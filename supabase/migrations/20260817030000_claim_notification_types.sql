-- Notification types for achievement claims (J4-E5).
--
-- The type list is a CHECK constraint rather than a lookup table so an unknown type is
-- rejected at write time by the database, not discovered later as an unrenderable row
-- in somebody's feed. That is worth keeping, which means adding to it here.

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'manual', 'event_lifecycle',
    'enrollment_requested', 'enrollment_approved', 'enrollment_rejected', 'enrollment_joined',
    'entry_submitted',
    'org_join_request', 'org_join_approved', 'org_join_declined',
    'org_invitation',
    -- J4-E5. Three types rather than one: the validator's "somebody is waiting on you"
    -- and the claimant's "you were turned down, here is why" are different messages to
    -- different people, and a single 'claim' type would make the feed unable to say
    -- which had happened.
    'claim_submitted', 'claim_approved', 'claim_rejected'
  ));
