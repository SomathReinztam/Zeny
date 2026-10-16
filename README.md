# Zeny — analista de IA de la minigranja solar Joropo

Zeny conversa con el usuario, delega la investigación de los datos en subagentes SQL que trabajan en
paralelo y dibuja gráficas en vivo en el navegador mediante el protocolo **AG-UI**.

```text
Navegador :3002 (Next.js + CopilotKit)  ──AG-UI──►  Backend :8100 (FastAPI + LangGraph)
  lienzo de gráficas  ◄── STATE_SNAPSHOT ──             Zeny (principal): write_todos · task · crear_grafica
  chat + tarjetas de subagentes                          └─ analista-sql ×N en paralelo: ejecutar_sql
                                                                    │ solo lectura (zeny_lector)
                                                         Postgres zeny-db :5434  ◄── ETL de los .xlsx
```

## Arranque

```bash
cp .env.example .env        # credenciales de zeny-db, ZENY_LECTOR_PASS, LLM
make install                # uv sync + npm install
make etl                    # carga ../data/Reportes-minigranja-Joropo (idempotente)
make backend                # LLM según .env  (o: make backend-gemini)
make frontend               # http://localhost:3002   (?demo=1 sin backend, ?q=pregunta)
make probar Q="¿Hay trackers con problemas?"   # prueba por consola, sin frontend
```

Requiere la base `zeny-db` levantada (`../pgDataBase`, `docker compose up -d`).

## Documentos
- [`docs/PLAN.md`](docs/PLAN.md): plan, arquitectura y estado (§12).
- [`docs/CONTRATO_UI.md`](docs/CONTRATO_UI.md): contrato AG-UI entre backend y frontend.
