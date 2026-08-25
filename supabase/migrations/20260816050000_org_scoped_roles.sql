-- ============================================================================
-- Roles were global; assignments were scoped
--
-- `user_org_roles(user_id, organization_id, role_id)` scopes an ASSIGNMENT correctly -
-- "Faculty Coordinator at IIMB" grants nothing at another institution. But the role
-- ROW it points at is global, so editing what Faculty Coordinator means changes it for
-- every institution on the platform at once. The screen invites exactly that: a
-- matrix of roles × permissions with no indication that the tick belongs to everybody.
--
-- The fix is an owner column rather than a second table. A role is now one of:
--
--   organization_id IS NULL  - a platform role. The starting set every institution
--                              gets, and the thing the super-admin matrix edits.
--   organization_id = <org>  - that institution's own. Created by overriding a
--                              platform role, and edited without touching anyone else.
--
-- Resolution is "the institution's own row for this code, else the platform one", so
-- an override shadows rather than replaces - and deleting the override restores the
-- platform behaviour with no data migration.
-- ============================================================================

alter table roles
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

-- `name` was globally unique, which cannot survive two institutions each naming a role
-- "Coordinator". Uniqueness becomes per-owner.
alter table roles drop constraint if exists roles_name_key;

create unique index if not exists uq_roles_platform_name
  on roles (lower(name)) where organization_id is null;
create unique index if not exists uq_roles_org_name
  on roles (organization_id, lower(name)) where organization_id is not null;

-- The same shape for `code`, which is what can() resolves membership roles through.
-- One org_admin per institution, one platform-wide fallback.
--
-- uq_roles_code (from the role-codes migration) was unique on lower(code) across the
-- whole table, which is exactly the global assumption being removed: it makes a second
-- row with code 'org_admin' impossible, so no institution could ever own a copy.
drop index if exists uq_roles_code;

create unique index if not exists uq_roles_platform_code
  on roles (lower(code)) where organization_id is null and code is not null;
create unique index if not exists uq_roles_org_code
  on roles (organization_id, lower(code)) where organization_id is not null and code is not null;

create index if not exists idx_roles_org on roles (organization_id) where organization_id is not null;
