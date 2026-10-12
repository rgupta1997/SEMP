# Beta

**Live.** ~21,800 invocations in the 14 days to 2026-09-22. Do not delete its
resources — see the note in [`../README.md`](../README.md).

| | |
|---|---|
| API | Lambda `semp-api` + HTTP API `semp-api-gateway`, ap-south-1 |
| Managed by | Nothing. Created with raw AWS CLI calls; there is no CloudFormation stack |
| Database | Supabase, project `iwxgd…`, via the transaction pooler |
| CORS | `sportagon-eos.netlify.app` and two deploy previews |

That CORS list is the quickest way to prove this is not production:
`events.sportagon.in` is absent from it, so the production frontend could not call this
API even if DNS pointed at it.

## Deploy

```bash
./deploy.sh
```

Equivalent to `npm run deploy:lambda --workspace @semp/api`, with the build step done
for you.

## Before this branch reaches beta

An existing function **keeps its environment** — the script only updates code, which is
deliberate (pushing a developer's `.env` would otherwise replace the live `JWT_SECRET`
and sign everyone out). Beta's function carries three variables: `DATABASE_URL`,
`JWT_SECRET`, `WEB_ORIGIN`.

This branch made `NODE_ENV` mandatory with no default, and `envSchema.parse` runs at
module load. So deploying it without touching the environment first is a cold-start
crash on every invocation, with nothing to warn you. Set on the function:

```
NODE_ENV=development
MAIL_TRANSPORT=console
REALTIME_TRANSPORT=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<the project's publishable / anon key>
SUPABASE_JWT_SECRET=<the project's legacy JWT secret - must NOT equal JWT_SECRET>
```

`development`, not `production`: the production guards would additionally demand a real
mail key. Mail stays on `console` until beta has one.

## Live notifications on beta: Supabase Realtime

Beta's database is a Supabase project, so its notification bell uses **Supabase
Realtime**, not AppSync (which needs the `semp-*` stack beta does not have). The code is
the same build as UAT; only this setting differs - see `REALTIME_TRANSPORT` in
`apps/api/src/config/env.schema.ts`.

- The three `SUPABASE_*` values come from the Supabase dashboard (Project Settings >
  API, and > JWT for the legacy secret). The URL and publishable key reach the browser in
  the `POST /notifications/realtime-token` response; the secret never leaves the API.
- Apply migration `20261011000000_supabase_realtime_where_supabase.sql` to the beta
  database. It restores the RLS policy and the realtime publication that
  `20260922000000_retire_supabase_realtime.sql` removed (and is a no-op on RDS).
- Netlify needs no new variable: the browser is told which transport to use at runtime.
- `REALTIME_TRANSPORT=off` still works if Supabase Realtime is not set up - the bell
  then falls back to its 2-minute poll.
