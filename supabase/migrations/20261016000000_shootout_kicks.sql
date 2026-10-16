-- Penalty shoot-out kicks on invasion_match_lines, kept apart from in-match penalties
-- (a shoot-out kick is not a goal). Written when the official names the kicker.
-- RDS twin: infra/rds-migrations/017_shootout_kicks.sql.

alter table invasion_match_lines add column if not exists shootout_scored integer not null default 0 check (shootout_scored >= 0);
alter table invasion_match_lines add column if not exists shootout_missed integer not null default 0 check (shootout_missed >= 0);
