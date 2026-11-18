-- A discipline's gender and result type. Catalogue disciplines stay generic (null); one an
-- organiser creates can be tied to men, women or mixed, so a "Men" discipline that runs all
-- races offers the generic ones plus the men's. result_type ranks a discipline whose name
-- matches nothing in the sport's template (an athletics "Javelin" is a distance, not a time).
--
-- STATUS: NOT APPLIED. Written 2026-11-12. Apply after 20261108000000_championship_photos_all_events.sql.
-- RDS twin: infra/rds-migrations/035_discipline_gender_result_type.sql.
--
-- Idempotent.

alter table disciplines add column if not exists gender varchar;
alter table disciplines add column if not exists result_type varchar;

do $$ begin
  alter table disciplines add constraint disciplines_gender_check
    check (gender is null or gender in ('men', 'women', 'mixed'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table disciplines add constraint disciplines_result_type_check
    check (result_type is null or result_type in ('time', 'distance', 'weight'));
exception when duplicate_object then null; end $$;
