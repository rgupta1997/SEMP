-- ============================================================================
-- Two role vocabularies, and the six organisation roles the breakdown names
--
--   ORGANISATION  Owner · Org Admin · Sports Admin · Billing Admin ·
--                 Reporting Admin · Viewer   (+ custom, behind advanced_permissions)
--   EVENT         Organiser · Captain · Official · Participant · POC
--
-- org_owner / org_admin / org_member are retired in favour of the first list.
--
-- They are RENAMED IN PLACE rather than deleted and replaced, and that is the
-- important decision in this file. Two things point at them:
--
--   * user_org_roles rows, by foreign key.
--   * organization_members.role - 'owner' (36), 'admin' (1), 'member' (395) - which
--     the permission engine reads as an IMPLIED grant of these three roles.
--
-- Deleting and re-inserting would break the first. Rewriting the membership strings
-- to match new codes would break the second in a worse way: 'member' is WRITTEN by
-- the join and invite paths (organizations.routes.ts) and READ by the notification
-- audience resolver, so changing the data would leave live code writing a value
-- nothing recognises. Renaming the role rows leaves both untouched - only the
-- code->role mapping in can.ts moves, and that is code, reviewed, and tested.
-- ============================================================================

-- ---- 1. A role now says which vocabulary it belongs to, and how far it reaches --

do $$ begin
  if not exists (select 1 from pg_type where typname = 'role_kind') then
    create type role_kind as enum ('org', 'event');
  end if;
  if not exists (select 1 from pg_type where typname = 'role_scope') then
    -- Role plus scope is the real permission unit: the same role name means a
    -- different reach at a different scope, which is why scope lives on the role
    -- and the concrete instance (which campus, which event) lives on the grant.
    create type role_scope as enum ('whole_org', 'campus_unit', 'single_event');
  end if;
end $$;

alter table roles add column if not exists kind role_kind;
alter table roles add column if not exists scope role_scope;
-- System roles are the product's own vocabulary and cannot be deleted through the
-- UI. Custom roles can, and are gated on advanced_permissions.
alter table roles add column if not exists is_system boolean not null default false;

-- ---- 2. Retire the three by renaming them ----------------------------------
-- Permissions are stored as CODES in roles.permission_ids, despite the column name -
-- it predates the code-owned catalogue in @semp/shared.

update roles set
  name = 'Owner', code = 'owner', kind = 'org', scope = 'whole_org', is_system = true,
  description = 'Full control of the tenant, including billing and deletion.',
  permission_ids = array['org.manage','org.member.manage','org.structure.manage','audit.view',
    'people.view','people.verify','people.edit','people.import','team.create','team.manage',
    'event.create','event.enroll','achievement.validate','certificate.issue','report.view',
    'role.manage','billing.manage','security.manage']
where organization_id is null and code = 'org_owner';

update roles set
  name = 'Org Admin', code = 'org_admin', kind = 'org', scope = 'whole_org', is_system = true,
  description = 'Everything except billing and tenant deletion.',
  permission_ids = array['org.manage','org.member.manage','org.structure.manage','audit.view',
    'people.view','people.verify','people.edit','people.import','team.create','team.manage',
    'event.create','event.enroll','achievement.validate','certificate.issue','report.view',
    'role.manage','security.manage']
where organization_id is null and code = 'org_admin';

-- 'member' always meant "can see the directory and nothing else", which is exactly
-- what the breakdown calls Viewer. Same grant, honest name.
update roles set
  name = 'Viewer', code = 'viewer', kind = 'org', scope = 'campus_unit', is_system = true,
  description = 'Read-only visibility of dashboards, events and achievements.',
  permission_ids = array['people.view']
where organization_id is null and code = 'org_member';

-- An organisation's private copy of the old member role follows the platform one.
update roles set name = 'Viewer', code = 'viewer', kind = 'org', scope = 'campus_unit'
where organization_id is not null and code = 'org_member';

-- ---- 3. The three roles that genuinely did not exist ------------------------

insert into roles (name, code, kind, scope, is_system, description, permission_ids)
select * from (values
  ('Sports Admin', 'sports_admin', 'org'::role_kind, 'campus_unit'::role_scope, true,
   'Runs sport day to day inside one campus or unit - people, teams, events, scoring.',
   array['people.view','people.verify','people.edit','people.import','team.create','team.manage',
         'event.create','event.enroll','official.assign','fixture.score','fixture.lock',
         'achievement.validate','certificate.issue','audit.view']),
  ('Billing Admin', 'billing_admin', 'org'::role_kind, 'whole_org'::role_scope, true,
   'Subscription, invoices and billing contact. No access to people data.',
   array['billing.manage']),
  ('Reporting Admin', 'reporting_admin', 'org'::role_kind, 'campus_unit'::role_scope, true,
   'Read and export reporting for the assigned scope. No operational actions.',
   array['people.view','report.view'])
) as v(name, code, kind, scope, is_system, description, permission_ids)
where not exists (select 1 from roles r where r.code = v.code and r.organization_id is null);

-- ---- 4. Label the event vocabulary ------------------------------------------
-- Captain stays a vocabulary entry rather than a granted row: captaincy is a TEAM
-- fact (team_members.role holds 218 captains and 186 vice-captains), and the engine
-- already derives event captaincy from team entries. The role exists so the word
-- means one thing; nobody is assigned it directly.

update roles set kind = 'event', scope = 'single_event', is_system = true
where organization_id is null and code in ('organiser', 'official', 'captain', 'participant', 'poc');

-- Anything still unlabelled is a custom role somebody made: org-scoped by default.
update roles set kind = 'org', scope = 'whole_org' where kind is null;

-- ---- 5. A grant says WHERE it applies, and whether it is live ---------------
-- Without scope_ref a campus-scoped role has no campus, which makes Sports Admin
-- and Reporting Admin meaningless - both are scoped to a campus by default.

alter table user_org_roles add column if not exists scope_ref varchar(64);
alter table user_org_roles add column if not exists status varchar(16) not null default 'ACTIVE';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_org_roles_status_check') then
    alter table user_org_roles add constraint user_org_roles_status_check
      check (status in ('ACTIVE', 'INVITED', 'SUSPENDED'));
  end if;
end $$;

-- Uniqueness now includes the scope: one person may hold Sports Admin on two
-- different campuses, which the old (user, org, role) key forbade.
drop index if exists uq_user_org_roles;
create unique index if not exists uq_user_org_roles_scoped
  on user_org_roles (user_id, organization_id, role_id, coalesce(scope_ref, ''));

create index if not exists idx_user_org_roles_status on user_org_roles (organization_id, status);

-- ---- 6. Four rows nothing ever read -----------------------------------------
-- P1..P4 predate the code-owned catalogue and appear in no role and no code path.

delete from permissions where code ~ '^P[0-9]+$';
