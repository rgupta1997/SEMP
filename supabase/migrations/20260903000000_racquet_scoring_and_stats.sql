-- ============================================================================
-- Racquet scoring formats + the player stat ledger
--
-- Two features, one migration, because the second is meaningless without the first:
-- a stat line has to say which rules the match was played under, or it cannot be
-- reproduced and the "Verified" badge is a decoration.
--
-- ─── WHY NOT format_config ──────────────────────────────────────────────────
-- tournament_disciplines.format_config already carries TWO unrelated things: the
-- stage tree (written by the wizard) and the scoring template (read by the web
-- console). The writer does not know about the reader, so
--
--     POST /tournament-disciplines/:id/fixtures/generate-all
--       -> data: { format_config: req.body.config }
--
-- REPLACES the whole jsonb and silently destroys format_config.scoring. That route
-- is fixed to merge in the same change as this migration. But even fixed, a NAMED
-- REUSABLE format is an entity, not a property of one draw - one saved format is
-- referenced by many disciplines across many championships, and a jsonb blob on one
-- row cannot be referenced. Hence a table.
--
-- ─── ORG-SCOPED, NOT CHAMPIONSHIP-SCOPED ────────────────────────────────────
-- An institution defines "our table tennis format" once and reuses it across every
-- championship it hosts; that is the behaviour that makes a customer's second event
-- faster to set up than their first. Resolved through
-- championships.host_organization_id, which is NULLABLE - a championship with no
-- host org inherits no org formats and falls through to the platform shelf. That is
-- intended, not an oversight.
--
-- ─── EVERYTHING DERIVED IS RECOMPUTED, NEVER INCREMENTED ────────────────────
-- player_match_stats and career_stats.stats are both rebuilt from fixture_events at
-- lock time, following the discipline career-stats.service.ts already states in its
-- header. A delta applied twice, or applied to a result later corrected, is wrong
-- permanently and silently. This also means a metric added in March backfills across
-- every match played since January.
--
-- PENDING APPLY. Apply via the session/direct connection (:5432), then
-- `npm run prisma:pull && npm run prisma:generate` with the API server stopped.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The format shelf
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists scoring_formats (
  id              uuid primary key default gen_random_uuid(),
  -- null = a platform preset, visible to every organisation.
  organization_id uuid references organizations(id) on delete cascade,
  sport_id        uuid references sports(id) on delete cascade,
  name            varchar(160) not null,
  -- The shelf preset this was derived from, so "tweaked from ITTF Standard" is a
  -- fact we keep rather than infer by diffing.
  preset_key      varchar(60),
  config          jsonb not null default '{}',
  is_system       boolean not null default false,
  -- Retire a format without orphaning the draws that already reference it.
  archived_at     timestamptz,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_scoring_formats_org   on scoring_formats(organization_id);
create index if not exists idx_scoring_formats_sport on scoring_formats(sport_id);

-- One org cannot hold two live formats with the same name for the same sport. Scoped
-- to `archived_at is null` so retiring a format frees its name again.
create unique index if not exists uq_scoring_formats_name
  on scoring_formats(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     coalesce(sport_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     lower(name))
  where archived_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Rungs 4 and 5 of the resolution ladder: the draw, then the round
-- ────────────────────────────────────────────────────────────────────────────

alter table tournament_disciplines
  add column if not exists scoring_format_id uuid references scoring_formats(id) on delete set null;

-- Per-round overrides: "QF and SF best of 3 to 11, the Final best of 5 to 21".
--
-- An ORDERED array, first match wins, so a specific ('Final') entry can sit above a
-- broader stage-wide one:
--   [{"stageSequence": 2, "round": "Final", "formatId": "…"},
--    {"stageSequence": 2, "round": "SF",    "formatId": "…"},
--    {"stageSequence": 2,                   "formatId": "…"}]
--
-- Keyed on (stage_sequence, round) because those are exactly what the generators
-- already stamp on every fixture - generators/util.ts emits 'Final', 'SF', 'QF',
-- 'R16', 'R32', plus '3rd Place'. No new concept, no new column on fixtures.
--
-- Round-robin is deliberately NOT keyable this way: those labels carry a match number
-- ('Round 3', 'Pool A - Match 1'), so overrides there match on the stage only, and the
-- UI hides the per-round control rather than offering one that never matches.
alter table tournament_disciplines
  add column if not exists round_formats jsonb not null default '[]';

create index if not exists idx_td_scoring_format on tournament_disciplines(scoring_format_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Rung 6: this one match
-- ────────────────────────────────────────────────────────────────────────────

alter table fixtures
  add column if not exists scoring_format_id uuid references scoring_formats(id) on delete set null;

create index if not exists idx_fixtures_scoring_format on fixtures(scoring_format_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The fact table
--
-- fixture_events was created in 20260627000000 and NOTHING HAS EVER WRITTEN TO IT -
-- the only mention in the whole TypeScript tree is a comment. Its own migration
-- header said "a small writer (mirror live_log -> fixture_events on sign-off) lands
-- with the wiring"; it never did. The table is created here if absent so this
-- migration applies cleanly whether or not that one ran.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists fixture_events (
  id              uuid primary key default gen_random_uuid(),
  fixture_id      uuid not null references fixtures(id) on delete cascade,
  rubber_key      varchar(40),
  team_side       char(1) check (team_side in ('A', 'B')),
  event_key       varchar(40)  not null,
  label           varchar(120) not null,
  points          integer      not null default 0,
  player_user_id  uuid references users(id) on delete set null,
  segment         varchar(40),
  seq             integer      not null default 0,
  created_at      timestamptz  not null default now()
);

create index if not exists idx_fixture_events_fixture on fixture_events(fixture_id);
create index if not exists idx_fixture_events_player  on fixture_events(player_user_id);
create index if not exists idx_fixture_events_key     on fixture_events(event_key);

alter table fixture_events
  -- The magnitude, where the event carries one (a kabaddi raid worth 3).
  add column if not exists metric_value   numeric,
  -- The SECOND person, because most interesting events involve two: goal + assist,
  -- wicket + fielder, block + set. On the same row as the primary, because an assist
  -- captured as a separate tap is an assist that never gets captured.
  add column if not exists second_user_id uuid references users(id) on delete set null,
  add column if not exists period_no      smallint,
  -- Minute of the goal, for the timeline.
  add column if not exists clock_seconds  integer,
  add column if not exists meta           jsonb not null default '{}';

create index if not exists idx_fixture_events_second on fixture_events(second_user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. One row per person per fixture: the appearance record AND the stat line
--
-- They are one table on purpose. They answer the same question at two depths, they
-- are written at the same moment by the same code, and they share a lifecycle - a
-- corrected result supersedes both or neither. Split, they would permit a state
-- where somebody has two goals and no appearance.
--
-- There was NO lineup concept anywhere in this codebase before this: the console's
-- event picker offered the whole team_members roster, so "which 11 of the 15 played"
-- was unanswerable and every per-match average would have been wrong.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists player_match_stats (
  id              uuid primary key default gen_random_uuid(),
  fixture_id      uuid not null references fixtures(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  team_id         uuid references teams(id) on delete set null,
  -- Who they played FOR, denormalised. Same reasoning as lifetime_entries: a later
  -- transfer, graduation or org deletion must not rewrite history.
  organization_id uuid references organizations(id) on delete set null,
  sport_id        uuid references sports(id) on delete set null,
  -- Which rubber of a team tie (MS / WD / XD …).
  rubber_key      varchar(40),
  -- Doubles. Makes "your record with each partner" a group-by, not another table.
  partner_user_id uuid references users(id) on delete set null,
  position        varchar(24),
  role            varchar(16) not null default 'player',
  played          boolean not null default true,
  minutes         integer,
  outcome         varchar(8) check (outcome in ('won', 'lost', 'drew') or outcome is null),
  -- The sport-specific measures: { "points_won": 33, "service_win_pct": 62.5 }.
  stats           jsonb not null default '{}',
  occurred_on     date not null,
  source          varchar(24) not null default 'locked_result',
  lock_version    integer,
  -- Mirrors lifetime_entries exactly, so an unlock drops these from the record and a
  -- re-lock rebuilds them.
  superseded_at   timestamptz,
  computed_at     timestamptz not null default now()
);

-- NULL != NULL in a plain unique constraint, so a person with no rubber_key could be
-- inserted twice over. coalesce in the index closes that.
create unique index if not exists uq_pms_fixture_user_rubber
  on player_match_stats (fixture_id, user_id, coalesce(rubber_key, ''));

create index if not exists idx_pms_user    on player_match_stats(user_id, occurred_on desc);
create index if not exists idx_pms_fixture on player_match_stats(fixture_id);
create index if not exists idx_pms_org     on player_match_stats(organization_id, sport_id);
-- jsonb_path_ops is the smaller, faster GIN opclass for containment queries, which is
-- all a leaderboard needs ("everyone with a `raid_points` key").
create index if not exists idx_pms_stats   on player_match_stats using gin (stats jsonb_path_ops);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. The career rollup gains the sport-specific measures
--
-- The existing typed columns (played / won / lost / drawn / gold / silver / bronze /
-- awards) stay exactly as they are: they are cross-sport and every consumer already
-- reads them. A striker's record could say how many matches they played and not that
-- they scored; this is the column that fixes that.
-- ────────────────────────────────────────────────────────────────────────────

alter table career_stats
  add column if not exists stats jsonb not null default '{}';
