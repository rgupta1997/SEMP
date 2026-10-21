-- When someone left a squad. Leaving a roster (or the organisation) now keeps the row,
-- inactive, so a player's history can tell their matches from the team's later ones.
-- Null on an active row; null on an old inactive row too - when that happened is unknown.
-- RDS twin: infra/rds-migrations/019_team_members_left_at.sql.

alter table team_members add column if not exists left_at timestamptz;
