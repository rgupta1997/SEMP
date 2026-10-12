-- The fifteen supabase/migrations dated 2026-10-04 -> 2026-10-09, which no file in
-- this directory has carried yet.
--
-- STATUS: NOT APPLIED. Written 2026-10-12.
--
-- ---------------------------------------------------------------------------
-- Why these, and only these
-- ---------------------------------------------------------------------------
-- 006-010 came from auditing the first 99 supabase migrations, ending at
-- 20260929000000_organization_archive. Everything after that boundary is listed
-- below. All of it is scoring/stats schema for the racquet, board-game and
-- head-to-head work, and every statement is plain Postgres - no auth.uid(), no
-- `to authenticated`, no publication - so the bodies are copied unchanged, in
-- filename order, one section per source file.
--
-- The one post-boundary file NOT copied is 20261011000000_supabase_realtime_where_supabase:
-- it restores Supabase Realtime (RLS policy + supabase_realtime publication) and is
-- for Supabase-hosted deploys only. On RDS it is a guarded no-op, and UAT's bell is
-- AppSync, so there is nothing to bring across.
--
-- Replayable end to end: every column and index is IF NOT EXISTS, the constraint and
-- the unique index are dropped IF EXISTS before being recreated with the same
-- definition, and the fixtures score retype is guarded on the current data_type.
-- That matters for the reason in apply.sh's header - a crash between psql exiting 0
-- and the ledger row being written makes an applied file look pending.
--
-- Applied to the Supabase database (beta + local) on 2026-10-10 and re-verified
-- column by column on 2026-10-12.

-- ===========================================================================
-- 20261004000000_rubber_lineups_head_to_head.sql
-- ===========================================================================
alter table player_match_stats add column if not exists opponent_user_ids uuid[];
create index if not exists idx_pms_opponents on player_match_stats using gin (opponent_user_ids);
alter table career_stats add column if not exists position varchar(12);
alter table career_stats drop constraint if exists career_stats_grain_check;
alter table career_stats add constraint career_stats_grain_check
  check (grain in ('sport', 'discipline', 'format', 'position'));
drop index if exists uq_career_stats_grain;
create unique index if not exists uq_career_stats_grain
  on career_stats(
    user_id, organization_id, sport_id,
    coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(format, ''::varchar),
    coalesce(position, ''::varchar),
    tier
  );

-- ===========================================================================
-- 20261005000000_event_scoped_disciplines.sql
-- ===========================================================================
alter table disciplines
  add column if not exists championship_id uuid references championships(id) on delete cascade;
create index if not exists idx_disciplines_championship on disciplines(championship_id);

-- ===========================================================================
-- 20261005000001_pair_serve_receive_points.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists pair_service_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists pair_return_points_played integer not null default 0;

-- ===========================================================================
-- 20261005000002_expedite_stats.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists expedite_matches integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_wins integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_return_wins integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_return_losses integer not null default 0;

-- ===========================================================================
-- 20261005000003_clutch_stats.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists game_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists game_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists game_points_faced integer not null default 0;
alter table racquet_match_lines add column if not exists game_points_saved integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_faced integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_saved integer not null default 0;
alter table racquet_match_lines add column if not exists comeback_games integer not null default 0;

-- ===========================================================================
-- 20261005000004_side_out_stats.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists side_outs_won integer not null default 0;
alter table racquet_match_lines add column if not exists service_turns integer not null default 0;
alter table racquet_match_lines add column if not exists service_turn_points integer not null default 0;

-- ===========================================================================
-- 20261005000005_side_out_pct_pickles.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists service_turns_faced integer not null default 0;
alter table racquet_match_lines add column if not exists pickles integer not null default 0;

-- ===========================================================================
-- 20261005000006_pair_points_won.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists pair_service_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists pair_return_points_won integer not null default 0;

-- ===========================================================================
-- 20261007000000_tennis_serve_stats.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists serve_points_tracked integer not null default 0;
alter table racquet_match_lines add column if not exists first_serve_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists second_serve_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists second_serve_points_won integer not null default 0;

-- ===========================================================================
-- 20261007000001_tennis_service_games.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists service_games_played integer not null default 0;
alter table racquet_match_lines add column if not exists service_games_won integer not null default 0;
alter table racquet_match_lines add column if not exists return_games_played integer not null default 0;
alter table racquet_match_lines add column if not exists return_games_won integer not null default 0;

-- ===========================================================================
-- 20261009000000_fixture_half_point_scores.sql
-- ===========================================================================
do $$
begin
  if (select data_type from information_schema.columns
      where table_name = 'fixtures' and column_name = 'home_score') = 'integer' then
    alter table fixtures alter column home_score type double precision using home_score::double precision;
    alter table fixtures alter column away_score type double precision using away_score::double precision;
  end if;
end $$;

-- ===========================================================================
-- 20261009000001_chess_game_stats.sql
-- ===========================================================================
alter table board_match_lines add column if not exists chess_games          integer not null default 0;
alter table board_match_lines add column if not exists chess_wins           integer not null default 0;
alter table board_match_lines add column if not exists chess_draws          integer not null default 0;
alter table board_match_lines add column if not exists chess_losses         integer not null default 0;
alter table board_match_lines add column if not exists chess_points_x2      integer not null default 0;
alter table board_match_lines add column if not exists chess_points_max_x2  integer not null default 0;
alter table board_match_lines add column if not exists white_games          integer not null default 0;
alter table board_match_lines add column if not exists white_points_x2      integer not null default 0;
alter table board_match_lines add column if not exists white_points_max_x2  integer not null default 0;
alter table board_match_lines add column if not exists black_games          integer not null default 0;
alter table board_match_lines add column if not exists black_points_x2      integer not null default 0;
alter table board_match_lines add column if not exists black_points_max_x2  integer not null default 0;
alter table board_match_lines add column if not exists wins_by_checkmate    integer not null default 0;
alter table board_match_lines add column if not exists wins_by_resignation  integer not null default 0;
alter table board_match_lines add column if not exists wins_on_time         integer not null default 0;
alter table board_match_lines add column if not exists draws_by_agreement   integer not null default 0;

-- ===========================================================================
-- 20261009000002_draw_scoring_preset_key.sql
-- ===========================================================================
alter table tournament_disciplines add column if not exists scoring_preset_key varchar(60);

-- ===========================================================================
-- 20261009000003_break_points_faced.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists break_points_faced integer not null default 0;

-- ===========================================================================
-- 20261009000004_tennis_love_holds_bagels.sql
-- ===========================================================================
alter table racquet_match_lines add column if not exists love_holds        integer not null default 0;
alter table racquet_match_lines add column if not exists bagels            integer not null default 0;
alter table racquet_match_lines add column if not exists won_from_set_down integer not null default 0;
