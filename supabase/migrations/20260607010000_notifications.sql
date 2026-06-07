-- ============================================================================
-- Event notifications
--   * notifications          : event-scoped messages with an audience + type.
--   * notification_reactions : toggleable emoji reactions (one row per user/emoji).
--   * notification_reads     : per-user read receipts (powers the unread badge).
--
-- Visibility is enforced in the route layer (see notifications.routes.ts +
-- audience.ts) — RLS is still deferred platform-wide, consistent with the rest
-- of the schema. Idempotent so it can be re-applied safely.
-- ============================================================================

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  sender_id  uuid references users(id) on delete set null,   -- null = system-generated
  type       varchar not null default 'manual'
               check (type in ('manual', 'event_lifecycle', 'enrollment_approved')),
  audience   varchar not null default 'all'
               check (audience in ('all', 'institutions_captains')),
  title      varchar not null,
  body       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_event_id      on notifications (event_id);
create index if not exists idx_notifications_event_created on notifications (event_id, created_at desc);

comment on table notifications is 'Event-scoped notifications; audience controls who can see each message';

create table if not exists notification_reactions (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  reaction        varchar not null,            -- emoji, one of the allowed set
  created_at      timestamptz not null default now(),
  unique (notification_id, user_id, reaction)
);

create index if not exists idx_notification_reactions_notification_id on notification_reactions (notification_id);

create table if not exists notification_reads (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  unique (notification_id, user_id)
);

create index if not exists idx_notification_reads_user on notification_reads (user_id);
