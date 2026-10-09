-- Chess per game on the board stat line: a match line holds every game in it, so a
-- three-game match is three results, split by colour. Points are doubled (2 win, 1
-- draw) so halves stay integers; the _max_x2 columns (2 a game) are what score % is
-- measured against. Plus the four endings asked about most. Integer, default 0. Idempotent.

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
