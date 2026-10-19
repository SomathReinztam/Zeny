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


## Reiniciar para empezar Langfuse de cero (sin tocar los datos de la app)

```bash
# baja Langfuse y borra SUS volúmenes (clickhouse/minio/redis)
docker compose --env-file .env -p zeny-langfuse -f infra/langfuse.yml down -v
# borra la base de metadatos (está en zeny-db, no en esos volúmenes)
docker exec -i zeny-db psql -U postgres -c 'DROP DATABASE IF EXISTS langfuse WITH (FORCE);'
# recrea y vuelve a levantar
make langfuse-db
make langfuse-up
```

## Borrar TODO (app + Langfuse)

```bash
# baja la app
make down  

# volúmenes de Langfuse
docker compose --env-file .env -p zeny-langfuse -f infra/langfuse.yml down -v   

# borra TODO el Postgres
cd ../pgDataBase && docker compose down -v                
```


