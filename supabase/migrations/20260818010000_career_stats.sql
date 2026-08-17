-- Career statistics, materialised (J4-E3).
--
-- Until now "how many has she won?" was computed by scanning achievements and fixtures
-- on every read. That is correct and it does not scale: a player page, a Hall of Fame
-- and a report all ask the same question with different filters, and none of them can
-- be indexed.
--
-- THE CASCADE.
-- One table holds three grains of the same truth, distinguished by which columns are
-- null:
--
--   grain='sport'       sport                     "her badminton record"
--   grain='discipline'  sport + discipline        "her badminton singles record"
--   grain='format'      sport + discipline + fmt  "her badminton singles knockout record"
--
-- Storing the rollups rather than summing them on read is what makes a player page a
-- single indexed lookup. They cannot drift, because every level is RECOMPUTED from the
-- underlying rows together in one transaction - never incremented. An increment that
-- runs twice is wrong forever and nothing ever tells you; a recompute that runs twice
-- is simply the same answer again.
--
-- WHEN IT UPDATES.
-- On lock, and on unlock. The lock is the moment a result becomes a fact, so it is the
-- only honest moment to count it, and it is also what makes the number feel live to the
-- person watching their own page.
create table if not exists career_stats (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  sport_id        uuid not null references sports(id) on delete cascade,
  -- Null at coarser grains. Part of the identity of the row, hence in the unique index
  -- below via a coalesce - Postgres treats nulls as distinct in a plain unique index,
  -- which would happily store the same sport-level row a hundred times.
  discipline_id   uuid references disciplines(id) on delete cascade,
  format          varchar(40),
  grain           varchar(12) not null check (grain in ('sport', 'discipline', 'format')),

  played          integer not null default 0,
  won             integer not null default 0,
  lost            integer not null default 0,
  drawn           integer not null default 0,
  gold            integer not null default 0,
  silver          integer not null default 0,
  bronze          integer not null default 0,
  awards          integer not null default 0,
  -- The span this record covers, so a profile can say "2023-2026" without a second query.
  first_on        date,
  last_on         date,
  computed_at     timestamptz not null default now()
);

-- One row per (person, institution, grain). The coalesce is load-bearing: without it
-- the sport-grain rows, whose discipline_id and format are null, would never collide
-- and the table would grow a duplicate on every recompute.
create unique index if not exists uq_career_stats_grain on career_stats(
  user_id, organization_id, sport_id,
  coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(format, '')
);

-- The two reads this exists to serve: one person's whole record, and an institution's
-- leaderboard within a sport.
create index if not exists idx_career_stats_user on career_stats(user_id, grain, last_on desc);
create index if not exists idx_career_stats_org_sport on career_stats(organization_id, sport_id, grain);
