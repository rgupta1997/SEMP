-- Shirt numbers - the RDS twin of supabase/migrations/20261107010000_jersey_numbers.sql.
--
-- STATUS: NOT APPLIED. Written 2026-11-07.
--
-- users.jersey_number: the player's own number from their profile (one for every sport).
-- player_match_stats.jersey_number: the number worn in that match, copied from the team
-- sheet at lock. Idempotent.

alter table users add column if not exists jersey_number smallint;
alter table users drop constraint if exists users_jersey_number_check;
alter table users add constraint users_jersey_number_check
  check (jersey_number is null or jersey_number between 0 and 999);

alter table player_match_stats add column if not exists jersey_number smallint;
alter table player_match_stats drop constraint if exists player_match_stats_jersey_number_check;
alter table player_match_stats add constraint player_match_stats_jersey_number_check
  check (jersey_number is null or jersey_number between 0 and 999);
