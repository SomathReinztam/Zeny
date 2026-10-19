"""Servidor AG-UI de Zeny.

    cd backend && uv run uvicorn app.api:app --port 8100 --reload
"""
from contextlib import asynccontextmanager

from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.zeny import build_zeny
from app.common.db import pool
from app.common.diccionario import build_diccionario
from app.common.observabilidad import configurar_logging, construir_callbacks, log
from app.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    configurar_logging()
    callbacks = construir_callbacks()
    log.info(
        "Arrancando Zeny · proveedor=%s · modelo_main=%s · modelo_sql=%s · thinking_main=%s/thinking_sql=%s",
        settings.llm_provider,
        settings.model_main,
        settings.model_sql,
        settings.thinking_main,
        settings.thinking_sql,
    )
    await pool.open()
    # El diccionario de datos se lee de la base (COMMENT ON) al arrancar.
    graph = build_zeny(await build_diccionario())
    add_langgraph_fastapi_endpoint(
        app,
        LangGraphAgent(
            name="zeny",
            graph=graph,
            # callbacks se propaga a subagentes y tools: ahí se registran los errores (429, etc.).
            config={"recursion_limit": 60, "callbacks": callbacks},
            emit_raw_events=False,
            subagent_visibility="attributed",  # emite SUBAGENT_* y etiqueta cada evento con subagent_run_id
        ),
        path="/agui",
    )
    log.info("Zeny listo en /agui")
    yield
    await pool.close()


app = FastAPI(title="Zeny", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "llm_provider": settings.llm_provider}
