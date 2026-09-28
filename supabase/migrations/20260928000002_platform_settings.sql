-- Platform-wide switches a super admin flips from the console, starting with one:
-- whether plans are enforced at all.
--
--   plans_enforced = false   every organisation and person is treated as the top
--                            tier (Enterprise / Elite); the Billing tab is hidden.
--   plans_enforced = true    the saved plans apply again, exactly as before.
--
-- Nothing about anybody's saved plan or subscription changes either way, which is
-- what makes turning plans back on a single click. Read by resolve.ts in
-- @semp/entitlements; a missing row or table means "enforced", the old behaviour.

create table if not exists platform_settings (
  key        varchar(64) primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);

-- Off from today: there is no real payment wiring yet.
insert into platform_settings (key, value) values ('plans_enforced', 'false'::jsonb)
on conflict (key) do nothing;
