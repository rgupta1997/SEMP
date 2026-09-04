-- ============================================================================
-- Close the gap between the stat registry and the per-category columns.
--
-- WHY THIS EXISTS. 20260903000020 introduced typed columns in place of the jsonb
-- bag. Cross-checking those columns against every non-derived metric in
-- packages/shared/src/stat-registry.ts turned up metrics with nowhere to land -
-- and a metric with no column is a metric SILENTLY DISCARDED, which is exactly the
-- failure the typed tables were meant to make impossible.
--
-- The check is now a test (`category-lines.test.ts`), so this cannot drift again
-- without going red.
--
-- The renames below are deliberate and stay: `units_won/units_lost` unify carrom
-- boards with snooker frames, and `colour` records the fact from which as_white /
-- as_black are counted. Those are mapped in shared, not duplicated here.
-- ============================================================================

-- ── RACQUET ─────────────────────────────────────────────────────────────────
-- The officiated-only taps. All derivable-from-nothing: nobody can compute a
-- winner or an unforced error from a rally log, so if the console captures them
-- they need somewhere to go.
alter table racquet_match_lines
  add column if not exists deciders_lost       integer not null default 0 check (deciders_lost >= 0),
  add column if not exists first_serves_in     integer not null default 0 check (first_serves_in >= 0),
  add column if not exists winners             integer not null default 0 check (winners >= 0),
  add column if not exists unforced_errors     integer not null default 0 check (unforced_errors >= 0),
  -- Outcomes that are not a played result. A walkover is an appearance with no
  -- rally, and a career page that counts it as a win over a full match is lying.
  add column if not exists retired             boolean not null default false,
  add column if not exists walkover_received   boolean not null default false,
  add column if not exists whitewash           boolean not null default false;

-- ── The clock ───────────────────────────────────────────────────────────────
-- `minutes` was on invasion only, though every timed family records it and the
-- registry asks for it in all five. Per-minute rates are meaningless without it.
alter table raid_match_lines   add column if not exists minutes integer check (minutes is null or minutes >= 0);
alter table net_match_lines    add column if not exists minutes integer check (minutes is null or minutes >= 0);
alter table board_match_lines  add column if not exists minutes integer check (minutes is null or minutes >= 0);
alter table combat_match_lines add column if not exists minutes integer check (minutes is null or minutes >= 0);

-- ── NET ─────────────────────────────────────────────────────────────────────
-- points_won is the rally count and points_scored the attacking credit; they are
-- different numbers and volleyball reports both. sets_lost cannot be inferred from
-- sets_played - a set can be in progress.
alter table net_match_lines
  add column if not exists points_won integer not null default 0 check (points_won >= 0),
  add column if not exists sets_lost  integer not null default 0 check (sets_lost >= 0);

-- ── COMBAT ──────────────────────────────────────────────────────────────────
-- `win_by` says how THIS bout ended; `stoppages` counts them over a multi-bout
-- appearance. Keeping both means a career page can say "9 wins, 4 by stoppage".
alter table combat_match_lines
  add column if not exists stoppages integer not null default 0 check (stoppages >= 0);

-- ── BOARD ───────────────────────────────────────────────────────────────────
-- Chess needs the opponent to make a result meaningful, and a tournament report
-- lists it. Nullable because carrom and snooker have no such notion here.
alter table board_match_lines
  add column if not exists opponent_user_id uuid references users(id) on delete set null;
create index if not exists idx_board_opponent on board_match_lines(opponent_user_id);
