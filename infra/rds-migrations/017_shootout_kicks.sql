-- Penalty shoot-out kicks on invasion_match_lines - the RDS twin of
-- supabase/migrations/20261016000000_shootout_kicks.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-16.
--
-- Two integer counters (default 0), kept apart from in-match penalties. Additive and
-- idempotent: every statement is ADD COLUMN IF NOT EXISTS.

alter table invasion_match_lines add column if not exists shootout_scored integer not null default 0;
alter table invasion_match_lines add column if not exists shootout_missed integer not null default 0;
