#!/usr/bin/env bash
# Compare a Supabase source against the RDS target, exhaustively.
#
# Usage:
#   export PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=semp PGSSLMODE=require
#   SUPA='postgresql://postgres.<ref>:<pw>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' \
#     bash infra/verify-migration.sh
#
# Exits 0 only if EVERY check matches. Anything else is a non-zero exit and a diff.
#
# Why a script and not a handful of ad-hoc queries: this has to run twice - once now,
# and once at the real cutover after a fresh dump - and "I checked three tables and they
# looked right" is how a partial migration ships. Row counts on 3 of 71 tables prove
# almost nothing.
set -uo pipefail

: "${SUPA:?SUPA must be set to the Supabase SESSION-pooler URI (:5432, no query params)}"
: "${PGHOST:?PG* must be exported for the RDS target - see RUNBOOK-rds.md step 8}"

# The RDS connection comes from the exported PG* variables. Supabase must NOT inherit
# them, or a wrong URI silently compares the target against itself and passes.
supa() { env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE \
           psql "$SUPA" -tAF'|' "$@"; }
rds()  { psql -tAF'|' "$@"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILED=0

check() {                       # check <label> <sql>
  local label="$1" sql="$2" side

  # Deliberately NOT `psql ... | sort > out 2> err`: in a pipeline the redirections
  # bind to `sort`, so psql's stderr escapes to the terminal, the error file stays
  # empty, and a query that failed on BOTH sides produces empty-vs-empty - which
  # diffs clean and reports a match. That is a false PASS on a verification script,
  # which is worse than no script at all. Run psql alone, check its exit status,
  # then sort.
  for side in rds supa; do
    if ! $side -c "$sql" > "$TMP/$side.$label.raw" 2> "$TMP/err.$side.$label"; then
      printf '  FAILED    %s - query errored against %s:\n' "$label" "$side"
      sed 's/^/              /' "$TMP/err.$side.$label"
      FAILED=1; return
    fi
    sort "$TMP/$side.$label.raw" > "$TMP/$side.$label"
  done

  # Every check here interrogates a populated database, so an empty result set is
  # never a legitimate answer - it means the query returned nothing useful even
  # though it exited 0. Belt and braces against the class of bug above.
  # ...unless BOTH sides are empty. That was impossible against the beta source this
  # script was written for (4 sequences, 1 bytea column), but the PROD source has
  # neither - every PK is a uuid default, so pg_dump emits no CREATE SEQUENCE and no
  # bytea column exists. A perfect prod restore would otherwise report FAILED twice
  # and exit 1, which trains you to ignore the script's verdict. Empty-on-both is
  # still printed, just not fatal; empty on RDS alone stays a hard failure.
  if [[ ! -s "$TMP/rds.$label" ]]; then
    if [[ ! -s "$TMP/supa.$label" ]]; then
      printf '  EMPTY     %s - zero rows on BOTH sides; nothing to compare\n' "$label"
      return
    fi
    printf '  FAILED    %s - returned ZERO rows; the query is wrong, not the data\n' "$label"
    FAILED=1; return
  fi

  if diff -q "$TMP/rds.$label" "$TMP/supa.$label" >/dev/null; then
    printf '  OK        %s (%s rows compared)\n' "$label" "$(wc -l < "$TMP/rds.$label" | tr -d ' ')"
  else
    printf '  MISMATCH  %s\n' "$label"
    printf '            < = RDS only / different, > = SUPABASE only / different\n'
    diff "$TMP/rds.$label" "$TMP/supa.$label" | sed 's/^/            /' | head -40
    FAILED=1
  fi
}

# Every base table's exact row count in ONE round trip per side. query_to_xml runs the
# count inside the server, so this is 2 queries rather than 142 - which matters against
# a pooler in another region.
SQL_ROWS="
select t.table_name || '|' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
                           false, true, '')))[1]::text
  from information_schema.tables t
 where t.table_schema = 'public' and t.table_type = 'BASE TABLE';"

# Sequences are the quiet killer: if last_value lags, the first INSERT after cutover
# collides on a primary key. A full pg_dump emits setval() so this SHOULD match - this
# is the check that proves it did.
SQL_SEQS="
select sequencename || '|' || coalesce(last_value::text, 'never_called')
  from pg_sequences where schemaname = 'public';"

# bytea payloads (claim_evidence.bytes and anything like it) are the one place a dump
# can silently truncate. Compare total octet length per column, not just row counts.
SQL_BLOBS="
select c.table_name || '.' || c.column_name || '|' ||
       (xpath('/row/s/text()',
              query_to_xml(format('select coalesce(sum(octet_length(%I)),0) as s from %I.%I',
                                  c.column_name, c.table_schema, c.table_name),
                           false, true, '')))[1]::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public' and c.data_type = 'bytea' and t.table_type = 'BASE TABLE';"

# Structure, so a schema drift between dump and restore is caught here rather than as a
# runtime error weeks later.
SQL_COLS="
select table_name || '.' || column_name || '|' || data_type || '|' || is_nullable
  from information_schema.columns where table_schema = 'public';"

SQL_CONS="
select conname || '|' || contype::text
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public';"

SQL_IDX="select indexname from pg_indexes where schemaname = 'public';"

echo "Comparing RDS ($PGHOST:${PGPORT:-5432}/${PGDATABASE:-?}) against Supabase"
echo
check "columns"     "$SQL_COLS"
check "constraints" "$SQL_CONS"
check "indexes"     "$SQL_IDX"
check "row-counts"  "$SQL_ROWS"
check "sequences"   "$SQL_SEQS"
check "bytea-bytes" "$SQL_BLOBS"
echo

if (( FAILED )); then
  echo "RESULT: MISMATCH - do not cut over. See the diffs above."
  exit 1
fi
echo "RESULT: identical on every check."
