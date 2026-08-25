-- ============================================================================
-- J3-E3 · one team per organisation per draw   ·   J2-E6 · elapsed match time
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · J3-E3-S1 — "only one team per organisation may be entered into the
--     same draw", as a CONSTRAINT rather than a convention.
--
-- The rule already existed, in the application code of exactly one route
-- (`POST /teams/:id/entries` checks it by hand). Four other paths create
-- `team_entries` - the matrix importer, solo entry, team creation and the bulk
-- team create - and none of them checked. Even the one that did was a
-- read-then-write with no lock, so two captains entering at the same moment
-- both saw an empty draw and both got in.
--
-- Partial, because `tournament_discipline_id` is nullable: an entry made before
-- the organiser has published the draws names no discipline yet, and any number
-- of those may exist for one organisation.
--
-- Verified empty before applying: no existing pair violates it.
create unique index if not exists uq_team_entries_org_draw
  on team_entries (organization_id, tournament_discipline_id)
  where tournament_discipline_id is not null;

-- ----------------------------------------------------------------------------
-- 2 · J2-E6-S2 — when a match actually kicked off.
--
-- `updated_at` is not this: every score tap moves it, so elapsed time computed
-- from it would reset to zero on every point. This column is written ONCE, on
-- the transition into 'live', and cleared if the fixture leaves 'live' without
-- finishing (a postponement), so a resumed match starts its clock again.
--
-- Deliberately elapsed-since-kickoff, not a stoppable match clock with halves
-- and injury time - that is a per-sport rabbit hole, and the epic flags the
-- simplification to product.
alter table fixtures
  add column if not exists live_started_at timestamptz;

-- Backfill the matches already showing as live: without it, sixteen fixtures
-- would render "elapsed —" forever. `updated_at` is the best evidence available
-- for when they were last touched, and it is honest for a match in progress.
update fixtures
   set live_started_at = updated_at
 where status = 'live' and live_started_at is null;

-- The live view reads "everything in progress in this championship".
create index if not exists idx_fixtures_live
  on fixtures (status, scheduled_at) where status = 'live';
