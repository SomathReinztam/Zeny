"""Genera el diccionario de datos (para el prompt del analista SQL) desde los COMMENT ON de Postgres."""
from app.common.db import pool

_SQL = """
SELECT n.nspname, c.relname, c.relkind, obj_description(c.oid, 'pg_class') AS rel_comment,
       a.attname, format_type(a.atttypid, a.atttypmod) AS tipo,
       col_description(c.oid, a.attnum) AS col_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname IN ('planta', 'telemetria', 'analitica') AND c.relkind IN ('r', 'v')
  AND c.relname <> 'cargas'
ORDER BY n.nspname DESC, c.relname, a.attnum
"""


async def build_diccionario() -> str:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute("SELECT nspname, obj_description(oid, 'pg_namespace') FROM pg_namespace "
                          "WHERE nspname IN ('planta', 'telemetria', 'analitica') ORDER BY nspname DESC")
        esquemas = await cur.fetchall()
        await cur.execute(_SQL)
        rows = await cur.fetchall()
        await cur.execute("SELECT clave, valor, unidad, descripcion FROM planta.parametros ORDER BY clave")
        params = await cur.fetchall()
        await cur.execute("SELECT min(ts)::date, max(ts)::date FROM telemetria.clima")
        rango = await cur.fetchone()

    out = [f"Datos disponibles: del {rango[0]} al {rango[1]} (hora local de Colombia).", ""]
    for esq, com in esquemas:
        out.append(f"## Esquema {esq}: {com}")
    actual = None
    for esq, rel, kind, rel_com, col, tipo, col_com in rows:
        if (esq, rel) != actual:
            actual = (esq, rel)
            out += ["", f"### {esq}.{rel} ({'vista' if kind == 'v' else 'tabla'})", rel_com or ""]
        out.append(f"- {col} ({tipo})" + (f": {col_com}" if col_com else ""))
    out += ["", "## Parámetros de planta (planta.parametros)"]
    out += [f"- {k} = {float(v):g} {u or ''} — {d}" for k, v, u, d in params]
    return "\n".join(out)
