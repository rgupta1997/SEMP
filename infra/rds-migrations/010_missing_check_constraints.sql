-- The 22 CHECK constraints that never reached RDS.
--
-- STATUS: NOT APPLIED. Written 2026-10-03.
--
-- Body taken from docs/prod_missing_constraints_no_txn.sql unchanged. Every
-- constraint was verified missing against pg_constraint before this file was
-- written, and that file's three omissions were checked too and are correct:
-- notifications_audience_check and notifications_type_check were deliberately
-- dropped by 001 and 003, and users_account_type_check by
-- 20260616000000_rebrand_and_multitenancy.sql:93.
--
-- ---------------------------------------------------------------------------
-- Why an audit of all 99 migrations said there was nothing left to find
-- ---------------------------------------------------------------------------
-- Because the audit script had a bug, and these 22 are precisely what it hid.
--
-- It collected every name any migration DROPS into one flat set and skipped those
-- names when reporting, so as to ignore objects a later migration deliberately
-- removed. But the idempotency pattern these are written in is
--
--     alter table t drop constraint if exists c;
--     alter table t add constraint c check (...);
--
-- so each of these put its own name into the "deliberately dropped" set and
-- disappeared. 22 of 22 use that pattern. The two CHECK constraints the audit DID
-- catch - auth_tokens_subject_check, user_org_roles_status_check - are the two
-- written with a `do $$ if not exists $$` guard and no drop to confuse it.
--
-- The script is fixed (infra/rds-migrations/audit-drift.py): expected state is now
-- decided by the LAST event for an object in migration and statement order, so
-- drop-then-add resolves to "should exist". It now reports these 22.
--
-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------
-- Adding a CHECK to a populated table validates every existing row, so all 22 were
-- counted against live data first. ZERO violations, including on the populated
-- tables - 823 users, 559 organization_members, 342 fixtures, 33 organizations, 7
-- championships, 3 org_units, 3 user_invitations. The rest are empty.
--
-- Nothing here is load-bearing for a running request: no route fails today for
-- want of these. They are the writes the database should refuse - visibility
-- 'banana', a gender outside the four, an achievement attached to BOTH a user and
-- a team, a 50 MB claim evidence upload. The API validates most of it at its own
-- boundary, so the exposure is scripts, seeds, manual SQL, and any code path that
-- forgets.
--
-- Drop-then-add throughout, so this is replayable. Wrapped in BEGIN/COMMIT here,
-- unlike the docs/ original, which omits it for scripts/apply-migration.ts running
-- statements one at a time; apply.sh runs a file at once and the all-or-nothing is
-- worth having.

BEGIN;


-- 20260723010000_championship_visibility.sql
alter table championships drop constraint if exists championships_visibility_check;
alter table championships add constraint championships_visibility_check check (visibility in ('public', 'private'));

-- 20260815000000_org_tenancy_auth_audit.sql
alter table organizations drop constraint if exists organizations_kind_check;
alter table organizations add constraint organizations_kind_check check (kind in ('community', 'institution', 'personal'));

-- 20260815000000_org_tenancy_auth_audit.sql
alter table auth_tokens drop constraint if exists auth_tokens_kind_check;
alter table auth_tokens add constraint auth_tokens_kind_check check (kind in ('otp', 'password_reset', 'invite'));

-- 20260815020000_scorecard_lock.sql
alter table fixtures drop constraint if exists fixtures_scorecard_status_check;
alter table fixtures add constraint fixtures_scorecard_status_check check (scorecard_status in ('draft', 'submitted', 'locked'));

-- 20260815030000_email_invitations.sql
alter table user_invitations drop constraint if exists user_invitations_addressed_check;
alter table user_invitations add constraint user_invitations_addressed_check check (mobile is not null or email is not null);

-- 20260815040000_championship_type.sql
alter table championships drop constraint if exists championships_type_check;
alter table championships add constraint championships_type_check check (type is null or type in ('multi_sport', 'inter_college', 'inter_programme', 'single_sport', 'open'));

-- 20260815050000_championship_region.sql
alter table championships drop constraint if exists championships_region_check;
alter table championships add constraint championships_region_check check (region is null or region in ('asia', 'europe', 'americas', 'africa', 'oceania'));

-- 20260815100000_rbac_engine.sql
alter table permissions drop constraint if exists permissions_scope_check;
alter table permissions add constraint permissions_scope_check check (scope is null or scope in ('org', 'championship'));

-- 20260816060000_lifetime_and_achievements.sql
alter table lifetime_entries drop constraint if exists lifetime_entries_kind_check;
alter table lifetime_entries add constraint lifetime_entries_kind_check check (kind in ('participation', 'result', 'medal', 'award', 'record', 'selection'));

-- 20260816060000_lifetime_and_achievements.sql
alter table lifetime_entries drop constraint if exists lifetime_entries_source_check;
alter table lifetime_entries add constraint lifetime_entries_source_check check (source in ('locked_result', 'validated_claim', 'migrated'));

-- 20260816060000_lifetime_and_achievements.sql
alter table achievements drop constraint if exists achievements_kind_check;
alter table achievements add constraint achievements_kind_check check (kind in ('medal', 'placement', 'record', 'selection', 'honour', 'award'));

-- 20260816060000_lifetime_and_achievements.sql
alter table achievements drop constraint if exists achievements_medal_check;
alter table achievements add constraint achievements_medal_check check (medal is null or medal in ('gold', 'silver', 'bronze'));

-- 20260816060000_lifetime_and_achievements.sql
alter table achievements drop constraint if exists achievements_source_check;
alter table achievements add constraint achievements_source_check check (source in ('locked_result', 'validated_claim', 'migrated'));

-- 20260816060000_lifetime_and_achievements.sql
alter table achievements drop constraint if exists achievements_subject_check;
alter table achievements add constraint achievements_subject_check check ((user_id is not null) <> (team_id is not null));

-- 20260816070000_people_and_demographics.sql
alter table users drop constraint if exists users_gender_check;
alter table users add constraint users_gender_check check (gender is null or gender in ('male', 'female', 'other', 'prefer_not_to_say'));

-- 20260816070000_people_and_demographics.sql
alter table organization_members drop constraint if exists organization_members_verification_check;
alter table organization_members add constraint organization_members_verification_check check (verification in ('pending', 'verified', 'rejected'));

-- 20260818000000_claim_evidence.sql
alter table claim_evidence drop constraint if exists claim_evidence_size_sane;
alter table claim_evidence add constraint claim_evidence_size_sane check (size_bytes > 0 and size_bytes <= 3145728);

-- 20260818000000_claim_evidence.sql
alter table claim_evidence drop constraint if exists claim_evidence_mime_allowed;
alter table claim_evidence add constraint claim_evidence_mime_allowed check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'));

-- 20260827000000_intra_org_championships.sql
alter table org_units drop constraint if exists org_units_type_check;
alter table org_units add constraint org_units_type_check check (type in ('campus', 'department'));

-- 20260827000000_intra_org_championships.sql
alter table org_units drop constraint if exists org_units_status_check;
alter table org_units add constraint org_units_status_check check (status in ('ACTIVE', 'SETUP', 'ARCHIVED'));

-- 20260827000000_intra_org_championships.sql
alter table championships drop constraint if exists championships_entry_level_check;
alter table championships add constraint championships_entry_level_check check (entry_level in ('organization', 'campus', 'department'));

-- 20260828000040_org_verification_requests.sql
alter table org_verification_requests drop constraint if exists org_verification_requests_status_check;
alter table org_verification_requests add constraint org_verification_requests_status_check check (status in ('pending', 'approved', 'rejected', 'withdrawn'));


COMMIT;

-- Verification. Expect 22:
--
--   SELECT count(*) FROM pg_constraint WHERE conname IN (
--     'championships_visibility_check','organizations_kind_check','auth_tokens_kind_check',
--     'fixtures_scorecard_status_check','user_invitations_addressed_check',
--     'championships_type_check','championships_region_check','permissions_scope_check',
--     'lifetime_entries_kind_check','lifetime_entries_source_check','achievements_kind_check',
--     'achievements_medal_check','achievements_source_check','achievements_subject_check',
--     'users_gender_check','organization_members_verification_check','claim_evidence_size_sane',
--     'claim_evidence_mime_allowed','org_units_type_check','org_units_status_check',
--     'championships_entry_level_check','org_verification_requests_status_check');
--
-- Then: python3 infra/rds-migrations/audit-drift.py
-- Expect the constraint lines gone, leaving only the rename fossils its docstring names.
