-- Tennis service games per racquet stat line: games served and held, games received and
-- broken. Tie-breaks are not counted (no single server). Integer counters, default 0. Idempotent.

alter table racquet_match_lines add column if not exists service_games_played integer not null default 0;
alter table racquet_match_lines add column if not exists service_games_won integer not null default 0;
alter table racquet_match_lines add column if not exists return_games_played integer not null default 0;
alter table racquet_match_lines add column if not exists return_games_won integer not null default 0;
