-- Volleyball / throwball: rally points lost on net_match_lines, for point win %.
-- Written by netLineStats (packages/shared/src/net-stats.ts).
-- RDS twin: infra/rds-migrations/013_net_points_lost.sql.

alter table net_match_lines add column if not exists points_lost integer not null default 0 check (points_lost >= 0);
