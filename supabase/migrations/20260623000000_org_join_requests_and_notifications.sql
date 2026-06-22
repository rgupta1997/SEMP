-- ============================================================================
-- Organization join requests + org/direct notifications
--
--   1. Self-service "join an organization" flow. A join request is simply an
--      organization_members row with status = 'pending' - no new table. The
--      unique (user_id, organization_id) constraint prevents duplicates, and
--      the orgRole() guard already requires status = 'active', so a pending row
--      grants no access until an owner/admin approves it. An index on
--      (organization_id, status) makes the owner's pending-requests query cheap.
--
--   2. Notifications were strictly championship-scoped (championship_id NOT NULL,
--      visibility derived from championship membership). To notify an org's
--      owners/admins of a new request, and the requester of the decision, we add
--      org-scoped and direct-to-user targeting:
--        - championship_id becomes nullable (org notifications have no event)
--        - organization_id  → fan-out to that org's owners/admins (audience
--                             'org_admins'), without writing one row per admin
--        - target_user_id   → a direct notification to a single user
--
--      These two are deliberately plain uuid columns WITHOUT foreign keys: the
--      notifications table already has one FK to users (sender_id), and adding
--      more FKs to users/organizations would make `prisma db pull` rename the
--      existing relations (breaking code that reads `n.users`). The columns are
--      always written with valid ids by application code, and an orphaned feed
--      row after a user/org delete is harmless (it simply never matches the
--      visibility filter). Indexed for the feed query.
--
--   Purely additive; idempotent so it can be re-applied safely.
-- ============================================================================

-- 1. Owner's pending-requests query.
create index if not exists idx_organization_members_org_status
  on organization_members (organization_id, status);

-- 2. Notifications: relax championship_id, add org + direct targeting.
alter table notifications alter column championship_id drop not null;

alter table notifications add column if not exists organization_id uuid;
alter table notifications add column if not exists target_user_id uuid;

create index if not exists idx_notifications_organization on notifications (organization_id);
create index if not exists idx_notifications_target_user on notifications (target_user_id);

comment on column notifications.organization_id is 'When set with audience=org_admins, the notification is visible to that organization''s owners/admins (used for join requests). Mutually exclusive with championship_id in practice.';
comment on column notifications.target_user_id is 'When set, the notification is a direct message visible only to this user (e.g. join request approved/declined).';
