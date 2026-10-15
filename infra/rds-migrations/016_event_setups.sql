-- Event setups: the super-admin "Event Setup" dashboard's record of one event built
-- from the standard workbook - the RDS twin of
-- supabase/migrations/20261015120000_event_setups.sql (same body).
--
-- STATUS: NOT APPLIED. Written 2026-10-15.
--
-- One table + one index. `credentials` holds handed-out logins, so RLS is on with no
-- policy: deny-all to every role but the owner the API connects as, exactly as on
-- Supabase. Idempotent: safe to run twice.

create table if not exists event_setups (
  id               uuid primary key default gen_random_uuid(),
  label            varchar(120) not null,
  event_type       varchar(16) not null,
  status           varchar(16) not null default 'draft',
  steps            jsonb not null,
  file_name        text,
  workbook         jsonb,                 -- { sheets: { <name>: string[][] } } as uploaded
  validation       jsonb,                 -- SetupValidationResult (issues, summary, blueprint)
  platform         jsonb,                 -- { steps: SetupPlatformStep[], issues: SetupIssue[] }
  blueprint_key    varchar(160),
  manifest         jsonb not null default '{}',
  apply_report     jsonb,                 -- [{ step, mode, found, created, notes }]
  verify_report    jsonb,                 -- { checked, failures, at }
  credentials      jsonb,                 -- [{ name, role, contact, phone, email, password|null }]
  organization_id  uuid references organizations(id) on delete set null,
  championship_id  uuid references championships(id) on delete set null,
  error            text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  applied_at       timestamptz,
  constraint event_setups_event_type_check check (event_type in ('intra', 'inter', 'campus')),
  constraint event_setups_status_check
    check (status in ('draft', 'invalid', 'validated', 'applying', 'applied', 'failed', 'undone'))
);

create index if not exists idx_event_setups_created on event_setups (created_at desc);

alter table event_setups enable row level security;
