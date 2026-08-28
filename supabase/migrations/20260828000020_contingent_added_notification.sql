-- ============================================================================
-- A notification type for "a campus is taking part"
--
-- `notifications.type` is pinned by a check constraint, so the registry in
-- packages/notifications is only half the definition: adding a key there and not
-- here produces a 500 at the moment somebody uses the feature, which is exactly
-- how this was found.
--
-- `contingent_added` announces that a campus or batch has been added to an
-- internal championship. It exists because `enrollment_approved` announces that an
-- ORGANISATION joined, and reusing it on an event contested between one
-- organisation's own campuses produced "Northfield has joined the championship" -
-- true, useless, and hiding the only fact the reader wants, which is WHICH campus.
--
-- The constraint is rebuilt rather than dropped: an unconstrained `type` would let
-- a typo become a notification nothing knows how to render, and the registry keys
-- are code precisely so that cannot happen.
-- ============================================================================

alter table notifications drop constraint if exists notifications_type_check;

alter table notifications add constraint notifications_type_check
  check (type in (
    'manual',
    'event_lifecycle',
    'enrollment_requested',
    'enrollment_approved',
    'enrollment_rejected',
    'enrollment_joined',
    'entry_submitted',
    -- New: a campus or batch added to an internal championship.
    'contingent_added',
    'org_join_request',
    'org_join_approved',
    'org_join_declined',
    'org_invitation',
    'claim_submitted',
    'claim_approved',
    'claim_rejected',
    'plan_changed',
    'plan_downgrade_scheduled',
    'plan_downgrade_applied',
    'plan_upgrade_requested'
  ));
