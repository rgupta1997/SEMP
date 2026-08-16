# SEMP - Sports Event Management Platform

Monorepo: **React** frontend + **Node/Express** API (all business logic) + **Supabase** (Postgres only).

**Deployed on AWS Lambda** (API, behind an API Gateway HTTP API) + **Netlify** (web) +
**Supabase** (Postgres). Render is retired — see [DEPLOYMENT.md](DEPLOYMENT.md).
Two consequences worth knowing before you write server code: there is **no long-lived
process** (background work needs SQS/EventBridge, not an interval timer), and a
synchronous response is capped at the **15s function timeout**.

```
packages/shared      # zod schemas, enums, DTO types (shared by web & api)
apps/api             # Express + Prisma, hexagonal (domain / application / adapters)
apps/web             # Vite + React + Tailwind + TanStack Query (bare-minimum CRUD UI)
supabase/migrations  # SQL migrations = source of truth for the DB schema
```

## Setup

```bash
npm install                      # install all workspaces
# DB schema is already applied via supabase/migrations (supabase db push)
npm run prisma:generate          # generate Prisma client (after any db pull)
npm run seed                     # create admin + Phase 1 foundational data
```

`apps/api/.env` holds `DATABASE_URL` (Supabase), `JWT_SECRET`, seed admin creds.
`apps/web/.env` holds `VITE_API_URL` (defaults to http://localhost:4000).

## Run

```bash
npm run dev:api     # API on http://localhost:4000
npm run dev:web     # Web on http://localhost:5173 (or next free port)
```

The web app is **role-aware**: the entire shell and screens change based on who
logs in. Demo logins seeded by `npm run seed` (all use password `demo123`,
except the admin):

| Login | Role / shell |
| --- | --- |
| `admin@semp.local` / `admin123` | System admin - everything + Platform master data, can "View as" any role |
| `organiser@semp.local` | Organiser - events, create-event wizard, setup, approvals, schedule, go-live |
| `poc@vjti.local` | Institution / Captain - dashboard, browse & apply, teams, roster builder, students |
| `official@semp.local` | Official - assigned matches + match console |
| `player@vjti.local` | Participant - profile, player card, my teams, my schedule |

A fully-populated demo event, **Genesis Sports Fest '26**, is seeded so every
view has live data. Self-serve sign up (organiser / institution) is on the login
screen.

## Deploy

```bash
npm run prisma:generate --workspace @semp/api   # needs binaryTargets rhel-openssl-3.0.x
npm run build:lambda    --workspace @semp/api   # esbuild -> apps/api/dist-lambda.zip
npm run deploy:lambda   --workspace @semp/api   # idempotent: IAM role + Lambda + HTTP API
```

Full walkthrough, including the Supabase pooler settings and concurrency caps:
[DEPLOYMENT.md](DEPLOYMENT.md).

## Verify

```bash
npm run test        # Vitest unit tests for the fixture-generation algorithms
```

> **Stale commands below/above:** `npm run seed` and `npm run smoke` are referenced in
> this README but **no longer exist** in any `package.json`. Seeding is now
> `npx tsx apps/api/scripts/bootstrap-catalog.ts` (global catalog) and
> `apps/api/scripts/seed-iimb.ts` (disposable demo championship), or the in-app demo
> sandboxes at `/platform/demos`. The demo-login table above is likewise unverified.
> Cleanup tracked in [`docs/eos/09-championship-core-deltas.md`](docs/eos/09-championship-core-deltas.md).

## Architecture notes

- **Auth**: custom JWT (bcrypt). `/auth/me` returns a full role context -
  `account_type`, `institution`, event-scoped roles (`user_event_roles`) and team
  memberships - which the web app uses to pick the right shell. Super admins can
  switch between role shells via the topbar "View as" selector.
- **Hexagonal API**: pure domain services hold the rules - event lifecycle
  (`events/domain`), entry/squad resolution (`tournaments/domain`), roster policy
  (`teams/domain`), and the fixture generators (`fixtures/domain/generators`).
  Express + Prisma are adapters; the generic CRUD factory (`http/crud.ts`) serves
  the simple master-data tables.
- **Fixture generators** are pure functions: `teams[] + params -> GeneratedFixture[]`
  (Knockout, League/Round Robin, Groups, Pool+Knockout).
- **Prisma** introspects the SQL schema (`prisma db pull`); SQL migrations remain
  the source of truth.
