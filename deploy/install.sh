#!/usr/bin/env bash
# Установка стенда ВОЛС на чистый сервер (Ubuntu/Debian).
#   ./deploy/install.sh vols.example.ru   — с доменом и HTTPS
#   ./deploy/install.sh                   — по IP-адресу, без HTTPS
# Повторный запуск безопасен: существующий .env.prod и данные не трогаются.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
ENV_FILE=".env.prod"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "Устанавливаю Docker"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Нужен плагин docker compose v2" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  say "Настройка доступа к сайту"
  read -rp "Логин для входа на сайт: " AUTH_USER
  while true; do
    read -rsp "Пароль: " AUTH_PASS; echo
    read -rsp "Пароль ещё раз: " AUTH_PASS2; echo
    [ -n "$AUTH_PASS" ] && [ "$AUTH_PASS" = "$AUTH_PASS2" ] && break
    echo "Пароли пустые или не совпадают, ещё раз."
  done
  AUTH_HASH=$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "$AUTH_PASS")

  # Пароли БД — только hex, чтобы безопасно подставлять в строки подключения.
  cat > "$ENV_FILE" <<CONF
# Сгенерировано deploy/install.sh $(date -u +%Y-%m-%dT%H:%MZ). Храните этот файл в секрете.
SITE_ADDRESS='${DOMAIN:-:80}'
POSTGRES_PASSWORD='$(openssl rand -hex 24)'
VOLS_APP_PASSWORD='$(openssl rand -hex 24)'
BASIC_AUTH_USER='${AUTH_USER}'
# Хэш bcrypt в одинарных кавычках: символы \$ не должны раскрываться.
BASIC_AUTH_HASH='${AUTH_HASH}'
# Пока нет входа в систему: оператор выбирается в интерфейсе. Сайт закрыт паролем выше.
ALLOW_TENANT_HEADER='true'
# Подложка карты (необязательно): свой стиль MapLibre и спутник.
VITE_MAP_STYLE=''
VITE_SATELLITE_TILES=''
VITE_SATELLITE_ATTRIBUTION=''
CONF
  chmod 600 "$ENV_FILE"
  echo "Настройки записаны в $ENV_FILE"
fi

say "Сборка и запуск контейнеров (первый раз — несколько минут)"
"${COMPOSE[@]}" up -d --build

say "Миграции базы данных"
"${COMPOSE[@]}" run --rm api node_modules/.bin/tsx src/scripts/migrate.ts

say "Демо-данные (если ещё не созданы)"
"${COMPOSE[@]}" run --rm api node_modules/.bin/tsx src/scripts/seed.ts

ADDR=$(grep '^SITE_ADDRESS=' "$ENV_FILE" | cut -d"'" -f2)
if [ "$ADDR" = ":80" ]; then
  IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
  say "Готово: http://${IP}/"
  echo "Без домена соединение не шифруется. Для HTTPS: укажите домен (A-запись на этот сервер)"
  echo "в SITE_ADDRESS в $ENV_FILE и запустите ./deploy/update.sh"
else
  say "Готово: https://${ADDR}/"
  echo "Сертификат выпускается автоматически при первом заходе; DNS A-запись домена должна указывать на этот сервер."
fi
