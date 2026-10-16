"""Pool async de conexiones con el rol de solo lectura zeny_lector."""
from datetime import date, datetime
from decimal import Decimal

from psycopg_pool import AsyncConnectionPool

from app.settings import settings

pool = AsyncConnectionPool(settings.dsn, min_size=1, max_size=6, open=False)


def to_json(value):
    """Valor de Postgres → valor JSON. Las fechas quedan en hora local (la sesión usa America/Bogota)."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.replace(tzinfo=None).isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


async def query(sql: str, limit: int) -> tuple[list[str], list[dict], bool]:
    """Ejecuta una consulta de solo lectura. Devuelve (columnas, filas ≤ limit, truncado)."""
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(sql)
        if cur.description is None:
            return [], [], False
        cols = [d.name for d in cur.description]
        rows = await cur.fetchmany(limit + 1)
        truncated = len(rows) > limit
        data = [{c: to_json(v) for c, v in zip(cols, r)} for r in rows[:limit]]
        return cols, data, truncated
