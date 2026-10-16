"""Prueba el grafo de Zeny sin frontend: imprime tool calls, gráficas publicadas y la respuesta.

    uv run python scripts/probar_agente.py "¿Cómo le fue a la planta en septiembre?"
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.agents.zeny import build_zeny  # noqa: E402
from app.common.db import pool  # noqa: E402
from app.common.diccionario import build_diccionario  # noqa: E402
from app.settings import settings  # noqa: E402


async def main(pregunta: str) -> None:
    await pool.open()
    graph = build_zeny(await build_diccionario())
    t0 = time.time()
    print(f"[{settings.llm_provider}] {pregunta}\n")
    async for ev in graph.astream_events(
        {"messages": [{"role": "user", "content": pregunta}]},
        {"configurable": {"thread_id": "cli"}, "recursion_limit": 60},
    ):
        t = f"{time.time() - t0:6.1f}s"
        kind, name = ev["event"], ev["name"]
        if kind == "on_tool_start":
            print(f"{t} → {name}: {str(ev['data'].get('input'))[:220]}")
        elif kind == "on_tool_end" and name in ("ejecutar_sql", "task"):
            print(f"{t} ← {name}: {str(ev['data'].get('output'))[:300]}")
        elif kind == "on_custom_event":
            charts = ev["data"].get("charts", {})
            print(f"{t} ★ STATE charts={[c['titulo'] for c in charts.values()]}")
    state = await graph.aget_state({"configurable": {"thread_id": "cli"}})
    print(f"\n=== Respuesta ({time.time() - t0:.0f}s) ===\n{state.values['messages'][-1].content}")
    print("\nGráficas en estado:", [c["titulo"] for c in state.values.get("charts", {}).values()])
    await pool.close()


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "¿Cómo le fue a la planta en septiembre?"))
