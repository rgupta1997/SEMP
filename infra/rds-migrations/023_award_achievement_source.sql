-- Achievements from organiser-given awards (sport / tournament / event level).
--
-- STATUS: NOT APPLIED to RDS. Local Docker only - written 2026-10-20.
-- Do not apply to Supabase or RDS until the award feature is signed off locally.
-- Depends on 021_award_system.sql.
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
