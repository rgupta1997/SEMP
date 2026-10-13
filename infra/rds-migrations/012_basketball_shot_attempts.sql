-- Basketball shot attempts on invasion_match_lines - the RDS twin of
-- supabase/migrations/20261013000000_basketball_shot_attempts.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-13.
--
-- Six integer counters (default 0) behind FG%, 3P% and FT%. Additive and
-- idempotent: every statement is ADD COLUMN IF NOT EXISTS.

alter table invasion_match_lines add column if not exists ftm  integer not null default 0;
alter table invasion_match_lines add column if not exists fta  integer not null default 0;
alter table invasion_match_lines add column if not exists fgm  integer not null default 0;
alter table invasion_match_lines add column if not exists fga  integer not null default 0;
alter table invasion_match_lines add column if not exists fg3m integer not null default 0;
alter table invasion_match_lines add column if not exists fg3a integer not null default 0;
