#!/bin/bash
# Роль приложения: логин без BYPASSRLS. Права на таблицы выдаёт миграция.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vols_app') THEN
    CREATE ROLE vols_app LOGIN PASSWORD '${VOLS_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
CREATE EXTENSION IF NOT EXISTS postgis;
SQL
