-- A discipline's gender and result type - the RDS twin of
-- supabase/migrations/20261112000000_discipline_gender_result_type.sql.
--
-- STATUS: NOT APPLIED. Written 2026-11-12. Apply after 034_championship_photos_all_events.sql.
--
-- Null = generic (every catalogue discipline). Idempotent.

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
