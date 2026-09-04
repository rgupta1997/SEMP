-- ============================================================================
-- Per-category statistics tables
--
-- REPLACES the jsonb-bag-only design. `player_match_stats.stats` held every
-- sport-specific number in one untyped blob; these tables hold them as columns.
--
-- WHY THIS IS BETTER, and it is:
--   * the DATABASE enforces the shape. `runs integer check (runs >= 0)` cannot be
--     violated by a typo in a metric key, which a jsonb bag silently accepts.
--   * `where runs > 50` is a plain b-tree index, not a jsonb cast.
--   * the schema documents what each sport records. Somebody reading
--     `cricket_batting_lines` learns cricket; reading `stats jsonb` learns nothing.
--   * verification compares typed columns, so a drift is a type error rather than a
--     missing key.
--
-- WHAT IT COSTS, stated plainly: adding a metric is now a migration, and adding a
-- category is a table plus a writer plus a reader. That is the trade being made.
--
-- ─── THE SPINE STAYS UNIVERSAL ──────────────────────────────────────────────
-- `player_match_stats` remains ONE row per person per fixture for every sport:
-- appearance, outcome, team, organisation, date. Splitting that per sport would
-- make "how many matches has this person played" a nine-way union, and that is the
-- first question a profile page asks. The DETAIL is what varies, so the detail is
-- what splits.
--
-- Every table below therefore hangs off that row:
--
--   player_match_stats                      appearance + outcome     (universal)
--     ├─ racquet_match_lines                points, serve, games
--     ├─ invasion_match_lines               goals, assists, cards, saves
--     ├─ raid_match_lines                   raids, tackles, all-outs
--     ├─ net_match_lines                    aces, kills, blocks, digs
--     ├─ board_match_lines                  boards/frames, breaks, chess result
--     ├─ combat_match_lines                 bouts, rounds, touches
--     ├─ cricket_batting_lines              PER INNINGS - the different grain
--     ├─ cricket_bowling_lines              PER INNINGS
--     └─ cricket_fielding_lines             PER INNINGS
--
-- `player_match_stats.stats` is KEPT, demoted to a denormalised copy for
-- leaderboards. The typed rows are the truth; that column is a cache recomputable
-- from them, which is exactly what makes it safe to keep.
--
-- PENDING APPLY. Apply via the session/direct connection (:5432), then
-- `npm run prisma:pull && npm run prisma:generate` with the API server stopped.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Shared shape
--
-- Every detail row points at ONE spine row and is deleted with it, so a corrected
-- result cannot leave orphaned detail behind. `line_id` rather than
-- (fixture_id, user_id) because cricket needs several rows per person per fixture
-- and the spine row is the single thing they all belong to.
-- ────────────────────────────────────────────────────────────────────────────

-- ── RACQUET ─────────────────────────────────────────────────────────────────
-- Derived from the rally log with no extra taps: the kernel knows who served every
-- point, so the service/return split is free.
create table if not exists racquet_match_lines (
  id                     uuid primary key default gen_random_uuid(),
  line_id                uuid not null references player_match_stats(id) on delete cascade,
  rubber_key             varchar(40),
  partner_user_id        uuid references users(id) on delete set null,

  points_won             integer not null default 0 check (points_won >= 0),
  points_lost            integer not null default 0 check (points_lost >= 0),
  service_points_played  integer not null default 0 check (service_points_played >= 0),
  service_points_won     integer not null default 0 check (service_points_won >= 0),
  return_points_played   integer not null default 0 check (return_points_played >= 0),
  return_points_won      integer not null default 0 check (return_points_won >= 0),
  games_won              integer not null default 0 check (games_won >= 0),
  games_lost             integer not null default 0 check (games_lost >= 0),
  sets_won               integer not null default 0 check (sets_won >= 0),
  sets_lost              integer not null default 0 check (sets_lost >= 0),
  deciders_won           integer not null default 0 check (deciders_won >= 0),
  deuce_points_played    integer not null default 0 check (deuce_points_played >= 0),
  deuce_points_won       integer not null default 0 check (deuce_points_won >= 0),
  tiebreaks_won          integer not null default 0 check (tiebreaks_won >= 0),
  tiebreaks_lost         integer not null default 0 check (tiebreaks_lost >= 0),
  longest_streak         integer not null default 0 check (longest_streak >= 0),
  comeback_win           boolean not null default false,
  aces                   integer not null default 0 check (aces >= 0),
  double_faults          integer not null default 0 check (double_faults >= 0),
  break_points_played    integer not null default 0 check (break_points_played >= 0),
  break_points_won       integer not null default 0 check (break_points_won >= 0),
  break_points_saved     integer not null default 0 check (break_points_saved >= 0),
  lets                   integer not null default 0 check (lets >= 0),

  created_at             timestamptz not null default now()
);
-- One racquet line per spine row per rubber. This has to be a unique INDEX rather
-- than a unique constraint: a singles match leaves rubber_key null, and because
-- NULL != NULL a plain constraint would happily accept the same line twice.
create unique index if not exists uq_racquet_line
  on racquet_match_lines(line_id, coalesce(rubber_key, ''));
create index if not exists idx_racquet_lines_line on racquet_match_lines(line_id);
create index if not exists idx_racquet_lines_partner on racquet_match_lines(partner_user_id);

-- ── INVASION & GOAL ─────────────────────────────────────────────────────────
create table if not exists invasion_match_lines (
  id              uuid primary key default gen_random_uuid(),
  line_id         uuid not null references player_match_stats(id) on delete cascade,
  position        varchar(24),
  minutes         integer check (minutes is null or minutes >= 0),
  started         boolean not null default true,

  goals           integer not null default 0 check (goals >= 0),
  assists         integer not null default 0 check (assists >= 0),
  own_goals       integer not null default 0 check (own_goals >= 0),
  shots           integer not null default 0 check (shots >= 0),
  saves           integer not null default 0 check (saves >= 0),
  clean_sheet     boolean not null default false,
  yellows         integer not null default 0 check (yellows >= 0),
  reds            integer not null default 0 check (reds >= 0),
  pens_scored     integer not null default 0 check (pens_scored >= 0),
  pens_missed     integer not null default 0 check (pens_missed >= 0),
  -- Basketball shares this table: the same shape with a different vocabulary. A
  -- separate table for it would duplicate goals/assists/minutes to no purpose.
  points_scored   integer not null default 0 check (points_scored >= 0),
  fg_1            integer not null default 0 check (fg_1 >= 0),
  fg_2            integer not null default 0 check (fg_2 >= 0),
  fg_3            integer not null default 0 check (fg_3 >= 0),
  rebounds        integer not null default 0 check (rebounds >= 0),
  steals          integer not null default 0 check (steals >= 0),
  blocks          integer not null default 0 check (blocks >= 0),
  turnovers       integer not null default 0 check (turnovers >= 0),
  fouls           integer not null default 0 check (fouls >= 0),

  created_at      timestamptz not null default now(),
  constraint uq_invasion_line unique (line_id)
);
create index if not exists idx_invasion_lines_line on invasion_match_lines(line_id);
-- The two leaderboards anybody actually asks for.
create index if not exists idx_invasion_goals on invasion_match_lines(goals desc) where goals > 0;
create index if not exists idx_invasion_points on invasion_match_lines(points_scored desc) where points_scored > 0;

-- ── RAID & TAG ──────────────────────────────────────────────────────────────
create table if not exists raid_match_lines (
  id                 uuid primary key default gen_random_uuid(),
  line_id            uuid not null references player_match_stats(id) on delete cascade,
  position           varchar(24),

  raid_points        integer not null default 0 check (raid_points >= 0),
  raids              integer not null default 0 check (raids >= 0),
  successful_raids   integer not null default 0 check (successful_raids >= 0),
  super_raids        integer not null default 0 check (super_raids >= 0),
  do_or_die_won      integer not null default 0 check (do_or_die_won >= 0),
  tackle_points      integer not null default 0 check (tackle_points >= 0),
  tackles            integer not null default 0 check (tackles >= 0),
  super_tackles      integer not null default 0 check (super_tackles >= 0),
  bonus_points       integer not null default 0 check (bonus_points >= 0),
  all_outs           integer not null default 0 check (all_outs >= 0),
  -- Kho kho shares this table: touch points and dream-run time are the same shape.
  touch_points       integer not null default 0 check (touch_points >= 0),
  dream_run_seconds  integer not null default 0 check (dream_run_seconds >= 0),

  created_at         timestamptz not null default now(),
  -- Successful raids can never exceed raids attempted; the strike rate depends on it.
  constraint ck_raid_sr check (successful_raids <= raids),
  constraint uq_raid_line unique (line_id)
);
create index if not exists idx_raid_lines_line on raid_match_lines(line_id);
create index if not exists idx_raid_points on raid_match_lines(raid_points desc) where raid_points > 0;

-- ── NET (team) ──────────────────────────────────────────────────────────────
create table if not exists net_match_lines (
  id               uuid primary key default gen_random_uuid(),
  line_id          uuid not null references player_match_stats(id) on delete cascade,
  position         varchar(24),

  points_scored    integer not null default 0 check (points_scored >= 0),
  aces             integer not null default 0 check (aces >= 0),
  kills            integer not null default 0 check (kills >= 0),
  blocks           integer not null default 0 check (blocks >= 0),
  digs             integer not null default 0 check (digs >= 0),
  service_errors   integer not null default 0 check (service_errors >= 0),
  attack_errors    integer not null default 0 check (attack_errors >= 0),
  reception_errors integer not null default 0 check (reception_errors >= 0),
  sets_played      integer not null default 0 check (sets_played >= 0),
  sets_won         integer not null default 0 check (sets_won >= 0),

  created_at       timestamptz not null default now(),
  constraint uq_net_line unique (line_id)
);
create index if not exists idx_net_lines_line on net_match_lines(line_id);

-- ── BOARD, FRAME & TABLE ────────────────────────────────────────────────────
create table if not exists board_match_lines (
  id              uuid primary key default gen_random_uuid(),
  line_id         uuid not null references player_match_stats(id) on delete cascade,

  units_won       integer not null default 0 check (units_won >= 0),
  units_lost      integer not null default 0 check (units_lost >= 0),
  points_scored   integer not null default 0 check (points_scored >= 0),
  -- carrom
  queens          integer not null default 0 check (queens >= 0),
  coins           integer not null default 0 check (coins >= 0),
  -- pool / snooker. A career best break is a MAX over these rows, which is the
  -- single most-asked snooker statistic and impossible to get from a sum.
  highest_break   integer not null default 0 check (highest_break >= 0),
  breaks_50       integer not null default 0 check (breaks_50 >= 0),
  centuries       integer not null default 0 check (centuries >= 0),
  -- chess. Doubled so a half point stays an integer: 2 = win, 1 = draw, 0 = loss.
  result_points_x2 smallint check (result_points_x2 is null or result_points_x2 between 0 and 2),
  colour          varchar(5) check (colour is null or colour in ('white', 'black')),
  board_no        smallint check (board_no is null or board_no > 0),

  created_at      timestamptz not null default now(),
  constraint uq_board_line unique (line_id)
);
create index if not exists idx_board_lines_line on board_match_lines(line_id);
create index if not exists idx_board_break on board_match_lines(highest_break desc) where highest_break > 0;

-- ── COMBAT & STRENGTH ───────────────────────────────────────────────────────
create table if not exists combat_match_lines (
  id                uuid primary key default gen_random_uuid(),
  line_id           uuid not null references player_match_stats(id) on delete cascade,
  weight_class      varchar(24),
  -- Arm wrestling records which arm; a left-arm record is not a right-arm record.
  side_used         varchar(5) check (side_used is null or side_used in ('left', 'right')),

  bouts             integer not null default 0 check (bouts >= 0),
  rounds_won        integer not null default 0 check (rounds_won >= 0),
  rounds_lost       integer not null default 0 check (rounds_lost >= 0),
  touches_for       integer not null default 0 check (touches_for >= 0),
  touches_against   integer not null default 0 check (touches_against >= 0),
  win_by            varchar(16),
  penalties         integer not null default 0 check (penalties >= 0),

  created_at        timestamptz not null default now(),
  constraint uq_combat_line unique (line_id)
);
create index if not exists idx_combat_lines_line on combat_match_lines(line_id);

-- ────────────────────────────────────────────────────────────────────────────
-- CRICKET - three tables, because cricket genuinely is three things
--
-- This is the family that justified per-category tables in the first place. Its
-- grain is PER INNINGS, not per match: a person bats in innings 2 and bowls in
-- innings 1, and in a Test does both twice. And one ball's outcome credits three
-- different people in three different directions - the batter is dismissed, the
-- bowler takes the wicket, the fielder takes the catch - which is why a batting row
-- carries `bowler_id` and `fielder_id` as references rather than a shared blob.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists cricket_batting_lines (
  id              uuid primary key default gen_random_uuid(),
  line_id         uuid not null references player_match_stats(id) on delete cascade,
  innings         smallint not null check (innings between 1 and 4),

  bat_position    smallint check (bat_position is null or bat_position between 1 and 15),
  runs            integer not null default 0 check (runs >= 0),
  balls_faced     integer not null default 0 check (balls_faced >= 0),
  fours           integer not null default 0 check (fours >= 0),
  sixes           integer not null default 0 check (sixes >= 0),
  -- 'not_out' and 'did_not_bat' are outcomes, not absences - a duck and a DNB are
  -- very different things on a career record.
  dismissal       varchar(20) not null default 'not_out'
    check (dismissal in ('not_out', 'did_not_bat', 'bowled', 'caught', 'lbw',
                         'run_out', 'stumped', 'hit_wicket', 'retired', 'obstructing',
                         'caught_and_bowled', 'timed_out')),
  bowler_id       uuid references users(id) on delete set null,
  fielder_id      uuid references users(id) on delete set null,

  created_at      timestamptz not null default now(),
  constraint uq_bat_line unique (line_id, innings),
  -- Boundaries cannot account for more runs than were scored.
  constraint ck_bat_boundaries check (fours * 4 + sixes * 6 <= runs + 6)
);
create index if not exists idx_bat_lines_line on cricket_batting_lines(line_id);
create index if not exists idx_bat_runs on cricket_batting_lines(runs desc) where runs > 0;
create index if not exists idx_bat_bowler on cricket_batting_lines(bowler_id);

create table if not exists cricket_bowling_lines (
  id              uuid primary key default gen_random_uuid(),
  line_id         uuid not null references player_match_stats(id) on delete cascade,
  innings         smallint not null check (innings between 1 and 4),

  -- BALLS, not overs. "3.4 overs" is a display format, not a number you can add:
  -- 3.4 + 3.4 is 7.2 overs, which arithmetic on decimals gets wrong every time.
  balls_bowled    integer not null default 0 check (balls_bowled >= 0),
  maidens         integer not null default 0 check (maidens >= 0),
  runs_conceded   integer not null default 0 check (runs_conceded >= 0),
  wickets         integer not null default 0 check (wickets between 0 and 10),
  wides           integer not null default 0 check (wides >= 0),
  no_balls        integer not null default 0 check (no_balls >= 0),
  dots            integer not null default 0 check (dots >= 0),

  created_at      timestamptz not null default now(),
  constraint uq_bowl_line unique (line_id, innings),
  constraint ck_bowl_dots check (dots <= balls_bowled)
);
create index if not exists idx_bowl_lines_line on cricket_bowling_lines(line_id);
create index if not exists idx_bowl_wickets on cricket_bowling_lines(wickets desc) where wickets > 0;

create table if not exists cricket_fielding_lines (
  id            uuid primary key default gen_random_uuid(),
  line_id       uuid not null references player_match_stats(id) on delete cascade,
  innings       smallint not null check (innings between 1 and 4),

  catches       integer not null default 0 check (catches >= 0),
  stumpings     integer not null default 0 check (stumpings >= 0),
  run_outs      integer not null default 0 check (run_outs >= 0),
  drops         integer not null default 0 check (drops >= 0),

  created_at    timestamptz not null default now(),
  constraint uq_field_line unique (line_id, innings)
);
create index if not exists idx_field_lines_line on cricket_fielding_lines(line_id);

-- ────────────────────────────────────────────────────────────────────────────
-- The innings scoreboard: the team-level record a scorecard is read from.
--
-- Not derivable from the player lines alone, because extras belong to the TEAM and
-- to nobody's batting line - a total is runs off the bat plus wides, no-balls, byes
-- and leg-byes, and a scorecard that cannot show them does not balance.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists cricket_innings (
  id              uuid primary key default gen_random_uuid(),
  fixture_id      uuid not null references fixtures(id) on delete cascade,
  innings         smallint not null check (innings between 1 and 4),
  batting_team_id uuid references teams(id) on delete set null,
  bowling_team_id uuid references teams(id) on delete set null,

  runs            integer not null default 0 check (runs >= 0),
  wickets         integer not null default 0 check (wickets between 0 and 10),
  balls           integer not null default 0 check (balls >= 0),
  -- Extras, itemised. A scoreboard that lumps them together cannot be checked
  -- against the bowling figures.
  wides           integer not null default 0 check (wides >= 0),
  no_balls        integer not null default 0 check (no_balls >= 0),
  byes            integer not null default 0 check (byes >= 0),
  leg_byes        integer not null default 0 check (leg_byes >= 0),
  penalty_runs    integer not null default 0 check (penalty_runs >= 0),

  -- Why the innings stopped. 'target' means the chase succeeded.
  ended_by        varchar(12) check (ended_by is null or ended_by in
                    ('overs', 'all_out', 'target', 'declared', 'rain', 'conceded')),
  target          integer check (target is null or target > 0),

  created_at      timestamptz not null default now(),
  constraint uq_cricket_innings unique (fixture_id, innings)
);
create index if not exists idx_cricket_innings_fixture on cricket_innings(fixture_id);

-- ────────────────────────────────────────────────────────────────────────────
-- `player_match_stats.stats` is demoted, not dropped.
--
-- The typed rows above are the truth. That column stays as a denormalised copy for
-- leaderboards and the profile card - recomputable from the typed rows, which is
-- what makes it safe to keep rather than a second source of truth.
-- ────────────────────────────────────────────────────────────────────────────
comment on column player_match_stats.stats is
  'Denormalised copy of the per-category typed line, for leaderboards. The typed *_match_lines tables are authoritative; this is recomputable from them.';
