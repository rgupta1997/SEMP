-- ============================================================================
-- Wave 3 · Records — J4-E2 (lifetime timeline) + J4-E4 (typed achievements)
--
-- The lock (J2-E7) made a result immutable. This is what an immutable result is
-- FOR: a permanent, system-written record that outlives the championship, the
-- roster and the institution.
--
--   fixtures.scorecard_status = 'locked'
--        │
--        ├─▶ lifetime_entries   one row per person per verified event  (04b §4.5)
--        └─▶ achievements       typed medals / placements / awards      (07a §4.1)
--
-- Three properties this schema exists to guarantee:
--
-- 1. THE RECORD SURVIVES LEAVING (J4-E2-S3). `user_id` is `on delete restrict`,
--    and organisation / championship / fixture / sport references are FK-LESS
--    columns on purpose. Delete the championship, the team, even the whole
--    institution, and the entry still stands and still names who they
--    represented at the time. This is the "survives graduation" promise made
--    literal at the schema level rather than in a comment.
--
--    The cost is real and deliberate: deleting a user now FAILS while they hold
--    entries. Demo teardown is the one place that legitimately deletes users, so
--    it removes these rows first (demo-teardown.service.ts).
--
-- 2. NOTHING IS EVER DESTROYED BY A CORRECTION (J4-E4-S3). Every row carries the
--    `lock_version` it was derived from and a `superseded_at` stamp. Unlocking a
--    result supersedes what that version produced instead of deleting it, so a
--    corrected record shows its own history rather than quietly rewriting it.
--    Readers filter on `superseded_at is null`.
--
-- 3. AN AWARD NAME IS COUNTABLE (J4-E4-S2). "Player of the Match", "player of
--    the match" and "POTM" are three different strings today, which is why
--    "MVP awards" cannot be counted. `award_types` is the catalogue;
--    `fixture_awards.award_type_id` is nullable so existing free text survives
--    untouched and free text stays available as a fallback.
--
-- NO BACKFILL. Nothing here is derived from historical fixtures, for the same
-- reason 20260815020000 refused to mark old results locked: a timeline assembled
-- from unverified results is exactly the thing the timeline promises not to be.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · lifetime_entries — the timeline (04b §4.5, FR-PRO-1/2)
-- ----------------------------------------------------------------------------

create table if not exists lifetime_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete restrict,
  -- FK-less by design (see header). Nullable because a ranking-event competitor
  -- may have represented nobody.
  organization_id uuid,
  championship_id uuid,
  fixture_id      uuid,
  sport_id        uuid,
  occurred_on     date not null,
  kind            text not null,
  -- Denormalised at write time: 'Inter-College Football — Runner-up'. The label
  -- must not change when the team is renamed or the championship is deleted.
  title           text not null,
  detail          jsonb not null default '{}'::jsonb,
  source          text not null default 'locked_result',
  -- The generation of the result this came from; null for entries with no
  -- fixture behind them (a validated claim).
  lock_version    integer,
  superseded_at   timestamptz,
  created_at      timestamptz not null default now()
);

alter table lifetime_entries drop constraint if exists lifetime_entries_kind_check;
alter table lifetime_entries add constraint lifetime_entries_kind_check
  check (kind in ('participation', 'result', 'medal', 'award', 'record', 'selection'));

alter table lifetime_entries drop constraint if exists lifetime_entries_source_check;
alter table lifetime_entries add constraint lifetime_entries_source_check
  check (source in ('locked_result', 'validated_claim', 'migrated'));

-- The profile read: one person's timeline, most recent first.
create index if not exists idx_lifetime_user_date
  on lifetime_entries (user_id, occurred_on desc);

-- The supersede/rewrite path: everything this fixture produced.
create index if not exists idx_lifetime_fixture
  on lifetime_entries (fixture_id) where fixture_id is not null;

-- Institution reporting (module 08) reads by org over a date range.
create index if not exists idx_lifetime_org_date
  on lifetime_entries (organization_id, occurred_on desc) where organization_id is not null;

-- One live entry per person per fixture per kind per title. This is what makes
-- the lock idempotent: a relock that somehow ran twice, or two organisers
-- locking the same card concurrently, collides here instead of silently
-- doubling somebody's record. Partial on superseded_at so the superseded
-- history can pile up freely underneath.
--
-- `title` is in the key because one fixture can legitimately produce more than
-- one row of the same kind for the same person - a swimmer takes gold in both
-- the 50m and the 100m of the same meet.
drop index if exists uq_lifetime_live_per_fixture;
create unique index if not exists uq_lifetime_live_per_fixture
  on lifetime_entries (user_id, fixture_id, kind, title)
  where fixture_id is not null and superseded_at is null;

-- ----------------------------------------------------------------------------
-- 2 · achievements — typed, countable (07a §4.1, FR-ACH-2)
-- ----------------------------------------------------------------------------

create table if not exists achievements (
  id              uuid primary key default gen_random_uuid(),
  -- Exactly one of user_id / team_id. Team achievements ALSO fan out to one
  -- user row per squad member at write time, so a player's profile reads
  -- "Runner-up, Inter-College Football" without a join through a team history
  -- that may later change (a player transfers; the medal does not).
  user_id         uuid references users(id) on delete restrict,
  -- FK-LESS, like the org and championship references below. A squad medal must
  -- outlive the squad row: teams are disbanded and re-created every season, and
  -- `detail.team_name` already holds the name as it stood. It is also the only
  -- shape that works with the subject check further down - an `on delete set
  -- null` here would leave a row with neither a user nor a team and fail the
  -- constraint, turning "delete this team" into an unexplainable database error.
  team_id         uuid,
  organization_id uuid,                                   -- FK-less: survives org deletion
  championship_id uuid,
  fixture_id      uuid,
  sport_id        uuid,
  kind            text not null,
  medal           text,
  title           text not null,
  detail          jsonb not null default '{}'::jsonb,
  occurred_on     date not null,
  source          text not null default 'locked_result',
  lock_version    integer,
  superseded_at   timestamptz,
  created_at      timestamptz not null default now()
);

-- Idempotent re-run: an earlier draft of this migration modelled team_id as a
-- real FK. Dropping it here keeps a database that already ran that version in
-- step with a fresh one.
alter table achievements drop constraint if exists achievements_team_id_fkey;

alter table achievements drop constraint if exists achievements_kind_check;
alter table achievements add constraint achievements_kind_check
  check (kind in ('medal', 'placement', 'record', 'selection', 'honour', 'award'));

alter table achievements drop constraint if exists achievements_medal_check;
alter table achievements add constraint achievements_medal_check
  check (medal is null or medal in ('gold', 'silver', 'bronze'));

alter table achievements drop constraint if exists achievements_source_check;
alter table achievements add constraint achievements_source_check
  check (source in ('locked_result', 'validated_claim', 'migrated'));

-- An achievement belongs to a person or to a squad, never to both and never to
-- neither - otherwise "medals won" double-counts the team row and its fan-out.
alter table achievements drop constraint if exists achievements_subject_check;
alter table achievements add constraint achievements_subject_check
  check ((user_id is not null) <> (team_id is not null));

create index if not exists idx_achievements_user
  on achievements (user_id, occurred_on desc) where user_id is not null;

create index if not exists idx_achievements_org
  on achievements (organization_id, occurred_on desc) where organization_id is not null;

create index if not exists idx_achievements_fixture
  on achievements (fixture_id) where fixture_id is not null;

-- Same idempotency guarantee as the timeline, for both subject shapes. Two
-- indexes rather than one because a null in a unique index does not collide,
-- so a single index over (user_id, team_id, …) would let team rows duplicate.
create unique index if not exists uq_achievements_live_user
  on achievements (user_id, fixture_id, kind, title)
  where user_id is not null and fixture_id is not null and superseded_at is null;

create unique index if not exists uq_achievements_live_team
  on achievements (team_id, fixture_id, kind, title)
  where team_id is not null and fixture_id is not null and superseded_at is null;

-- ----------------------------------------------------------------------------
-- 3 · award_types — the catalogue that makes "MVP awards" a number (J4-E4-S2)
-- ----------------------------------------------------------------------------

create table if not exists award_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,     -- stable key; reports group on this, not on the label
  label       text not null,
  -- Which sport this award belongs to, null = offered for every sport. Keeps
  -- "Best Bowler" out of the football console without a second table.
  sport_id    uuid references sports(id) on delete cascade,
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now()
);

create index if not exists idx_award_types_sport
  on award_types (sport_id, sort_order);

-- The seeded catalogue. Sport-agnostic only: sport-specific awards (Best Bowler,
-- Best Libero) are an organiser-managed addition, not something to guess at here.
--
-- 'Player of the Tournament' is here because it is what the existing data
-- actually contains - every free-text award recorded on this platform so far is
-- that one, and a catalogue that omits the award people are really giving would
-- push them straight back to free text on their first use of the picker.
insert into award_types (code, label, sort_order) values
  ('player_of_the_match',      'Player of the Match',      10),
  ('player_of_the_tournament', 'Player of the Tournament', 15),
  ('mvp',                      'Most Valuable Player',     20),
  ('top_scorer',               'Top Scorer',               30),
  ('best_defender',            'Best Defender',            40),
  ('best_goalkeeper',          'Best Goalkeeper',          50),
  ('emerging_player',          'Emerging Player',          60),
  ('fair_play',                'Fair Play',                70),
  ('best_team',                'Best Team',                80)
on conflict (code) do nothing;

-- Nullable on purpose: free text remains available as a fallback, and the free
-- text already recorded stays exactly as it is, untyped (J4-E4-S2).
alter table fixture_awards
  add column if not exists award_type_id uuid references award_types(id) on delete set null;

create index if not exists idx_fixture_awards_type
  on fixture_awards (award_type_id) where award_type_id is not null;

-- Best-effort backfill for the awards already recorded: only where the existing
-- free text matches a catalogue label exactly, case-insensitively. Deliberately
-- NOT fuzzy - guessing that "POTM" means Player of the Match is the kind of
-- assumption that makes a countable number wrong in a way nobody can see.
update fixture_awards fa
   set award_type_id = at.id
  from award_types at
 where fa.award_type_id is null
   and lower(trim(fa.award_name)) = lower(at.label);
