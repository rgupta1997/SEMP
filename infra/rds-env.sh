# Sets up a shell for working against both databases. SOURCE it, do not execute:
#
#   source infra/rds-env.sh
#
# Exports PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE for the RDS target,
# read live from Secrets Manager so no credential is ever stored in the repo, and
# derives SUPA (the Supabase SESSION-pooler URI) from the root .env so the Supabase
# password never has to be retyped either.
#
# Also defines pgsupa(), which strips the PG* variables before running a command
# against Supabase - without it a libpq tool inherits the RDS connection as its
# defaults and silently talks to the wrong server.

if [ -n "${BASH_SOURCE:-}" ] && [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "error: source this file, don't run it - exports would vanish with the subshell" >&2
  exit 1
fi

_rds_env_region="${AWS_REGION:-ap-south-1}"
_rds_env_secret="${RDS_SECRET_ID:-semp/infra/db-master}"

if _rds_env_sec=$(aws secretsmanager get-secret-value \
      --secret-id "$_rds_env_secret" --region "$_rds_env_region" \
      --query SecretString --output text 2>/dev/null); then
  export PGHOST=$(printf '%s' "$_rds_env_sec" | jq -r .host)
  export PGPORT=$(printf '%s' "$_rds_env_sec" | jq -r .port)
  export PGUSER=$(printf '%s' "$_rds_env_sec" | jq -r .username)
  export PGPASSWORD=$(printf '%s' "$_rds_env_sec" | jq -r .password)
  export PGDATABASE=$(printf '%s' "$_rds_env_sec" | jq -r .dbname)
  # rds.force_ssl=1 on the instance refuses unencrypted connections outright.
  export PGSSLMODE=require
  echo "RDS:  $PGUSER@$PGHOST:$PGPORT/$PGDATABASE (sslmode=$PGSSLMODE)"
else
  echo "RDS:  could not read $_rds_env_secret in $_rds_env_region - is the AWS CLI configured?" >&2
fi

# Derive the Supabase session-pooler URI from the root .env's DATABASE_URL, which
# still points at Supabase. Two transformations are required and both matter:
#   :6543 -> :5432   the TRANSACTION pooler cannot serve pg_dump (it needs one
#                    session to hold a consistent snapshot for the whole dump)
#   strip ?...       pgbouncer=true and connection_limit=N are PRISMA parameters;
#                    libpq rejects unrecognised query keywords outright
_rds_env_root_url=$(sed -nE 's/^DATABASE_URL="?(postgresql:\/\/[^"]*supabase[^"]*)"?$/\1/p' \
                      "$(dirname "${_rds_env_self:-infra/x}")/../.env" 2>/dev/null \
                    || true)
[ -z "$_rds_env_root_url" ] && _rds_env_root_url=$(sed -nE 's/^DATABASE_URL="?(postgresql:\/\/[^"]*supabase[^"]*)"?$/\1/p' .env 2>/dev/null)

# An already-exported SUPA always wins. That is how you point this at a DIFFERENT
# Supabase project (prod rather than beta) without editing .env, which the running
# app also reads. Set it in your shell, or put it in infra/.supa.local (gitignored):
#
#   SUPA='postgresql://postgres.<prod-ref>:<pw>@<region>.pooler.supabase.com:5432/postgres'
_supa_src=""
if [ -n "${SUPA:-}" ]; then
  _supa_src="inherited from this shell"
fi

if [ -f "infra/.supa.local" ]; then
  # Read it regardless, so a STALE exported SUPA can be reported rather than
  # silently shadowing the file. Guessing wrong here means dumping the wrong
  # database, which is not a mistake worth being subtle about.
  _supa_inherited="${SUPA:-}"
  # shellcheck disable=SC1091
  . infra/.supa.local
  if [ -n "$_supa_inherited" ] && [ "$_supa_inherited" != "${SUPA:-}" ]; then
    echo "  NOTE: infra/.supa.local overrode a different SUPA already set in this shell." >&2
  fi
  _supa_src="infra/.supa.local"
fi

if [ -n "${SUPA:-}" ]; then
  # Export unconditionally. infra/.supa.local is documented above as a bare
  # SUPA='...' assignment, which is NOT exported - so verify-migration.sh, run as
  # `bash infra/verify-migration.sh`, is a subshell that never inherits it and dies
  # on its own `: "${SUPA:?...}"` guard while THIS script has just echoed the value.
  # Exporting here fixes it for every source of SUPA rather than relying on whoever
  # writes .supa.local to remember the keyword.
  export SUPA
  echo "SUPA: $(printf '%s' "$SUPA" | sed -E 's#(://[^:]*:)[^@]*@#\1<pw>@#')  ($_supa_src)"
  case "$SUPA" in
    *:6543*)  echo "  WARNING: that is the TRANSACTION pooler. pg_dump needs :5432 (session)." >&2 ;;
  esac
  case "$SUPA" in
    *\?*)     echo "  WARNING: query parameters present. libpq rejects pgbouncer=/connection_limit=." >&2 ;;
  esac
  # postgresql://USER:PASSWORD@HOST - the separator is a COLON. A userinfo with no
  # colon means the password got merged into the username, which authenticates as a
  # user that does not exist rather than failing in an obvious way.
  case "$(printf '%s' "$SUPA" | sed -E 's#^postgresql://([^@]*)@.*#\1#')" in
    *:*) ;;
    *)   echo "  WARNING: no ':' between user and password - is the password merged into the username?" >&2 ;;
  esac
elif [ -n "$_rds_env_root_url" ]; then
  export SUPA=$(printf '%s' "$_rds_env_root_url" | sed -E 's/:6543/:5432/; s/\?.*$//')
  echo "SUPA: $(printf '%s' "$SUPA" | sed -E 's#(://[^:]*:)[^@]*@#\1<pw>@#')"
else
  echo "SUPA: not found - no supabase DATABASE_URL in ./.env. Export SUPA by hand." >&2
fi

pgsupa() { env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE "$@"; }

unset _rds_env_sec _rds_env_region _rds_env_secret _rds_env_root_url
