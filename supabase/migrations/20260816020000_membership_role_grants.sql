-- ============================================================================
-- Retiring the hard-coded permission fallbacks
--
-- `can()` was retrofitted underneath the existing guards: super admin, then an
-- explicit grant, then - always - the hard-coded rule the guard already had. That made
-- the retrofit safe (nobody lost access) but it also made the engine decorative. Every
-- decision in production still came from the hard-coded half, and `user_org_roles` had
-- exactly zero rows, so no role a super admin configured could actually decide
-- anything. Permissions were a screen, not a policy.
--
-- What was in the way: the hard-coded rules read `organization_members.role`
-- ('owner' | 'admin' | 'member'), while grants read `roles`. Two vocabularies for the
-- same idea. This migration joins them - membership role IS a role - so the engine can
-- answer the same questions the hard-coded rules answered, from data.
--
-- After this, `can()` resolves an org owner's permissions through the `org_owner` role
-- row, and the fallbacks in permissions.ts come out one permission at a time (see the
-- tests in can.test.ts, one per permission).
--
-- The consequence is the point: an institution editing what `org_admin` grants now
-- changes what its admins can do. Grants stop being able only to widen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Legacy uuid entries in permission_ids
--
-- The column was uuid[] before it was text[], so two roles still carry uuids that match
-- no catalogue code. can() already ignores them, and the roles matrix shows an amber
-- "leftover entries" banner. Now that these rows decide real access, an entry nobody
-- can read is a liability rather than a curiosity - remove them.
-- ---------------------------------------------------------------------------
update roles
set permission_ids = coalesce((
  select array_agg(p order by ord)
  from unnest(permission_ids) with ordinality as t(p, ord)
  where p !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), '{}')
where exists (
  select 1 from unnest(permission_ids) as p
  where p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

-- ---------------------------------------------------------------------------
-- 2. A role row per membership role
--
-- These carry exactly what the hard-coded rules granted, so retiring a fallback is a
-- no-op for every existing user:
--
--   orgRole(user, org, ['owner','admin'])  ->  org_owner / org_admin
--
-- `org_member` exists so the mapping is total and so an institution has somewhere to
-- put "what an ordinary member may do" without inventing a role first.
-- ---------------------------------------------------------------------------
insert into roles (name, code, description, permission_ids)
select v.name, v.code, v.description, v.perms::text[]
from (values
  (
    'Organisation Owner', 'org_owner',
    'Full authority over an organisation. Held by whoever created it.',
    '{org.manage,org.member.manage,org.structure.manage,audit.view,people.view,people.verify,team.manage,team.create,event.create,event.enroll,achievement.validate,certificate.issue,report.view}'
  ),
  (
    'Organisation Admin', 'org_admin',
    'Runs the sports office day to day: people, teams and entries.',
    '{org.member.manage,org.structure.manage,people.view,people.verify,team.manage,team.create,event.create,event.enroll,report.view}'
  ),
  (
    'Organisation Member', 'org_member',
    'An ordinary member. Can see the directory and reports, nothing more.',
    '{people.view,report.view}'
  )
) as v(name, code, description, perms)
where not exists (select 1 from roles r where r.code = v.code);

-- Re-running must refresh the grants of a role nobody has edited yet. These three rows
-- are seeded, not managed, so the update is deliberately keyed on code and only fills
-- the case where the row exists with an empty grant list.
update roles set permission_ids = '{org.manage,org.member.manage,org.structure.manage,audit.view,people.view,people.verify,team.manage,team.create,event.create,event.enroll,achievement.validate,certificate.issue,report.view}'
where code = 'org_owner' and permission_ids = '{}';
update roles set permission_ids = '{org.member.manage,org.structure.manage,people.view,people.verify,team.manage,team.create,event.create,event.enroll,report.view}'
where code = 'org_admin' and permission_ids = '{}';
update roles set permission_ids = '{people.view,report.view}'
where code = 'org_member' and permission_ids = '{}';

-- ---------------------------------------------------------------------------
-- 3. The captain role
--
-- teamManager's rule had a second half the org roles cannot express: the team's OWN
-- captain, which is per-team rather than per-organisation. That half stays in code as a
-- first-class rule (not a fallback) - see permissions.ts. The captain role row still
-- gets team.manage so that granting it explicitly means what it says.
-- ---------------------------------------------------------------------------
update roles
set permission_ids = (
  select array_agg(distinct p) from unnest(permission_ids || '{team.manage,people.view}'::text[]) as p
)
where code = 'captain';

-- ---------------------------------------------------------------------------
-- 4. The one new permission code
--
-- `permissions` is a mirror of the code-owned catalogue (bootstrap-catalog.ts), but the
-- roles seeded above reference event.enroll, so the row has to exist by the time this
-- migration finishes rather than the next time somebody runs the bootstrap script.
--
-- event.enroll is entering YOUR organisation into somebody else's championship.
-- enrollSelf was checking event.approve - the HOST's permission to admit entrants -
-- for the entrant's own action.
-- ---------------------------------------------------------------------------
insert into permissions (code, label, scope, area)
select 'event.enroll', 'Enter this organisation into championships', 'org', 'Championships'
where not exists (select 1 from permissions where code = 'event.enroll');

-- ---------------------------------------------------------------------------
-- 5. An index for the lookup can() now does on every guarded request
-- ---------------------------------------------------------------------------
create index if not exists idx_organization_members_user_org_active
  on organization_members (user_id, organization_id) where status = 'active';
