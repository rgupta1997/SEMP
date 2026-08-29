-- ============================================================================
-- An organisation can now ASK to be verified
--
-- `organizations.verified` has existed since 20260815000000 and there was no route
-- to it. Administration → Organization Profile listed the four things verification
-- asks for and then said "Contact play@sportagon.in to start it", with a comment on
-- the missing button that was honest about why: "Deliberately not a 'Request
-- verification' button yet: nothing routes such a request to anyone, and a button
-- that silently does nothing is worse than a sentence telling you who to talk to."
--
-- This table is what routes it. The submission carries the details the reviewer
-- needs to answer the only question verification asks - is this institution what it
-- says it is - and the platform side approves or rejects with a note.
--
-- Shaped after `demo_requests` and `feedback`, which is deliberate: a super-admin
-- triage queue is a solved problem here, and a third shape would mean a third page
-- that behaves differently for no reason. What is NOT copied is who may create a
-- row: those two are public capture tables, and this one is written only by
-- somebody who already manages the organisation being vouched for.
--
-- Approval sets `organizations.verified = true` in the same transaction as the
-- status, in the API. Verification is a TRUST SIGNAL and not an access gate - an
-- unverified organisation runs events, enters championships and issues certificates
-- exactly as a verified one does - so nothing else moves when this flips.
-- ============================================================================

create table if not exists org_verification_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,

  -- ---- the authorised contact -------------------------------------------
  -- "Someone Sportagon can reach about this account" is step 2 of the four the
  -- profile screen already lists, so it is asked for here rather than inferred from
  -- whoever happened to click the button.
  contact_name      varchar not null,
  contact_role      varchar,                  -- their designation at the institution
  contact_email     varchar not null,
  contact_phone     varchar,

  -- ---- the institution ---------------------------------------------------
  -- `registered_name` is separate from organizations.name on purpose: a workspace is
  -- called "IIMB Sports" and the entity on the certificate of registration is
  -- "Indian Institute of Management Bangalore". The reviewer is checking the second.
  registered_name   varchar,
  registration_id   varchar,                  -- affiliation / registration / UDISE number
  website           varchar,
  address           text,

  -- A link to something the reviewer can look at. A URL rather than an upload
  -- because there is no file store in this product yet, and inventing one inside a
  -- verification form is how a feature ends up owning infrastructure.
  document_url      text,
  note              text,

  -- ---- lifecycle ---------------------------------------------------------
  -- 'withdrawn' is the organisation's own cancel; 'rejected' is the platform's
  -- answer. Keeping them apart matters when somebody asks why a request is closed.
  status            varchar not null default 'pending',
  submitted_by      uuid references users(id) on delete set null,
  reviewed_by       uuid references users(id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,                     -- what the platform said, shown to the org
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table org_verification_requests drop constraint if exists org_verification_requests_status_check;
alter table org_verification_requests add constraint org_verification_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn'));

-- ONE OPEN REQUEST PER ORGANISATION. A partial unique index rather than a check in
-- the route, because two clicks on a slow connection is the ordinary way a queue
-- fills up with duplicates - and a reviewer looking at two identical submissions
-- cannot tell which one the organisation means.
--
-- Closed requests are not unique: an organisation whose first attempt was rejected
-- must be able to submit a better one, and the history of both is the audit trail
-- for why the tick was eventually given.
create unique index if not exists uq_org_verification_open
  on org_verification_requests (organization_id)
  where status = 'pending';

-- The platform queue is ordered newest-first and filtered by status.
create index if not exists idx_org_verification_created on org_verification_requests (created_at desc);
create index if not exists idx_org_verification_status on org_verification_requests (status);
-- The organisation's own screen reads its latest request.
create index if not exists idx_org_verification_org on org_verification_requests (organization_id, created_at desc);

-- ---- notifications ---------------------------------------------------------
--
-- `notifications.type` is pinned by a check constraint, so the registry in
-- packages/notifications is only half the definition: adding a key there and not
-- here produces a 500 at the moment somebody uses the feature. The constraint is
-- rebuilt rather than dropped - an unconstrained `type` would let a typo become a
-- notification nothing knows how to render.
--
-- Both decisions are announced to the organisation's owners and admins. The REQUEST
-- itself is not announced to anybody: it goes to a platform queue that has a page,
-- and there is no super-admin audience rule to send it to.

alter table notifications drop constraint if exists notifications_type_check;

alter table notifications add constraint notifications_type_check
  check (type in (
    'manual',
    'event_lifecycle',
    'enrollment_requested',
    'enrollment_approved',
    'enrollment_rejected',
    'enrollment_joined',
    'entry_submitted',
    'contingent_added',
    'org_join_request',
    'org_join_approved',
    'org_join_declined',
    'org_invitation',
    -- New: the platform answered a verification request.
    'org_verification_approved',
    'org_verification_rejected',
    'claim_submitted',
    'claim_approved',
    'claim_rejected',
    'plan_changed',
    'plan_downgrade_scheduled',
    'plan_downgrade_applied',
    'plan_upgrade_requested'
  ));
