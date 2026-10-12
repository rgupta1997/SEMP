-- Seed the role catalogue. RDS has never had it.
--
-- STATUS: NOT APPLIED. Written 2026-10-03.
--
-- ---------------------------------------------------------------------------
-- What is actually wrong
-- ---------------------------------------------------------------------------
-- The whole IAM layer on this database is still the June 2026 one. `roles` holds
-- five rows, every `code` is NULL, and `permission_ids` holds UUIDs pointing at a
-- four-row `permissions` table (P1 Full access, P2 Manage matches, P3 Manage own
-- team, P4 Read-only). packages/shared/src/role-model.ts declares ELEVEN roles
-- addressed by code.
--
--     $ npx tsx scripts/sync-role-catalogue.ts
--     ! viewer           no platform role row - run the migrations
--     ! sports_admin     no platform role row - run the migrations
--     ...
--     0 platform roles would change, 11 missing.
--
-- Five supabase migrations are involved and all five are no-ops here, in a chain:
--
--   20260816020000_membership_role_grants   only its index arrived
--   20260825000080_role_model               columns arrived via 002, zero data
--   20260825000090_admin_competition_perms  UPDATE ... WHERE code IN (...) -> 0 rows
--   20260826000020_host_org_event_manage    same, 0 rows
--   20260828000030_role_catalogue_closure   same, 0 rows
--
-- 20260825000080 renames rows `WHERE code = 'org_owner'`. No row here has ever had
-- a code, so the rename matches nothing and the three later migrations then update
-- roles that were never created. Replaying those files verbatim would change
-- nothing at all - which is why this is a new migration and not a re-run.
--
-- ---------------------------------------------------------------------------
-- What breaks today, and what does not
-- ---------------------------------------------------------------------------
-- Nothing throws. can.ts:159 ignores a permission_id that is not a known code
-- rather than failing, so grantedPermissions() simply returns the empty set for
-- everybody, and every guard falls through to its hard-coded fallback -
-- permissions.ts:109, `organization_members.role in ('owner','admin')`.
--
-- So the app works, and the permission engine contributes nothing to it:
--
--   * Roles & Permissions is a screen that cannot grant anything. There is no
--     sports_admin row to assign, and user_org_roles holds 0 rows.
--   * Only `owner` and `admin` memberships carry authority. Sports Admin, Billing
--     Admin, Reporting Admin and Viewer do not exist.
--   * event.manage / event.approve are granted to nobody, so the bug
--     20260826000020 was written to fix is still live.
--   * Custom roles and campus-scoped grants resolve to nothing.
--
-- ---------------------------------------------------------------------------
-- The one judgement call: the UUIDs in permission_ids
-- ---------------------------------------------------------------------------
-- The five existing rows carry UUIDs that resolve to P1-P4. This file overwrites
-- them with codes from the ladder, and that is a deliberate departure from the
-- "only ever UNION" rule in 20260828000030 and sync-role-catalogue.ts.
--
-- The reason it is safe is that those UUIDs are INERT, not merely redundant.
-- can.ts matches permission_ids against the code catalogue; a UUID matches no code
-- and is discarded on every request. Organiser's P1 "Full access" grants nothing
-- today and has granted nothing since the code-owned catalogue landed. Keeping it
-- would preserve the appearance of authority while changing none, and would make
-- sync-role-catalogue.ts report "1 added by hand" on that row forever.
--
-- No authority is removed by this file. Every role ends up with strictly more than
-- it has now, because it has nothing now.
--
-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------
-- The grant arrays below are not hand-written. They are effectiveGrants(code) from
-- packages/shared/src/role-model.ts, dumped from the model so that the ladder
-- closure rbac.test.ts asserts is what lands in the database. participant, captain
-- and poc compute to an EMPTY array, which is correct and expected - can.ts:172
-- falls a platform row with a code and no permissions back to the model, and its
-- comment notes the event roles "shipped with empty arrays for months" for exactly
-- this reason.
--
-- Replayable: the UPDATEs are idempotent and the INSERTs are guarded by
-- WHERE NOT EXISTS on lower(code).
--
-- After this runs, `npx tsx scripts/sync-role-catalogue.ts` should report eleven
-- roles at their floor and nothing missing. That script is the maintenance path
-- from here on; it deliberately will not create a missing row, which is why this
-- migration has to exist.

BEGIN;

-- ---- 1. The five rows that already exist: give them their codes, in place ----

-- MATCHED BY NAME AND UPDATED, NEVER DELETED AND REINSERTED. 752 rows in
-- user_championship_roles point at these five ids (738 Participant, 14 Organiser),
-- so the id is the one thing that must survive. This is the same reasoning
-- 20260825000080 gives for renaming rather than replacing - it just cannot use
-- that migration's WHERE clause, because the codes it matches on were never here.

UPDATE roles SET
  code = 'captain', kind = 'event'::role_kind, scope = 'single_event'::role_scope,
  is_system = true, description = 'Leads a squad. Captaincy is a team fact; the role exists so the word means one thing.',
  permission_ids = ARRAY[]::text[]
WHERE organization_id IS NULL AND lower(name) = 'captain';

UPDATE roles SET
  code = 'official', kind = 'event'::role_kind, scope = 'single_event'::role_scope,
  is_system = true, description = 'Records what happened in the matches they are assigned to.',
  permission_ids = ARRAY['fixture.score']::text[]
WHERE organization_id IS NULL AND lower(name) = 'official';

UPDATE roles SET
  code = 'organiser', kind = 'event'::role_kind, scope = 'single_event'::role_scope,
  is_system = true, description = 'Runs the event: setup, entries, officials, results.',
  permission_ids = ARRAY['event.manage', 'event.approve', 'official.assign', 'fixture.score', 'fixture.lock', 'fixture.unlock']::text[]
WHERE organization_id IS NULL AND lower(name) = 'organiser';

UPDATE roles SET
  code = 'poc', kind = 'event'::role_kind, scope = 'single_event'::role_scope,
  is_system = true, description = 'The point of contact an institution nominates for an event.',
  permission_ids = ARRAY[]::text[]
WHERE organization_id IS NULL AND lower(name) = 'poc';

UPDATE roles SET
  code = 'participant', kind = 'event'::role_kind, scope = 'single_event'::role_scope,
  is_system = true, description = 'Competes in the event. Sees it as published.',
  permission_ids = ARRAY[]::text[]
WHERE organization_id IS NULL AND lower(name) = 'participant';


-- ---- 2. The six organisation roles, which do not exist at all ----

-- Inserted rather than renamed: there is no org_owner / org_admin / org_member row
-- on this database to rename. gen_random_uuid() is fine here precisely because
-- nothing points at them yet - user_org_roles holds 0 rows.
--
-- WHERE NOT EXISTS rather than ON CONFLICT: uq_roles_platform_code is a PARTIAL
-- unique index on lower(code), which an ON CONFLICT target cannot name cleanly.

INSERT INTO roles (id, name, code, kind, scope, is_system, description, permission_ids, organization_id)
SELECT gen_random_uuid(), 'Owner', 'owner', 'org'::role_kind, 'whole_org'::role_scope,
       true, 'Full control of the tenant, including billing and deletion.', ARRAY['org.manage', 'org.member.manage', 'org.structure.manage', 'audit.view', 'people.view', 'people.verify', 'people.edit', 'people.import', 'team.manage', 'team.create', 'event.create', 'event.manage', 'event.approve', 'event.enroll', 'official.assign', 'fixture.score', 'fixture.lock', 'fixture.unlock', 'achievement.view', 'achievement.validate', 'certificate.issue', 'report.view', 'role.manage', 'billing.manage', 'security.manage']::text[], NULL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organization_id IS NULL AND lower(code) = 'owner');

INSERT INTO roles (id, name, code, kind, scope, is_system, description, permission_ids, organization_id)
SELECT gen_random_uuid(), 'Org Admin', 'org_admin', 'org'::role_kind, 'whole_org'::role_scope,
       true, 'Everything except billing, security policy and tenant deletion.', ARRAY['org.manage', 'org.member.manage', 'org.structure.manage', 'audit.view', 'people.view', 'people.verify', 'people.edit', 'people.import', 'team.manage', 'team.create', 'event.create', 'event.manage', 'event.approve', 'event.enroll', 'official.assign', 'fixture.score', 'fixture.lock', 'fixture.unlock', 'achievement.view', 'achievement.validate', 'certificate.issue', 'report.view', 'role.manage']::text[], NULL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organization_id IS NULL AND lower(code) = 'org_admin');

INSERT INTO roles (id, name, code, kind, scope, is_system, description, permission_ids, organization_id)
SELECT gen_random_uuid(), 'Sports Admin', 'sports_admin', 'org'::role_kind, 'campus_unit'::role_scope,
       true, 'Runs sport day to day inside one campus or unit - people, teams, events, scoring.', ARRAY['audit.view', 'people.view', 'people.verify', 'people.edit', 'people.import', 'team.manage', 'team.create', 'event.create', 'event.manage', 'event.approve', 'event.enroll', 'official.assign', 'fixture.score', 'fixture.lock', 'achievement.view', 'achievement.validate', 'certificate.issue']::text[], NULL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organization_id IS NULL AND lower(code) = 'sports_admin');

INSERT INTO roles (id, name, code, kind, scope, is_system, description, permission_ids, organization_id)
SELECT gen_random_uuid(), 'Billing Admin', 'billing_admin', 'org'::role_kind, 'whole_org'::role_scope,
       true, 'Subscription, invoices and billing contact. No access to people data.', ARRAY['billing.manage']::text[], NULL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organization_id IS NULL AND lower(code) = 'billing_admin');

INSERT INTO roles (id, name, code, kind, scope, is_system, description, permission_ids, organization_id)
SELECT gen_random_uuid(), 'Reporting Admin', 'reporting_admin', 'org'::role_kind, 'campus_unit'::role_scope,
       true, 'Read and export reporting for the assigned scope. No operational actions.', ARRAY['people.view', 'achievement.view', 'report.view']::text[], NULL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organization_id IS NULL AND lower(code) = 'reporting_admin');

INSERT INTO roles (id, name, code, kind, scope, is_system, description, permission_ids, organization_id)
SELECT gen_random_uuid(), 'Viewer', 'viewer', 'org'::role_kind, 'campus_unit'::role_scope,
       true, 'Read-only visibility of dashboards, events and achievements.', ARRAY['people.view', 'achievement.view']::text[], NULL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE organization_id IS NULL AND lower(code) = 'viewer');

COMMIT;

-- Verification.
--
--   SELECT code, name, kind, scope, array_length(permission_ids,1) AS n
--     FROM roles WHERE organization_id IS NULL ORDER BY kind, code;
--
-- Expect 11 rows, every code non-null. Then the authority that matters:
--
--   SELECT code FROM roles
--    WHERE organization_id IS NULL AND 'event.manage' = ANY(permission_ids);
--     -> owner, org_admin, sports_admin
--
-- And the 752 grants must still resolve, which is the thing this file is most at
-- risk of breaking:
--
--   SELECT r.name, count(*) FROM user_championship_roles ucr
--     JOIN roles r ON r.id = ucr.role_id GROUP BY 1;
--     -> Participant 738, Organiser 14
--
-- Then: npx tsx scripts/sync-role-catalogue.ts   (expect 0 missing)
