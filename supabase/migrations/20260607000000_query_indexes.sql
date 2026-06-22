-- ============================================================================
-- SEMP - Query-shaped indexes (composite + partial) and the team uniqueness guard
--
-- The initial schema indexed every foreign-key column (good for joins/FK checks),
-- but the hot read paths filter/sort on *combinations* of columns. This migration
-- adds composite and partial indexes matched to the actual predicates in the API,
-- plus the partial UNIQUE index that makes "one team per institution per discipline"
-- race-proof (the app now also checks it, but the DB is the real backstop).
--
-- Apply: paste into the Supabase SQL Editor and run (or `supabase db push`).
--   On a large, live database prefer running each `create index` with CONCURRENTLY
--   (outside a transaction) to avoid holding a write lock during the build.
-- After applying: `npm run prisma:pull && npm run prisma:generate` to resync Prisma.
--
-- All statements are idempotent (`if not exists`) so re-running is safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- team_members - the most-read child table.
--   * me/teams, dashboard, auth-context, teamManager guard all filter
--     (user_id = ? AND is_active), and roster count/lock filter (team_id = ?
--     AND is_active). Partial indexes keep only the live rows, which is the
--     set every one of those queries wants.
-- ----------------------------------------------------------------------------
create index if not exists idx_team_members_user_active
  on team_members (user_id) where is_active;

create index if not exists idx_team_members_team_active
  on team_members (team_id) where is_active;

-- ----------------------------------------------------------------------------
-- fixtures - the largest table and the heaviest read paths.
--   * List a draw's fixtures: WHERE tournament_discipline_id = ?
--       ORDER BY pool_number, bracket_position, created_at
--     -> one composite serves both the filter and the sort.
--   * Standings: WHERE status = 'completed' AND <join up to event via the draw>
--     -> a partial index on completed rows, keyed by the draw, narrows the scan
--        to exactly the rows standings aggregate.
--   * me/officiating: WHERE official_id = ? ORDER BY scheduled_at
--     -> composite gives filter + ordered read.
-- (The OR over home_team_id / away_team_id is already served by the existing
--  single-column FK indexes via a bitmap OR, so no new index is added for it.)
-- ----------------------------------------------------------------------------
create index if not exists idx_fixtures_draw_ordering
  on fixtures (tournament_discipline_id, pool_number, bracket_position, created_at);

create index if not exists idx_fixtures_completed_by_draw
  on fixtures (tournament_discipline_id) where status = 'completed';

create index if not exists idx_fixtures_official_scheduled
  on fixtures (official_id, scheduled_at);

-- ----------------------------------------------------------------------------
-- event_institutions - the organiser enrollment queue filters (event_id, status).
-- ----------------------------------------------------------------------------
create index if not exists idx_event_institutions_event_status
  on event_institutions (event_id, status);

-- ----------------------------------------------------------------------------
-- event_officials - officials list filters (event_id AND is_active); me/officiating
-- resolves an official's events with (user_id AND is_active). Partial on live rows.
-- ----------------------------------------------------------------------------
create index if not exists idx_event_officials_event_active
  on event_officials (event_id) where is_active;

create index if not exists idx_event_officials_user_active
  on event_officials (user_id) where is_active;

-- ----------------------------------------------------------------------------
-- users - the list/picker filters (institution_id AND account_type), and the POC
-- lookup embedded on teams filters the same leading column.
-- ----------------------------------------------------------------------------
create index if not exists idx_users_institution_account_type
  on users (institution_id, account_type);

-- ----------------------------------------------------------------------------
-- user_event_roles - the events-list "events I organise" query filters
-- (user_id AND role_id). The existing unique (user_id, event_id, role_id) can
-- only use the user_id prefix for that shape, so add the exact two-column index.
-- ----------------------------------------------------------------------------
create index if not exists idx_user_event_roles_user_role
  on user_event_roles (user_id, role_id);

-- ----------------------------------------------------------------------------
-- teams - uniqueness guard: one team per (institution, event, discipline).
-- Partial so teams still in 'forming' with no draw yet (tournament_discipline_id
-- NULL) are unconstrained; the rule only bites once a discipline is assigned.
-- This both enforces the business rule under concurrency and serves the
-- duplicate-check lookup the create/patch handlers run.
--
-- NOTE: this will fail to build if legacy duplicates already exist. Find them with:
--   select institution_id, event_id, tournament_discipline_id, count(*)
--     from teams where tournament_discipline_id is not null
--     group by 1, 2, 3 having count(*) > 1;
-- Resolve those rows before applying.
-- ----------------------------------------------------------------------------
create unique index if not exists uq_teams_institution_event_discipline
  on teams (institution_id, event_id, tournament_discipline_id)
  where tournament_discipline_id is not null;

-- ============================================================================
-- End of query-shaped indexes
-- ============================================================================
