-- ============================================================================
-- Widen notifications type/audience checks for the org-join flow
--   The org-join feature writes notifications with type
--   org_join_request / org_join_approved / org_join_declined and audience
--   org_admins, but the check constraints (from the notifications + rebrand
--   migrations) never included them, so those inserts failed. Bring both
--   constraints in line with the NOTIFICATION_TYPE / NOTIFICATION_AUDIENCE enums
--   in @semp/shared. Idempotent; lossless (existing rows use the old values).
-- ============================================================================

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('manual', 'event_lifecycle', 'enrollment_approved', 'org_join_request', 'org_join_approved', 'org_join_declined'));

alter table notifications drop constraint if exists notifications_audience_check;
alter table notifications add constraint notifications_audience_check
  check (audience in ('all', 'organizations_captains', 'org_admins'));
