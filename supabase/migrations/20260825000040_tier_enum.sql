-- ============================================================================
-- Subscription tiers: one ordered enum, compared by rank
--
-- Product Breakdown v1.0 sheet 06 models entitlements as a grid - plan x
-- capability -> yes/no, 11 org capabilities and 10 personal, 63 cells.
--
-- That grid is MONOTONIC: no capability is granted at a lower tier and withdrawn
-- at a higher one, on either ladder. A monotonic grid carries no more information
-- than one minimum tier per capability, so it collapses to 21 values with nothing
-- lost, and the yes/no lookup becomes an ordinal comparison.
--
-- Postgres native enums compare by DECLARATION ORDER, so the ordering costs
-- nothing - no rank column, no lookup table, no entitlement grid table:
--
--     'pro'::tier > 'free'::tier   ->  true
--
-- One type serves both ladders. 'max' is displayed as "Enterprise" on the
-- organisation ladder and "Elite" on the personal one; that is a label, not a
-- structure, and keeping it one type means one comparison operator across the
-- whole product instead of two that can drift apart.
--
-- The capability -> minimum tier registry deliberately does NOT live here. It
-- lives in packages/entitlements/src/core, so that adding a gated feature is a
-- registry entry rather than a migration, and so the API guard and the UI lock
-- state read one definition and cannot disagree about what is granted.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tier') then
    create type tier as enum ('free', 'pro', 'max');
  end if;
end $$;

-- The two ladders are independent: an organisation on 'max' does not grant its
-- players 'max', and vice versa.

alter table organizations
  add column if not exists plan tier not null default 'free';

alter table users
  add column if not exists personal_plan tier not null default 'free';

comment on column organizations.plan is
  'Organisation subscription tier. Compared by rank against a capability''s minimum tier; displayed as Free / Pro / Enterprise.';

comment on column users.personal_plan is
  'Personal subscription tier, independent of any organisation plan. Displayed as Free / Pro / Elite.';

-- Every gated read filters on the holder's tier, and both columns are NOT NULL
-- with a default, so a plain btree index is enough to keep plan-scoped reporting
-- (how many orgs on each tier) off a sequential scan.

create index if not exists idx_organizations_plan on organizations (plan);
create index if not exists idx_users_personal_plan on users (personal_plan);
