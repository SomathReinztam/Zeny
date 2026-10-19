# Imagen única del backend AG-UI y del ETL de Zeny.
# Base ligera + uv para instalar las dependencias del pyproject/uv.lock.
FROM python:3.12-slim

# uv gestiona el entorno; estas variables evitan avisos y aceleran el build.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Instala uv (gestor de paquetes del proyecto).
RUN pip install --no-cache-dir uv

# 1) Primero solo el manifiesto + lock para aprovechar la caché de capas.
#    package=false en pyproject → uv sync instala solo las dependencias (no el proyecto).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# El venv creado por uv queda en el PATH: uvicorn/python salen de ahí.
ENV PATH="/app/.venv/bin:$PATH"

# 2) Código y recursos que la app y el ETL necesitan en tiempo de ejecución.
COPY backend/ ./backend/
COPY etl/ ./etl/
COPY db/ ./db/
COPY config/ ./config/

# `app` vive en backend/ y `etl` en la raíz: ambos deben ser importables.
# (app.settings.ROOT = parents[2] de settings.py = /app → aquí viven db/ y config/.)
ENV PYTHONPATH="/app/backend:/app"

EXPOSE 8100

# Servidor AG-UI por defecto. El servicio `etl` del compose sobreescribe este command.
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8100"]
