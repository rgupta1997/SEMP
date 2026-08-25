-- ============================================================================
-- J3-E4-S2 · Where a competition is, so it can be filtered by region
--
-- Two columns rather than one, deliberately. `country` is what an organiser knows and
-- types; `region` is what the Discover chips filter on. Deriving the region from the
-- country on every read would mean shipping the lookup table into every query - so it
-- is derived once, on write, from the map in packages/shared/src/regions.ts.
--
-- Both nullable, and a championship with no country is grouped as "Unspecified"
-- rather than hidden (the epic is explicit about that): a filter that silently drops
-- rows teaches people not to trust the filter.
-- ============================================================================

alter table championships
  add column if not exists country varchar,
  add column if not exists region  varchar;

alter table championships
  drop constraint if exists championships_region_check;
alter table championships
  add constraint championships_region_check
  check (region is null or region in ('asia', 'europe', 'americas', 'africa', 'oceania'));

create index if not exists idx_championships_region on championships (region) where region is not null;
