-- ============================================================================
-- Plans, subscriptions and invoices
--
-- 20260825000040 added the `tier` enum and the two columns the entitlement guard
-- reads - organizations.plan and users.personal_plan. Those columns stay exactly
-- where they are and keep exactly that job: they are the RESOLVED tier, the one
-- value every gated request compares against.
--
-- What was missing was everything behind them. A tier column alone cannot say
-- who bought it, when it renews, what was charged, or what it should fall back
-- to when the period ends. This migration adds that record, and nothing else:
--
--   subscriptions        - the agreement. One live row per holder.
--   invoices             - what was charged, with GST, and the number it was
--                          charged under.
--   subscription_events  - the audit trail. Every plan change, who did it, why.
--
-- The resolved column is written BY the subscription, never independently. That
-- direction matters: making the guard read through a join would have put a query
-- on the hot path of every gated request, and making the two independent would
-- have let them disagree about what a customer has paid for.
--
-- Payment is deliberately absent. `provider` is 'none' until a gateway is wired,
-- at which point the only change is that the row is created by a webhook instead
-- of by the subscribe route - the shape it writes is already here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'billing_period') then
    create type billing_period as enum ('monthly', 'annual');
  end if;
end $$;

-- Deliberately NOT an ordered comparison like `tier` - these are states, and
-- nothing should ever ask whether 'cancelled' is greater than 'active'.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type subscription_status as enum (
      'active',              -- running, renews at period end
      'pending_downgrade',   -- running, but drops to `pending_plan` at period end
      'cancelled',           -- superseded by a newer subscription, or ended early
      'expired'              -- ran to its end with nothing to follow it
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Billing contact, on the organisation
--
-- Held here rather than on the subscription because it survives a plan change:
-- an institution's GSTIN does not change because it moved from Pro to
-- Enterprise, and re-entering it at every renewal is how a wrong one gets typed.
-- The invoice COPIES these at issue time, so a later correction never rewrites
-- a document already sent.
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists billing_name    text,
  add column if not exists billing_email   text,
  add column if not exists billing_phone   text,
  add column if not exists billing_address text,
  add column if not exists billing_gstin   text,
  -- The state whose GST applies. Two characters, the GSTIN state code - it
  -- decides CGST+SGST against IGST, which is a split this product does not make
  -- yet but which the invoice must be able to record when it does.
  add column if not exists billing_state_code text;

comment on column organizations.billing_gstin is
  'Buyer GSTIN, copied onto each invoice at issue time so a later correction never rewrites a document already sent.';

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),

  -- Which ladder this agreement is on. The two are independent - an institution
  -- on Enterprise grants its players nothing, and vice versa - so they are two
  -- rows here, never one.
  ladder text not null check (ladder in ('org', 'personal')),

  organization_id uuid references organizations(id) on delete cascade,
  user_id         uuid references users(id)         on delete cascade,

  plan   tier            not null,
  period billing_period  not null,
  status subscription_status not null default 'active',

  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null,

  -- The scheduled downgrade. A downgrade does not take effect on confirmation:
  -- the customer paid for the period they are in and keeps it. Both columns are
  -- set together or neither is.
  pending_plan         tier,
  pending_effective_at timestamptz,

  -- 'none' while checkout is a formality. When a gateway is wired this becomes
  -- 'razorpay' (or whichever) and provider_ref holds its subscription id.
  provider     text not null default 'none',
  provider_ref text,

  created_by uuid references users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A subscription belongs to exactly one holder, and the holder must match the
  -- ladder. Enforced here rather than in the service because a row that belongs
  -- to both an org and a person cannot be reasoned about by anything that
  -- later reads this table.
  constraint subscriptions_holder_matches_ladder check (
    (ladder = 'org'      and organization_id is not null and user_id is null) or
    (ladder = 'personal' and user_id is not null and organization_id is null)
  ),

  -- pending_plan and pending_effective_at travel together, and a pending
  -- downgrade must be reflected in the status - otherwise the sweep that applies
  -- due changes and the panel that renders them disagree about what is scheduled.
  constraint subscriptions_pending_is_complete check (
    (pending_plan is null and pending_effective_at is null) or
    (pending_plan is not null and pending_effective_at is not null)
  ),
  constraint subscriptions_pending_matches_status check (
    (status = 'pending_downgrade') = (pending_plan is not null)
  ),

  constraint subscriptions_period_is_forward check (current_period_end > current_period_start)
);

-- One LIVE subscription per holder. Partial, so the history of cancelled and
-- expired rows is kept - which is what makes "what did they have last March?"
-- an answerable question.
create unique index if not exists idx_subscriptions_one_live_per_org
  on subscriptions (organization_id)
  where status in ('active', 'pending_downgrade') and organization_id is not null;

create unique index if not exists idx_subscriptions_one_live_per_user
  on subscriptions (user_id)
  where status in ('active', 'pending_downgrade') and user_id is not null;

-- The sweep's only query: which live subscriptions are due a change or a
-- renewal? Partial so it stays small however much history accumulates.
create index if not exists idx_subscriptions_due
  on subscriptions (current_period_end)
  where status in ('active', 'pending_downgrade');

comment on table subscriptions is
  'The billing agreement behind organizations.plan / users.personal_plan. Those columns remain the resolved tier the entitlement guard reads; this table says who bought it, until when, and what it falls back to.';

-- ---------------------------------------------------------------------------
-- invoices
--
-- Every field the buyer needs is COPIED, not joined: an invoice is a document as
-- it was issued, and a join would let a later edit to the organisation silently
-- restate a figure somebody has already paid.
-- ---------------------------------------------------------------------------

create sequence if not exists invoice_number_seq;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,

  -- SPG/2026-27/000123. The financial year is the Indian one (April to March),
  -- computed by the service that issues it; the sequence guarantees the tail is
  -- never reused, and the unique index guarantees the whole string is not either.
  number text not null,

  ladder text not null check (ladder in ('org', 'personal')),
  organization_id uuid references organizations(id) on delete set null,
  user_id         uuid references users(id)         on delete set null,

  plan   tier           not null,
  period billing_period not null,

  currency text not null default 'INR',
  -- Money in paise, integer. Nothing in this table is a float: a rupee amount
  -- held as a double eventually prints a total that does not equal its lines.
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_rate_bp    integer not null default 1800 check (tax_rate_bp >= 0),
  tax_paise      bigint not null check (tax_paise >= 0),
  total_paise    bigint not null check (total_paise >= 0),

  -- The buyer, as printed.
  buyer_name       text,
  buyer_email      text,
  buyer_address    text,
  buyer_gstin      text,
  place_of_supply  text,

  -- SaaS. 998314 is the SAC for information technology consulting and support.
  sac_code text not null default '998314',

  status text not null default 'paid' check (status in ('paid', 'due', 'void')),
  -- 'none' until a gateway exists. An invoice marked paid with provider 'none'
  -- is honest about what happened: access was granted without money moving.
  provider     text not null default 'none',
  provider_ref text,

  issued_at timestamptz not null default now(),
  paid_at   timestamptz,
  created_at timestamptz not null default now(),

  constraint invoices_totals_add_up check (total_paise = subtotal_paise + tax_paise),
  constraint invoices_holder_matches_ladder check (
    (ladder = 'org'      and organization_id is not null) or
    (ladder = 'personal' and user_id is not null)
  )
);

create unique index if not exists idx_invoices_number on invoices (number);
create index if not exists idx_invoices_subscription on invoices (subscription_id, issued_at desc);
create index if not exists idx_invoices_org  on invoices (organization_id, issued_at desc) where organization_id is not null;
create index if not exists idx_invoices_user on invoices (user_id, issued_at desc) where user_id is not null;

comment on constraint invoices_totals_add_up on invoices is
  'The printed lines must add up. Rounding the total separately from the tax is how they stop doing so, so the database refuses it.';

-- ---------------------------------------------------------------------------
-- subscription_events - the audit trail
--
-- Upgrades leave an invoice; downgrades and cancellations do not, and without
-- this table they would leave nothing at all. "Who put us back on Free, and
-- when?" has to be answerable.
-- ---------------------------------------------------------------------------

create table if not exists subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,

  kind text not null check (kind in (
    'subscribed',            -- first purchase on this ladder
    'upgraded',              -- moved up, effective at once
    'downgrade_scheduled',   -- will move down at period end
    'downgrade_cancelled',   -- changed their mind before it landed
    'downgrade_applied',     -- the sweep moved them down
    'renewed',               -- period rolled forward on the same plan
    'cancelled'              -- ended, back to free
  )),

  from_plan tier,
  to_plan   tier,
  -- Null when the actor is the sweep rather than a person. That distinction is
  -- the point of the column: "the system did this on schedule" and "somebody
  -- chose this" are different answers to the same question.
  actor_id uuid references users(id) on delete set null,
  note text,
  effective_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_subscription_events_sub
  on subscription_events (subscription_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notification types
--
-- The type list is a CHECK constraint (see 20260817030000) so an unknown type is
-- rejected at write time rather than found later as an unrenderable row in
-- somebody's feed. Adding to it means restating it.
-- ---------------------------------------------------------------------------

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'manual', 'event_lifecycle',
    'enrollment_requested', 'enrollment_approved', 'enrollment_rejected', 'enrollment_joined',
    'entry_submitted',
    'org_join_request', 'org_join_approved', 'org_join_declined',
    'org_invitation',
    'claim_submitted', 'claim_approved', 'claim_rejected',
    -- Billing. Four types rather than one, for the same reason the claim types
    -- are three: they go to different people and say different things. The
    -- request is the one that earns its place - somebody who cannot buy still
    -- has to be able to ask, and a wall with no route out of it is a dead end.
    'plan_changed',
    'plan_downgrade_scheduled',
    'plan_downgrade_applied',
    'plan_upgrade_requested'
  ));

-- ---------------------------------------------------------------------------
-- Backfill: a subscription row for every organisation and user already above
-- free, so the two representations agree from the first read.
--
-- Anything on free is left without a row on purpose. Free is the absence of a
-- subscription, not a subscription costing nothing - giving every account a row
-- would mean the sweep walks every user in the product to find nothing to do.
-- ---------------------------------------------------------------------------

insert into subscriptions (ladder, organization_id, plan, period, status, current_period_end, provider)
select 'org', o.id, o.plan, 'annual', 'active', now() + interval '1 year', 'none'
from organizations o
where o.plan <> 'free'
  and not exists (
    select 1 from subscriptions s
    where s.organization_id = o.id and s.status in ('active', 'pending_downgrade')
  );

insert into subscriptions (ladder, user_id, plan, period, status, current_period_end, provider)
select 'personal', u.id, u.personal_plan, 'annual', 'active', now() + interval '1 year', 'none'
from users u
where u.personal_plan <> 'free'
  and not exists (
    select 1 from subscriptions s
    where s.user_id = u.id and s.status in ('active', 'pending_downgrade')
  );

-- RLS is enabled across this schema (see the notification_deliveries migration
-- and the RLS gap note). These three tables carry money and are read only
-- through the API's own guards, so they are enabled with no policy: nothing
-- reaches them except the service role.
alter table subscriptions       enable row level security;
alter table invoices            enable row level security;
alter table subscription_events enable row level security;
