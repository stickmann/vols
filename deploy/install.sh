#!/usr/bin/env bash
# Установка стенда ВОЛС на сервер (Ubuntu/Debian) из релиза GitHub.
#   ./deploy/install.sh vols.example.ru                    — последний релиз, домен с HTTPS
#   ./deploy/install.sh vols.example.ru --version v0.2.0   — конкретный релиз
#   ./deploy/install.sh vols.example.ru --behind-proxy СЕТЬ
#                        — порты 80/443 уже заняты другим веб-сервером в Docker (например, Caddy
#                          соседнего проекта): ВОЛС подключается к его сети Docker, а HTTPS и
#                          сертификат остаются за ним. См. deploy/README.md.
#   ./deploy/install.sh                                    — по IP-адресу, без HTTPS
# Повторный запуск безопасен: пароли и данные не трогаются.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/release.sh
. deploy/release.sh

ARGS=("$@")
DOMAIN=""
VERSION=""
EDGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?укажите версию после --version}"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --behind-proxy) EDGE="${2:?укажите сеть Docker после --behind-proxy}"; shift 2 ;;
    --behind-proxy=*) EDGE="${1#--behind-proxy=}"; shift ;;
    -*) echo "Неизвестный параметр: $1" >&2; exit 1 ;;
    *) DOMAIN="$1"; shift ;;
  esac
done
# Частая ошибка — указать адрес вместе со схемой или слэшем: https://vols.example.ru/
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z0-9-]+$ ]]; then
  echo "Не похоже на доменное имя: $DOMAIN (кириллический домен укажите в punycode, xn--...)" >&2
  exit 1
fi
if [ -n "$EDGE" ] && [ -z "$DOMAIN" ]; then
  echo "С --behind-proxy укажите и домен: ./deploy/install.sh vols.example.ru --behind-proxy $EDGE" >&2
  exit 1
fi
if [ -n "$EDGE" ] && ! [[ "$EDGE" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "Не похоже на имя сети Docker: $EDGE" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  echo "Запустите от root или через sudo: sudo ./deploy/install.sh ${ARGS[*]}" >&2
  exit 1
fi

# Сначала переключаемся на релиз и дальше выполняем установку скриптом из этого релиза:
# так скрипт, docker-compose и код всегда одной версии.
if [ -z "${VOLS_RELEASE_READY:-}" ]; then
  say "Выбор релиза"
  REL=$(switch_release "$VERSION")
  echo "Устанавливается: $REL"
  VOLS_RELEASE_READY=1 exec ./deploy/install.sh "${ARGS[@]}"
fi

ENV_FILE=".env.prod"
# За чужим веб-сервером — если указан сейчас или был указан при прошлой установке.
if [ -z "$EDGE" ]; then EDGE=$(env_value EDGE_NETWORK); fi

# Проверки до запуска: иначе сертификат не выпустится и упрётся в лимиты Let's Encrypt.
if [ -n "$DOMAIN" ]; then
  say "Проверка домена $DOMAIN"
  MY_IP=$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || true)
  DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
  DNS_IP6=$(getent ahostsv6 "$DOMAIN" 2>/dev/null | awk '$1 !~ /^::ffff:/ {print $1; exit}' || true)
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

# Порты 80/443 нужны, только если ВОЛС сам принимает HTTPS.
if [ -z "$EDGE" ]; then
  BUSY=$(ss -Htlnp 2>/dev/null | awk '$4 ~ /:(80|443)$/' || true)
  # docker-proxy — это опубликованный порт контейнера. Свой (проект vols) не мешает, чужой — мешает.
  if [ -n "$BUSY" ] && command -v docker >/dev/null 2>&1 && echo "$BUSY" | grep -q docker-proxy; then
    BUSY=$(echo "$BUSY" | grep -v docker-proxy || true)
    OTHER=$(docker ps --format '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.Ports}}' |
      awk -F'\t' '$1 != "vols"' | grep -E ':(80|443)->' | cut -f2 || true)
    if [ -n "$OTHER" ]; then
      warn "Порты 80/443 заняты контейнером Docker: $(echo "$OTHER" | paste -sd, -)"
      echo "ВОЛС можно поставить за этот веб-сервер — подключиться к его сети Docker:" >&2
      for c in $OTHER; do
        for n in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c"); do
          echo "  ./deploy/install.sh ${DOMAIN:-vols.example.ru} --behind-proxy $n" >&2
        done
      done
      echo "Подробнее: «Сервер, где 80/443 уже заняты» в deploy/README.md." >&2
      exit 1
    fi
  fi
  if [ -n "$BUSY" ]; then
    warn "Порты 80/443 заняты другой программой (часто nginx или apache):"
    echo "$BUSY"
    echo "Остановите её (например: systemctl disable --now nginx) или поставьте ВОЛС за неё:" >&2
    echo "см. «Сервер, где 80/443 уже заняты» в deploy/README.md." >&2
    exit 1
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    say "Открываю порты 80 и 443 в ufw"
    ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  say "Устанавливаю Docker"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Нужен плагин docker compose v2" >&2
  exit 1
fi
if [ -n "$EDGE" ] && ! docker network inspect "$EDGE" >/dev/null 2>&1; then
  echo "Сети Docker «$EDGE» нет. Список сетей: docker network ls" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  # Пароли БД — только hex, чтобы безопасно подставлять в строки подключения.
  cat > "$ENV_FILE" <<CONF
# Сгенерировано deploy/install.sh $(date -u +%Y-%m-%dT%H:%MZ). Храните этот файл в секрете.
SITE_ADDRESS='${DOMAIN:-:80}'
POSTGRES_PASSWORD='$(openssl rand -hex 24)'
VOLS_APP_PASSWORD='$(openssl rand -hex 24)'
# Вход — по e-mail и паролю; выбор оператора заголовком (режим разработки) выключен.
ALLOW_TENANT_HEADER='false'
# Подложка карты (необязательно): свой стиль MapLibre и спутник.
VITE_MAP_STYLE=''
VITE_SATELLITE_TILES=''
VITE_SATELLITE_ATTRIBUTION=''
CONF
  chmod 600 "$ENV_FILE"
  echo "Настройки записаны в $ENV_FILE"
fi

if [ -n "$EDGE" ]; then
  # HTTPS принимает внешний веб-сервер; веб ВОЛС отвечает ему по HTTP внутри сети Docker,
  # а на хосте слушает только локальный порт (для проверки curl'ом).
  [ -n "$DOMAIN" ] && set_env PUBLIC_DOMAIN "$DOMAIN"
  set_env EDGE_NETWORK "$EDGE"
  set_env SITE_ADDRESS ":80"
  set_env WEB_HTTP_BIND "127.0.0.1:${VOLS_LOCAL_PORT:-8090}"
  set_env WEB_HTTPS_BIND "127.0.0.1:${VOLS_LOCAL_TLS_PORT:-8453}"
elif [ -n "$DOMAIN" ]; then
  # Повторный запуск с доменом (например, раньше ставили по IP) — меняем только адрес сайта.
  set_env SITE_ADDRESS "$DOMAIN"
fi
set_env VOLS_VERSION "$(app_version)"
# Вход по паролю есть — режим выбора оператора заголовком (до появления входа) выключаем.
set_env ALLOW_TENANT_HEADER "false"

say "Сборка и запуск контейнеров (первый раз — несколько минут)"
vols_compose up -d --build

say "Миграции базы данных"
vols_compose run --rm api node dist/migrate.js

say "Демо-данные (если ещё не созданы)"
vols_compose run --rm api node dist/seed.js

ensure_admin

ADDR=$(env_value SITE_ADDRESS)
if [ -n "$EDGE" ]; then
  say "ВОЛС запущен (версия $(app_version)) и подключён к сети Docker «$EDGE» под именем vols-web"
  echo "Осталось добавить сайт в веб-сервер этой сети. Для Caddy:"
  echo
  echo "$(env_value PUBLIC_DOMAIN) {"
  echo "	reverse_proxy vols-web:80"
  echo "}"
  echo
  echo "Если это Caddy соседнего node-checker, всё это сделает: ./deploy/attach-node-checker.sh"
  echo "Проверка с этого сервера, минуя внешний веб-сервер: curl -I http://$(env_value WEB_HTTP_BIND)/"
elif [ "$ADDR" = ":80" ]; then
  IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
  say "Готово: http://${IP}/ (версия $(app_version))"
  echo "Без домена соединение не шифруется. Для HTTPS: ./deploy/install.sh ваш-домен"
else
  say "Готово: https://${ADDR}/ (версия $(app_version))"
  echo "Сертификат выпускается автоматически при первом заходе; DNS A-запись домена должна указывать на этот сервер."
fi
