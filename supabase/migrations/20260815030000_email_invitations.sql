-- ============================================================================
-- J1-E3 · Invite the sports office team, by email
--
-- `user_invitations` already exists, but it is keyed on a MOBILE NUMBER and has no
-- token: the invitee is expected to sign in with that number one day, at which point
-- the invitation is silently applied. That works, but it cannot do what J1-E3 asks
-- for - "an invitation with a single-use expiring token, and an email containing the
-- acceptance link" - because there is nothing to put in a link.
--
-- Rather than add a fourth parallel invite mechanism, this widens the existing one:
-- an invitation may now be addressed by email AND carry a hashed, expiring token.
-- Phone-addressed invitations keep working exactly as before (the service that
-- auto-applies them is untouched), and `mobile` becomes optional because an
-- email-addressed invitation has no number to match on.
--
-- Only the hash of the token is stored, for the same reason as auth_tokens: reading
-- this table must not let anyone accept somebody else's invitation.
-- ============================================================================

alter table user_invitations
  add column if not exists email      varchar,
  add column if not exists token_hash varchar,
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

-- An email-addressed invitation has no mobile to key on.
alter table user_invitations alter column mobile drop not null;

-- Accepting resolves the invitation by its token, so that lookup is the hot path.
create unique index if not exists uq_user_invitations_token
  on user_invitations (token_hash) where token_hash is not null;
create index if not exists idx_user_invitations_email
  on user_invitations (lower(email), status) where email is not null;

-- An invitation must be addressed to somebody: one of the two, at least.
alter table user_invitations
  drop constraint if exists user_invitations_addressed_check;
alter table user_invitations
  add constraint user_invitations_addressed_check
  check (mobile is not null or email is not null);

-- 'revoked' joins pending/accepted so a withdrawn invitation is distinguishable from
-- one that was never sent.
alter table user_invitations
  drop constraint if exists user_invitations_status_check;
alter table user_invitations
  add constraint user_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'declined'));

-- ---------------------------------------------------------------------------
-- The invitee is told in-app, not only by email.
--
-- Email delivery is still bypassed (module 02 is not wired), so a notification is
-- what actually reaches somebody who already has an account - and it is the right
-- channel regardless: an invitation to join an institution belongs in the same
-- inbox as everything else the product tells you.
-- ---------------------------------------------------------------------------

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'manual', 'event_lifecycle', 'enrollment_approved',
    'org_join_request', 'org_join_approved', 'org_join_declined',
    'org_invitation'
  ));
