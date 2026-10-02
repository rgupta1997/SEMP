#!/usr/bin/env bash
#
# Apply every *.sql in this directory that the target database has not recorded
# in rds_migrations, in filename order.
#
#   ./infra/rds-migrations/apply.sh            # show what would run, change nothing
#   ./infra/rds-migrations/apply.sh --apply    # run the pending files
#   ./infra/rds-migrations/apply.sh --dry-run  # run them, then ROLLBACK every one
#
# Dry run is the default on purpose: the default target is production.
#
# The connection comes from $DATABASE_URL if set, else DIRECT_URL in
# apps/api/.env. `connection_limit` is stripped - it is a Prisma parameter and
# libpq rejects the URI outright if it is left in.
#
# Each file runs in a transaction. Files that open their own (001, 004, 005) are
# run as-is; the rest get --single-transaction. Either way a file that fails
# leaves the database untouched, and the run stops there rather than carrying on
# to the next file.
#
# The rds_migrations row is written immediately after psql exits 0, in a separate
# statement - not inside the migration's own transaction, which has already
# committed by then. The window is small but real: a crash between the two leaves
# a file applied and unrecorded, which on the next run looks like a pending file.
# That is why new migrations should stay replayable (IF NOT EXISTS, DROP ...
# IF EXISTS), as 003, 004 and 005 are.

set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT=$(cd ../.. && pwd)

MODE=plan
case "${1:-}" in
  --apply)   MODE=apply ;;
  --dry-run) MODE=dryrun ;;
  "")        MODE=plan ;;
  *) echo "usage: $0 [--apply|--dry-run]" >&2; exit 2 ;;
esac

# psql is not on PATH under Postgres.app
if ! command -v psql >/dev/null 2>&1; then
  for d in /Applications/Postgres.app/Contents/Versions/latest/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/psql" ] && PATH="$d:$PATH" && break
  done
fi
command -v psql >/dev/null 2>&1 || { echo "psql not found" >&2; exit 1; }

URL="${DATABASE_URL:-}"
if [ -z "$URL" ]; then
  URL=$(grep -E '^DIRECT_URL=' "$REPO_ROOT/apps/api/.env" | head -1 | sed 's/^DIRECT_URL=//; s/^"//; s/"$//')
fi
[ -n "$URL" ] || { echo "no DATABASE_URL and no DIRECT_URL in apps/api/.env" >&2; exit 1; }
URL=$(printf '%s' "$URL" | sed 's/[?&]connection_limit=[0-9]*//')

export PGCONNECT_TIMEOUT=15
psql_q() { psql "$URL" -Atq -c "$1"; }

TARGET=$(psql_q "select current_user||'@'||current_database()") \
  || { echo "cannot connect" >&2; exit 1; }
HOST=$(printf '%s' "$URL" | sed -E 's|.*@([^:/?]+).*|\1|')
echo "target: $TARGET on $HOST"
echo "mode:   $MODE"
echo

# Before 005 has run there is no ledger; treat that as "nothing recorded".
HAVE_LEDGER=$(psql_q "select to_regclass('public.rds_migrations') is not null")
if [ "$HAVE_LEDGER" = "t" ]; then
  APPLIED=$(psql_q "select filename from rds_migrations")
else
  APPLIED=""
  echo "note: rds_migrations does not exist yet; 005 creates and backfills it."
  echo
fi

recorded() { printf '%s\n' "$APPLIED" | grep -Fxq "$1"; }

PENDING=()
for f in [0-9]*.sql; do
  [ -e "$f" ] || continue
  if recorded "$f"; then
    SUM=$(shasum -a 256 "$f" | cut -d' ' -f1)
    OLD=$(psql_q "select coalesce(checksum,'') from rds_migrations where filename='$f'")
    if [ -n "$OLD" ] && [ "$OLD" != "$SUM" ]; then
      echo "  ~ $f  applied, but the file has changed since (read the diff)"
    else
      echo "  = $f  applied"
    fi
  else
    echo "  + $f  PENDING"
    PENDING+=("$f")
  fi
done
echo

if [ ${#PENDING[@]} -eq 0 ]; then
  echo "nothing to do."
  exit 0
fi

if [ "$MODE" = plan ]; then
  echo "${#PENDING[@]} pending. Re-run with --dry-run to test them, --apply to run them."
  exit 0
fi

for f in "${PENDING[@]}"; do
  echo "--- $f"
  SUM=$(shasum -a 256 "$f" | cut -d' ' -f1)
  SQL_FILE="$f"
  ARGS=(-v ON_ERROR_STOP=1)
  grep -q '^BEGIN;' "$f" || ARGS+=(--single-transaction)

  if [ "$MODE" = dryrun ]; then
    SQL_FILE=$(mktemp -t "rdsmig.XXXXXX").sql
    if grep -q '^COMMIT;' "$f"; then
      sed 's/^COMMIT;$/ROLLBACK;/' "$f" > "$SQL_FILE"
    else
      # --single-transaction has no rollback switch; make the transaction explicit
      { echo 'BEGIN;'; cat "$f"; echo 'ROLLBACK;'; } > "$SQL_FILE"
      ARGS=(-v ON_ERROR_STOP=1)
    fi
  fi

  psql "$URL" "${ARGS[@]}" -f "$SQL_FILE" 2>&1 | sed 's/^/    /'
  [ "$MODE" = dryrun ] && rm -f "$SQL_FILE"

  if [ "$MODE" = apply ]; then
    psql "$URL" -Atq -c \
      "insert into rds_migrations (filename, checksum) values ('$f', '$SUM')
       on conflict (filename) do update set checksum = excluded.checksum"
    echo "    recorded in rds_migrations"
  fi
  echo
done

echo "$MODE complete: ${#PENDING[@]} file(s)."
[ "$MODE" = dryrun ] && echo "Nothing was committed."
exit 0
