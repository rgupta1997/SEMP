-- next_certificate_number(): reserves the next certificate serial per org/year/code.
--
-- STATUS: NOT APPLIED to RDS. Local Docker only - written 2026-10-20.
-- RDS already has this function: it was applied by hand from
-- infra/rds-repair-20260926.sql (originally supabase/migrations/20260817010000_certificates.sql),
-- but no numbered file here ever created it, so the local Docker DB (built only
-- from this folder) lacked it. The certificate generator's per-row fallback
-- (allocateNumber in apps/api/src/modules/certificates/certificates.service.ts)
-- calls it, so any batch with an already-issued recipient failed locally with 42883.
--
-- Body copied exactly from infra/rds-repair-20260926.sql. Depends on certificate_counters.
--
-- Idempotent (create or replace).

create or replace function next_certificate_number(p_org uuid, p_year smallint, p_code varchar)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into certificate_counters (organization_id, year, code, next_number)
       values (p_org, p_year, p_code, 1)
  on conflict (organization_id, year, code) do update
          set next_number = certificate_counters.next_number + 1
    returning next_number into n;
  return n;
end $$;
