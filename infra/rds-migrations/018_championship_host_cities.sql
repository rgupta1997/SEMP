-- Championship host cities - the RDS twin of
-- supabase/migrations/20261018000000_championship_host_cities.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-18.
--
-- Adds a text[] list (default empty) and backfills it from the existing single
-- `venue` value. Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only
-- touches rows whose list is still empty.

alter table championships add column if not exists host_cities text[] not null default '{}';

update championships
   set host_cities = array[btrim(venue)]
 where cardinality(host_cities) = 0
   and venue is not null
   and btrim(venue) <> '';
