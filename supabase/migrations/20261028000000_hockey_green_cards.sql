-- Hockey green cards (2-minute suspension) and penalty corner goals on the invasion stat table.
-- RDS twin: infra/rds-migrations/030_hockey_green_cards.sql.
--
-- Apply BEFORE the API that writes it: a hockey stat row naming a missing column
-- fails the whole match's insert. Additive with a zero default. Idempotent.

alter table invasion_match_lines add column if not exists greens   integer not null default 0 check (greens >= 0);
alter table invasion_match_lines add column if not exists pc_goals integer not null default 0 check (pc_goals >= 0);
