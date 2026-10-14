-- Basketball free throws on invasion_match_lines - the RDS twin of
-- supabase/migrations/20261013000000_basketball_shot_attempts.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-13.
--
-- Two integer counters (default 0) behind FT%. Additive and idempotent:
-- every statement is ADD COLUMN IF NOT EXISTS.

alter table invasion_match_lines add column if not exists ftm integer not null default 0;
alter table invasion_match_lines add column if not exists fta integer not null default 0;
