-- Event-scoped officials: assigns officials to specific events so organizers
-- can only see/manage officials for their own events.
create table if not exists event_officials (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  assigned_by uuid references users(id),
  assigned_at timestamptz not null default now(),
  is_active   boolean not null default true,
  notes       text,
  
  unique(event_id, user_id)
);

create index if not exists idx_event_officials_event_id on event_officials(event_id);
create index if not exists idx_event_officials_user_id on event_officials(user_id);

comment on table event_officials is 'Officials assigned to specific events - enables multi-tenant isolation';
