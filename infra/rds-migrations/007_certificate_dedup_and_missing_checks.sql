-- Objects from THREE pre-cutover supabase migrations that never reached RDS.
--
-- STATUS: NOT APPLIED. Written 2026-10-03.
--
-- ---------------------------------------------------------------------------
-- How these were found, and why they were missed twice
-- ---------------------------------------------------------------------------
-- 006 came from auditing the six supabase migrations dated after the 2026-09-24
-- RDS cutover. That was the wrong boundary. This file comes from checking all 99
-- of them, object by object, against pg_proc / pg_trigger / pg_indexes /
-- pg_constraint / information_schema - 1606 live objects in total.
--
-- Eleven migrations came back with something missing. Six of those are fossils
-- and need nothing, each confirmed by finding the thing that removed them:
--
--   idx_sponsors_event_id            sponsors dropped, deliberately, in 002
--   trg_events_updated_at            events renamed to championships
--   idx_teams_event_id and two more  those teams columns no longer exist
--   idx_users_institution_id         users.institution_id no longer exists
--   idx_audit_log_entity             20260815010000 replaced entity_type with
--                                    target_type, and this index with
--                                    idx_audit_target
--   idx_organization_members_unit    20260828000000:55 drops org_unit_id
--
-- Two more are the sportagon_id function, already handled in 006. That leaves
-- the three below, which are real.
--
-- Worth saying plainly: a clean `prisma migrate diff` missed every one of these,
-- and so did 006's narrower audit. CHECK constraints and partial indexes are
-- invisible to the first, and the cutover date was the wrong place to stop
-- looking for the second.
--
-- ---------------------------------------------------------------------------
-- 1. 20260917000000_certificate_categories - SUBSTANTIALLY UNAPPLIED
-- ---------------------------------------------------------------------------
-- Only the column arrived, and only because 004 happened to add it while syncing
-- to schema.prisma. Everything that gives the column meaning is missing:
--
--   recipient_category column            present (via 004)
--   chk_certificates_recipient_category  MISSING - any string is storable
--   uq_certificates_one_per_recipient    STILL PRESENT - should have been dropped
--   uq_certificates_fixture_recipient    MISSING
--   uq_certificates_event_recipient      MISSING
--   idx_certificates_recipient_category  MISSING
--
-- So RDS is enforcing the OLD dedup key, (fixture_id, user_id, template_id), and
-- that migration exists specifically to retire it. Its own notes describe the
-- bug: keying on template_id means switching an organisation's certificate
-- design silently re-certifies someone who already holds the same honour - found
-- on a bench "where nine people held eight certificates each for one honour".
-- RDS still has exactly that behaviour, and additionally has no event-scoped
-- constraint at all, so the four non-fixture categories (participation,
-- organising, officials, coaches) have no dedup whatsoever.
--
-- The backfill UPDATEs in the source migration are NOT reproduced here. They
-- recover recipient_category from achievements and supersede the duplicate rows
-- the old key allowed, and certificates holds 0 rows on this database - verified,
-- not assumed - so all three are no-ops. The column's NOT NULL DEFAULT 'winners'
-- from 004 covers any row written between now and this file running.

ALTER TABLE certificates
  DROP CONSTRAINT IF EXISTS chk_certificates_recipient_category;

ALTER TABLE certificates
  ADD CONSTRAINT chk_certificates_recipient_category
  CHECK (recipient_category IN ('winners', 'awards', 'participation', 'organising', 'officials', 'coaches'));

-- Retire the template-keyed index this migration exists to replace.
DROP INDEX IF EXISTS uq_certificates_one_per_recipient;

-- One live certificate per person per category per fixture.
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificates_fixture_recipient
  ON certificates(fixture_id, user_id, recipient_category)
  WHERE revoked_at IS NULL AND superseded_at IS NULL AND fixture_id IS NOT NULL;

-- One live certificate per person per category per event, for the four
-- categories that have no single fixture behind them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificates_event_recipient
  ON certificates(championship_id, user_id, recipient_category)
  WHERE revoked_at IS NULL AND superseded_at IS NULL AND fixture_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_certificates_recipient_category
  ON certificates(recipient_category);

-- ---------------------------------------------------------------------------
-- 2. auth_tokens_subject_check (20260825000060_identity_option_b)
-- ---------------------------------------------------------------------------
-- "A token must identify its subject one way or the other" - email or phone, at
-- least one. auth_tokens currently has NO check constraints at all, so a token
-- row with neither is storable: an OTP or magic link addressed to nobody.
--
-- The source wraps it in a `do $$ ... end $$` guard that tests pg_constraint
-- first, which is equivalent to the drop-then-add used here.
--
-- 0 rows in auth_tokens, and 0 that would violate it - both checked.

ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_subject_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_subject_check
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. user_org_roles_status_check (20260825000080_role_model)
-- ---------------------------------------------------------------------------
-- The status column exists on RDS with its 'ACTIVE' default; the constraint that
-- bounds it does not, so any string is storable where the application expects
-- one of three.
--
-- This is the same table as uq_user_org_roles, the UNIQUE index that 004 notes
-- `prisma migrate diff` keeps proposing to drop. Between that and this, the
-- integrity rules on user_org_roles have been eroding from both directions.
--
-- 0 rows, and 0 violating - both checked.

ALTER TABLE user_org_roles DROP CONSTRAINT IF EXISTS user_org_roles_status_check;
ALTER TABLE user_org_roles ADD CONSTRAINT user_org_roles_status_check
  CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED'));

-- Verification. Expect three constraints and three certificate indexes present,
-- and the old index gone:
--
--   SELECT conname FROM pg_constraint WHERE conname IN
--     ('chk_certificates_recipient_category','auth_tokens_subject_check',
--      'user_org_roles_status_check');
--   SELECT indexname FROM pg_indexes WHERE indexname IN
--     ('uq_certificates_fixture_recipient','uq_certificates_event_recipient',
--      'idx_certificates_recipient_category','uq_certificates_one_per_recipient');
