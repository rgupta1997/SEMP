-- ============================================================================
-- A person belongs to SEVERAL campuses and batches, not one
--
-- `organization_members.org_unit_id` is a single nullable column, so somebody sat
-- in exactly one unit. That is not how an institution works: a student is in a
-- campus AND a programme AND an intake year, and an employee can be on two sites.
-- More to the point, it is not how squads work - the same person is legitimately
-- eligible for their campus team and their department team at once, and a single
-- column forced a choice between them.
--
-- Placement moves to `org_unit_members`, one row per (person, unit). The old column
-- is backfilled into it and then DROPPED: two ways to express the same fact is how
-- one of them silently goes stale, and the whole point of this table is that
-- eligibility, the directory and the reports all read the same answer.
--
-- Counting follows from the shape: somebody in two batches is counted in both, so
-- per-unit counts sum to more than the headcount. That is the honest reading of
-- "how many of my people" and the screens say so where the totals appear.
-- ============================================================================

create table if not exists org_unit_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  org_unit_id     uuid not null references org_units(id)     on delete cascade,
  user_id         uuid not null references users(id)         on delete cascade,
  created_at      timestamptz not null default now(),

  -- Being in a unit twice is not a thing. The unique also makes the "add them to
  -- this campus" write idempotent, which the bulk placement path relies on.
  constraint uq_org_unit_members unique (org_unit_id, user_id)
);

-- The three questions asked of this table, in the order they are asked:
--   who is in this unit?            (the campus page, the counts)
--   which units is this person in?  (squad eligibility, the directory row)
--   who is placed anywhere here?    (the unplaced banner)
create index if not exists idx_org_unit_members_unit on org_unit_members(org_unit_id);
create index if not exists idx_org_unit_members_user on org_unit_members(user_id);
create index if not exists idx_org_unit_members_org  on org_unit_members(organization_id, user_id);

-- ---------------------------------------------------------------------------
-- Backfill, then drop
--
-- `organization_id` is taken from the MEMBERSHIP rather than from the unit. They
-- agree today, and if they ever did not, the membership is the row that says which
-- institution this placement belongs to.
-- ---------------------------------------------------------------------------

insert into org_unit_members (organization_id, org_unit_id, user_id)
select m.organization_id, m.org_unit_id, m.user_id
from organization_members m
where m.org_unit_id is not null
on conflict (org_unit_id, user_id) do nothing;

alter table organization_members drop column if exists org_unit_id;
