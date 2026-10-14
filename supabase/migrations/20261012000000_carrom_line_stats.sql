-- Carrom per match on the board stat line, from the board-by-board console
-- (carromLineStats in packages/shared/src/carrom.ts): games won and lost (a game is the
-- 25-point unit), points scored and conceded, the best single board, slams, fouls, boards
-- broken and won on the break, and deciding games. Real boards keep using units_won /
-- units_lost; queens keep the queens column (now queens COVERED). Integer, default 0.
-- Idempotent.

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
