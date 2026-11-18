-- Event photos for all events - the RDS twin of
-- supabase/migrations/20261108000000_championship_photos_all_events.sql.
--
-- STATUS: NOT APPLIED. Written 2026-11-08. Apply after 032_championship_photos.sql.
--
-- A photo with no championship_id shows on every event's public Overview. Idempotent.

alter table championship_photos alter column championship_id drop not null;
