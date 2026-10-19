# Imagen del frontend Next.js 16 de Zeny.
FROM node:20-slim

WORKDIR /app

# Dependencias primero (aprovecha la caché de capas).
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

# NEXT_PUBLIC_* se hornea en el build porque lo usa el navegador.
# Por defecto apunta a localhost; para tablets, pásalo como build-arg con la IP del host.
ARG NEXT_PUBLIC_AGUI_URL=http://localhost:8100/agui
ENV NEXT_PUBLIC_AGUI_URL=$NEXT_PUBLIC_AGUI_URL

RUN npm run build

EXPOSE 3002
CMD ["npx", "next", "start", "-p", "3002"]
