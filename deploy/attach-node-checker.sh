#!/usr/bin/env bash
# Публикует ВОЛС через Caddy соседнего Node Checker, который уже занимает порты 80/443.
#   ./deploy/attach-node-checker.sh [путь к node-checker]     (по умолчанию ~/node-checker)
# Сначала установите ВОЛС: ./deploy/install.sh vols.example.ru --behind-proxy node-checker_default
#
# Что делает в каталоге node-checker (повторный запуск ничего не дублирует):
#   - deploy/Caddyfile: подключает дополнительные сайты из deploy/sites/*.caddy;
#   - docker-compose.caddy.yml: монтирует deploy/sites в контейнер Caddy;
#   - .gitignore: deploy/sites/*.caddy не попадают в git;
#   - deploy/sites/vols.caddy: домен ВОЛС → reverse_proxy vols-web:80.
# Затем проверяет конфиг и пересоздаёт контейнер Caddy (сайт Node Checker недоступен несколько секунд).
# Если конфиг не прошёл проверку, правки откатываются.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/release.sh
. deploy/release.sh

NC="${1:-$HOME/node-checker}"
NC="$(cd "$NC" && pwd)"
CADDYFILE="$NC/deploy/Caddyfile"
COMPOSE_CADDY="$NC/docker-compose.caddy.yml"
DOMAIN=$(env_value PUBLIC_DOMAIN)
CADDY_IMAGE="caddy:2.10-alpine"

[ -f "$CADDYFILE" ] && [ -f "$COMPOSE_CADDY" ] || {
  echo "В $NC нет deploy/Caddyfile и docker-compose.caddy.yml — это точно каталог node-checker?" >&2
  exit 1
}
[ -n "$DOMAIN" ] && [ -n "$(env_value EDGE_NETWORK)" ] || {
  echo "ВОЛС ещё не установлен в режиме за веб-сервером. Сначала:" >&2
  echo "  ./deploy/install.sh vols.example.ru --behind-proxy node-checker_default" >&2
  exit 1
}

BACKUP=$(mktemp -d)
cp -p "$CADDYFILE" "$COMPOSE_CADDY" "$BACKUP/"
[ -f "$NC/.gitignore" ] && cp -p "$NC/.gitignore" "$BACKUP/"
restore() {
  cp -p "$BACKUP/Caddyfile" "$CADDYFILE"
  cp -p "$BACKUP/docker-compose.caddy.yml" "$COMPOSE_CADDY"
  [ -f "$BACKUP/.gitignore" ] && cp -p "$BACKUP/.gitignore" "$NC/.gitignore"
  rm -f "$NC/deploy/sites/vols.caddy"
}

say "Правки в $NC"
if ! grep -q '^import /etc/caddy/sites/' "$CADDYFILE"; then
  printf '\n# Другие сайты на этом же Caddy (например, ВОЛС): файлы deploy/sites/*.caddy, в git не хранятся.\nimport /etc/caddy/sites/*.caddy\n' >> "$CADDYFILE"
  echo "deploy/Caddyfile: подключены deploy/sites/*.caddy"
fi
if ! grep -q '/etc/caddy/sites' "$COMPOSE_CADDY"; then
  grep -q '\./deploy/Caddyfile:/etc/caddy/Caddyfile' "$COMPOSE_CADDY" || {
    echo "Не нашёл в docker-compose.caddy.yml монтирование ./deploy/Caddyfile — формат файла изменился, правки не внесены." >&2
    restore; exit 1
  }
  sed -i '\#\./deploy/Caddyfile:/etc/caddy/Caddyfile#a\      - ./deploy/sites:/etc/caddy/sites:ro' "$COMPOSE_CADDY"
  echo "docker-compose.caddy.yml: смонтирована deploy/sites"
fi
grep -qxF 'deploy/sites/*.caddy' "$NC/.gitignore" 2>/dev/null || echo 'deploy/sites/*.caddy' >> "$NC/.gitignore"
mkdir -p "$NC/deploy/sites"
cat > "$NC/deploy/sites/vols.caddy" <<CADDY
# ВОЛС (документирование оптики). Создано $(pwd)/deploy/attach-node-checker.sh
$DOMAIN {
	reverse_proxy vols-web:80
}
CADDY
echo "deploy/sites/vols.caddy: $DOMAIN → vols-web:80"

say "Проверка конфига Caddy"
NC_DOMAIN=$(sed -n "s/^DOMAIN=['\"]\{0,1\}\([^'\"]*\).*/\1/p" "$NC/.env" 2>/dev/null | tail -1 || true)
if ! docker run --rm -e DOMAIN="${NC_DOMAIN:-localhost}" \
  -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" -v "$NC/deploy/sites:/etc/caddy/sites:ro" \
  "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>"$BACKUP/validate.log"; then
  cat "$BACKUP/validate.log" >&2
  warn "Конфиг не прошёл проверку — правки откачены, Caddy не тронут."
  restore; exit 1
fi
echo "Конфиг в порядке."

say "Пересоздаю контейнер Caddy Node Checker"
(cd "$NC" && docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d caddy)
rm -rf "$BACKUP"

say "Готово: https://$DOMAIN/"
echo "Сертификат для $DOMAIN Caddy Node Checker выпустит при первом заходе (до минуты)."
echo "Логи, если не открывается: docker logs --tail 50 node-checker-caddy"
echo
echo "В node-checker изменены отслеживаемые git файлы (deploy/Caddyfile, docker-compose.caddy.yml, .gitignore)."
echo "Чтобы git pull в node-checker не конфликтовал, закоммитьте эти правки в его репозиторий."
