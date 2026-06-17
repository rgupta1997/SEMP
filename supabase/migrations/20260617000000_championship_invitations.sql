-- ============================================================================
-- Championship invitations
--   A host invites an organization to a championship by name + POC mobile,
--   before that org (or its POC user) necessarily exists on the platform.
--
--   The invited POC sees pending invitations on login (matched by phone number),
--   and accepting creates a pending row in championship_organizations — which then
--   surfaces in the host's Approvals queue, exactly like a self-application.
--
-- Visibility is enforced in the route layer (invitations.routes.ts); RLS remains
-- deferred platform-wide, consistent with the rest of the schema. Idempotent so
-- it can be re-applied safely.
-- ============================================================================

create table if not exists championship_invitations (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references championships(id) on delete cascade,
  org_name        varchar not null,
  poc_mobile      varchar not null,
  status          varchar not null default 'pending'
                    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  invited_by      uuid not null references users(id) on delete cascade,
  -- Resolved once the POC accepts (picks which org they represent):
  organization_id uuid references organizations(id) on delete set null,
  accepted_by     uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  responded_at    timestamptz
);

create index if not exists idx_championship_invitations_championship on championship_invitations (championship_id);
create index if not exists idx_championship_invitations_mobile       on championship_invitations (poc_mobile);

comment on table championship_invitations is 'Host invitations to organizations by name + POC mobile; the POC sees them on login and accepting creates a pending championship_organizations enrollment.';
