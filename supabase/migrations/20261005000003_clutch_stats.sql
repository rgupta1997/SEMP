-- Pressure stats per racquet stat line: game and match points converted / saved,
-- and games won from behind. All integer counters, default 0. Idempotent.

alter table racquet_match_lines add column if not exists game_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists game_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists game_points_faced integer not null default 0;
alter table racquet_match_lines add column if not exists game_points_saved integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_faced integer not null default 0;
alter table racquet_match_lines add column if not exists match_points_saved integer not null default 0;
alter table racquet_match_lines add column if not exists comeback_games integer not null default 0;
