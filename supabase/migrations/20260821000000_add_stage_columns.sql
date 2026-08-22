-- Stage-tree columns for the group + knockout stage-config feature. Additive and
-- backward-compatible: stage_sequence defaults to 1, matching every existing fixture
-- row's implicit single-stage semantics, and the new nullable slot-label columns are
-- unused by any pre-existing code path.
alter table public.fixtures
  add column stage_sequence smallint not null default 1,
  add column home_slot_label varchar,
  add column away_slot_label varchar;

create index idx_fixtures_stage_sequence
  on public.fixtures (tournament_discipline_id, stage_sequence, pool_number);
