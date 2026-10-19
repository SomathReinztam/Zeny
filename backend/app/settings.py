"""Configuración leída de Zeny/.env."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    db_host: str = "localhost"
    db_port: int = 5434
    db_name: str = "zeny_agent_db"
    zeny_lector_pass: str

    # LLM: "openai_compat" (vLLM en la EVO-X2) o "gemini"
    llm_provider: str = "openai_compat"
    llm_base_url: str = "http://10.8.0.82:8000/v1"
    llm_api_key: str = "EMPTY"
    model_main: str = "qwen3-27b"
    model_sql: str = "qwen3-27b"
    thinking_main: bool = True
    thinking_sql: bool = True
    gemini_thinking_budget: int = 1024
    # Gemini es rápido: un timeout corto evita que un stream estancado cuelgue la corrida.
    gemini_timeout_s: float = 90
    gemini_max_retries: int = 2
    llm_timeout_s: float = 900
    # Timeout entre chunks del stream (langchain-openai). None = desactivado (recomendado para la EVO).
    stream_chunk_timeout_s: float | None = None
    google_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash"

    cors_origins: str = "http://localhost:3002"

    # Observabilidad
    log_level: str = "INFO"
    # Carpeta de logs; vacío = <repo>/logs. En Docker se fija a /app/logs (montado en ./logs del host).
    log_dir: str | None = None
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "http://localhost:3010"

    @property
    def dsn(self) -> str:
        return (
            f"host={self.db_host} port={self.db_port} dbname={self.db_name} "
            f"user=zeny_lector password={self.zeny_lector_pass}"
        )


settings = Settings()
