-- ============================================================================
-- Intra-organisation championships: the competing entity stops being the org
--
-- Until now the thing that competes in a championship was always an
-- ORGANISATION, and it was never stored - it was DERIVED, one hop at a time:
--
--     fixtures.home_team_id -> teams.organization_id -> standings.organization_id
--
-- `teams.organization_id` is NOT NULL, so inside a single institution every team
-- resolves to the same organisation and the whole standings table collapses into
-- one row. An inter-college meet works; an inter-campus or inter-department meet
-- inside one company cannot exist at all.
--
-- This migration introduces the CONTINGENT: the thing that competes, identified
-- by `org_unit_id` when there is one and by `organization_id` when there is not.
--
--     entry_level = 'organization'  ->  IIMB vs IIM-I vs IIM-K     (inter-org)
--     entry_level = 'campus'        ->  Bangalore vs Mumbai vs Pune (intra-org)
--     entry_level = 'department'    ->  Sales vs Engineering vs Finance
--
-- Every column added here is NULLABLE and every default reproduces today's
-- behaviour exactly. An existing championship is `entry_level='organization'`
-- with `org_unit_id` null on every row beneath it, which is byte-for-byte the
-- model that ran before this file. The regression surface is therefore not
-- "small" - it is empty by construction, and that is deliberate: the standings
-- engine is the most heavily tested code in the product and it is not being
-- asked to change behaviour, only to read its key from one place instead of
-- assuming it.
--
-- `standings.organization_id` deliberately stays NOT NULL. For an intra event it
-- holds the host organisation on every row, so the FK, the cascade and every
-- existing index keep working, and `org_unit_id` sits BESIDE it rather than
-- replacing it. A nullable-FK design would have been the obvious move and would
-- have made "which institution does this row belong to" unanswerable for exactly
-- the rows that need it most.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · org_units becomes campus -> department
--
-- The types were `programme` and `batch`, which are nouns from a college and
-- meaningless to a company. The STRUCTURE was always right - a two-level tree -
-- so this renames the levels and leaves the shape alone:
--
--     programme (root)  -> campus       a campus, an office, a location
--     batch (child)     -> department   a department, a batch, a programme
--
-- The noun each institution shows is a LABEL, kept in organizations.settings
-- (`unit_labels`), not a type. A college says Campus/Batch and a company says
-- Office/Department off one structure - which is the whole reason the type is
-- being made generic rather than adding a third and fourth enum value.
-- ---------------------------------------------------------------------------

-- The old constraint is dropped FIRST. It allowed only ('programme','batch'), so
-- the very first UPDATE below would have violated it and rolled the whole file
-- back - a check constraint is enforced per row as it is written, not at the end
-- of the transaction, so there is no ordering in which the rename survives it.
alter table org_units drop constraint if exists org_units_type_check;

update org_units set type = 'campus'     where type in ('programme', 'campus', 'primary_campus');
update org_units set type = 'department' where type in ('batch', 'unit', 'department');

-- Anything unrecognised becomes a department rather than being left to fail the
-- constraint below. A row we cannot classify is still somebody's data.
update org_units set type = 'department' where type not in ('campus', 'department');

alter table org_units add constraint org_units_type_check
  check (type in ('campus', 'department'));

-- SETUP means "created, not yet in use". It is not a soft delete: a SETUP unit
-- is still a legitimate scope for a role grant, it simply is not offered as an
-- entrant yet.
alter table org_units add column if not exists status varchar(16) not null default 'ACTIVE';
alter table org_units drop constraint if exists org_units_status_check;
alter table org_units add constraint org_units_status_check
  check (status in ('ACTIVE', 'SETUP', 'ARCHIVED'));

-- Who runs this campus. ON DELETE SET NULL: losing the administrator must not
-- take the campus, its people and its results with it.
alter table org_units add column if not exists admin_user_id uuid
  references users(id) on delete set null;

create index if not exists idx_org_units_admin on org_units(admin_user_id);
create index if not exists idx_org_units_status on org_units(organization_id, status);

-- ---------------------------------------------------------------------------
-- 2 · championships carry the level they are run at
--
-- The level is on the CHAMPIONSHIP, not on the tournament: standings aggregate
-- into a championship-wide scope, and a championship that mixed levels would
-- rank a campus against a department in the same table. One event, one kind of
-- competitor, and the overall table stays comparable by construction.
--
-- `entry_scope_unit_id` narrows a department-level event to one campus's
-- departments. Null means every department in the organisation enters, which is
-- the org-wide department league.
-- ---------------------------------------------------------------------------

alter table championships add column if not exists entry_level varchar(16) not null default 'organization';
alter table championships drop constraint if exists championships_entry_level_check;
alter table championships add constraint championships_entry_level_check
  check (entry_level in ('organization', 'campus', 'department'));

alter table championships add column if not exists entry_scope_unit_id uuid
  references org_units(id) on delete set null;

-- An intra event is defined by the institution it runs inside, so it MUST name a
-- host. Enforced in the API rather than as a table constraint only because
-- host_organization_id is nullable for the inter-org case and a conditional
-- check here would fire on rows this migration does not touch.
create index if not exists idx_championships_entry_level on championships(entry_level);

-- ---------------------------------------------------------------------------
-- 3 · a team can represent a unit rather than the whole institution
--
-- organization_id stays NOT NULL and keeps meaning "who owns this team". The new
-- column answers a different question - "who does it play FOR" - and the two are
-- the same thing only in an inter-org event.
-- ---------------------------------------------------------------------------

alter table teams add column if not exists org_unit_id uuid
  references org_units(id) on delete set null;

create index if not exists idx_teams_org_unit on teams(org_unit_id);

-- ---------------------------------------------------------------------------
-- 4 · entries: one row per CONTINGENT, not one per organisation
--
-- `championship_organizations` was unique on (championship_id, organization_id),
-- which is precisely the constraint that makes an intra event impossible: every
-- campus of one institution would be the same organisation, so the second campus
-- to enter collided with the first.
--
-- The replacement uniqueness treats a null unit as its own value via coalesce to
-- the nil UUID. Postgres would otherwise let (event, org, null) be inserted any
-- number of times, because null is not equal to null - so the inter-org case,
-- the one that has always worked, would silently lose its duplicate protection
-- the moment this column was added. That is the bug this coalesce exists to
-- prevent, and it is worth the ugliness.
-- ---------------------------------------------------------------------------

alter table championship_organizations add column if not exists org_unit_id uuid
  references org_units(id) on delete cascade;

alter table championship_organizations
  drop constraint if exists event_institutions_event_id_institution_id_key;

create unique index if not exists uq_championship_entrants
  on championship_organizations (
    championship_id,
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_championship_organizations_unit
  on championship_organizations(org_unit_id);

-- ---------------------------------------------------------------------------
-- 5 · team entries and standings carry the same contingent
--
-- Denormalised onto both rather than joined back through the team every time.
-- The standings row in particular has to survive the team being deleted - it is
-- a published result, and "who won" must not become unanswerable because
-- somebody tidied up a squad.
-- ---------------------------------------------------------------------------

alter table team_entries add column if not exists org_unit_id uuid
  references org_units(id) on delete set null;

alter table standings add column if not exists org_unit_id uuid
  references org_units(id) on delete cascade;

create index if not exists idx_standings_unit on standings(championship_id, org_unit_id);

-- ---------------------------------------------------------------------------
-- 6 · backfill: every existing row is an inter-org contingent
--
-- Stated as an explicit no-op so the intent is on the record. `org_unit_id` is
-- null on every pre-existing row, which IS the inter-org contingent, so there is
-- nothing to write. If a future migration ever needs to find "rows written
-- before levels existed", this comment is the marker.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7 · the two unique indexes that would have broken intra events silently
--
-- Adding the column was not enough. Two pre-existing unique indexes key on
-- organization_id alone, and in an intra event EVERY contingent shares one
-- organisation - so the second campus to be written would have collided with
-- the first:
--
--   uq_standings_scope_org   (championship, scope_type, scope_id, organization)
--       -> Mumbai's championship-scope row collides with Bangalore's, and the
--          standings upsert either throws or overwrites. The medal table would
--          have shown exactly one campus.
--
--   uq_team_entries_org_draw (championship, discipline, organization)
--       -> the second campus cannot enter a draw the first has entered. Every
--          intra draw would have had one entrant.
--
-- Both are rebuilt with the contingent in the key, coalescing null to the nil
-- UUID for the same reason as the entrants index above: without it the
-- inter-org rows lose their duplicate protection, because null <> null.
-- ---------------------------------------------------------------------------

drop index if exists uq_standings_scope_org;
create unique index uq_standings_scope_org
  on standings (
    championship_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop index if exists uq_team_entries_org_draw;
create unique index uq_team_entries_org_draw
  on team_entries (
    championship_id,
    tournament_discipline_id,
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where tournament_discipline_id is not null;
