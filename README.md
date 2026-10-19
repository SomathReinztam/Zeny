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
# 0. Postgres: Levantar postgres 
cd ../pgDataBase && docker compose up -d

# 1. Crear la base `langfuse` dentro de zeny-db (solo la primera vez)
make langfuse-db

# 2. Levantar Langfuse — la PRIMERA vez descarga ClickHouse/MinIO/Redis (varios GB)
make langfuse-up
#    → abre http://localhost:3010, crea cuenta + proyecto,
#      copia la public key y secret key a LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY en .env

# 3. Levantar la app (construye backend + frontend; la 1ª vez el npm build tarda)
make up

# 4. Cargar los datos a la BD (idempotente; solo si necesitas (re)cargar)
make docker-etl

Luego abres http://localhost:3002.

```


## Documentos
- [`docs/PLAN.md`](docs/PLAN.md): plan, arquitectura y estado (§12).
- [`docs/CONTRATO_UI.md`](docs/CONTRATO_UI.md): contrato AG-UI entre backend y frontend.
