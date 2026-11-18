-- Two new subscription history kinds for the SaaS plans:
--   admin_set      - a super admin put the holder on a plan from the console
--   default_grant  - a new organisation started on the default plan
--
-- Widening a CHECK only: every row the old list allowed is still allowed, so code
-- built before this (beta) keeps working. subscription_events is tiny, so the
-- re-check on ADD CONSTRAINT is instant.
alter table subscription_events drop constraint if exists subscription_events_kind_check;
alter table subscription_events add constraint subscription_events_kind_check check (kind in (
  'subscribed', 'upgraded', 'downgrade_scheduled', 'downgrade_cancelled',
  'downgrade_applied', 'renewed', 'cancelled',
  'admin_set', 'default_grant'
));
