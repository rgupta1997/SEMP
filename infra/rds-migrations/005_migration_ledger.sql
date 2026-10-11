-- A ledger of which files in this directory have been applied to this database.
--
-- ---------------------------------------------------------------------------
-- Why this exists
-- ---------------------------------------------------------------------------
-- Until now the only record of what RDS had applied was the prose at the top of
-- each file, maintained by hand - and it was already wrong: 003 carried
-- "STATUS: NOT APPLIED" for a week after the constraint had in fact been
-- dropped. Working out the true state meant querying pg_constraint,
-- information_schema and pg_tables for each file in turn and inferring backwards
-- from the schema. That does not scale and it is not safe to guess from.
--
-- It also makes "apply all the migrations" an unanswerable request. 001 has no
-- IF NOT EXISTS guards and 002 has 137 unguarded CREATE statements, so replaying
-- the directory top to bottom against a database that already has them aborts on
-- the first `CREATE TYPE "billing_period"`. Only 003 and 004 are replayable.
-- With a ledger, apply.sh can skip what is already recorded and the directory
-- becomes safe to run as a whole, on this database or on a fresh one.
--
-- This is deliberately NOT prisma_migrations. Prisma's own table carries
-- assumptions about a migrations directory this project does not have
-- (apps/api/prisma/migrations is empty by design - see 002 on why these files
-- are hand-written), and adopting it would invite someone to run
-- `prisma migrate deploy` against RDS, which is the failure mode these files
-- exist to avoid.
--
-- ---------------------------------------------------------------------------
-- The backfill
-- ---------------------------------------------------------------------------
-- 001 through 004 are recorded as applied below. That is not an assumption; each
-- was verified against the live catalogue on 2026-10-02:
--
--   001  notifications.audience is jsonb; notifications_audience_check absent
--   002  71 public tables (was 33)
--   003  notifications_type_check absent; 157 notification rows against the 144
--        in the file, so types outside the original six are writing
--   004  applied this session, inside BEGIN/COMMIT, after a ROLLBACK dry run
--
-- applied_at for 001-003 is the date each file's own notes give, or the date of
-- verification where the file does not say. They are a record of what ran, not
-- forensic timestamps, and the `note` column says which is which.
--
-- checksum is sha256 of the file as committed. apply.sh warns - it does not
-- fail - when a recorded file no longer matches, because these files are
-- routinely edited after the fact to correct their own STATUS headers. A changed
-- checksum means "read the diff", not "the database is wrong". The backfilled
-- rows leave it NULL rather than pinning a hash to content that was edited after
-- it ran.

BEGIN;

CREATE TABLE IF NOT EXISTS "rds_migrations" (
    "filename"   TEXT        NOT NULL,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_by" TEXT        NOT NULL DEFAULT current_user,
    "checksum"   TEXT,
    "note"       TEXT,

    CONSTRAINT "rds_migrations_pkey" PRIMARY KEY ("filename")
);

COMMENT ON TABLE "rds_migrations" IS
  'Which infra/rds-migrations/*.sql files have run against this database. Written by infra/rds-migrations/apply.sh.';

INSERT INTO "rds_migrations" ("filename", "applied_at", "note") VALUES
  ('001_notifications_audience_to_jsonb.sql',  '2026-09-24', 'backfilled 2026-10-02; verified via pg_constraint + column type'),
  ('002_sync_schema_to_prisma.sql',            '2026-09-24', 'backfilled 2026-10-02; date from the file''s own header; verified via 71-table count'),
  ('003_drop_notifications_type_check.sql',    '2026-10-02', 'backfilled 2026-10-02; exact apply date unknown, file header said NOT APPLIED but the constraint was already gone'),
  ('004_archive_settings_and_id_counters.sql', '2026-10-02', 'applied 2026-10-02 after a ROLLBACK dry run')
ON CONFLICT ("filename") DO NOTHING;

COMMIT;

-- Verification. Expect five rows after apply.sh records this file itself:
--
--   SELECT filename, applied_at::date, note FROM rds_migrations ORDER BY filename;
