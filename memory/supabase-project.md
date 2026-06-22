---
name: supabase-project
description: SEMP backend is a Supabase (Postgres) project; how schema/migrations are applied
metadata:
  type: project
---

SEMP is a sports-event management platform backed by **Supabase** (Postgres).

- Project ref: `iwxgdttztfhabvufukob`, region **ap-south-1 (Mumbai)** - migrated here 2026-06-20 from the old Tokyo project `pzpnldkustokmwzflnfl` (retired) to cut query latency (~700ms → ~30ms warm). Pooler host `aws-1-ap-south-1.pooler.supabase.com`; runtime uses the transaction pooler `:6543`, migrations the session pooler `:5432`.
- Migrations live in `supabase/migrations/` and are applied per-file with **`npx prisma db execute --url "<session :5432 URL>" --file <f>`** (no local `psql`/`pg_dump`; `supabase db dump`/`db push` need Docker which isn't available). The DB password is NOT stored here - ask the user for the connection string each time.
- Initial schema (`20260605000000_initial_schema.sql`) applied 2026-06-05: 19 tables (permissions, roles, users, events, institutions, venues, venue_grounds, sponsors, sports, disciplines, tournament_formats, tournaments, tournament_sports, tournament_disciplines, event_institutions, user_event_roles, teams, team_members, fixtures).

**PENDING (as of 2026-06-06):** migration `20260606040000_fixture_live_state.sql` (adds `fixtures.live_state` + `fixtures.live_log` jsonb) is **written but NOT yet applied** - needs `npx supabase db push --db-url "<conn-string>"`. Also run `npx prisma generate --schema apps/api/prisma/schema.prisma` afterward (it failed mid-session with EPERM because the `tsx watch` dev server held the engine DLL - stop the API dev server first). The live-scoring endpoints (`GET/PATCH /fixtures/:id/live`) use **raw SQL** so they work without regeneration and degrade gracefully until the migration lands.

Decisions made so far:
- `public.users` is **standalone**, NOT linked to `auth.users` yet (marked in the migration for later wiring).
- `roles.permission_ids` and `permissions.rules` are array columns → no FK enforced on their contents.
- **No RLS** yet - tables only. RLS off the permissions/roles model is the planned next pass.
