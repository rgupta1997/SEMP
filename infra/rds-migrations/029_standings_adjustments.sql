-- Point system: manual tally adjustments, and half points in the standings table - the
-- RDS twin of supabase/migrations/20261025000000_standings_adjustments.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-25. Check main's latest RDS number before merging.
--
-- standings.points becomes double precision (a mixed event can count half toward each
-- group); existing values are kept exactly. standings_adjustments holds organiser +/-
-- points per contingent with a reason, added on recompute. Idempotent.

alter table standings alter column points type double precision using points::double precision;
alter table standings alter column points set default 0;

create table if not exists standings_adjustments (
  id                       uuid primary key default gen_random_uuid(),
  championship_id          uuid not null references championships(id) on delete cascade,
  organization_id          uuid not null references organizations(id) on delete cascade,
  org_unit_id              uuid references org_units(id) on delete cascade,
  tournament_discipline_id uuid references tournament_disciplines(id) on delete set null,
  points                   double precision not null,
  reason                   text not null,
  created_by               uuid references users(id) on delete set null,
  created_at               timestamptz not null default now(),
  constraint standings_adjustments_points_check check (points <> 0 and points between -1000 and 1000),
  constraint standings_adjustments_reason_check check (char_length(reason) between 3 and 300)
);

create index if not exists idx_standings_adjustments_championship on standings_adjustments (championship_id);
