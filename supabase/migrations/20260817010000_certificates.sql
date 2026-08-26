-- Certificates (J4-E6, J4-E7, J4-E8).
--
-- A certificate is the artefact an institution hands to a person and that person shows
-- to somebody else. Three properties follow from that and they drive this whole schema:
--
--   1. It must be VERIFIABLE by a stranger. Hence a public token and a signature over
--      the facts, so "is this real?" is answerable without an account and without
--      trusting the PDF in front of you.
--   2. Its number must be GAPLESS. An institution that issues CERT-26-FOOT-0001 and
--      then CERT-26-FOOT-0003 cannot answer "what happened to 0002?", and a register
--      with holes in it is not a register. The sequence is allocated in the database,
--      inside the same transaction as the row, so a crashed batch cannot burn numbers.
--   3. It must be REVOCABLE without being erasable. A certificate issued from a result
--      that was later corrected has to stop verifying, but the fact that it existed is
--      part of the record - so revocation is a state, never a delete.

-- ---------------------------------------------------------------------------
-- 1. Templates (J4-E6)
-- ---------------------------------------------------------------------------
create table if not exists certificate_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            varchar(160) not null,
  -- What the certificate says and how it looks. Kept as JSON rather than columns
  -- because a template is content, and every institution wants a different sentence.
  design          jsonb not null default '{}',
  -- The code that becomes the middle of the serial: CERT-26-<CODE>-0001.
  code            varchar(8),
  is_default      boolean not null default false,
  archived_at     timestamptz,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_certificate_templates_org on certificate_templates(organization_id, archived_at);

-- One default per institution, enforced rather than hoped for: two defaults means the
-- generator picks arbitrarily and nobody can explain which template was used.
create unique index if not exists uq_certificate_template_default
  on certificate_templates(organization_id) where is_default and archived_at is null;

-- ---------------------------------------------------------------------------
-- 2. The gapless sequence (J4-E7)
-- ---------------------------------------------------------------------------
-- A counter per (organisation, year, code) rather than a Postgres sequence: sequences
-- are explicitly NOT gapless (a rolled-back transaction burns its number), which is the
-- one property this has to have. The row is locked for the length of the allocation, so
-- a 300-certificate batch takes the lock 300 times briefly rather than once for the
-- whole run - concurrent batches interleave instead of blocking each other out.
create table if not exists certificate_counters (
  organization_id uuid not null references organizations(id) on delete cascade,
  year            smallint not null,
  code            varchar(8) not null,
  next_number     integer not null default 1,
  primary key (organization_id, year, code)
);

create or replace function next_certificate_number(p_org uuid, p_year smallint, p_code varchar)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into certificate_counters (organization_id, year, code, next_number)
       values (p_org, p_year, p_code, 1)
  on conflict (organization_id, year, code) do update
          set next_number = certificate_counters.next_number + 1
    returning next_number into n;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The certificates themselves
-- ---------------------------------------------------------------------------
create table if not exists certificates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id     uuid references certificate_templates(id),
  championship_id uuid references championships(id),
  fixture_id      uuid references fixtures(id),
  -- Who it is for. `recipient_name` is denormalised on purpose: a certificate says the
  -- name it was issued in, and that must not change when somebody later corrects their
  -- profile or the account is erased (J4-E10).
  user_id         uuid references users(id),
  recipient_name  varchar(200) not null,
  serial          varchar(40) not null,
  seq             integer not null,
  year            smallint not null,
  code            varchar(8) not null,
  -- The facts printed on it, frozen at issue. The signature is taken over exactly this.
  payload         jsonb not null default '{}',
  signature       varchar(64) not null,
  -- Public handle. Unguessable, so possession of a serial is not possession of a
  -- verification - a serial is printed on the artefact and is therefore not a secret.
  token           varchar(64) not null,
  issued_by       uuid references users(id),
  issued_at       timestamptz not null default now(),
  -- Revocation is a state. The row survives so the register stays gapless and so
  -- "this was issued and then withdrawn" remains answerable.
  revoked_at      timestamptz,
  revoked_by      uuid references users(id),
  revoked_reason  text,
  -- Which lock_version of the result it was issued from. A later correction supersedes
  -- the certificate, exactly as it supersedes the medal.
  lock_version    integer,
  superseded_at   timestamptz
);

create unique index if not exists uq_certificates_serial on certificates(organization_id, serial);
create unique index if not exists uq_certificates_token on certificates(token);
create index if not exists idx_certificates_org on certificates(organization_id, issued_at desc);
create index if not exists idx_certificates_user on certificates(user_id, issued_at desc);
create index if not exists idx_certificates_championship on certificates(championship_id);
-- One live certificate per person per fixture per template: re-running a batch must not
-- issue somebody a second copy of the same thing.
create unique index if not exists uq_certificates_one_per_recipient
  on certificates(fixture_id, user_id, template_id) where revoked_at is null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- 4. Verification log (J4-E8)
-- ---------------------------------------------------------------------------
-- Every scan is recorded. The design's "this verification record is logged immutably"
-- has to be true for the claim on the page to mean anything, so this table gets the
-- same append-only treatment as audit_log.
create table if not exists certificate_verifications (
  id             bigserial primary key,
  certificate_id uuid not null references certificates(id) on delete cascade,
  verified_at    timestamptz not null default now(),
  -- What the verifier saw, so a later dispute can be settled against what was true then.
  outcome        varchar(24) not null,
  ip             inet,
  user_agent     text
);
create index if not exists idx_certificate_verifications_cert on certificate_verifications(certificate_id, verified_at desc);

create or replace function certificate_verifications_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'certificate_verifications is append-only: % is not permitted', tg_op;
end $$;

drop trigger if exists trg_certificate_verifications_no_update on certificate_verifications;
create trigger trg_certificate_verifications_no_update
  before update or delete on certificate_verifications
  for each row execute function certificate_verifications_append_only();

revoke update, delete, truncate on certificate_verifications from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke update, delete, truncate on certificate_verifications from authenticated;
  end if;
end $$;
