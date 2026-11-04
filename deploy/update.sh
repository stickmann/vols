#!/usr/bin/env bash
# Обновление стенда: свежий код, пересборка, миграции. Данные сохраняются.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)

git pull --ff-only
"${COMPOSE[@]}" up -d --build
"${COMPOSE[@]}" run --rm api node_modules/.bin/tsx src/scripts/migrate.ts
"${COMPOSE[@]}" ps
