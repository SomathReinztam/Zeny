"""Observabilidad: logging estructurado + callbacks de LangChain.

Dos capas complementarias:
- Logs (siempre activos): arranque, errores de LLM (p. ej. 429 de Gemini), errores de tool y
  resultados de tool que empiezan con "ERROR". Esto cubre el punto ciego: cuando un subagente falla,
  LangGraph convierte el error en texto y el agente principal simplemente termina, sin traza en consola.
- Langfuse (opcional): si hay credenciales en el entorno, se añade su callback para ver el árbol de
  cada corrida (agente, subagentes, tools, SQL, tokens, latencias, errores).

Ambas se enchufan como callbacks de LangChain, que se propagan a subagentes y tools.
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from langchain_core.callbacks import BaseCallbackHandler

from app.settings import ROOT, settings

log = logging.getLogger("zeny")

_FORMATO = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s | %(message)s", "%H:%M:%S")


def configurar_logging() -> None:
    """Configura el logger 'zeny' hacia stdout y a un archivo rotado. Idempotente (sobrevive a --reload).

    El archivo (por defecto <repo>/logs/zeny.log, en Docker /app/logs montado en ./logs del host) deja ver
    los logs sin entrar al contenedor. Si el directorio no es escribible, se sigue solo con stdout.
    """
    nivel = getattr(logging, settings.log_level.upper(), logging.INFO)
    root = logging.getLogger()

    if not any(getattr(h, "_zeny", False) for h in root.handlers):
        stdout = logging.StreamHandler(sys.stdout)
        stdout.setFormatter(_FORMATO)
        stdout._zeny = True  # type: ignore[attr-defined]
        root.addHandler(stdout)

    if not any(getattr(h, "_zeny_file", False) for h in root.handlers):
        try:
            carpeta = Path(settings.log_dir) if settings.log_dir else ROOT / "logs"
            carpeta.mkdir(parents=True, exist_ok=True)
            archivo = RotatingFileHandler(
                carpeta / "zeny.log", maxBytes=5_000_000, backupCount=5, encoding="utf-8"
            )
            archivo.setFormatter(_FORMATO)
            archivo._zeny_file = True  # type: ignore[attr-defined]
            root.addHandler(archivo)
        except OSError as e:  # noqa: BLE001 — sin archivo seguimos con stdout
            log.warning("No se pudo abrir el archivo de log (%r); se usa solo stdout.", e)

    root.setLevel(min(nivel, logging.INFO))
    log.setLevel(nivel)


def _etiqueta(kwargs: dict) -> str:
    """Nombre de la tool/modelo y el subagente (si lo hay) para correlacionar en los logs."""
    nombre = kwargs.get("name") or "?"
    meta = kwargs.get("metadata") or {}
    nodo = meta.get("langgraph_node") or meta.get("checkpoint_ns", "")
    return f"{nombre}" + (f" [{nodo}]" if nodo else "")


class LogCallback(BaseCallbackHandler):
    """Registra los errores que de otro modo quedarían tragados en la capa de tools/LLM."""

    def on_llm_error(self, error, **kwargs):  # noqa: ANN001
        log.error("Error de LLM en %s: %r", _etiqueta(kwargs), error)

    def on_tool_error(self, error, **kwargs):  # noqa: ANN001
        log.error("Error de tool %s: %r", _etiqueta(kwargs), error)

    def on_tool_end(self, output, **kwargs):  # noqa: ANN001
        texto = output if isinstance(output, str) else getattr(output, "content", None)
        if isinstance(texto, str) and texto.lstrip().startswith("ERROR"):
            log.warning("La tool %s devolvió un error: %s", _etiqueta(kwargs), texto[:300])

    def on_retry(self, retry_state, **kwargs):  # noqa: ANN001
        log.warning(
            "Reintento en %s (intento %s): %r",
            _etiqueta(kwargs),
            getattr(retry_state, "attempt_number", "?"),
            getattr(retry_state, "outcome", None),
        )


def _langfuse_handler():
    """Devuelve el callback de Langfuse si hay credenciales, o None. Soporta SDK v3 y v2."""
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        return None
    # El SDK v3 lee las claves de las variables de entorno del proceso. En local vienen del .env
    # (vía pydantic) y no quedan exportadas, así que las exportamos aquí antes de construirlo.
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
    os.environ.setdefault("LANGFUSE_HOST", settings.langfuse_host)
    try:
        try:
            from langfuse.langchain import CallbackHandler  # SDK v3+ (lee claves del entorno)

            handler = CallbackHandler()
        except ImportError:
            from langfuse.callback import CallbackHandler  # SDK v2

            handler = CallbackHandler(
                public_key=settings.langfuse_public_key,
                secret_key=settings.langfuse_secret_key,
                host=settings.langfuse_host,
            )
        log.info("Langfuse activo (host=%s)", settings.langfuse_host)
        return handler
    except Exception as e:  # noqa: BLE001 — Langfuse nunca debe tumbar el agente
        log.warning("Langfuse configurado pero no se pudo inicializar: %r", e)
        return None


def construir_callbacks() -> list[BaseCallbackHandler]:
    """Callbacks para la corrida del grafo: logging siempre, Langfuse si está configurado."""
    callbacks: list[BaseCallbackHandler] = [LogCallback()]
    lf = _langfuse_handler()
    if lf is not None:
        callbacks.append(lf)
    return callbacks
