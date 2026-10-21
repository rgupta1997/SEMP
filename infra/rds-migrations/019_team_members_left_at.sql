-- Squad leave date - the RDS twin of
-- supabase/migrations/20261021000000_team_members_left_at.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-21.
--
-- Adds a nullable timestamp; no backfill (older inactive rows have no known date).
-- Idempotent: ADD COLUMN IF NOT EXISTS.

alter table team_members add column if not exists left_at timestamptz;
