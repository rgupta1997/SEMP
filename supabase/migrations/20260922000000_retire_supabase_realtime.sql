-- Retires the Supabase Realtime transport for notifications.
--
-- Live delivery now runs on AWS AppSync Events: notify() enqueues to SQS, a publisher
-- Lambda fans out one event per recipient, and a Lambda authorizer decides who may
-- subscribe to which channel. Nothing reads this publication or this policy any more.
--
-- This reverses 20260825000010_notification_deliveries_realtime.sql (the publication
-- membership) and 20260825000020_enable_rls_notification_deliveries.sql (the policy).
-- Those files stay where they are: they are the record of what was actually applied
-- to this database, and rewriting applied history would desync every environment that
-- already ran them.
--
-- ---------------------------------------------------------------------------
-- APPLY THIS BEFORE TAKING THE RDS BASELINE DUMP.
-- ---------------------------------------------------------------------------
-- infra/README.md blocker 1 and RUNBOOK-rds.md step 9 both call out that the dump has
-- to have two Supabase-only artifacts stripped out of it by hand, because neither the
-- `authenticated` role, the `auth.uid()` function, nor the `supabase_realtime`
-- publication exists on plain Postgres 17. Running this migration first means the dump
-- simply does not contain them - the strip becomes unnecessary rather than easy to
-- forget, which matters because forgetting it fails the load at `ON_ERROR_STOP=1` and
-- creates nothing at all.
--
-- WHAT THIS DOES NOT DO: it does not drop `notification_deliveries`. That table is not
-- the transport, it is the record of who a notification was addressed to, and the
-- unread-count query still range-scans it (see cursor.ts in the API). Only the
-- Realtime plumbing goes.

-- The SELECT policy existed solely so Realtime could authorize a subscriber per change
-- event. Per-user isolation is now the AppSync Lambda authorizer's job, which compares
-- the channel against the token's `sub` with exact equality
-- (apps/api/src/modules/realtime/authorize.ts).
drop policy if exists "Users can receive their own notification deliveries"
  on notification_deliveries;

-- With no policy left, RLS on this table would deny every read from any non-owner role
-- rather than merely being unused. Prisma connects as owner and bypasses RLS either
-- way, so this is about not leaving a trap for anything that does not.
alter table notification_deliveries disable row level security;

-- Guarded, because the publication does not exist on a database that never ran the
-- original migration - a fresh RDS restore, for one - and this file must be replayable
-- there without error.
do $$
begin
  alter publication supabase_realtime drop table notification_deliveries;
exception
  when undefined_object then null;  -- publication or membership already gone
end $$;
