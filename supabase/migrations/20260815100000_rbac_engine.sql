-- ============================================================================
-- J6-E1 · The permission engine
--
-- Two role systems already exist and neither is scoped to an institution:
-- `user_championship_roles` (per championship) and `organization_members.role` (a
-- single enum value per membership). What is missing is the ability to say "Priya is
-- a Faculty Coordinator AT IIMB" and have that mean a configurable set of permissions
-- there and nowhere else.
--
-- `user_org_roles` is that missing triple. It sits ALONGSIDE
-- `organization_members.role` rather than replacing it: the membership role still
-- answers "are they an owner/admin here", which every existing guard reads, and this
-- table adds granted capability on top. Replacing the enum would mean rewriting every
-- guard in one step - exactly the rewrite module 03 §4.1 argues against.
-- ============================================================================

create table if not exists user_org_roles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role_id         uuid not null references roles(id) on delete cascade,
  assigned_by     uuid references users(id) on delete set null,
  assigned_at     timestamptz not null default now()
);

-- The same role twice for the same person in the same organisation is meaningless.
create unique index if not exists uq_user_org_roles
  on user_org_roles (user_id, organization_id, role_id);

create index if not exists idx_user_org_roles_user on user_org_roles (user_id);
create index if not exists idx_user_org_roles_org on user_org_roles (organization_id);

-- ---------------------------------------------------------------------------
-- `permissions.rules` was an undocumented jsonb[] with no consumer and no schema.
-- An honest empty column beats a mystery one, but dropping it outright would break
-- the existing CRUD screen's payload - so it is left in place and simply unused,
-- and `permissions` gains the fields the catalogue actually needs.
-- ---------------------------------------------------------------------------
alter table permissions
  add column if not exists scope varchar,
  add column if not exists area  varchar;

alter table permissions
  drop constraint if exists permissions_scope_check;
alter table permissions
  add constraint permissions_scope_check check (scope is null or scope in ('org', 'championship'));
