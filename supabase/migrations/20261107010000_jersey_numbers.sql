-- Shirt numbers: a player's own number on their profile, and the number they actually
-- wore in each match (the scorer can change it on the team sheet for that match only).
--
-- STATUS: NOT APPLIED. Written 2026-11-07. RDS twin: infra/rds-migrations/033_jersey_numbers.sql.
--
-- Idempotent.

-- The player's own number, set on My Sports Profile. One number for every sport.
alter table users add column if not exists jersey_number smallint;
alter table users drop constraint if exists users_jersey_number_check;
alter table users add constraint users_jersey_number_check
  check (jersey_number is null or jersey_number between 0 and 999);

-- The number worn in this match, copied from the match's team sheet when the result
-- locks. Null when no team sheet was confirmed.
alter table player_match_stats add column if not exists jersey_number smallint;
alter table player_match_stats drop constraint if exists player_match_stats_jersey_number_check;
alter table player_match_stats add constraint player_match_stats_jersey_number_check
  check (jersey_number is null or jersey_number between 0 and 999);
