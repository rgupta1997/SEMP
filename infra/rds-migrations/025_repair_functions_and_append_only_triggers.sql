-- The remaining repair-file functions: audit_log_is_append_only(), rate_limit_hit()
-- and certificate_verifications_append_only(), plus the two append-only triggers
-- that are the only reason the first and third exist.
--
-- STATUS: NOT APPLIED to RDS. Local Docker only - written 2026-10-20.
-- RDS already has all of this: it was applied by hand from
-- infra/rds-repair-20260926.sql (originally supabase/migrations/20260815010000_audit_log.sql,
-- 20260816040000_rate_limits.sql and 20260817010000_certificates.sql), but no
-- numbered file here ever created it, so the local Docker DB (built only from this
-- folder) lacked it. Same gap as 024_next_certificate_number_fn.sql.
--
-- With the triggers in place, update/delete on audit_log and certificate_verifications
-- raises locally exactly as it does on RDS - including the cascade from deleting a
-- certificate that has verifications (apps/api/scripts/seed-northfield.ts does that).
--
-- Bodies copied exactly from infra/rds-repair-20260926.sql.
--
-- Idempotent (create or replace; drop trigger if exists before create).

-- audit_log_is_append_only  [from 20260815010000_audit_log.sql]
create or replace function audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$;

-- rate_limit_hit  [from 20260816040000_rate_limits.sql]
create or replace function rate_limit_hit(p_key text, p_window_start timestamptz)
returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

-- certificate_verifications_append_only  [from 20260817010000_certificates.sql]
create or replace function certificate_verifications_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'certificate_verifications is append-only: % is not permitted', tg_op;
end $$;

-- trg_audit_log_no_update  [from 20260815010000_audit_log.sql]
drop trigger if exists trg_audit_log_no_update on audit_log;
create trigger trg_audit_log_no_update
  before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

-- trg_certificate_verifications_no_update  [from 20260817010000_certificates.sql]
drop trigger if exists trg_certificate_verifications_no_update on certificate_verifications;
create trigger trg_certificate_verifications_no_update
  before update or delete on certificate_verifications
  for each row execute function certificate_verifications_append_only();
