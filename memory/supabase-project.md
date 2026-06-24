---
name: supabase-project
description: SEMP backend is a Supabase (Postgres) project; how schema/migrations are applied
metadata:
  type: project
---

SEMP is a sports-event management platform backed by **Supabase** (Postgres).

- Project ref: `iwxgdttztfhabvufukob`, region **ap-south-1 (Mumbai)** - migrated here 2026-06-20 from the old Tokyo project `pzpnldkustokmwzflnfl` (retired) to cut query latency (~700ms → ~30ms warm). Pooler host `aws-1-ap-south-1.pooler.supabase.com`; runtime uses the transaction pooler `:6543`, migrations the session pooler `:5432`. The DB password is NOT stored here - ask the user for the connection string each time.
- **Applying migrations (current workflow, as of 2026-06-24):** the repo is now linked (`npx supabase link --project-ref iwxgdttztfhabvufukob`) and migrations apply with **`npx supabase db push`** (remote push does NOT need Docker - only local `supabase start` does). The older per-file `npx prisma db execute --url "<session :5432 URL>" --file <f>` still works as a fallback (and is the only way to run ad-hoc SQL like data cleanup, since `db execute` doesn't print SELECT rows - use the Supabase dashboard SQL Editor to view query results).
- **Gotchas hit during the 2026-06-24 push:**
  - **URL-encode the password** in connection strings (e.g. `/` -> `%2F`), or Prisma errors with `P1013 invalid port number`.
  - **Migration history was out of sync** because earlier migrations were applied via `prisma db execute` (which doesn't record into `supabase_migrations.schema_migrations`). Fixed with `npx supabase migration repair --status applied <versions...>` so `db push` didn't try to re-run already-applied SQL. Check `npx supabase migration list` (Local vs Remote) before pushing.
  - **Unique version timestamps are required.** Two files shared version `20260627000000` (`fixture_events` + `users_phone_unique`), which collided on `schema_migrations_pkey`. Renamed the latter to `20260627010000_users_phone_unique.sql`. Always give new migrations a distinct `HHMMSS`.
- After applying, run `npx prisma generate --schema apps/api/prisma/schema.prisma`. If it fails with **EPERM renaming `query_engine-windows.dll.node`**, the running dev server (`tsx watch` Node process) holds the engine DLL - stop the dev server (Ctrl+C) before regenerating, then restart it.
- Initial schema (`20260605000000_initial_schema.sql`) applied 2026-06-05: 19 tables (permissions, roles, users, events, institutions, venues, venue_grounds, sponsors, sports, disciplines, tournament_formats, tournaments, tournament_sports, tournament_disciplines, event_institutions, user_event_roles, teams, team_members, fixtures).
- **All migrations through `20260629000000_rankings_format.sql` are applied** (full `db push` completed 2026-06-24, including `fixture_live_state`, `fixture_events`, `feedback`, `users_phone_unique`, `rankings_format`). The `users` table now has a partial unique index `users_phone_last10_key` on the last-10-digits-of-phone (matches the app's `findUserByPhone` normalization); applying it required removing duplicate `9999999999` test-data phones first.

Decisions made so far:
- `public.users` is **standalone**, NOT linked to `auth.users` yet (marked in the migration for later wiring).
- `roles.permission_ids` and `permissions.rules` are array columns → no FK enforced on their contents.
- **No RLS** yet - tables only. RLS off the permissions/roles model is the planned next pass.
