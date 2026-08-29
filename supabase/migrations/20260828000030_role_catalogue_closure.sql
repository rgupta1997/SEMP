-- ============================================================================
-- The role ladder becomes a rule instead of eleven hand-written arrays
--
-- Three migrations before this one patched a missing permission onto a senior
-- role after somebody discovered they could not do their job:
--
--   20260825000090  "Owner and Org Admin were missing the competition permissions"
--   20260826000020  "The institution hosting an event could not manage it"
--   20260826000030  the honours board, granted role by role
--
-- Each was correct. The pattern was the bug: the grant sets were written out per
-- role, so nothing anywhere asserted the rule everybody assumed - that a senior
-- role holds at least everything the roles under it hold. Every gap of this class
-- could only be found by logging in as a real account, which is what 20260825000090
-- says in its own comment.
--
-- packages/shared/src/role-model.ts now owns the ladder. Each role declares only the
-- slice it is FOR and which roles it is senior to; the effective set is computed, and
-- rbac.test.ts asserts the closure holds and that Owner ends up holding the entire
-- catalogue - so a NEW permission cannot be added without a decision about where on
-- the ladder it goes.
--
-- THE MODEL IS A FLOOR, NOT A REPLACEMENT. This file, and
-- scripts/sync-role-catalogue.ts, only ever UNION the computed set into what is
-- stored. That is not timidity, it is what the data required:
--
--   * /platform/roles is a live screen (PATCH /roles/:roleId/permissions), and it
--     has been used. The platform `organiser` row currently holds 18 permissions
--     including org.manage and people.view - considerably more than the six the
--     ladder computes for it. Replacing the array would silently revoke whatever
--     that was for.
--   * An institution can own its own copy of a role, and one here holds exactly
--     `{report.view}` for Viewer - deliberately narrower than the platform floor.
--     Institution copies are not touched at all.
--
-- So the guarantee this file establishes is a MINIMUM: the ladder's closure always
-- holds, and anything a human added on top survives. Taking a permission away stays
-- an explicit act - there is exactly one below, and it says why.
-- ============================================================================

-- ---- 1. The floor, unioned into the platform rows --------------------------
-- One statement per role. array(select distinct unnest(...)) is the same idiom
-- 20260825000090 used, and it keeps the column a set rather than a list with
-- duplicates in it.

-- Owner: the whole catalogue. rbac.test.ts asserts this equals PERMISSION_CODES,
-- so a permission added to @semp/shared fails the build until it has a home.
update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'org.manage','org.member.manage','org.structure.manage','audit.view',
  'people.view','people.verify','people.edit','people.import',
  'team.manage','team.create',
  'event.create','event.manage','event.approve','event.enroll',
  'official.assign','fixture.score','fixture.lock','fixture.unlock',
  'achievement.view','achievement.validate','certificate.issue','report.view',
  'role.manage','billing.manage','security.manage'
])), kind = 'org', scope = 'whole_org', is_system = true,
  description = 'Full control of the tenant, including billing and deletion.'
where organization_id is null and code = 'owner';

-- Org Admin: everything except billing and security policy.
update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'org.manage','org.member.manage','org.structure.manage','audit.view',
  'people.view','people.verify','people.edit','people.import',
  'team.manage','team.create',
  'event.create','event.manage','event.approve','event.enroll',
  'official.assign','fixture.score','fixture.lock','fixture.unlock',
  'achievement.view','achievement.validate','certificate.issue','report.view',
  'role.manage'
])), kind = 'org', scope = 'whole_org', is_system = true,
  description = 'Everything except billing, security policy and tenant deletion.'
where organization_id is null and code = 'org_admin';

-- Sports Admin: runs sport inside a unit. Note what is absent: fixture.unlock.
-- Locking is a review, reopening rewrites a published result, and the person at the
-- match should not be able to do the second.
update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'audit.view',
  'people.view','people.verify','people.edit','people.import',
  'team.manage','team.create',
  'event.create','event.manage','event.approve','event.enroll',
  'official.assign','fixture.score','fixture.lock',
  'achievement.view','achievement.validate','certificate.issue'
])), kind = 'org', scope = 'campus_unit', is_system = true,
  description = 'Runs sport day to day inside one campus or unit - people, teams, events, scoring.'
where organization_id is null and code = 'sports_admin';

update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'people.view','achievement.view','report.view'
])), kind = 'org', scope = 'campus_unit', is_system = true,
  description = 'Read and export reporting for the assigned scope. No operational actions.'
where organization_id is null and code = 'reporting_admin';

-- Billing Admin inherits NOTHING on the ladder, not even Viewer's floor: "No access
-- to people data" is the role's whole definition, and Viewer's floor is the people
-- directory. It is the one place where a senior-looking role is narrower than the
-- floor, and it is narrower on purpose.
update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'billing.manage'
])), kind = 'org', scope = 'whole_org', is_system = true,
  description = 'Subscription, invoices and billing contact. No access to people data.'
where organization_id is null and code = 'billing_admin';

-- Viewer is THE FLOOR: everybody who belongs to an institution holds this, because
-- membership implies it. Anything added here is added for every person in every
-- institution, which is why it is two permissions and both are reads.
update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'people.view','achievement.view'
])), kind = 'org', scope = 'campus_unit', is_system = true,
  description = 'Read-only visibility of dashboards, events and achievements.'
where organization_id is null and code = 'viewer';

-- ---- 2. The event vocabulary ----------------------------------------------
--
-- `official.assign` was missing from Organiser, which is the same class of gap as
-- the three patch-migrations: the guard on POST /championships/:id/officials has
-- always permitted the organiser, and the array behind the role did not say so. It
-- only surfaced now because the array is finally being asserted against something.

update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'event.manage','event.approve','official.assign',
  'fixture.score','fixture.lock','fixture.unlock'
])), kind = 'event', scope = 'single_event', is_system = true
where organization_id is null and code = 'organiser';

-- Scoring only. Locking makes a result official and is the organiser's review; an
-- official who could lock their own card would be reviewing themselves - which is
-- also what the routes already say (fixtures.routes.ts uses fixtureOrganiser for
-- /lock and fixtureScorer for the score).
update roles set permission_ids = array(select distinct unnest(permission_ids || array[
  'fixture.score'
])), kind = 'event', scope = 'single_event', is_system = true
where organization_id is null and code = 'official';

-- Captain, POC and Participant add nothing: all three see the event as published and
-- operate none of it. Labelled here only so the vocabulary is complete; whatever is
-- already stored on them is left exactly as it is.
update roles set kind = 'event', scope = 'single_event', is_system = true
where organization_id is null and code in ('captain', 'poc', 'participant');

-- ---- 3. The one removal ---------------------------------------------------
--
-- security.manage leaves Org Admin. Administration already withheld the Security tab
-- from Org Admin (AdminPage.tsx, ROLE_ADMIN) with the right reason on it: org-wide
-- policy - 2FA enforcement, IP allowlist, session length - binds the administrators
-- too, and somebody the Owner appointed, and can remove, should not be able to relax
-- the rules that bind them. The server granted it anyway, so the screen and the API
-- disagreed about who may change the institution's security policy.
--
-- Nothing enforces security.manage yet (no route reads it), so this costs nothing
-- today and stops the API from being wrong on the day something does. Owner keeps it.
--
-- PLATFORM ROW ONLY. An institution that has taken its own copy of Org Admin has
-- made a decision about it, and this is not the place to overrule it.
update roles
set permission_ids = array_remove(permission_ids, 'security.manage')
where organization_id is null and code = 'org_admin';

-- ---- 4. Report, don't rewrite --------------------------------------------
--
-- Belonging to an institution IS holding Viewer there, and can() reads that from
-- organization_members.role. The map in can.ts covered owner/admin/member and
-- silently missed the other two values ORGANIZATION_MEMBER_ROLE allows - 'captain'
-- and 'alumni' - so those members held no role on the server while the web app
-- mapped them to Viewer. Navigation offered them Dashboard, Events and Achievements;
-- all three refused them.
--
-- Fixed in CODE (membershipRoleCode defaults to viewer, so a sixth value added later
-- grants the floor rather than nothing) rather than by rewriting the membership
-- strings: 'member' is written by the join and invite paths and read by the
-- notification audience resolver, so changing the data would leave live code writing
-- a value nothing recognises. This block only reports what was affected.

do $$
declare n bigint; scoped bigint;
begin
  select count(*) into n from organization_members
   where status = 'active' and role in ('captain', 'alumni');
  raise notice 'membership floor: % active captain/alumni memberships now imply Viewer', n;

  -- can() now reads user_org_roles.scope_ref, which the role-assignment screen has
  -- always written and nothing consulted. These grants stop reaching the whole
  -- institution the moment a call site names a unit.
  select count(*) into scoped from user_org_roles where scope_ref is not null;
  raise notice 'scope_ref: % grants are campus-scoped and are now enforced as such', scoped;
end $$;
