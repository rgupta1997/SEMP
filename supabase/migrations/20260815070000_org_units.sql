-- ============================================================================
-- J1-E4 · The institution's own shape: programmes and batches
--
-- "Participation by programme" is the question every report in module 08 is built to
-- answer, and it cannot be asked until an institution can describe itself. PGP, EPGP,
-- PhD; batches within each.
--
-- Deliberately a TWO-LEVEL TYPED tree (programme → batch) rather than arbitrary
-- nesting, because that is what the PRD asks for and what a "group by programme"
-- report needs. `parent_id` is self-referential anyway, so a third level later widens
-- the CHECK rather than requiring a migration of the shape.
--
-- Member counts are DERIVED, never stored (PRD §7 is explicit). A stored count is a
-- number that goes wrong silently the first time anyone is moved.
-- ============================================================================

create table if not exists org_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_id       uuid references org_units(id) on delete cascade,
  type            varchar not null,
  name            varchar not null,
  code            varchar,
  display_order   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table org_units
  drop constraint if exists org_units_type_check;
alter table org_units
  add constraint org_units_type_check check (type in ('programme', 'batch'));

create index if not exists idx_org_units_org on org_units (organization_id, display_order);
create index if not exists idx_org_units_parent on org_units (parent_id, display_order);

-- Two units in one institution should not share a name at the same level; a second
-- "PGP 2024" under the same programme is a mistake every time.
create unique index if not exists uq_org_units_sibling_name
  on org_units (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ---------------------------------------------------------------------------
-- Where a person sits in that tree.
--
-- ON DELETE SET NULL is the story's requirement expressed as a constraint: removing a
-- programme clears its members' placement, it does not remove the members
-- (J1-E4-S2). Nullable because most memberships - community orgs, personal orgs, an
-- institution that hasn't described itself yet - have no unit and never will.
-- ---------------------------------------------------------------------------
alter table organization_members
  add column if not exists org_unit_id uuid references org_units(id) on delete set null;

create index if not exists idx_organization_members_unit on organization_members (org_unit_id);

-- ---------------------------------------------------------------------------
-- A declined registration is its own kind of news.
--
-- Rejections currently borrow 'event_lifecycle', so an applicant sees "Championship
-- update" for the message that matters most to them. The CHECK is what forced that,
-- so it is widened here rather than left as a papered-over compromise.
-- ---------------------------------------------------------------------------
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'manual', 'event_lifecycle', 'enrollment_approved', 'enrollment_rejected',
    'org_join_request', 'org_join_approved', 'org_join_declined',
    'org_invitation'
  ));
