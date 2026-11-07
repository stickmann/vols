#!/usr/bin/env bash
# Переход на другой релиз GitHub: резервная копия, новый код, пересборка, миграции. Данные сохраняются.
#   ./deploy/update.sh            — на последний релиз
#   ./deploy/update.sh v0.2.0     — на конкретный релиз (в том числе откат на прежний)
#   ./deploy/update.sh main       — на текущий main (неопубликованный код, для проверки)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/release.sh
. deploy/release.sh

if [ -z "${VOLS_RELEASE_READY:-}" ]; then
  FROM=$(current_release)
  say "Сейчас развёрнуто: $FROM"

  if vols_compose ps --status running --services 2>/dev/null | grep -qx db; then
    say "Резервная копия базы перед обновлением"
    ./deploy/backup.sh
  fi

  TO=$(switch_release "${1:-}")
  if is_release "$FROM" && is_release "$TO" && is_older "$TO" "$FROM"; then
    warn "Откат с $FROM на $TO. Миграции базы не откатываются: если более новая версия меняла схему,"
    warn "старый код может с ней не работать. Тогда восстановите копию, сделанную выше (см. deploy/DOCKER.md)."
    if ! confirm "Продолжить откат?"; then
      git -c advice.detachedHead=false checkout --quiet "${FROM%@*}" 2>/dev/null || true
      exit 1
    fi
  fi
  say "Переход на $TO"
  # Остальное выполняет скрипт из нового релиза.
  VOLS_RELEASE_READY=1 exec ./deploy/update.sh
fi

set_env VOLS_VERSION "$(app_version)"

say "Сборка и перезапуск контейнеров"
vols_compose up -d --build

say "Миграции базы данных"
vols_compose run --rm api node_modules/.bin/tsx src/scripts/migrate.ts

# Старые образы после пересборки больше не нужны.
docker image prune -f >/dev/null

vols_compose ps
say "Готово: версия $(app_version)"
