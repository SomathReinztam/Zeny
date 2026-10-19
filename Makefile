.PHONY: install etl backend backend-gemini frontend probar \
        up down docker-etl langfuse-db langfuse-up langfuse-down

# ─── Desarrollo local (sin Docker) ────────────────────────────────────────────
install:            ## dependencias Python (uv) y frontend (npm)
	uv sync
	cd frontend && npm install

etl:                ## carga los .xlsx a zeny-db (idempotente, local)
	uv run python -m etl.cargar_xlsx

backend:            ## servidor AG-UI en :8100 con el LLM de .env
	cd backend && uv run uvicorn app.api:app --port 8100 --reload

backend-gemini:     ## igual, forzando Gemini (respaldo)
	cd backend && LLM_PROVIDER=gemini uv run uvicorn app.api:app --port 8100 --reload

frontend:           ## interfaz en :3002
	cd frontend && npm run dev

probar:             ## prueba el agente por consola: make probar Q="¿Hay trackers con problemas?"
	uv run python scripts/probar_agente.py "$(Q)"

# ─── Docker: app (backend + frontend + ETL) ───────────────────────────────────
# Requiere ../pgDataBase levantado (zeny-db en :5434). Ver docs/DOCKER.md.
up:                 ## construye y levanta backend + frontend en Docker
	docker compose up -d --build backend frontend

down:               ## baja la app (backend + frontend)
	docker compose down

docker-etl:         ## recarga los .xlsx a zeny-db desde el contenedor ETL
	docker compose run --rm etl

# ─── Docker: Langfuse (reutiliza el Postgres de zeny-db) ──────────────────────
langfuse-db:        ## crea el rol y la base `langfuse` en zeny-db (idempotente)
	@set -a; . ./.env; set +a; \
	docker exec -e LANGFUSE_DB_PASS="$$LANGFUSE_DB_PASS" -i zeny-db \
	  psql -U "$$DB_USER" -d postgres < db/langfuse_init.sql

langfuse-up:        ## levanta la pila de Langfuse (web en :3010)
	docker compose --env-file .env -p zeny-langfuse -f infra/langfuse.yml up -d

langfuse-down:      ## baja la pila de Langfuse
	docker compose --env-file .env -p zeny-langfuse -f infra/langfuse.yml down
