-- Basketball shot attempts on invasion_match_lines, for FG%, 3P% and FT%.
-- Written only for matches where the scorer logged a miss (team-stats.ts).
-- RDS twin: infra/rds-migrations/012_basketball_shot_attempts.sql.

alter table invasion_match_lines add column if not exists ftm  integer not null default 0 check (ftm >= 0);
alter table invasion_match_lines add column if not exists fta  integer not null default 0 check (fta >= 0);
alter table invasion_match_lines add column if not exists fgm  integer not null default 0 check (fgm >= 0);
alter table invasion_match_lines add column if not exists fga  integer not null default 0 check (fga >= 0);
alter table invasion_match_lines add column if not exists fg3m integer not null default 0 check (fg3m >= 0);
alter table invasion_match_lines add column if not exists fg3a integer not null default 0 check (fg3a >= 0);
