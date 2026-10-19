# Despliegue con Docker

Zeny se ejecuta en contenedores, pero **reutiliza infraestructura que ya corre en el host**:

- **Postgres** (`zeny-db`, puerto `5434`) vive en `../pgDataBase` con su volumen externo.
  Ni este compose ni Langfuse lo duplican ni migran su volumen.
- **La EVO (LLM vLLM)** vive en la VPN (`http://10.8.0.82:8000/v1`), enrutable por NAT del host.

Por eso los contenedores **no comparten red** con esos servicios: los alcanzan a través del host con
`host.docker.internal` (declarado como `extra_hosts: host-gateway` en cada servicio). Así:

- Backend/ETL → Postgres: `host.docker.internal:5434`.
- Backend → EVO: su IP de VPN directa (el NAT del host enruta).
- Backend → Langfuse: `http://host.docker.internal:3010`.

## Piezas

| Archivo | Qué levanta |
|---|---|
| `Dockerfile` (raíz) | Imagen única **backend AG-UI + ETL** (python:3.12-slim + uv). |
| `frontend/Dockerfile` | Imagen del **frontend** Next.js 16 (node:20-slim). |
| `docker-compose.yml` (raíz) | Servicios `backend` (:8100), `frontend` (:3002) y `etl` (perfil `tools`). |
| `infra/langfuse.yml` | Langfuse v4 (web :3010, worker, clickhouse, redis, minio) **sin su propio Postgres**. |
| `db/langfuse_init.sql` | Crea el rol y la base `langfuse` dentro de `zeny-db`. |

## Orden de arranque (primera vez)

```bash
# 1. El Postgres (zeny-db) debe estar arriba
cd ../pgDataBase && docker compose up -d && cd -

# 2. Crear el rol y la base `langfuse` dentro de zeny-db (idempotente)
make langfuse-db

# 3. Levantar la pila de Langfuse (web en http://localhost:3010)
make langfuse-up

# 4. Abrir http://localhost:3010, crear la cuenta y un proyecto.
#    Copiar las claves del proyecto (pk-lf-... / sk-lf-...) al .env:
#       LANGFUSE_PUBLIC_KEY=pk-lf-...
#       LANGFUSE_SECRET_KEY=sk-lf-...

# 5. Construir y levantar la app (backend :8100 + frontend :3002)
make up

# 6. (Solo si hay que cargar/recargar los .xlsx a la base)
make docker-etl
```

Arranques posteriores: basta `cd ../pgDataBase && docker compose up -d`, `make langfuse-up` y `make up`.
El paso 2 (`make langfuse-db`) es idempotente y el 4 (claves) solo se hace una vez.

## Variables de entorno

Todo sale del `.env` del repo (ver `.env.example`):

- **App**: `DB_*`, `ZENY_LECTOR_PASS`, `LLM_*`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `MODEL_*`,
  `THINKING_*`, `LOG_LEVEL`, `LANGFUSE_PUBLIC_KEY/SECRET_KEY`.
  En el compose, `DB_HOST`, `DB_PORT` y `LANGFUSE_HOST` se **sobreescriben** para apuntar al host.
- **Langfuse**: `LANGFUSE_DB_PASS` (contraseña del rol en zeny-db), `ENCRYPTION_KEY`, `SALT`,
  `NEXTAUTH_SECRET`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`. Ya vienen con valores generados en `.env`.

El `.env` **no entra a las imágenes** (está en `.dockerignore`); se inyecta en runtime vía `env_file`.

## Frontend y tablets

`NEXT_PUBLIC_AGUI_URL` se **hornea en el build** (lo usa el navegador). Por defecto
`http://localhost:8100/agui`, válido en el PC del usuario. Para que **tablets/Expo** lleguen al
backend, reconstruye el frontend apuntando a la IP del host:

```bash
NEXT_PUBLIC_AGUI_URL=http://192.168.X.Y:8100/agui docker compose up -d --build frontend
```

## Notas

- `make langfuse-db` lee `LANGFUSE_DB_PASS` y `DB_USER` del `.env` y corre
  `db/langfuse_init.sql` dentro de `zeny-db`. Equivale a:
  `docker exec -e LANGFUSE_DB_PASS='...' -i zeny-db psql -U postgres -d postgres < db/langfuse_init.sql`.
- Langfuse corre sus **migraciones** automáticamente al arrancar sobre la base `langfuse`.
- El servicio `etl` tiene `profiles: ["tools"]`: **no** arranca con `make up`; se corre a demanda
  con `make docker-etl`. Monta los `.xlsx` de solo lectura desde `./docs/data` (relativo al repo,
  ignorado por git) hacia `/data` en el contenedor. Para cargar otros datos, deja los `.xlsx` ahí.
- La pila de Langfuse usa volúmenes nombrados propios (`zeny-langfuse_langfuse_*`); no toca los de la app.
