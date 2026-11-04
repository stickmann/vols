#!/usr/bin/env bash
# Установка стенда ВОЛС на чистый сервер (Ubuntu/Debian).
#   ./deploy/install.sh vols.example.ru   — с доменом и HTTPS
#   ./deploy/install.sh                   — по IP-адресу, без HTTPS
# Повторный запуск безопасен: существующий .env.prod и данные не трогаются.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
# Частая ошибка — указать адрес вместе со схемой или слэшем: https://vols.example.ru/
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z0-9-]+$ ]]; then
  echo "Не похоже на доменное имя: $DOMAIN (кириллический домен укажите в punycode, xn--...)" >&2
  exit 1
fi
ENV_FILE=".env.prod"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
confirm() { read -rp "$1 [y/N] " a; [[ "$a" =~ ^[YyДд] ]]; }

if [ "$(id -u)" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  echo "Запустите от root или через sudo: sudo ./deploy/install.sh $DOMAIN" >&2
  exit 1
fi

# Проверки до запуска: иначе Caddy не выпустит сертификат и упрётся в лимиты Let's Encrypt.
if [ -n "$DOMAIN" ]; then
  say "Проверка домена $DOMAIN"
  MY_IP=$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || true)
  DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
  DNS_IP6=$(getent ahostsv6 "$DOMAIN" 2>/dev/null | awk '$1 !~ /^::ffff:/ {print $1; exit}')
  if [ -z "$DNS_IP" ]; then
    warn "У $DOMAIN нет A-записи (или она ещё не разошлась). Создайте A-запись на ${MY_IP:-IP этого сервера}."
    confirm "Продолжить всё равно?" || exit 1
  elif [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; then
    warn "$DOMAIN указывает на $DNS_IP, а у сервера адрес $MY_IP."
    warn "Если домен за Cloudflare, выключите проксирование (серое облако, «DNS only»)."
    confirm "Продолжить всё равно?" || exit 1
  else
    echo "A-запись в порядке: $DNS_IP"
  fi
  if [ -n "$DNS_IP6" ]; then
    MY_IP6=$(curl -fsS -6 --max-time 5 https://ifconfig.me 2>/dev/null || true)
    if [ "$DNS_IP6" != "$MY_IP6" ]; then
      warn "У домена есть AAAA-запись $DNS_IP6, не совпадающая с IPv6 сервера (${MY_IP6:-нет IPv6})."
      warn "Let's Encrypt проверяет по IPv6 в первую очередь — удалите эту AAAA-запись."
      confirm "Продолжить всё равно?" || exit 1
    fi
  fi
fi

BUSY=$(ss -Htlnp 2>/dev/null | awk '$4 ~ /:(80|443)$/' | grep -v docker-proxy || true)
if [ -n "$BUSY" ]; then
  warn "Порты 80/443 заняты другой программой (часто nginx или apache):"
  echo "$BUSY"
  echo "Остановите её, например: systemctl disable --now nginx" >&2
  exit 1
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Открываю порты 80 и 443 в ufw"
  ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
fi

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
elif [ -n "$DOMAIN" ]; then
  # Повторный запуск с доменом (например, раньше ставили по IP) — меняем только адрес сайта.
  sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS='${DOMAIN}'|" "$ENV_FILE"
  echo "Адрес сайта в $ENV_FILE: $DOMAIN"
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
