-- Sport-scoped organisers - the RDS twin of
-- supabase/migrations/20261026000000_sport_scoped_organisers.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-26.
--
-- Adds a sport list to organiser rows and to invitations; empty = all sports, so
-- existing rows are unchanged and nothing is backfilled.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

alter table user_championship_roles add column if not exists sport_ids uuid[] not null default '{}';
alter table user_invitations add column if not exists sport_ids uuid[] not null default '{}';
