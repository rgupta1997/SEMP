-- Enables Realtime to actually deliver postgres_changes INSERT events for
-- notification_deliveries. Previously RLS was disabled on this table, and
-- the client connected without any Supabase-recognized identity at all -
-- so even once auth is wired up (see realtime-token.ts / lib/supabase.ts),
-- without this policy Realtime has no way to authorize any subscriber.
--
-- Postgres Changes authorizes each change event per-subscriber via a SELECT
-- policy (not the newer realtime.messages scheme, which is for Broadcast/
-- Presence channels only - not used here). Inserts still happen through the
-- backend's direct DB connection (Prisma), which bypasses RLS as normal -
-- this policy only governs what a Realtime-connected client may receive.
alter table notification_deliveries enable row level security;

create policy "Users can receive their own notification deliveries"
on notification_deliveries
for select
to authenticated
using (user_id = auth.uid());