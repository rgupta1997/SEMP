#!/usr/bin/env bash
#
# Takes a timestamped, PERMANENT backup of the SEMP RDS instance in two
# independent forms. Both are "manual" in the sense that matters: nothing in AWS
# ever expires them. They have to be deleted by hand.
#
#   A. a manual RDS snapshot  - semp-manual-<UTC>
#        Restores the whole instance (data, users, parameter group) with one
#        command. Unlike an AUTOMATED snapshot, a manual one has no retention
#        period at all: RDS keeps it until someone runs delete-db-snapshot.
#
#   B. a pg_dump custom-format archive in S3 - s3://<bucket>/rds/<UTC>/
#        The portable copy. pg_restore can replay it into RDS, Supabase, or a
#        laptop. Survives the loss of the RDS instance, and of this AWS account
#        if you ever copy the bucket out. The bucket is created with versioning
#        on, public access blocked, and DELIBERATELY NO LIFECYCLE RULE - a
#        lifecycle rule is the only thing that makes S3 delete objects on its
#        own, so leaving it off is what makes this permanent.
#
# Usage:
#   bash infra/backup-rds.sh                 # both A and B
#   bash infra/backup-rds.sh --snapshot-only # A only (fast, no pg_dump needed)
#   bash infra/backup-rds.sh --dump-only     # B only
#   bash infra/backup-rds.sh --no-wait       # don't block on the snapshot
#
# Env overrides: AWS_REGION, RDS_SECRET_ID, BACKUP_BUCKET, DB_INSTANCE_ID
#
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
SECRET_ID="${RDS_SECRET_ID:-semp/infra/db-master}"

DO_SNAPSHOT=1
DO_DUMP=1
WAIT_FOR_SNAPSHOT=1
for arg in "$@"; do
  case "$arg" in
    --snapshot-only) DO_DUMP=0 ;;
    --dump-only)     DO_SNAPSHOT=0 ;;
    --no-wait)       WAIT_FOR_SNAPSHOT=0 ;;
    -h|--help)       sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# One timestamp for the whole run, so the snapshot and the S3 prefix pair up by
# name. UTC, because a backup labelled in local time is ambiguous twice a year.
TS="$(date -u +%Y%m%d-%H%M%S)"
TS_HUMAN="$(date -u +'%Y-%m-%d %H:%M:%S UTC')"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 0. preflight

say "Preflight"
command -v aws >/dev/null || { echo "aws CLI not found" >&2; exit 1; }
command -v jq  >/dev/null || { echo "jq not found" >&2; exit 1; }

ACCOUNT_ARN="$(aws sts get-caller-identity --query '[Account,Arn]' --output text)" || {
  echo "Not authenticated. Run: aws login" >&2; exit 1; }
ACCOUNT_ID="$(printf '%s' "$ACCOUNT_ARN" | awk '{print $1}')"
echo "account : $ACCOUNT_ARN"
echo "region  : $REGION"
echo "stamp   : $TS_HUMAN"

# Read the master credentials. Also how we identify WHICH instance to snapshot:
# matching the secret's host against the live endpoint list is safer than
# hardcoding an identifier that could drift from what the app actually uses.
SEC="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" \
         --region "$REGION" --query SecretString --output text)"
PGHOST_V="$(printf '%s' "$SEC" | jq -r .host)"
PGPORT_V="$(printf '%s' "$SEC" | jq -r .port)"
PGUSER_V="$(printf '%s' "$SEC" | jq -r .username)"
PGDATABASE_V="$(printf '%s' "$SEC" | jq -r .dbname)"

if [ -n "${DB_INSTANCE_ID:-}" ]; then
  INSTANCE_ID="$DB_INSTANCE_ID"
else
  INSTANCE_ID="$(aws rds describe-db-instances --region "$REGION" \
    --query "DBInstances[?Endpoint.Address=='${PGHOST_V}'].DBInstanceIdentifier | [0]" \
    --output text)"
fi
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ] || {
  echo "Could not match an RDS instance to host $PGHOST_V in $REGION." >&2
  echo "Set DB_INSTANCE_ID=... explicitly." >&2; exit 1; }

echo "instance: $INSTANCE_ID  ($PGHOST_V:$PGPORT_V/$PGDATABASE_V)"

SNAP_ID="semp-manual-${TS}"
BUCKET="${BACKUP_BUCKET:-semp-db-backups-${ACCOUNT_ID}}"
S3_PREFIX="rds/${INSTANCE_ID}/${TS}"

# ------------------------------------------------- A. manual RDS snapshot

if [ "$DO_SNAPSHOT" = 1 ]; then
  say "A. Manual RDS snapshot: $SNAP_ID"
  aws rds create-db-snapshot \
    --region "$REGION" \
    --db-instance-identifier "$INSTANCE_ID" \
    --db-snapshot-identifier "$SNAP_ID" \
    --tags "Key=Name,Value=$SNAP_ID" \
           "Key=TakenAtUTC,Value=$TS" \
           "Key=Retention,Value=permanent-manual" \
           "Key=TakenBy,Value=infra/backup-rds.sh" \
    --query 'DBSnapshot.[DBSnapshotIdentifier,SnapshotType,Status]' --output text

  if [ "$WAIT_FOR_SNAPSHOT" = 1 ]; then
    echo "waiting for snapshot to finish (typically 5-15 min; Ctrl-C is safe,"
    echo "the snapshot keeps running server-side)..."
    aws rds wait db-snapshot-available --region "$REGION" \
      --db-snapshot-identifier "$SNAP_ID"
    aws rds describe-db-snapshots --region "$REGION" \
      --db-snapshot-identifier "$SNAP_ID" \
      --query 'DBSnapshots[0].[Status,PercentProgress,AllocatedStorage,SnapshotCreateTime]' \
      --output text
  fi
fi

# ------------------------------------------------- B. pg_dump -> S3

if [ "$DO_DUMP" = 1 ]; then
  say "B. pg_dump -> s3://$BUCKET/$S3_PREFIX/"

  # pg_dump refuses to run against a server newer than itself. RDS is PG17, and
  # macOS/Postgres.app often puts a v15 client first on PATH - catch it here
  # rather than after the dump has already been running for ten minutes.
  # Homebrew keeps libpq keg-only, so the pg_dump first on PATH is usually
  # Postgres.app's v15. Prefer libpq's when it is newer rather than just
  # reporting the problem - the whole backup would otherwise fail on a PATH
  # detail that has nothing to do with the database.
  if _libpq="$(brew --prefix libpq 2>/dev/null)" && [ -x "$_libpq/bin/pg_dump" ]; then
    _path_major="$(command -v pg_dump >/dev/null && pg_dump --version | sed -E 's/.* ([0-9]+).*/\1/' || echo 0)"
    _libpq_major="$("$_libpq/bin/pg_dump" --version | sed -E 's/.* ([0-9]+).*/\1/')"
    if [ "$_libpq_major" -gt "${_path_major:-0}" ]; then
      export PATH="$_libpq/bin:$PATH"
      echo "client  : using libpq v$_libpq_major from $_libpq/bin (PATH had v$_path_major)"
    fi
  fi
  command -v pg_dump >/dev/null || {
    echo "pg_dump not found. brew install libpq && export PATH=\"\$(brew --prefix libpq)/bin:\$PATH\"" >&2
    exit 1; }
  CLIENT_MAJOR="$(pg_dump --version | sed -E 's/.* ([0-9]+).*/\1/')"
  SERVER_MAJOR="$(PGPASSWORD="$(printf '%s' "$SEC" | jq -r .password)" \
    psql -h "$PGHOST_V" -p "$PGPORT_V" -U "$PGUSER_V" -d "$PGDATABASE_V" \
         -tAc 'SHOW server_version' 2>/dev/null | sed -E 's/^([0-9]+).*/\1/')"
  echo "pg_dump v$CLIENT_MAJOR -> server v${SERVER_MAJOR:-?}"
  if [ -n "$SERVER_MAJOR" ] && [ "$CLIENT_MAJOR" -lt "$SERVER_MAJOR" ]; then
    echo "pg_dump v$CLIENT_MAJOR is older than the server (v$SERVER_MAJOR); it will abort." >&2
    echo "  brew install libpq && export PATH=\"\$(brew --prefix libpq)/bin:\$PATH\"" >&2
    exit 1
  fi

  # Create the bucket if it is not there yet. Every setting below is about
  # durability or privacy; note what is ABSENT - no lifecycle configuration, so
  # S3 has no mechanism by which to expire these objects.
  if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
    echo "bucket  : s3://$BUCKET (exists)"
  else
    echo "bucket  : s3://$BUCKET (creating)"
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
    aws s3api put-public-access-block --bucket "$BUCKET" \
      --public-access-block-configuration \
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
    aws s3api put-bucket-versioning --bucket "$BUCKET" \
      --versioning-configuration Status=Enabled
    aws s3api put-bucket-encryption --bucket "$BUCKET" \
      --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
    aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging \
      'TagSet=[{Key=Purpose,Value=semp-database-backups},{Key=Retention,Value=permanent-manual}]'
    echo "          versioning=on, public access blocked, SSE-S3, no lifecycle rule"
  fi

  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  DUMP="$WORK/${INSTANCE_ID}-${PGDATABASE_V}-${TS}.dump"
  SCHEMA="$WORK/${INSTANCE_ID}-${PGDATABASE_V}-${TS}.schema.sql"

  export PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE
  PGPASSWORD="$(printf '%s' "$SEC" | jq -r .password)"
  PGHOST="$PGHOST_V"; PGPORT="$PGPORT_V"; PGUSER="$PGUSER_V"
  PGDATABASE="$PGDATABASE_V"; PGSSLMODE=require

  # -Fc: the custom format. Compressed, and pg_restore can do selective restores
  # and reorder for dependencies - which plain SQL cannot.
  echo "dumping (custom format, compressed)..."
  pg_dump -Fc -Z 6 --verbose --file "$DUMP" 2> "$WORK/pg_dump.log" || {
    echo "pg_dump failed; tail of its log:" >&2; tail -20 "$WORK/pg_dump.log" >&2; exit 1; }

  # A plain-text schema alongside it, so the structure is greppable and diffable
  # years from now without needing a running Postgres to inspect the archive.
  pg_dump --schema-only --no-owner --file "$SCHEMA" 2>/dev/null || true

  DUMP_SHA="$(shasum -a 256 "$DUMP" | awk '{print $1}')"
  DUMP_SIZE="$(wc -c < "$DUMP" | tr -d ' ')"

  cat > "$WORK/MANIFEST.txt" <<EOF
SEMP database backup
====================
taken at (UTC) : $TS_HUMAN
aws account    : $ACCOUNT_ID
region         : $REGION
rds instance   : $INSTANCE_ID
endpoint       : $PGHOST_V:$PGPORT_V
database       : $PGDATABASE_V
server version : ${SERVER_MAJOR:-unknown}
pg_dump version: $CLIENT_MAJOR
git commit     : $(git rev-parse HEAD 2>/dev/null || echo 'n/a')
git branch     : $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'n/a')

paired rds snapshot : $( [ "$DO_SNAPSHOT" = 1 ] && echo "$SNAP_ID" || echo 'none (--dump-only)' )

files
-----
$(basename "$DUMP")
    pg_dump custom format (-Fc -Z 6)
    size   : $DUMP_SIZE bytes
    sha256 : $DUMP_SHA
$(basename "$SCHEMA")
    plain-SQL schema only, for reading and diffing. NOT the restore artifact.

restore
-------
  aws s3 cp s3://$BUCKET/$S3_PREFIX/$(basename "$DUMP") .
  pg_restore --no-owner --no-acl --clean --if-exists \\
    -h <target-host> -U <user> -d <database> -j 4 \\
    $(basename "$DUMP")

This object has no lifecycle rule and no expiry. It is deleted only by hand.
EOF

  echo "uploading..."
  aws s3 cp "$DUMP"            "s3://$BUCKET/$S3_PREFIX/$(basename "$DUMP")"   --only-show-errors
  aws s3 cp "$SCHEMA"          "s3://$BUCKET/$S3_PREFIX/$(basename "$SCHEMA")" --only-show-errors
  aws s3 cp "$WORK/MANIFEST.txt" "s3://$BUCKET/$S3_PREFIX/MANIFEST.txt"        --only-show-errors

  echo
  cat "$WORK/MANIFEST.txt"
fi

say "Done"
[ "$DO_SNAPSHOT" = 1 ] && echo "snapshot : $SNAP_ID  (aws rds describe-db-snapshots --db-snapshot-identifier $SNAP_ID)"
[ "$DO_DUMP" = 1 ]     && echo "s3       : s3://$BUCKET/$S3_PREFIX/"
echo
echo "Neither will ever be deleted by AWS. To remove them you must run"
echo "delete-db-snapshot / s3 rm by hand."
