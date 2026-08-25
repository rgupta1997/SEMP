-- ============================================================================
-- EOS Wave 0.5 - organisation tenancy, email-first auth and the audit trail
--
-- Three things land together because the first auth flow needs all of them:
--
--   1. `organizations` becomes a *tenant* rather than a directory row - it gains a
--      tier (`kind`), a verification flag, a settings bag and an owner stamp.
--   2. `org_domains` maps an email domain to exactly one organisation, which is what
--      lets sign-in identify where a person belongs from their address alone.
--   3. `auth_tokens` backs one-time codes / reset links / invites, and `audit_log`
--      records privileged actions from the very first one (see docs/eos/epics/
--      01-execution-order.md - the audit table must precede the first consequential
--      action, because history cannot be retrofitted).
--
-- Still no RLS anywhere, deliberately and consistently with the previous 27
-- migrations. Tenant isolation is enforced in the route layer; narrowing
-- `GET /organizations` is tracked as J6-E5.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Organisation tiers
--     community   - the lightweight thing that exists today; anyone can create one
--     institution - a *verified* org with the full workspace (domains, reports, ...)
--     personal    - a hidden one-person org for solo entrants (J3-E1, not yet used)
--
-- Every existing row backfills to 'community' / verified=false. Promotion to the
-- institution tier is a deliberate super-admin action, never a migration guess -
-- the Verified badge is a trust signal and must not be self-issued.
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists kind       varchar not null default 'community',
  add column if not exists verified   boolean not null default false,
  add column if not exists settings   jsonb   not null default '{}'::jsonb,
  add column if not exists created_by uuid references users(id) on delete set null;

alter table organizations
  drop constraint if exists organizations_kind_check;
alter table organizations
  add constraint organizations_kind_check check (kind in ('community', 'institution', 'personal'));

-- Discover/directory reads filter on the tier; personal orgs never appear.
create index if not exists idx_organizations_kind on organizations(kind);

-- ---------------------------------------------------------------------------
-- 2. Email domain -> organisation
--
-- The unique index is on the domain ALONE, not (organization_id, domain): one domain
-- maps to at most one organisation, and that is precisely what makes identification
-- at sign-in deterministic.
--
-- `verified` defaults to true because rows are currently created only by a platform
-- super-admin (/api/org-domains, super-admin guarded), and such a row is pre-verified
-- by definition. The column exists so a future org-admin self-claim can land as false
-- and be approved without a schema change - sign-in honours verified = true only.
-- ---------------------------------------------------------------------------

create table if not exists org_domains (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain          varchar not null,                  -- bare host, lower-cased: 'iimb.ac.in'
  verified        boolean not null default true,     -- only verified domains route sign-in
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_org_domains_domain on org_domains (lower(domain));
create index if not exists idx_org_domains_org on org_domains (organization_id);

-- ---------------------------------------------------------------------------
-- 3. Single-use auth tokens - one-time codes, password resets, invitations
--
-- Keyed by EMAIL rather than user_id, with user_id nullable: a first-time visitor
-- verifies a code before their `users` row exists. Only the sha256 hash of the code
-- is ever stored, so a database read cannot be replayed as a sign-in.
--
-- `attempts` serves two purposes: it invalidates a code after N wrong tries, and the
-- row count per address over a window is the real (DB-backed) rate limit - an
-- in-process limiter is per-container on Lambda and therefore best-effort only.
-- ---------------------------------------------------------------------------

create table if not exists auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  email       varchar not null,                      -- lower-cased address the token was issued to
  user_id     uuid references users(id) on delete cascade,  -- null until the account exists
  kind        varchar not null,                      -- 'otp' | 'password_reset' | 'invite'
  token_hash  varchar not null,                      -- sha256 of the code/token, never the value
  expires_at  timestamptz not null,
  consumed_at timestamptz,                           -- set once; a consumed token is dead
  attempts    integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table auth_tokens
  drop constraint if exists auth_tokens_kind_check;
alter table auth_tokens
  add constraint auth_tokens_kind_check check (kind in ('otp', 'password_reset', 'invite'));

-- Lookup of the newest live token for an address, and the rate-limit window scan.
create index if not exists idx_auth_tokens_email_kind on auth_tokens (lower(email), kind, created_at desc);
create index if not exists idx_auth_tokens_expires on auth_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- 4. Audit trail (FR-ADM-2)
--
-- Append-only BY CONVENTION: nothing in the API updates or deletes these rows, and
-- no route is written that could. `metadata` carries the before/after of whatever
-- changed, so the shape does not need a migration each time a new action is audited.
-- ---------------------------------------------------------------------------

create table if not exists audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references users(id) on delete set null,          -- null = system/unauthenticated
  organization_id uuid references organizations(id) on delete set null,  -- tenant the action belongs to
  action          varchar not null,                  -- 'org_domain.create', 'auth.otp_signup', ...
  entity_type     varchar,                           -- 'org_domains', 'organizations', ...
  entity_id       uuid,
  summary         text,                              -- human-readable one-liner for the admin view
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_log_created on audit_log (created_at desc);
create index if not exists idx_audit_log_org on audit_log (organization_id, created_at desc);
create index if not exists idx_audit_log_entity on audit_log (entity_type, entity_id);
create index if not exists idx_audit_log_actor on audit_log (actor_user_id, created_at desc);
