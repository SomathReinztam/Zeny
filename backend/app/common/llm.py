"""Fábrica de LLM por rol. El proveedor se elige con LLM_PROVIDER en .env.

El "razonamiento" (thinking) se activa por rol para el modo en vivo de la expo: el agente emite sus
tokens de pensamiento y AG-UI los transmite como eventos REASONING. En vLLM (Qwen3) ya está el
--reasoning-parser qwen3; aquí solo se enciende por petición. En Gemini se pide include_thoughts.
"""
from langchain_core.language_models import BaseChatModel

from app.settings import settings


def make_llm(role: str = "main") -> BaseChatModel:
    thinking = settings.thinking_sql if role == "sql" else settings.thinking_main

    if settings.llm_provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        kwargs = {}
        if thinking:
            # Presupuesto de pensamiento acotado: suficiente para "ver" que razona sin disparar latencia/costo.
            kwargs = {"thinking_budget": settings.gemini_thinking_budget, "include_thoughts": True}
        return ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.google_api_key,
            temperature=0.2,
            **kwargs,
        )

    from langchain_openai import ChatOpenAI

    model = settings.model_sql if role == "sql" else settings.model_main
    return ChatOpenAI(
        model=model,
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        temperature=0.2,
        timeout=600,
        # Qwen3: el razonamiento se activa/desactiva por petición desde la plantilla de chat.
        extra_body={"chat_template_kwargs": {"enable_thinking": thinking}},
    )
