-- ============================================================================
-- Detailed per-event scoring log (Phase 3 of the configurable scoring system).
--
-- In detailed mode the console records each event (raid/tackle/bonus/card/goal/…),
-- optionally attributed to a player, into fixtures.live_log (JSON) which remains the
-- LIVE source of truth. This table is the normalized, queryable projection of those
-- events - it powers player stats / leaderboards across a championship.
--
-- PENDING APPLY: like the other forward migrations in this repo, apply via the
-- session/direct connection, then `npm run prisma:pull && prisma:generate` (API server
-- stopped) to expose the model. Until then nothing reads it; the JSON log is unaffected.
-- A small writer (mirror live_log -> fixture_events on sign-off) lands with the wiring.
-- ============================================================================
create table if not exists fixture_events (
  id              uuid primary key default gen_random_uuid(),
  fixture_id      uuid not null references fixtures(id) on delete cascade,
  rubber_key      varchar(40),                        -- which rubber (tie fixtures); null for single
  team_side       char(1) check (team_side in ('A', 'B')),  -- A = home, B = away; null = neutral
  event_key       varchar(40)  not null,              -- 'raid' | 'tackle' | 'card' | 'point' …
  label           varchar(120) not null,
  points          integer      not null default 0,    -- credited to team_side (0 = non-scoring)
  player_user_id  uuid references users(id) on delete set null,
  segment         varchar(40),                        -- period/set/innings label at the time
  seq             integer      not null default 0,    -- order within the fixture
  created_at      timestamptz  not null default now()
);

create index if not exists idx_fixture_events_fixture on fixture_events(fixture_id);
create index if not exists idx_fixture_events_player  on fixture_events(player_user_id);
create index if not exists idx_fixture_events_key     on fixture_events(event_key);
