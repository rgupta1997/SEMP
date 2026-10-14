-- Basketball free throws made / attempted on invasion_match_lines, for FT%.
-- Written only for matches where the scorer logged a missed free throw (team-stats.ts).
-- RDS twin: infra/rds-migrations/013_basketball_shot_attempts.sql.

alter table invasion_match_lines add column if not exists ftm integer not null default 0 check (ftm >= 0);
alter table invasion_match_lines add column if not exists fta integer not null default 0 check (fta >= 0);
