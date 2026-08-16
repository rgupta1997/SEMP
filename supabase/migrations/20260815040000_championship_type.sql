-- ============================================================================
-- J2-E1-S2 · What kind of championship this is
--
-- Nullable on purpose: existing championships predate the question, and guessing a
-- type for them in a backfill would put made-up data into the column that FR-EVT-2's
-- filters and the reports in module 08 will group by.
--
-- The list is what an organiser actually runs, not a taxonomy: an inter-programme
-- meet inside one institution and an inter-college one across many are different
-- events to plan, staff and report on, even when the sports are identical.
-- ============================================================================

alter table championships
  add column if not exists type varchar;

alter table championships
  drop constraint if exists championships_type_check;
alter table championships
  add constraint championships_type_check
  check (type is null or type in ('multi_sport', 'inter_college', 'inter_programme', 'single_sport', 'open'));

-- The championships list filters by type; the column is low-cardinality but the
-- table is read on every Discover and Host page load.
create index if not exists idx_championships_type on championships (type) where type is not null;
