-- User feedback captured from the public championship pages and the in-app shell.
--
-- The public share pages are unauthenticated, so the create endpoint is public; when a
-- signed-in user submits, their id is captured too. Reading, triaging and deleting these
-- rows is restricted to platform super-admins. Mirrors the demo_requests capture table.

create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  message         text not null,
  name            varchar,                         -- optional name the sender gave
  email           varchar,                         -- optional reply-to email
  context         varchar,                         -- where it came from (app path or 'public:<token>')
  championship_id uuid references championships(id) on delete set null, -- related championship, if any
  user_id         uuid references users(id) on delete set null,         -- signed-in sender, if any
  status          varchar not null default 'new',  -- triage state: 'new' | 'reviewing' | 'resolved' | 'closed'
  handled_by      uuid references users(id) on delete set null,         -- admin who last triaged it
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Admin list is ordered newest-first; index supports that scan.
create index if not exists idx_feedback_created on feedback(created_at desc);
create index if not exists idx_feedback_status on feedback(status);
