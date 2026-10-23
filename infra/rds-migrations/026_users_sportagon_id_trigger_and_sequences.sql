-- The last repair-file objects the local DB lacked: trg_users_sportagon_id and the
-- two sequences invoice_number_seq and sportagon_id_seq.
--
-- STATUS: NOT APPLIED to RDS. Local Docker only - written 2026-10-20.
-- RDS already has all three: they were applied by hand from
-- infra/rds-repair-20260926.sql (originally supabase/migrations/20260826000040_plans_and_billing.sql
-- and 20260829000000_issue_sportagon_id.sql), but no numbered file here ever
-- created them, so the local Docker DB (built only from this folder) lacked them.
-- Same gap as 024 and 025.
--
-- What each fixes locally:
--   invoice_number_seq   issueInvoice() (apps/api/src/modules/billing/invoice.ts)
--                        calls nextval on it; without it every invoice failed.
--   trg_users_sportagon_id  new users got no sportagon_id; now minted on insert.
--   sportagon_id_seq     only the pre-006 issue_sportagon_id() body used it.
--                        Created so local matches RDS; nothing current reads it.
--
-- The trigger calls issue_sportagon_id() AS 006 LEFT IT (EOS-STG0001 scheme via
-- next_sportagon_ids). The repair file also carries the older sequence-based body
-- of that function; it is deliberately NOT copied here, since that would undo 006.
-- Existing users are not backfilled: the trigger only fires on insert.
--
-- Sequence and trigger statements copied exactly from infra/rds-repair-20260926.sql.
--
-- Idempotent (if not exists; drop trigger if exists before create).

-- invoice_number_seq  [from 20260826000040_plans_and_billing.sql]
create sequence if not exists invoice_number_seq;

-- sportagon_id_seq  [from 20260829000000_issue_sportagon_id.sql]
create sequence if not exists sportagon_id_seq start with 1000000;

-- trg_users_sportagon_id  [from 20260829000000_issue_sportagon_id.sql]
drop trigger if exists trg_users_sportagon_id on users;
create trigger trg_users_sportagon_id
  before insert on users
  for each row execute function issue_sportagon_id();
