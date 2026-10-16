.PHONY: install etl backend backend-gemini frontend probar

install:            ## dependencias Python (uv) y frontend (npm)
	uv sync
	cd frontend && npm install

etl:                ## carga los .xlsx a zeny-db (idempotente)
	uv run python -m etl.cargar_xlsx

backend:            ## servidor AG-UI en :8100 con el LLM de .env
	cd backend && uv run uvicorn app.api:app --port 8100 --reload

backend-gemini:     ## igual, forzando Gemini (respaldo)
	cd backend && LLM_PROVIDER=gemini uv run uvicorn app.api:app --port 8100 --reload

frontend:           ## interfaz en :3002
	cd frontend && npm run dev

probar:             ## prueba el agente por consola: make probar Q="¿Hay trackers con problemas?"
	uv run python scripts/probar_agente.py "$(Q)"
