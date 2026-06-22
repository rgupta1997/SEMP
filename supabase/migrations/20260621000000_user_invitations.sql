-- ============================================================================
-- User invitations by mobile number
--   A general "invite a person to a role by their mobile number" - used to add
--   organization members, co-organisers and championship officials without
--   pre-creating a login. When that person signs up / logs in with the same
--   number, the pending invitation is auto-applied (see applyUserInvitations).
--
--   `mobile` stores the normalized last-10 digits so matching is an indexed exact
--   match (consistent with the championship_invitations last-10 approach).
--   Purely additive; no existing table/column is changed. Idempotent.
-- ============================================================================

create table if not exists user_invitations (
  id               uuid primary key default gen_random_uuid(),
  mobile           varchar not null,
  target_type      varchar not null
                     check (target_type in ('org_member', 'championship_organiser', 'championship_official')),
  target_id        uuid not null,
  role             varchar,
  invited_by       uuid not null references users(id) on delete cascade,
  status           varchar not null default 'pending'
                     check (status in ('pending', 'accepted', 'cancelled')),
  accepted_user_id uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  responded_at     timestamptz
);

create index if not exists idx_user_invitations_mobile on user_invitations (mobile, status);
create index if not exists idx_user_invitations_target on user_invitations (target_type, target_id);

comment on table user_invitations is 'Invite a person by mobile to an org-member / co-organiser / official role; auto-applied when they sign in with that number.';
