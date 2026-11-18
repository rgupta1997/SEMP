-- Razorpay checkout: one row per payment attempt.
--
-- A purchase used to be a single write (subscribe -> subscription + invoice +
-- tier). With a gateway it becomes two steps with money in between:
--
--   1. checkout  - the server prices the purchase, creates a Razorpay order for
--                  that exact amount and records it here as 'created'.
--   2. settle    - Razorpay confirms payment (the browser's signed callback, the
--                  webhook, or the reconcile sweep - whichever arrives first).
--                  The row is claimed 'created' -> 'paid' with ONE conditional
--                  update inside the same transaction that grants the plan, so
--                  the three confirmations can race and exactly one wins.
--
-- What is being bought is frozen here at checkout (plan, period, list price,
-- coupon, total). Settlement grants what was PAID FOR, never a re-priced
-- version: the catalogue can change between the two, the payment cannot.
--
-- Additive only: a new table. Code built before this never reads it.

create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),

  provider            text not null default 'razorpay',
  provider_order_id   text not null,
  provider_payment_id text,

  -- What is being bought. Only plan subscriptions today; event passes will
  -- widen this check.
  kind   text not null default 'subscription' check (kind in ('subscription')),
  ladder text not null check (ladder in ('org', 'personal')),
  organization_id uuid references organizations(id) on delete cascade,
  user_id         uuid references users(id) on delete cascade,
  plan   tier not null,
  period billing_period not null,

  -- Paise. list - discount = subtotal; subtotal + GST = total (what Razorpay charges).
  list_price_paise bigint not null,
  discount_paise   bigint not null default 0,
  coupon_code      text,
  total_paise      bigint not null check (total_paise > 0),

  --   created        - order exists at Razorpay, nothing paid yet
  --   paid           - settled: plan granted, invoice issued
  --   settle_failed  - money was taken but granting failed; needs a human (see error)
  --   expired        - never paid; swept after the order went stale
  status text not null default 'created'
    check (status in ('created', 'paid', 'settle_failed', 'expired')),
  error text,

  subscription_id uuid references subscriptions(id) on delete set null,
  invoice_id      uuid references invoices(id) on delete set null,

  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at    timestamptz,

  constraint payment_orders_holder_matches_ladder check (
    (ladder = 'org'      and organization_id is not null) or
    (ladder = 'personal' and user_id is not null)
  )
);

create unique index if not exists idx_payment_orders_provider_order on payment_orders (provider, provider_order_id);
-- The reconcile sweep reads only unsettled rows.
create index if not exists idx_payment_orders_open on payment_orders (created_at) where status = 'created';
create index if not exists idx_payment_orders_org  on payment_orders (organization_id, created_at desc) where organization_id is not null;
create index if not exists idx_payment_orders_user on payment_orders (user_id, created_at desc) where user_id is not null;

-- Same posture as every other table: RLS on, the API connects as owner.
alter table payment_orders enable row level security;
