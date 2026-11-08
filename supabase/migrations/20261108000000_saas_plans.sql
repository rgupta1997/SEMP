-- SaaS plans: a fourth tier, an editable catalogue, per-event plans, add-ons and coupons.
--
-- SAFE TO APPLY UNDER A RUNNING API (local and beta share this database):
--   * everything is additive - new tables, nullable/defaulted columns, one enum value;
--   * nothing is renamed or dropped, and no existing row changes meaning;
--   * the one index is built CONCURRENTLY, so writes to championships are never blocked.
-- Apply with the runner's --direct flag (session connection):
--   npx tsx scripts/apply-migration.ts ../../supabase/migrations/20261108000000_saas_plans.sql --direct
--
-- ORDERING RULE for the new enum value: do not write 'starter' to any row until
-- the API that knows about it is deployed. Code built before this migration
-- cannot deserialise the value and would fail every read of that row.

-- 1. The fourth slot. BEFORE 'pro' so the native enum order stays the rank
--    order the guard relies on: free < starter < pro < max.
alter type tier add value if not exists 'starter' before 'pro';

-- 2. The editable catalogue. Empty tables mean "the code defaults" - the
--    product behaves exactly as before until somebody saves in the console.
create table if not exists plan_catalog (
  ladder      text        not null check (ladder in ('org', 'personal')),
  tier        tier        not null,
  -- PlanOverride (packages/entitlements/src/core/catalog.ts): name, tagline,
  -- price, eventPass, selfServe, offered, featured, adds, limits.
  overrides   jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references users(id) on delete set null,
  primary key (ladder, tier)
);

-- Single row: which plan includes each capability, and the platform-wide
-- plan settings (default org plan, default formats, grace days).
create table if not exists plan_catalog_settings (
  id          smallint    primary key default 1 check (id = 1),
  min_tiers   jsonb       not null default '{}'::jsonb,
  settings    jsonb       not null default '{}'::jsonb,
  version     bigint      not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references users(id) on delete set null
);
insert into plan_catalog_settings (id) values (1) on conflict (id) do nothing;

-- 3. Per-event plan (see core/eventPlan.ts).
alter table championships add column if not exists plan_tier        tier;
alter table championships add column if not exists plan_source      varchar(8) not null default 'org';
alter table championships add column if not exists plan_grace_until timestamptz;

-- Everything that exists before this ships is grandfathered: unlimited, never
-- locked. `plan_tier is null` keeps a re-run from touching events the new code
-- has already stamped.
update championships
   set plan_source = 'legacy'
 where plan_source = 'org'
   and plan_tier is null
   and created_at < timestamptz '2026-11-09 00:00:00+05:30';

-- The active-events count (host org, not archived, not finished) had no
-- covering index: idx_championships_host_org found the org's rows and the
-- status/archived filters ran on the heap. Partial index = only live rows.
create index concurrently if not exists idx_championships_host_live
  on championships (host_organization_id)
  where archived_at is null and status <> 'completed';

-- 4. Add-ons: a catalogue, and what each organisation holds.
create table if not exists addons (
  key            text        primary key,
  name           text        not null,
  description    text        not null default '',
  -- How it is priced: per month, per event, or a one-off pack.
  unit           text        not null default 'month' check (unit in ('month', 'event', 'pack')),
  price_paise    bigint,
  status         text        not null default 'coming_soon' check (status in ('available', 'coming_soon', 'hidden')),
  -- Included at no charge from this plan upward; null = always paid.
  included_from  tier,
  sort           int         not null default 0,
  updated_at     timestamptz not null default now()
);

insert into addons (key, name, description, unit, price_paise, status, included_from, sort) values
  ('whatsapp_notifications', 'WhatsApp notifications', 'Match reminders, results and announcements delivered on WhatsApp.', 'month', 99900, 'coming_soon', null, 10),
  ('extra_events',           'Extra event pack',       'Run more events at once than your plan includes.',                   'pack',  149900, 'available',   null, 20),
  ('extra_participants',     'Extra people pack',      'Raise the teams and people limits on your events.',                  'pack',  99900,  'available',   null, 30),
  ('white_label',            'White label',            'Your own brand and domain on event pages and emails.',               'month', 499900, 'available',   'max', 40),
  ('priority_support',       'Priority support',       'A named contact and same-day responses.',                            'month', 199900, 'available',   'max', 50)
on conflict (key) do nothing;

create table if not exists org_addons (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references organizations(id) on delete cascade,
  addon_key        text        not null references addons(key) on delete restrict,
  quantity         int         not null default 1 check (quantity > 0),
  status           text        not null default 'active' check (status in ('active', 'cancelled')),
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  granted_by       uuid        references users(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_org_addons_org on org_addons (organization_id) where status = 'active';

-- 5. Coupons. Redemption is one conditional UPDATE (redemptions < max), so two
--    buyers racing for the last use cannot both get it and nothing waits on a lock.
create table if not exists coupons (
  code             text        primary key check (code = upper(code)),
  description      text        not null default '',
  kind             text        not null check (kind in ('percent', 'flat')),
  -- percent: basis points (1500 = 15%); flat: paise.
  value            int         not null check (value > 0),
  ladder           text        not null default 'org' check (ladder in ('org', 'personal')),
  tiers            text[],     -- null = every tier
  periods          text[],     -- null = monthly and annual
  valid_from       timestamptz,
  valid_until      timestamptz,
  max_redemptions  int,
  redemptions      int         not null default 0,
  active           boolean     not null default true,
  created_by       uuid        references users(id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table invoices add column if not exists discount_paise bigint not null default 0;
alter table invoices add column if not exists coupon_code    text;
