-- Point system: manual tally adjustments, and half points in the standings table.
--
-- STATUS: NOT APPLIED. Written 2026-10-25. RDS twin: infra/rds-migrations/029_standings_adjustments.sql.
--
-- What changes:
--   standings.points      integer -> double precision, so a mixed event that counts half
--                         toward Men and half toward Women can show 2.5. Existing values
--                         are kept exactly.
--   standings_adjustments new: organiser +/- points per contingent with a reason
--                         (deductions, forfeits, OC decisions). Added on recompute.
--
-- Idempotent.

alter table standings alter column points type double precision using points::double precision;
alter table standings alter column points set default 0;

create table if not exists standings_adjustments (
  id                       uuid primary key default gen_random_uuid(),
  championship_id          uuid not null references championships(id) on delete cascade,
  organization_id          uuid not null references organizations(id) on delete cascade,
  org_unit_id              uuid references org_units(id) on delete cascade,
  -- The discipline it concerns, if any. The adjustment then also shows in that sport's table.
  tournament_discipline_id uuid references tournament_disciplines(id) on delete set null,
  points                   double precision not null,
  reason                   text not null,
  created_by               uuid references users(id) on delete set null,
  created_at               timestamptz not null default now(),
  constraint standings_adjustments_points_check check (points <> 0 and points between -1000 and 1000),
  constraint standings_adjustments_reason_check check (char_length(reason) between 3 and 300)
);

create index if not exists idx_standings_adjustments_championship on standings_adjustments (championship_id);

-- RLS on with no policy: only the API (table owner) reads and writes it.
alter table standings_adjustments enable row level security;
