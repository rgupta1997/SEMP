-- Achievements from organiser-given awards (sport / tournament / event level).
--
-- Supabase twin of infra/rds-migrations/023_award_achievement_source.sql - same SQL, kept in step so both
-- tracks describe the same schema.
--
-- STATUS: NOT APPLIED. Written 2026-10-22. Do not run against Supabase (beta or
-- prod) until the award feature is signed off on the local Docker DB and promotion
-- is explicitly approved.
-- Depends on 20261020000000_award_system.sql.
--
-- Match awards reach achievements through the scorecard lock (source
-- 'locked_result'). Awards above match level have no lock behind them - the
-- organiser gives them on the event's Awards tab - so they are their own source,
-- and a report can always tell the two apart.
--
-- Idempotent.

alter table achievements drop constraint if exists achievements_source_check;
alter table achievements add constraint achievements_source_check
  check (source in ('locked_result', 'validated_claim', 'migrated', 'organiser_award'));
