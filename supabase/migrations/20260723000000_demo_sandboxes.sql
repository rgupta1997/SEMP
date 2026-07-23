-- Demo sandboxes: personalized, isolated demo environments a super-admin spins up
-- per client (4 championships at different lifecycle stages, client-branded teams,
-- orgs and users). The manifest records every created row id so Reset/Delete can
-- wipe the sandbox even after the client mutates it mid-demo.

create table if not exists demo_sandboxes (
  id                 uuid primary key default gen_random_uuid(),
  client_name        varchar not null,                    -- "Tata"
  slug               varchar not null unique,             -- "tata-4f2a": namespace for slugs/org codes
  email_domain       varchar not null unique,             -- "tata.com": all demo logins; one active sandbox per client
  brand_color        varchar,                             -- hex, stored for future theming
  config             jsonb not null default '{}',         -- personalization payload; reset re-seeds from this
  manifest           jsonb not null default '{}',         -- { "<table>": [ids...] } written incrementally during seeding
  organiser_user_id  uuid references users(id) on delete set null,
  organiser_email    varchar not null,
  organiser_password varchar,                             -- shared demo password; null when attached to an existing user
  status             varchar not null default 'seeding',  -- seeding|ready|resetting|deleting|error
  error              text,                                -- last failure message, when status='error'
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seeded_at     timestamptz
);

create index if not exists idx_demo_sandboxes_created on demo_sandboxes(created_at desc);
