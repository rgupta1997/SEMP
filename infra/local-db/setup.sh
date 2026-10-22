#!/usr/bin/env bash
#
# Build the local Postgres schema so it matches RDS.
#
#   ./infra/local-db/setup.sh           start the container, build the schema if empty
#   ./infra/local-db/setup.sh --reset   destroy the volume first, then rebuild
#
# How the schema is built (RDS has no single source file, so this replays its history):
#   1. baseline-33-tables.sql   the original 33-table prod schema (schema only, taken from
#                               semp-prod-full.rds.sql with the COPY data stripped)
#   2. 001-005, run directly    002 takes it to 71 tables; 005 creates the rds_migrations
#                               ledger and backfills 001-004
#   3. apply.sh --apply         006 onward, recorded in the ledger
#
# The result is a schema-only database: no users, no data. Run `npm run db:seed` after.
set -euo pipefail

cd "$(dirname "$0")/../.."
URL="postgresql://semp:semp@127.0.0.1:5433/semp"

if [ "${1:-}" = "--reset" ]; then
  echo "==> removing container and volume"
  docker compose down -v
fi

echo "==> starting postgres"
docker compose up -d --wait db

dbpsql() { docker compose exec -T db psql -U semp -d semp -v ON_ERROR_STOP=1 -q "$@"; }

if [ "$(dbpsql -Atc "select to_regclass('public.rds_migrations') is not null")" = "t" ]; then
  echo "==> schema already built; applying any new migrations"
else
  echo "==> loading baseline schema"
  dbpsql < infra/local-db/baseline-33-tables.sql >/dev/null
  # apply.sh cannot record 001-004: the ledger only exists once 005 has run, and 005
  # backfills those four itself. So run 001-005 directly, then hand over to apply.sh.
  for f in infra/rds-migrations/00[1-5]_*.sql; do
    echo "==> $(basename "$f")"
    # 001/004/005 carry their own BEGIN/COMMIT; the rest need a transaction wrapped round them
    if grep -q '^BEGIN;' "$f"; then dbpsql < "$f" >/dev/null; else dbpsql --single-transaction < "$f" >/dev/null; fi
  done
fi

echo "==> apply.sh"
DATABASE_URL="$URL" ./infra/rds-migrations/apply.sh --apply

echo
echo "local db ready: $URL"
