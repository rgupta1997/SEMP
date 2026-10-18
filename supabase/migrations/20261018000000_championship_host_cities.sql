-- A championship can be hosted across several cities. The list lives here; the old
-- `venue` text column stays, filled by the API with the same cities joined.
-- RDS twin: infra/rds-migrations/018_championship_host_cities.sql.

alter table championships add column if not exists host_cities text[] not null default '{}';

-- Backfill: an existing championship's single host city becomes a one-city list.
-- Not split on commas - "Kozhikode, Kerala" is one place, not two.
update championships
   set host_cities = array[btrim(venue)]
 where cardinality(host_cities) = 0
   and venue is not null
   and btrim(venue) <> '';
