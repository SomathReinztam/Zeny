"""Carga los reportes .xlsx de la minigranja a Postgres (idempotente).

    uv run python -m etl.cargar_xlsx --dir ../data/Reportes-minigranja-Joropo

Reglas de interpretación (ver docs/PLAN.md §3):
- Las marcas de tiempo son hora local de Colombia; la "Z" del exportador es incorrecta y se ignora.
- "-1" en columnas de clima = lectura inválida → NULL.
- La fila TOTAL de inversores se descarta. Celdas vacías → NULL ("sin dato" ≠ cero).
- Cada archivo se identifica por sus columnas, no por su nombre.
"""
import argparse
import hashlib
import io
import os
import tomllib
from pathlib import Path

import pandas as pd
import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
TZ = "America/Bogota"

# columnas del reporte → (tabla destino, renombrado)
FUENTES = {
    "tracker_posicion": {
        "ID Dispositivo": "tracker_id",
        "Fecha / Hora": "ts",
        "Ángulo Pitch (°)": "pitch_deg",
    },
    "tracker_electrica": {
        "ID Dispositivo": "tracker_id",
        "Fecha / Hora": "ts",
        "Corriente Batería (A)": "i_bateria_a",
        "Corriente Panel (A)": "i_panel_a",
        "Voltaje Batería (V)": "v_bateria_v",
        "Voltaje de Entrada Panel (V)": "v_panel_v",
    },
    "clima": {
        "Fecha / Hora": "ts",
        "Velocidad del viento (m/s)": "viento_ms",
        "Dirección del viento (°)": "viento_dir_deg",
        "Lluvia (mm)": "lluvia_mm",
        "Radiación (W/m²)": "ghi_wm2",
        "Temperatura ambiente (°C)": "temp_ambiente_c",
        "Temperatura panel (°C)": "temp_panel_c",
        "Radiación POA (W/m²)": "poa_wm2",
        "Suciedad (%)": "limpieza_pct",
        "Voltaje batería (V)": "v_bateria_estacion_v",
    },
    "energia_inversores": {"Fecha / Hora": "ts", "Generación (kWh)": "kwh"},
    "energia_frontera": {"Fecha / Hora": "ts", "Valor": "kwh", "Unidad": "unidad"},
}
LLAVES = {
    "tracker_posicion": ["tracker_id", "ts"],
    "tracker_electrica": ["tracker_id", "ts"],
    "clima": ["ts"],
    "energia_inversores": ["ts"],
    "energia_frontera": ["ts"],
}


def conectar() -> psycopg.Connection:
    load_dotenv(ROOT / ".env")
    return psycopg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5434"),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASS"],
        dbname=os.environ["DB_NAME"],
    )


def identificar(cols: set[str]) -> str:
    for tabla, mapa in FUENTES.items():
        if set(mapa) == cols:
            return tabla
    raise ValueError(f"Columnas no reconocidas: {sorted(cols)}")


def normalizar(tabla: str, df: pd.DataFrame, trackers: set[str]) -> tuple[pd.DataFrame, int]:
    n0 = len(df)
    df = df.rename(columns=FUENTES[tabla])
    df = df[df["ts"].astype(str).str.upper() != "TOTAL"]
    ts = df["ts"].astype(str).str.replace("Z", "", regex=False).str.replace("T", " ", regex=False)
    df = df.assign(ts=pd.to_datetime(ts, errors="coerce").dt.tz_localize(TZ))
    df = df.dropna(subset=["ts"])

    if tabla == "clima":
        valores = [c for c in df.columns if c != "ts"]
        df[valores] = df[valores].mask(df[valores] == -1)
    if tabla == "energia_frontera":
        assert set(df["unidad"].dropna()) <= {"kWh"}, "Unidad inesperada en frontera"
        df = df.drop(columns="unidad")
    if "tracker_id" in df.columns:
        df = df[df["tracker_id"].isin(trackers)]
    if tabla == "tracker_posicion":
        df = df[df["pitch_deg"].between(-90, 90)]

    df = df.drop_duplicates(subset=LLAVES[tabla])
    return df, n0 - len(df)


def cargar_catalogo(cur: psycopg.Cursor, toml_path: Path) -> set[str]:
    cat = tomllib.loads(toml_path.read_text())
    seg = cat["equipos"]["seguidores_solares"]
    for clave, t in seg["lista"].items():
        numero = int(clave.split("_")[1])
        cur.execute(
            "INSERT INTO planta.trackers VALUES (%s, %s, %s) "
            "ON CONFLICT (tracker_id) DO UPDATE SET numero = EXCLUDED.numero, nombre = EXCLUDED.nombre",
            (t["mac_id"], numero, t["nombre"]),
        )
    for clave, inv in cat["equipos"]["inversores"]["lista"].items():
        cur.execute(
            "INSERT INTO planta.inversores VALUES (%s, %s, %s, %s) ON CONFLICT (inversor_id) DO UPDATE "
            "SET nombre = EXCLUDED.nombre, modelo = EXCLUDED.modelo, potencia_nominal_kw = EXCLUDED.potencia_nominal_kw",
            (int(clave.split("_")[1]), inv["nombre"], inv["modelo"], inv["potencia_nominal_kw"]),
        )

    sens = cat["equipos"]["estacion_meteorologica"]["sensores"]
    parametros = [
        ("potencia_instalada_kwp", cat["proyecto"]["potencia_instalada_kw"], "kWp", "Potencia pico DC instalada (supuesto: pico DC). Base del PR de referencia."),
        ("capacidad_ac_kw", cat["equipos"]["inversores"]["potencia_nominal_planta_kw"], "kW", "Capacidad AC total de los 5 inversores."),
        ("trackers_catalogo", seg["cantidad_total"], "unidades", "Trackers en el catálogo de la planta."),
        ("pitch_min_deg", seg["angulo_minimo_deg"], "°", "Ángulo mínimo mecánico de los trackers."),
        ("pitch_max_deg", seg["angulo_maximo_deg"], "°", "Ángulo máximo mecánico de los trackers."),
        ("posicion_defensa_deg", seg["posicion_defensa_viento_deg"], "°", "Posición de defensa (stow) ante viento fuerte."),
        ("tolerancia_tracker_deg", seg["tolerancia_desviacion_deg"], "°", "Tolerancia de seguimiento respecto al ángulo objetivo (no hay ángulo objetivo en los datos)."),
        ("desviacion_tracker_alerta_deg", 10, "°", "Desviación respecto a la mediana de la flota que sugiere tracker desalineado (preliminar)."),
        ("bateria_tracker_baja_v", 23.5, "V", "Voltaje de batería del controlador considerado bajo (preliminar)."),
        ("viento_alerta_ms", sens["anemometro_velocidad"]["umbral_alerta_viento_fuerte"], "m/s", "Viento fuerte: los trackers deberían ir a posición de defensa."),
        ("temp_panel_alerta_c", sens["temperatura_panel"]["umbral_efecto_termico_c"], "°C", "Temperatura de módulo a partir de la cual las pérdidas térmicas son relevantes."),
        ("coef_perdida_termica_pct_c", sens["temperatura_panel"]["coeficiente_perdida_pct_c"], "%/°C", "Pérdida de potencia por °C sobre 25 °C."),
        ("pr_posible_falla", 0.6, "", "PR diario por debajo del cual, con sol suficiente, se sospecha falla (preliminar)."),
    ]
    for p in parametros:
        cur.execute(
            "INSERT INTO planta.parametros VALUES (%s, %s, %s, %s) ON CONFLICT (clave) DO UPDATE "
            "SET valor = EXCLUDED.valor, unidad = EXCLUDED.unidad, descripcion = EXCLUDED.descripcion",
            p,
        )
    return {t["mac_id"] for t in seg["lista"].values()}


def copiar(cur: psycopg.Cursor, tabla: str, df: pd.DataFrame) -> int:
    cols = list(df.columns)
    tmp = f"tmp_{tabla}"
    cur.execute(f"CREATE TEMP TABLE {tmp} (LIKE telemetria.{tabla} INCLUDING DEFAULTS) ON COMMIT DROP")
    buf = io.StringIO()
    df.to_csv(buf, index=False, header=False, na_rep="\\N", date_format="%Y-%m-%d %H:%M:%S%z")
    buf.seek(0)
    with cur.copy(f"COPY {tmp} ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')") as cp:
        cp.write(buf.read())
    cur.execute(
        f"INSERT INTO telemetria.{tabla} ({', '.join(cols)}) SELECT {', '.join(cols)} FROM {tmp} ON CONFLICT DO NOTHING"
    )
    return cur.rowcount


def crear_rol_lector(cur: psycopg.Cursor) -> None:
    pwd = os.getenv("ZENY_LECTOR_PASS")
    if not pwd:
        print("ZENY_LECTOR_PASS no definido: no se crea el rol de solo lectura.")
        return
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = 'zeny_lector'")
    verbo = "ALTER" if cur.fetchone() else "CREATE"
    cur.execute(psycopg.sql.SQL(f"{verbo} ROLE zeny_lector LOGIN PASSWORD {{}}").format(psycopg.sql.Literal(pwd)))
    db = os.environ["DB_NAME"]
    cur.execute(f'GRANT CONNECT ON DATABASE "{db}" TO zeny_lector')
    for esquema in ("planta", "telemetria", "analitica"):
        cur.execute(f"GRANT USAGE ON SCHEMA {esquema} TO zeny_lector")
        cur.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {esquema} TO zeny_lector")
    cur.execute("ALTER ROLE zeny_lector SET default_transaction_read_only = on")
    cur.execute("ALTER ROLE zeny_lector SET statement_timeout = '20s'")
    cur.execute("ALTER ROLE zeny_lector SET timezone = 'America/Bogota'")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(ROOT.parent / "data" / "Reportes-minigranja-Joropo"))
    ap.add_argument("--toml", default=str(ROOT / "config" / "planta_joropo.toml"))
    args = ap.parse_args()

    with conectar() as conn, conn.cursor() as cur:
        cur.execute((ROOT / "db" / "schema.sql").read_text())
        trackers = cargar_catalogo(cur, Path(args.toml))
        cur.execute(f"ALTER DATABASE \"{os.environ['DB_NAME']}\" SET timezone = '{TZ}'")
        conn.commit()

        for archivo in sorted(Path(args.dir).glob("*.xlsx")):
            sha = hashlib.sha256(archivo.read_bytes()).hexdigest()
            cur.execute("SELECT 1 FROM telemetria.cargas WHERE sha256 = %s", (sha,))
            if cur.fetchone():
                print(f"= {archivo.name}: ya cargado")
                continue
            df = pd.read_excel(archivo, engine="calamine")
            tabla = identificar(set(df.columns))
            df, descartadas = normalizar(tabla, df, trackers)
            insertadas = copiar(cur, tabla, df)
            cur.execute(
                "INSERT INTO telemetria.cargas (archivo, sha256, tabla, filas, filas_descartadas) VALUES (%s, %s, %s, %s, %s)",
                (archivo.name, sha, tabla, insertadas, descartadas),
            )
            conn.commit()
            print(f"+ {archivo.name} → telemetria.{tabla}: {insertadas} filas ({descartadas} descartadas)")

        cur.execute((ROOT / "db" / "views.sql").read_text())
        crear_rol_lector(cur)
        conn.commit()
        cur.execute("ANALYZE")
    print("Listo.")


if __name__ == "__main__":
    main()
