#!/usr/bin/env bash
# Резервная копия базы в ./backups (храните копии и вне сервера).
# Для ежедневного запуска: crontab -e → 0 3 * * * /путь/к/vols/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/release.sh
. deploy/release.sh
mkdir -p backups
FILE="backups/vols-$(date +%Y%m%d-%H%M).sql.gz"
vols_compose exec -T db pg_dump -U vols -d vols | gzip > "$FILE"
find backups -name 'vols-*.sql.gz' -mtime +14 -delete
echo "$FILE"
