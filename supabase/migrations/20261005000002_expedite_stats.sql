-- Table tennis expedite system: per-match counters for the profile's expedite tiles.
-- All 0 for matches expedite never came into. Idempotent.

alter table racquet_match_lines add column if not exists expedite_matches integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_wins integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_return_wins integer not null default 0;
alter table racquet_match_lines add column if not exists expedite_return_losses integer not null default 0;
