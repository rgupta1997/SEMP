-- Carrom per-match stats on board_match_lines - the RDS twin of
-- supabase/migrations/20261012000000_carrom_line_stats.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-12.
--
-- Twelve integer counters (default 0) written by carromLineStats
-- (packages/shared/src/carrom.ts) for matches scored on the board-by-board carrom
-- console. Additive and idempotent: every statement is ADD COLUMN IF NOT EXISTS.

alter table board_match_lines add column if not exists carrom_games           integer not null default 0;
alter table board_match_lines add column if not exists carrom_games_won       integer not null default 0;
alter table board_match_lines add column if not exists carrom_games_lost      integer not null default 0;
alter table board_match_lines add column if not exists carrom_points_for      integer not null default 0;
alter table board_match_lines add column if not exists carrom_points_against  integer not null default 0;
alter table board_match_lines add column if not exists best_board             integer not null default 0;
alter table board_match_lines add column if not exists slams                  integer not null default 0;
alter table board_match_lines add column if not exists carrom_fouls           integer not null default 0;
alter table board_match_lines add column if not exists boards_broken          integer not null default 0;
alter table board_match_lines add column if not exists board_wins_on_break    integer not null default 0;
alter table board_match_lines add column if not exists carrom_deciders        integer not null default 0;
alter table board_match_lines add column if not exists carrom_deciders_won    integer not null default 0;
