-- ============================================================================
-- Notification Service v2
--
-- 1. Replace the legacy string audience with a JSONB AudienceRule.
-- 2. Preserve existing notification visibility semantics.
-- 3. Add notification_cursors for the watermark-based unread badge.
-- ============================================================================

-- 1. Remove the old audience CHECK constraint.

alter table notifications
  drop constraint if exists notifications_audience_check;

-- 2. Convert the existing audience column to JSONB.

alter table notifications
  alter column audience drop default;

alter table notifications
  alter column audience type jsonb
  using (
    case
      when target_user_id is not null then
        jsonb_build_object(
          'kind', 'direct_user',
          'userId', target_user_id
        )

      when audience::text = 'all'
           and championship_id is not null then
        jsonb_build_object(
          'kind', 'everyone',
          'championshipId', championship_id
        )

      when audience::text = 'organizations_captains'
           and championship_id is not null then
        jsonb_build_object(
          'kind', 'role',
          'role', 'captain',
          'championshipId', championship_id
        )

      when audience::text = 'org_admins'
           and organization_id is not null then
        jsonb_build_object(
          'kind', 'org_admins',
          'organizationId', organization_id
        )

      else
        jsonb_build_object(
          'kind', 'everyone',
          'championshipId', championship_id
        )
    end
  );

-- 3. Add notification cursors.

create table if not exists notification_cursors (
  user_id uuid primary key
    references users(id) on delete cascade,

  last_seen_at timestamptz not null default 'epoch',

  last_clicked_notification_id uuid
    references notifications(id) on delete set null,

  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_cursors_user
  on notification_cursors (user_id);

-- 4. Documentation.

comment on column notifications.audience is
  'JSONB AudienceRule describing notification visibility';

comment on table notification_cursors is
  'Per-user notification feed watermark used for unread/badge calculations';