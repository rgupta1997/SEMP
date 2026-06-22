-- "Book a demo" leads captured from the public Sportagon EOS landing page.
--
-- The landing page is unauthenticated, so the create endpoint is public; reading,
-- triaging and deleting these rows is restricted to platform super-admins. This is
-- a standalone capture table - it references no other entity and is never exposed
-- to ordinary users.

create table if not exists demo_requests (
  id            uuid primary key default gen_random_uuid(),
  name          varchar not null,
  email         varchar not null,
  organization  varchar,                       -- the visitor's organization / school
  role          varchar,                        -- self-described role (Sports Secretary, PE Teacher, …)
  sport         varchar,                        -- primary sport they run
  phone         varchar,
  message       text,                           -- optional free-text note from the visitor
  status        varchar not null default 'new', -- triage state: 'new' | 'contacted' | 'scheduled' | 'closed'
  handled_by    uuid references users(id) on delete set null, -- admin who last triaged it
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Admin list is ordered newest-first; index supports that scan.
create index if not exists idx_demo_requests_created on demo_requests(created_at desc);
create index if not exists idx_demo_requests_status on demo_requests(status);
