# Веб: сборка Vite и раздача через Caddy (он же проксирует /api и выпускает HTTPS).
# Собирается из корня репозитория: docker build -f apps/web/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@vols/web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
# Настройки подложки карты попадают в сборку (см. .env.example).
ARG VITE_MAP_STYLE=""
ARG VITE_SATELLITE_TILES=""
ARG VITE_SATELLITE_ATTRIBUTION=""
# Версия релиза для показа в интерфейсе.
ARG VITE_APP_VERSION="dev"
ENV VITE_MAP_STYLE=$VITE_MAP_STYLE VITE_SATELLITE_TILES=$VITE_SATELLITE_TILES VITE_SATELLITE_ATTRIBUTION=$VITE_SATELLITE_ATTRIBUTION VITE_APP_VERSION=$VITE_APP_VERSION
RUN pnpm --filter @vols/web build

FROM caddy:2.10-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
