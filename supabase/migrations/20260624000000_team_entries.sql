-- ============================================================================
-- True many-to-many: a roster (team) can enter many championships
--   Moves the single (championship, championship_organization, discipline, lock
--   status) tuple off `teams` into a new `team_entries` join table — one row per
--   championship a roster participates in. `teams` becomes the reusable roster
--   identity (name + sport + org + members); fixtures keep referencing team_id and
--   derive their championship from the fixture's discipline.
--
--   Players can be added to the shared roster before any entry exists; each entry
--   locks its own roster snapshot against its discipline's squad rules.
--   Idempotent.
-- ============================================================================

create table if not exists team_entries (
  id                            uuid primary key default gen_random_uuid(),
  team_id                       uuid not null references teams (id) on delete cascade,
  organization_id               uuid not null references organizations (id),
  championship_id               uuid not null references championships (id),
  championship_organization_id  uuid not null references championship_organizations (id),
  tournament_discipline_id      uuid references tournament_disciplines (id),
  status                        varchar not null default 'forming',
  created_at                    timestamptz not null default now()
);

-- A roster enters a given championship at most once.
create unique index if not exists uq_team_entries_team_championship
  on team_entries (team_id, championship_id);

-- Race-proof "one team per draw per org" — replaces uq_teams_institution_event_discipline.
-- Partial so an entry that has not yet picked a draw is unconstrained.
create unique index if not exists uq_team_entries_org_draw
  on team_entries (championship_id, tournament_discipline_id, organization_id)
  where tournament_discipline_id is not null;

create index if not exists idx_team_entries_team on team_entries (team_id);
create index if not exists idx_team_entries_championship on team_entries (championship_id);
create index if not exists idx_team_entries_discipline on team_entries (tournament_discipline_id);

-- Backfill: every currently-assigned team becomes one entry, preserving lock status.
insert into team_entries (team_id, organization_id, championship_id, championship_organization_id, tournament_discipline_id, status)
select id, organization_id, championship_id, championship_organization_id, tournament_discipline_id, status
from teams
where championship_id is not null
on conflict do nothing;

-- Drop the now-legacy single-assignment columns + the old uniqueness guard.
-- (teams.status stays, but now reflects only the roster's own lifecycle; the
--  per-championship lock lives on team_entries.status.)
drop index if exists uq_teams_institution_event_discipline;
alter table teams drop column if exists championship_id;
alter table teams drop column if exists championship_organization_id;
alter table teams drop column if exists tournament_discipline_id;
