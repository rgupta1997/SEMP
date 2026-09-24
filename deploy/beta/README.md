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
REALTIME_TRANSPORT=off
```

`development`, not `production`: the production guards would additionally demand a real
mail key plus AppSync queue, endpoint and region values that only a deployed `semp-*`
stack produces. Beta has no stack, so `off` and `console` are the honest settings.
