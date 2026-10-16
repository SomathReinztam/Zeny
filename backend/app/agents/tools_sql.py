"""Tools de datos: `ejecutar_sql` (analista-sql) y `crear_grafica` (Zeny, el agente principal).

Las gráficas viven en el estado `charts` (ver docs/CONTRATO_UI.md) y llegan al frontend en vivo.
Los datos de la gráfica NO entran al contexto del LLM: Zeny solo recibe un resumen corto.
"""
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, NotRequired

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.callbacks import adispatch_custom_event
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.prebuilt import InjectedState
from langgraph.types import Command
from pydantic import BaseModel, Field

from app.common.db import query

MAX_FILAS_LLM = 60
MAX_FILAS_GRAFICA = 2000


def merge_charts(a: dict | None, b: dict | None) -> dict:
    """Reducer idempotente: une por id (necesario porque varios subagentes escriben en paralelo)."""
    return {**(a or {}), **(b or {})}


class ChartsState(AgentState):
    charts: NotRequired[Annotated[dict[str, dict], merge_charts]]


class ChartsMiddleware(AgentMiddleware):
    """Añade la clave `charts` al estado del agente."""

    state_schema = ChartsState


def _tabla_compacta(cols: list[str], rows: list[dict]) -> str:
    def fmt(v: Any) -> str:
        if v is None:
            return "∅"
        if isinstance(v, float):
            return f"{v:.4g}"
        return str(v)

    lineas = [" | ".join(cols)]
    lineas += [" | ".join(fmt(r[c]) for c in cols) for r in rows]
    return "\n".join(lineas)


@tool
async def ejecutar_sql(sql: str, config: RunnableConfig) -> str:
    """Ejecuta una consulta SQL de SOLO LECTURA (PostgreSQL) y devuelve como máximo 60 filas.
    Agrega o filtra en SQL (GROUP BY, date_trunc, WHERE) en vez de traer datos crudos.
    ∅ significa NULL (sin dato)."""
    # El SQL se transmite al frontend como paso de trabajo en vivo (queda etiquetado con el
    # subagente porque el evento se emite dentro de su contexto). No viaja en TOOL_CALL_ARGS.
    try:
        await adispatch_custom_event("zeny_sql", {"sql": sql.strip()[:600]}, config=config)
    except Exception:  # noqa: BLE001 — el streaming no debe romper la consulta
        pass
    try:
        cols, rows, truncado = await query(sql, MAX_FILAS_LLM)
    except Exception as e:  # noqa: BLE001 — el error vuelve al modelo para que corrija la consulta
        return f"ERROR de SQL: {e}"
    if not cols:
        return "La consulta no devolvió columnas."
    aviso = f"\n(Resultado truncado a {MAX_FILAS_LLM} filas: agrega más o filtra.)" if truncado else ""
    return f"{len(rows)} filas:\n{_tabla_compacta(cols, rows)}{aviso}"


class SerieArg(BaseModel):
    campo: str = Field(description="Columna numérica del resultado SQL.")
    nombre: str = Field(description="Nombre legible para la leyenda.")
    unidad: str | None = Field(default=None, description="Unidad, p. ej. kWh, W/m², °, V.")
    eje: Literal["izq", "der"] = Field(default="izq", description="'der' para una segunda escala (doble eje).")


class KpiArg(BaseModel):
    etiqueta: str = Field(description="Texto del indicador, p. ej. 'Energía exportada'.")
    campo: str = Field(description="Columna de la PRIMERA fila del resultado SQL con el valor.")
    unidad: str | None = None
    estado: Literal["ok", "alerta", "critico"] | None = None
    detalle: str | None = Field(default=None, description="Aclaración corta bajo el valor.")


class GraficaArgs(BaseModel):
    titulo: str = Field(description="Título corto y claro para público no técnico.")
    tipo: Literal[
        "linea", "area", "barras", "barras_apiladas", "dispersion", "kpi", "tabla",
        "mapa_calor", "calendario", "dona", "medidor", "banda",
    ]
    sql: str = Field(description="Consulta SQL de solo lectura que produce los datos de la gráfica.")
    insight: str = Field(description="1–3 frases: qué muestra la gráfica y por qué importa. Solo cifras verificadas.")
    x: str | None = Field(default=None, description="Columna del eje X. En 'mapa_calor'/'calendario' es la fecha/día; en 'dona' la categoría. No aplica a 'kpi'/'medidor'.")
    x_es_tiempo: bool = Field(default=False, description="True si x es fecha/hora.")
    series: list[SerieArg] | None = Field(default=None, description="Series a graficar (linea/area/barras/dispersion). En 'banda': exactamente 3, en orden [mínimo, centro, máximo].")
    kpis: list[KpiArg] | None = Field(default=None, description="Solo para tipo 'kpi'.")
    y: str | None = Field(default=None, description="Solo 'mapa_calor': columna del eje Y categórico (p. ej. la hora del día).")
    valor: str | None = Field(default=None, description="Columna del valor numérico que da el color/tamaño en 'mapa_calor', 'calendario', 'dona' y 'medidor' (en 'medidor', de la primera fila).")
    maximo: float | None = Field(default=None, description="Solo 'medidor': tope de la escala (el valor va de 0 a este máximo).")
    unidad: str | None = Field(default=None, description="Unidad del valor en 'mapa_calor'/'calendario'/'medidor' (p. ej. kWh, %, W/m²).")
    subtitulo: str | None = None
    severidad: Literal["info", "alerta", "critico"] = "info"
    id: str | None = Field(default=None, description="Para REEMPLAZAR una gráfica existente, su id.")


@tool(args_schema=GraficaArgs)
async def crear_grafica(
    titulo: str,
    tipo: str,
    sql: str,
    insight: str,
    config: RunnableConfig,
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
    x: str | None = None,
    x_es_tiempo: bool = False,
    series: list[SerieArg] | None = None,
    kpis: list[KpiArg] | None = None,
    y: str | None = None,
    valor: str | None = None,
    maximo: float | None = None,
    unidad: str | None = None,
    subtitulo: str | None = None,
    severidad: str = "info",
    id: str | None = None,
) -> Command | str:
    """Ejecuta la consulta y publica una gráfica en el panel que ve el usuario (aparece al instante).

    Tipos:
    - linea/area: series de tiempo (x = tiempo).
    - barras/barras_apiladas: comparar categorías o días.
    - dispersion: relación entre dos variables.
    - kpi: indicadores grandes de una sola fila (usa `kpis`).
    - tabla: datos tal cual.
    - mapa_calor: x = día/fecha, y = hora u otra categoría, `valor` = color. Ideal para ver patrones
      hora×día (energía, POA) y detectar días oscuros de un vistazo.
    - calendario: una celda por día del mes coloreada por `valor` (x = fecha, `valor` = métrica diaria).
    - dona: composición por categorías (x = categoría, `valor` = cantidad).
    - medidor: un solo número con aguja (`valor` de la primera fila, `maximo` = tope, `unidad`).
    - banda: serie de tiempo con rango; `series` = exactamente 3 en orden [mínimo, centro, máximo]."""
    try:
        cols, rows, truncado = await query(sql, MAX_FILAS_GRAFICA)
    except Exception as e:  # noqa: BLE001
        return f"ERROR de SQL, la gráfica no se creó: {e}"
    if not rows:
        return "La consulta no devolvió filas; la gráfica no se creó."

    series_d = [s.model_dump() for s in series or []]
    requeridas = [c for c in [x, y, valor, *(s["campo"] for s in series_d)] if c]
    faltan = [c for c in requeridas if c not in cols]
    if faltan:
        return f"ERROR: columnas {faltan} no están en el resultado {cols}. La gráfica no se creó."
    if tipo == "banda" and len(series_d) != 3:
        return "ERROR: 'banda' requiere exactamente 3 series [mínimo, centro, máximo]. No se creó."

    chart: dict[str, Any] = {
        "id": id or uuid.uuid4().hex[:8],
        "titulo": titulo,
        "subtitulo": subtitulo,
        "tipo": tipo,
        "insight": insight,
        "severidad": severidad,
        "autor": "zeny",
        "creado_en": datetime.now().isoformat(timespec="seconds"),
        "sql": sql,
    }
    if tipo == "kpi":
        fila = rows[0]
        chart["kpis"] = [
            {**k.model_dump(exclude={"campo"}), "valor": fila.get(k.campo)} for k in kpis or []
        ]
    elif tipo == "medidor":
        chart.update(valor=rows[0].get(valor), maximo=maximo, unidad=unidad)
    else:
        chart.update(x=x, x_es_tiempo=x_es_tiempo, series=series_d, datos=rows)
        for k, v in (("y", y), ("valor", valor), ("unidad", unidad)):
            if v is not None:
                chart[k] = v

    # Publicación inmediata al frontend (AG-UI STATE_SNAPSHOT) sin esperar a que termine el turno.
    charts = {**state.get("charts", {}), chart["id"]: chart}
    await adispatch_custom_event("manually_emit_state", {"charts": charts}, config=config)

    resumen = f"Gráfica '{titulo}' publicada (id={chart['id']}, {len(rows)} filas"
    resumen += ", truncada" if truncado else ""
    resumen += ")."
    return Command(
        update={
            "charts": {chart["id"]: chart},
            "messages": [ToolMessage(resumen, tool_call_id=tool_call_id)],
        }
    )
