-- Recipient-specific rows are the Realtime transport. A notification remains a
-- single canonical row; these rows contain no message content and are created
-- only for users matched by its stored AudienceRule.
create table if not exists notification_deliveries (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists idx_notification_deliveries_user_created
  on notification_deliveries (user_id, created_at desc);

-- The browser subscribes with a user_id filter, so no global notifications
-- insert is sent to every connected client.
do $$
begin
  alter publication supabase_realtime add table notification_deliveries;
exception
  when duplicate_object then null;
end $$;
