"""Fábrica de LLM por rol. El proveedor se elige con LLM_PROVIDER en .env.

El "razonamiento" (thinking) se activa por rol para el modo en vivo de la expo: el agente emite sus
tokens de pensamiento y AG-UI los transmite como eventos REASONING. En vLLM (Qwen3) ya está el
--reasoning-parser qwen3; aquí solo se enciende por petición. En Gemini se pide include_thoughts.
"""
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.settings import settings


class _ChatOpenAIRazona(ChatOpenAI):
    """ChatOpenAI que rescata el razonamiento en streaming.

    vLLM (con --reasoning-parser) manda el pensamiento en `delta.reasoning` (o `reasoning_content`
    según el build; esta EVO usa `reasoning`), pero `ChatOpenAI` base lo DESCARTA a propósito. Lo
    reexponemos en `additional_kwargs['reasoning_content']`, que es justo lo que AG-UI lee para emitir
    los eventos REASONING. Se añade el delta por chunk (no acumulado), que es como AG-UI lo transmite.
    """

    def _convert_chunk_to_generation_chunk(self, chunk, default_chunk_class, base_generation_info):
        gen = super()._convert_chunk_to_generation_chunk(chunk, default_chunk_class, base_generation_info)
        if gen is None:
            return gen
        try:
            choices = chunk.get("choices") or chunk.get("chunk", {}).get("choices") or []
            delta = (choices[0].get("delta") or {}) if choices else {}
            texto = delta.get("reasoning_content") or delta.get("reasoning")
            if isinstance(texto, str) and texto:
                gen.message.additional_kwargs["reasoning_content"] = texto
        except Exception:  # noqa: BLE001 — nunca romper el stream por el razonamiento
            pass
        return gen


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

    model = settings.model_sql if role == "sql" else settings.model_main
    return _ChatOpenAIRazona(
        model=model,
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        temperature=0.2,
        timeout=settings.llm_timeout_s,
        # Timeout ENTRE chunks. Con la EVO (GPU lenta) y subagentes en paralelo, una petición puede
        # quedar encolada en vLLM y tardar >120s (el default) en el primer token. None = desactivado.
        stream_chunk_timeout=settings.stream_chunk_timeout_s,
        # Qwen3: el razonamiento se activa/desactiva por petición desde la plantilla de chat.
        extra_body={"chat_template_kwargs": {"enable_thinking": thinking}},
    )
