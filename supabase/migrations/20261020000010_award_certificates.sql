-- Award certificates: one live certificate per person per AWARD.
--
-- Supabase twin of infra/rds-migrations/022_award_certificates.sql - same SQL, kept in step so both
-- tracks describe the same schema.
--
-- STATUS: NOT APPLIED. Written 2026-10-22. Do not run against Supabase (beta or
-- prod) until the award feature is signed off on the local Docker DB and promotion
-- is explicitly approved.
-- Depends on 20261020000000_award_system.sql.
--
-- Until now an award certificate was deduped like every other: one per person per
-- fixture (match awards) or one per person per event. With several award levels
-- that is wrong both ways - a player who is Player of the Match AND Best Raider in
-- the same game could only ever hold one of the two, and a Player of the Tournament
-- would block their Best Raider - Kabaddi certificate at event level.
--
-- certificates.award_ref names the award a certificate is for - a stable key built
-- from the scope and the award type, not a row id (match awards are re-saved by
-- delete and re-insert, so their ids change):
--   match:<fixture_id>:<award_type_id>
--   championship:<level>:<scope id>:<award_type_id>
-- Award certificates are deduped on (user_id, award_ref); everything else keeps the
-- two existing keys, which now exclude rows that carry an award_ref.
--
-- Idempotent.

alter table certificates add column if not exists award_ref varchar(160);

drop index if exists uq_certificates_fixture_recipient;
create unique index uq_certificates_fixture_recipient
  on certificates (fixture_id, user_id, recipient_category)
  where revoked_at is null and superseded_at is null and fixture_id is not null and award_ref is null;

drop index if exists uq_certificates_event_recipient;
create unique index uq_certificates_event_recipient
  on certificates (championship_id, user_id, recipient_category)
  where revoked_at is null and superseded_at is null and fixture_id is null and award_ref is null;

create unique index if not exists uq_certificates_award_recipient
  on certificates (user_id, award_ref)
  where revoked_at is null and superseded_at is null and award_ref is not null;
