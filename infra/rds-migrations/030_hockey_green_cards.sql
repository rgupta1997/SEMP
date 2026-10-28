-- Hockey green cards and penalty corner goals - the RDS twin of
-- supabase/migrations/20261028000000_hockey_green_cards.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-28.
--
-- Apply BEFORE the API that writes it: a hockey stat row naming a missing column
-- fails the whole match's insert. Additive with a zero default. Idempotent.

alter table invasion_match_lines add column if not exists greens   integer not null default 0 check (greens >= 0);
alter table invasion_match_lines add column if not exists pc_goals integer not null default 0 check (pc_goals >= 0);
