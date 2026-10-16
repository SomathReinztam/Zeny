"""Grafo de Zeny: agente principal (conversa, planea, delega y GRAFICA) y subagente analista-sql
(investiga los datos y devuelve hallazgos + SQL verificado).

Se arma con las piezas de deepagents (SubAgentMiddleware → tool `task`, ejecución paralela de
subagentes) y TodoListMiddleware (plan visible), sin las tools de sistema de archivos que trae
create_deep_agent por defecto: con modelos locales, menos tools = decisiones más fiables.
"""
from deepagents.backends import StateBackend
from deepagents.middleware.subagents import CompiledSubAgent, SubAgentMiddleware
from langchain.agents import create_agent
from langchain.agents.middleware import TodoListMiddleware
from langgraph.checkpoint.memory import MemorySaver

from app.agents.tools_sql import ChartsMiddleware, crear_grafica, ejecutar_sql
from app.common.llm import make_llm
from app.prompts import ANALISTA_PROMPT, ZENY_PROMPT

ANALISTA_DESCRIPCION = (
    "Analista de datos de la planta. Consulta la base de datos (energía, clima, trackers, calidad de "
    "datos) y devuelve hallazgos con cifras + consultas SQL verificadas listas para crear_grafica. "
    "Pásale una tarea concreta e indica qué quieres graficar. Puedes lanzar varias en paralelo."
)


def build_analista(diccionario: str):
    graph = create_agent(
        make_llm("sql"),
        tools=[ejecutar_sql],
        system_prompt=ANALISTA_PROMPT.format(diccionario=diccionario),
        name="analista-sql",
    )
    # Sus eventos (razonamiento, SQL, resultados) SÍ se transmiten, etiquetados con subagent_run_id
    # (subagent_visibility="attributed" en api.py). El frontend los enruta a la tarjeta del subagente.
    return graph.with_config({"recursion_limit": 40})


def build_zeny(diccionario: str):
    analista = CompiledSubAgent(
        name="analista-sql", description=ANALISTA_DESCRIPCION, runnable=build_analista(diccionario)
    )
    return create_agent(
        make_llm("main"),
        tools=[crear_grafica],
        system_prompt=ZENY_PROMPT,
        middleware=[
            TodoListMiddleware(),
            SubAgentMiddleware(backend=StateBackend(), subagents=[analista]),
            ChartsMiddleware(),
        ],
        checkpointer=MemorySaver(),
        name="zeny",
    )
