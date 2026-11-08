-- Event photos for ALL events: a photo with no championship_id shows on every event's public
-- Overview, beside that event's own photos. Super admins choose the scope when adding one.
--
-- STATUS: NOT APPLIED. Written 2026-11-08. Apply after 20261107000000_championship_photos.sql.
-- RDS twin: infra/rds-migrations/034_championship_photos_all_events.sql.
--
-- Idempotent.

alter table championship_photos alter column championship_id drop not null;
