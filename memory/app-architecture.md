---
name: app-architecture
description: SEMP app stack, layout, and how to run/verify the React+Node+Supabase build
metadata:
  type: project
---

SEMP is built as an **npm-workspaces monorepo** (pnpm not installed on this machine):
`packages/shared` (zod schemas + enums + DTOs), `apps/api` (Express + Prisma,
**hexagonal**: domain/application/adapters), `apps/web` (Vite + React + Tailwind v4
+ TanStack Query + React Router). See [[supabase-project]] for DB/migration details.

Stack decisions (from the user): React frontend, Node owns ALL API calls, Supabase
is DB only; backend uses **Prisma** (introspects SQL schema via `db pull`); **custom
JWT auth** (bcrypt) with a **single super-admin role for now** (event-scoped
permission resolution deferred); frontend is **bare-minimum CRUD** (a generic
`ResourcePage` driven by `apps/web/src/lib/resources.ts`, plus dedicated pages for
enrollment, teams, fixtures).

Domain rules live in pure services: event lifecycle, entry/squad resolution, roster
policy, and the **fixture generators** (`apps/api/src/modules/fixtures/domain/generators/`) —
pure `teams[] + params -> GeneratedFixture[]` for Knockout / Round-Robin·League /
Groups / Pool+Knockout.

Run: `npm run dev:api` (4000) + `npm run dev:web` (5173/5174). Login admin@semp.local /
admin123 (`npm run seed`). Verify: `npm run smoke` (replays TechFest 2025 across all
5 phases) and `npm run test` (9 Vitest generator tests). API CORS allows any
`http://localhost:*` in dev.

**Why:** captures non-obvious choices (workspaces-not-pnpm, single-role-for-now,
generic CRUD pattern, SQL-as-migration-source-of-truth) so future sessions don't re-derive them.
