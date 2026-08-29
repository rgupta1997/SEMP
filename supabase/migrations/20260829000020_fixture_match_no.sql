-- ============================================================================
-- Every fixture gets a match number
--
-- There was no way to refer to a match. An organiser on a phone, an official at the
-- pitch and a captain asking "which one?" all had only "B.Tech 2023 v PhD Scholars",
-- which in a round robin of eight batches is not unique - the same two sides meet
-- twice, and a 224-match championship has several pairs playing on the same day.
--
-- PER CHAMPIONSHIP, NOT GLOBAL. "Match 14" means something inside one event and
-- nothing across the platform; a global sequence would give the first match of a
-- school's own league a five-digit number.
--
-- ASSIGNED IN PLAYING ORDER, and that ordering is the point: numbering by
-- scheduled_at means the numbers run the way the day runs, so sorting by match
-- number is sorting by when it is played, and an unscheduled fixture sorts to the
-- end rather than into the middle. Ties fall back to created_at then id so the
-- backfill is deterministic and re-runnable.
--
-- NULLABLE. 3,000-odd fixtures predate this and are numbered below; anything the
-- generator creates from now on is numbered at creation. Nullable also keeps the
-- door open for a fixture created by a path that has not been taught to number yet -
-- it sorts last and displays as blank rather than failing an insert.
-- ============================================================================

alter table fixtures add column if not exists match_no integer;

-- Backfill: one sequence per championship, in playing order.
with ordered as (
  select
    f.id,
    row_number() over (
      partition by t.championship_id
      order by
        -- nulls last: a fixture with no date is not "match 1", it is unplaced.
        f.scheduled_at asc nulls last,
        f.created_at asc,
        f.id asc
    ) as n
  from fixtures f
  join tournament_disciplines td on td.id = f.tournament_discipline_id
  join tournament_sports ts on ts.id = td.tournament_sport_id
  join tournaments t on t.id = ts.tournament_id
)
update fixtures f
set match_no = ordered.n
from ordered
where f.id = ordered.id and f.match_no is null;

-- One number per championship. A partial index because match_no is nullable, and
-- because two unnumbered fixtures are not a conflict.
--
-- The championship is three joins away from a fixture, so the constraint cannot be a
-- plain unique index on this table. It is enforced in the allocator instead
-- (nextMatchNo in fixtures/domain), and this index is what makes that allocator's
-- "highest so far" lookup a single index scan rather than a sort of every fixture in
-- the event.
create index if not exists idx_fixtures_match_no
  on fixtures (tournament_discipline_id, match_no)
  where match_no is not null;

comment on column fixtures.match_no is
  'Sequential within the championship, in scheduled order. Assigned at creation; the display label is "Match N".';
