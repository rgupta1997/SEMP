-- ============================================================================
-- One notification type was carrying four different messages
--
-- `enrollment_approved` was being written for all of these:
--
--   1. an organisation APPLIED, and the organiser has to review it
--   2. an organisation ACCEPTED AN INVITATION and is now in
--   3. an applicant was told they had been approved   <- the only one it named
--   4. everybody was told a new organisation had joined
--   5. an individual entered a solo event, awaiting the organiser's review
--
-- Every one of those reads as "Approval ✅" in the feed. An organiser with something to
-- review sees a green tick that says the work is already done; an applicant waiting for
-- a decision sees the same tick when somebody else got in. The type is also what any
-- future notification preference or email digest would have to key off, so collapsing
-- five meanings into one is not just a display bug - it makes "email me when somebody
-- applies" unimplementable.
--
-- Splitting them:
--
--   enrollment_requested  - an organisation applied; an organiser must decide (1)
--   entry_submitted       - an individual entered; an organiser must decide (5)
--   enrollment_approved   - YOU are in (3)                         [meaning narrowed]
--   enrollment_rejected   - YOU are not (unchanged)
--   enrollment_joined     - somebody else joined; news, not a task (2, 4)
--
-- Existing rows are deliberately NOT reclassified. The distinction lives in who the
-- row was addressed to and what its title says, and guessing wrong would rewrite
-- history in the one table people read to find out what happened. They stay
-- 'enrollment_approved', which is what they have always claimed to be.
-- ============================================================================

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'manual', 'event_lifecycle',
    'enrollment_requested', 'enrollment_approved', 'enrollment_rejected', 'enrollment_joined',
    'entry_submitted',
    'org_join_request', 'org_join_approved', 'org_join_declined',
    'org_invitation'
  ));
