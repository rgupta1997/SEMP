-- ============================================================================
-- Allow self-service join requests on organization_members
--   The join flow (org_join_requests_and_notifications) stores a request as an
--   organization_members row with status = 'pending', approved → 'active'. The
--   original status check (from the rebrand migration) only permitted
--   ('active', 'past'), so inserting a 'pending' request failed. Widen it to cover
--   the request lifecycle. Idempotent; lossless (existing rows are active/past).
-- ============================================================================

alter table organization_members drop constraint if exists organization_members_status_check;
alter table organization_members add constraint organization_members_status_check
  check (status in ('active', 'past', 'pending', 'rejected'));
