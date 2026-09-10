# Imagen de producción del backend (API + capacidad de correr el worker con `npm run worker`)
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
COPY package.json ./
EXPOSE 3001
# El compilador (sin nest-cli.json) preserva la carpeta "src" dentro de dist/, así que el
# entrypoint real queda en dist/src/main.js (no dist/main.js). Se corren las migraciones antes
# de levantar la API en cada arranque — es idempotente (drizzle registra qué migraciones ya se
# aplicaron), así que es seguro repetirlo en cada deploy/restart.
CMD ["sh", "-c", "node dist/src/db/migrate.js && node dist/src/main.js"]
