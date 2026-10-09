-- Chess scores in halves: a drawn game is ½-½ and a team match finishes 2½-1½. The
-- fixture headline columns were integers, so a half had nowhere to go. Widened to
-- double precision: every existing value (and every other sport) stays a whole number,
-- chess may now store 0.5 steps. A widening cast - no data changes. Idempotent.
--
-- Apply BEFORE the API deploys: the new API writes 2.5 and an integer column rejects it.

do $$
begin
  if (select data_type from information_schema.columns
      where table_name = 'fixtures' and column_name = 'home_score') = 'integer' then
    alter table fixtures alter column home_score type double precision using home_score::double precision;
    alter table fixtures alter column away_score type double precision using away_score::double precision;
  end if;
end $$;
