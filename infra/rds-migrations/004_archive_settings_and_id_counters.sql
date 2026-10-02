-- Brings the RDS schema back in line with apps/api/prisma/schema.prisma after
-- 002: org/championship archiving, certificate recipient categories, fixture
-- format overrides, platform_settings and sportagon_id_counters.
--
-- APPLIED to semp-prod (ap-south-1) on 2026-10-02, inside BEGIN/COMMIT, after a
-- ROLLBACK dry run of this exact file. Verified afterwards: 7 columns and 2
-- tables present, all five kept indexes still present, 73 public tables, and
-- data untouched - 821 users, 29 organizations, 6 championships, 342 fixtures,
-- 157 notifications. `prisma migrate diff` then reports nothing but the five
-- DROP INDEX lines discussed below.
--
-- Generated with:
--   prisma migrate diff --from-url <rds> \
--     --to-schema-datamodel apps/api/prisma/schema.prisma --script
--
-- ---------------------------------------------------------------------------
-- What was REMOVED from the generated diff, and why
-- ---------------------------------------------------------------------------
-- Prisma emitted five DROP INDEX statements before anything else:
--
--     DROP INDEX "idx_audit_log_actor";
--     DROP INDEX "idx_audit_log_created";
--     DROP INDEX "idx_audit_log_org";
--     DROP INDEX "idx_championship_invitations_mobile";
--     DROP INDEX "uq_user_org_roles";
--
-- None of them are in this file. `migrate diff` wants them gone for one reason
-- only - they are not declared in schema.prisma - and that is exactly the drift
-- direction that loses hand-made objects. Each was checked against the live
-- catalogue rather than assumed:
--
--   uq_user_org_roles is a UNIQUE index on
--   user_org_roles(user_id, organization_id, role_id). It is not a performance
--   hint, it is the only thing stopping the same user holding the same role in
--   the same organisation twice. schema.prisma declares three plain @@index on
--   that table and no @@unique, so dropping it would silently remove an
--   integrity guarantee the application still depends on. Keep it; declaring it
--   in schema.prisma is the real fix and belongs in its own change.
--
--   idx_championship_invitations_mobile covers
--   championship_invitations(poc_mobile), the column invitations are looked up
--   by when a POC responds from a phone number rather than a link.
--
--   idx_audit_log_actor / _created / _org are btrees on audit_log.created_at and
--   friends. audit_log carries BOTH `at` and `created_at`; schema.prisma indexes
--   the `at` variants (idx_audit_actor_at, idx_audit_org_at, ...) and those
--   already exist on RDS, which is why the diff proposes no replacements. The
--   older three are therefore redundant rather than wrong, and on a table with 0
--   rows there is nothing to gain by dropping them today. They go when
--   `created_at` itself goes, as one deliberate cleanup, not as a side effect of
--   a schema sync.
--
-- So this file is purely additive. Nothing it touches existed beforehand - the
-- seven columns and two tables below were each confirmed absent against the live
-- catalogue before the file was written.
--
-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------
-- Every ADD COLUMN is either nullable or has a DEFAULT, so none of them can fail
-- the way a bare NOT NULL add does on a populated table (the trap 001 was written
-- to avoid). Postgres 11+ stores those defaults in the catalogue, so no table is
-- rewritten. Row counts at the time of writing: 821 users, 29 organizations, 6
-- championships, 342 fixtures, 0 certificates, 0 audit_log.
--
-- IF NOT EXISTS / DROP CONSTRAINT IF EXISTS throughout, so re-running the file is
-- a no-op rather than an error - it has to be replayable, because these files are
-- the only record of what RDS has had applied.
--
-- Wrapped in BEGIN/COMMIT. 002's notes explain why that is not ceremony.

BEGIN;

-- AlterTable
ALTER TABLE "certificates"
  ADD COLUMN IF NOT EXISTS "recipient_category" VARCHAR(24) NOT NULL DEFAULT 'winners';

-- AlterTable
ALTER TABLE "championships"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "archived_by" UUID,
  ADD COLUMN IF NOT EXISTS "archived_with_org" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "fixtures"
  ADD COLUMN IF NOT EXISTS "format_overrides" JSONB;

-- AlterTable
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "archived_by" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sportagon_id_counters" (
    "prefix" VARCHAR(3) NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sportagon_id_counters_pkey" PRIMARY KEY ("prefix")
);

-- AddForeignKey
-- ADD CONSTRAINT has no IF NOT EXISTS, so each is dropped-if-present first. The
-- drop is harmless on a fresh run and makes the file replayable.
ALTER TABLE "championships" DROP CONSTRAINT IF EXISTS "championships_archived_by_fkey";
ALTER TABLE "championships" ADD CONSTRAINT "championships_archived_by_fkey"
  FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_archived_by_fkey";
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_archived_by_fkey"
  FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "platform_settings" DROP CONSTRAINT IF EXISTS "platform_settings_updated_by_fkey";
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT;

-- Verification.
--
-- Expect 7 rows (the new columns) and 2 rows (the new tables):
--
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE (table_name, column_name) IN (
--     ('certificates','recipient_category'),
--     ('championships','archived_at'), ('championships','archived_by'),
--     ('championships','archived_with_org'),
--     ('fixtures','format_overrides'),
--     ('organizations','archived_at'), ('organizations','archived_by'));
--
--   SELECT tablename FROM pg_tables WHERE schemaname='public'
--   AND tablename IN ('platform_settings','sportagon_id_counters');
--
-- Expect the five kept indexes to STILL be there - this is the check that the
-- drops really were left out:
--
--   SELECT indexname FROM pg_indexes WHERE indexname IN
--   ('idx_audit_log_actor','idx_audit_log_created','idx_audit_log_org',
--    'idx_championship_invitations_mobile','uq_user_org_roles');
--
-- Then `prisma migrate diff --from-url <rds> --to-schema-datamodel
-- apps/api/prisma/schema.prisma --script` should report nothing but the five
-- DROP INDEX lines above. Anything else is new drift.
