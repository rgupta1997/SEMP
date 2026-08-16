# Module 01 — Identity, Tenancy & Workspace Shell

> **PRD:** §6.1 Authentication & Organisation Access · §6.2 Workspace Shell & Navigation ·
> §6.3 Dashboard (Home) · §6.12 FR-ADM-1 (org structure) · §7 Organisation/OrgUnit entities
> **Blocked by:** [02 Communications](02-communications.md) *(soft — an **S**-sized wiring
> task against an email service that already exists, so auth work is never actually held up)*
> **Blocks:** [03 RBAC](03-rbac-module-access-audit.md), [04 People](04-people-and-player-records.md), [08 Reports](08-reports-impact-exports.md)
> **Size:** **XL**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

This module turns `organizations` from a *directory row* into a *tenant*, and gives an
institution's administrator a workspace to stand in.

Three distinct pieces of work that share one substrate:

| Piece | PRD | What it means |
| --- | --- | --- |
| **Tenancy** | §7, FR-ADM-1, FR-AUTH-2 | Org tiers, verification, domain allow-list, feature flags, Programme/Batch tree |
| **Authentication** | FR-AUTH-1…7 | Email-first identification, OTP, SSO, reset, invitation links |
| **Workspace shell** | FR-NAV-1…5, FR-DASH-1…6 | A third nav set and an org-admin home that isn't a CRUD table |

**Explicitly not in this module:** permission enforcement and module-access toggles
(that's [03](03-rbac-module-access-audit.md)); the people directory itself
(that's [04](04-people-and-player-records.md)).

---

## 2. What we have today

### 2.1 Authentication — works, but is bare

`apps/api/src/modules/iam/auth.routes.ts` mounted at `/api/auth`, pre-auth:

| Endpoint | Behaviour |
| --- | --- |
| `POST /auth/login` | Email + password, bcrypt compare, returns a signed JWT |
| `POST /auth/register`, `POST /auth/signup` | Self-service account creation |
| `GET /auth/me` | Current user + resolved context |
| `POST /auth/change-password` | Authenticated only |

Token handling is in [`apps/api/src/http/middleware/auth.ts`](../../apps/api/src/http/middleware/auth.ts):

- `signToken` — payload `{ sub, email, isSuperAdmin, organizationId }`, **7-day expiry**
- `parseAuth` — non-rejecting Bearer parse, mounted globally so public routes can still
  see a user if one is present
- `requireAuth`, `requireSuperAdmin`

Notable: this is **custom JWT + bcrypt, not Supabase Auth**. The `public.users` table
is not linked to `auth.users` — the initial migration flags this for a later pass and
it never happened. That is a real fork in the road; see §4.2.

Provisioned logins are handled well already: `hashProvisionedPassword()` in
[`users.helpers.ts`](../../apps/api/src/modules/iam/users.helpers.ts) mints a temp
password, `users.must_change_password` forces a reset at next sign-in, and
[`ChangePasswordPage.tsx`](../../apps/web/src/pages/ChangePasswordPage.tsx) blocks the
whole app until it is done. **This is the hook that FR-AUTH-6 should reuse**, not
replace.

Login UI is a single page — [`AuthPage.tsx`](../../apps/web/src/pages/AuthPage.tsx) —
serving both `/` (public landing) and `/login`, with a sign-in/sign-up toggle.

### 2.2 Organisations — a flat, globally-readable directory

Table shape (from `20260605000000_initial_schema.sql`, renamed in
`20260616000000_rebrand_and_multitenancy.sql`):

```
organizations(id, name, short_name, code UNIQUE, logo_url, city, status bool, country, created_at)
```

That is the whole thing. **No owner column, no tier, no settings, no parent, no domains,
no verification flag.**

Membership is the real model — `organization_members`:

```
(id, user_id, organization_id, role, status, joined_at)  UNIQUE(user_id, organization_id)
role   ∈ owner | admin | captain | member | alumni
status ∈ active | past | pending | rejected
```

[`organizations.routes.ts`](../../apps/api/src/modules/iam/organizations.routes.ts) is
mature and worth reading before touching: it already handles owner-vs-admin authority
splits, an `assertNotLastAdmin()` invariant so an org can never be left unmanageable,
self-service join requests as `status='pending'` rows, approve/decline with
notifications, and a careful cascade-delete that refuses when completed or scored
matches exist.

**The tenancy hole:** `GET /api/organizations` is an *open authenticated read* returning
every organisation on the platform, with a typeahead `q`. Combined with zero RLS, there
is currently no tenant boundary of any kind. Any logged-in user can enumerate every
institution.

### 2.3 Workspace shell — two nav sets, no org context

[`AppShell.tsx`](../../apps/web/src/components/AppShell.tsx): 240px sidebar + topbar
(role switcher, header filters, notification bell, theme toggle, avatar), a
`FilterProvider`, and a floating feedback widget on overview surfaces.

`navFor(role)` recognises exactly two roles — `APP_ROLE = ['system', 'user']`:

- **`system`** → Championships / Platform Master Data / Platform groups
- **`user`** → My Game · Officiating · Organizations · Discover · Championships · Host · Help

`roleHome('system')` returns `/platform/sports` — **a super-admin's home page is a
master-data CRUD table.** There is no org-admin shell at all: an institution
administrator logs in and lands on `/profile`, a participant view.

Org context, where it exists, is a tab strip inside a page —
[`OrgTabs.tsx`](../../apps/web/src/components/OrgTabs.tsx): Overview / Teams / Members /
Invitations.

### 2.4 Dashboards that exist

| Page | For whom | What's on it |
| --- | --- | --- |
| [`EventDashboard.tsx`](../../apps/web/src/pages/organiser/EventDashboard.tsx) | Championship organiser | 5 StatCards, "Needs your attention" list, `GettingStarted` checklist |
| [`OrgOverviewPage.tsx`](../../apps/web/src/pages/organization/OrgOverviewPage.tsx) | Org member | Getting-started checklist + approved championships |
| [`ParticipantDashboard.tsx`](../../apps/web/src/pages/participant/ParticipantDashboard.tsx) | Player | Career stats, achievements, championships, recent matches |
| [`PlatformOverview.tsx`](../../apps/web/src/pages/platform/PlatformOverview.tsx) | Super admin | Read-only championship table — **and it isn't linked in the nav** |

The pattern to copy is `EventDashboard`'s "Needs your attention" block plus
[`onboarding.tsx`](../../apps/web/src/lib/onboarding.tsx), which is already the single
source for the checklist, the spotlight tour and the `/help` page. FR-DASH-2's queue is
the same idea scoped to an org rather than a championship.

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | No org tier / verification flag | §7 | P0 |
| G2 | No domain allow-list; no domain→org identification at login | FR-AUTH-1/2 | P0 |
| G3 | No per-org auth configuration (which methods are permitted) | FR-AUTH-4 | P1 |
| G4 | No forgot-password flow | FR-AUTH-3 | P0 |
| G5 | No OTP | FR-AUTH-4 | P1 |
| G6 | No SSO | FR-AUTH-5 | P2 |
| G7 | Invitations exist but nothing is ever *sent* | FR-AUTH-6 | P1 |
| G8 | No org trust stats on login | FR-AUTH-7 | P2 |
| G9 | No Programme/Batch tree | FR-ADM-1 | P0 |
| G10 | No org-admin nav set, no org identity block, no sync strip, no breadcrumb | FR-NAV-1…4 | P0 |
| G11 | No merged/split nav configuration | FR-NAV-5 | P1 |
| G12 | No org-level dashboard (KPIs, pending queue, trend, widgets) | FR-DASH-1…5 | P0 |
| G13 | **No tenant isolation** — every org readable by every user | NFR | P0 |
| G14 | JWT has no refresh; 7-day expiry with no revocation | NFR security | P1 |

---

## 4. What we could do

### 4.1 Tenancy — upgrade `organizations` in place  ✅ decided

Three tiers on one table rather than a second entity:

```sql
alter table organizations
  add column if not exists kind text not null default 'community',
  add column if not exists verified boolean not null default false,
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references users(id) on delete set null;

alter table organizations drop constraint if exists organizations_kind_check;
alter table organizations add constraint organizations_kind_check
  check (kind in ('community','institution','personal'));
```

**Why in place rather than a new `institutions` table:** `organizations.id` is already
referenced by `organization_members`, `teams`, `team_entries`,
`championship_organizations`, `championship_invitations`, `standings`, `notifications`
and `users.organization_id`. A parallel tenant table means either duplicating all of
that or migrating eight FKs — for no behavioural gain, since an institution *is* an
organisation that has more switched on.

`settings` jsonb carries what would otherwise be a dozen sparse columns:

```jsonc
{
  "auth":    { "methods": ["password", "otp"], "sso": [] },
  "nav":     { "mergeEventsCompetitions": true, "mergeRecordsAchievements": false },
  "modules": { "people": ["staff"], "reports": ["staff"], "certificates": ["staff"] },
  "flags":   { "peerBenchmark": false },
  "brand":   { "primaryColor": "#…", "signatories": [] }
}
```

> `settings.modules` is *written* here but *enforced* in
> [03](03-rbac-module-access-audit.md) — FR-ADM-4. Keeping the store in one place
> avoids a second flag system.

**Alternative considered and rejected:** a `feature_flags` table keyed by
`(org_id, flag)`. More queryable, but every page load would need a join, and the flag
set is small and always fetched whole. Revisit only if flags need per-flag audit.

### 4.2 Domain allow-listing and email-first login

New table:

```sql
create table if not exists org_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_org_domains_domain on org_domains (lower(domain));
```

The unique index is on `domain` alone, not `(org_id, domain)` — **one domain maps to at
most one organisation**, which is what makes FR-AUTH-1's identification deterministic.

New endpoint, public:

```
POST /api/auth/identify   { email }
  → 200 { organization: { id, name, logo_url, verified }, auth_methods: [...], stats: {...} }
  → 200 { organization: null, auth_methods: ['password'] }   // generic signup path
```

**Security note that must not be skipped:** this endpoint is an unauthenticated oracle.
Rate-limit it per IP, and *never* let the response distinguish "no such user" from "no
such domain" — return the generic shape in both cases. FR-AUTH-2 says unrecognised
domains get "clear messaging"; that must mean "this isn't a recognised work domain",
never "that account doesn't exist".

`stats` covers FR-AUTH-7 (records kept / events per year / medals) and should be a
cached aggregate, not a live count — see [08](08-reports-impact-exports.md).

### 4.3 The Programme/Batch tree — FR-ADM-1

```sql
create table if not exists org_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_id uuid references org_units(id) on delete cascade,
  type text not null check (type in ('programme','batch')),
  name text not null,
  code text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_org_units_org on org_units (organization_id);
create index if not exists idx_org_units_parent on org_units (parent_id);
```

Deliberately a two-level typed tree (`programme` → `batch`) rather than an arbitrary
nesting, because that is what the PRD asks for and what Reports needs to group by.
`parent_id` is kept self-referential so a third level can be added later without a
migration — only the CHECK would widen.

Member counts are **derived**, never stored (PRD §7 says "member counts derived").

### 4.4 Auth methods — sequencing matters more than choice

| Method | Recommendation |
| --- | --- |
| **Forgot password** (P0) | Build first. Single-use token in an `auth_tokens` table with `expires_at` and `consumed_at`, delivered via `sendEmail()` from [02](02-communications.md). The logic is a couple of hours; the email pipe is already available. |
| **OTP** (P1) | Same `auth_tokens` table, 6-digit code, per-email and per-IP rate limits (NFR explicitly requires OTP rate-limiting). Email-delivered via the same client; SMS only if a provider is funded separately. |
| **SSO** (P2) | **Defer.** Do not hand-roll OAuth. When it comes, this is the moment to reconsider adopting Supabase Auth wholesale rather than bolting providers onto the custom JWT. |
| **Invitation links** (P1) | Reuse the existing `must_change_password` flow — the invite link just authenticates the token and drops the user on `ChangePasswordPage`. The mechanism already works; only delivery is missing. |

**A note on the Supabase Auth fork.** Sticking with custom JWT is right for now — the
codebase is consistent, guards are well factored, and switching mid-flight would touch
every route. But every auth feature added here raises the cost of switching later. If
SSO is genuinely wanted within a year, evaluate the migration *before* building OTP,
not after.

One thing to fix regardless of path (G14): a 7-day JWT with no refresh and no
revocation means a deprovisioned admin keeps access for up to a week. Either shorten
the access token and add a refresh endpoint, or check `users.is_active` on each request.
The latter is one indexed lookup and considerably less work.

### 4.5 The workspace shell

Add a third `AppRole`. `APP_ROLE` becomes `['system', 'org_admin', 'user']`, resolved in
[`me-context.ts`](../../apps/api/src/modules/iam/me-context.ts): a user is `org_admin`
if they hold `owner|admin` in any org with `kind='institution'`. The existing
`RoleSwitcher` in `AppShell` already handles multiple available roles, so this slots in.

`navFor('org_admin')` per FR-NAV-1, with `settings.nav` driving the merge (FR-NAV-5):

```
Home            /org/:orgId
People          /org/:orgId/people
Teams           /org/:orgId/teams
Events          /org/:orgId/events        ← badge: live count
Discover        /discover
Achievements    /org/:orgId/achievements   ┐ merged per settings.nav
Certificates    /org/:orgId/certificates   ┘
Reports         /org/:orgId/reports
Administration  /org/:orgId/admin
```

Two shell details worth doing properly because they are cheap and set the tone:

- **Org identity block** (FR-NAV-2) — logo/initials, name, "Sports Org · Verified"
  badge driven by `organizations.verified`. Reuse the existing `Avatar` and `Badge`
  from [`ui.tsx`](../../apps/web/src/components/ui.tsx).
- **Sync strip** (FR-NAV-3) — "synced across N records · updated Xm ago". N must be a
  real count from a cached aggregate. If it is fake, remove it; a fabricated trust
  signal is worse than none.

### 4.6 The org dashboard

FR-DASH-1's six KPIs, one endpoint, one query round:

```
GET /api/organizations/:id/dashboard
  → { kpis: { players, teams, upcomingEvents, awaitingApproval, certificatesPending, matchesLive },
      pending: [ { kind, count, cta: { label, href } } ],
      trend:   [ { season, participants } ],       // 6 seasons
      events:  [...], achievements: [...] }
```

The pending queue (FR-DASH-2) generalises `EventDashboard`'s "Needs your attention".
Note two of its four PRD examples do not exist yet: "scorecard ready to lock" needs
[06](06-verification-pipeline.md) and "achievement claim needing validation" needs
[07](07-achievements-certificates.md). **Ship the queue with the two that work
(registrations, call-for-participation) and let it grow** — do not block the dashboard
on the spine.

`trend` (FR-DASH-3) needs the aggregates from [08](08-reports-impact-exports.md).
Ship the dashboard without the chart if 08 hasn't landed.

---

## 5. Data model changes

| Change | Table | Notes |
| --- | --- | --- |
| `+ kind`, `+ verified`, `+ settings`, `+ created_by` | `organizations` | CHECK on `kind`; backfill all existing rows to `'community'` |
| **new** `org_domains` | — | Unique on `lower(domain)` |
| **new** `org_units` | — | Self-referential, typed two-level |
| **new** `auth_tokens` | — | `(id, user_id, kind, token_hash, expires_at, consumed_at)`; `kind ∈ password_reset \| otp \| invite`. **Store a hash, never the token.** |
| `+ organization_id` on `org_units` breakdowns | `organization_members` | Covered in [04](04-people-and-player-records.md) — noted here so the two migrations don't collide |

Migration file, following house convention:
`supabase/migrations/2026XXXXXXXXXX_org_tenancy.sql` — idempotent, `if not exists`
throughout, guarded `do $$` for the CHECK swaps. Then `npm run prisma:pull` +
`prisma:generate` against the **direct** port with the API server stopped.

**Backfill decision:** every existing organisation becomes `kind='community'`,
`verified=false`. Promotion to `institution` is a deliberate super-admin action, not
a migration guess.

---

## 6. API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/identify` | public, rate-limited | FR-AUTH-1/2/7 |
| `POST` | `/api/auth/forgot-password` | public, rate-limited | FR-AUTH-3 |
| `POST` | `/api/auth/reset-password` | public + token | FR-AUTH-3 |
| `POST` | `/api/auth/otp/request` · `/otp/verify` | public, rate-limited | FR-AUTH-4 |
| `POST` | `/api/auth/accept-invite` | public + token | FR-AUTH-6 |
| `GET/POST/DELETE` | `/api/organizations/:id/domains` | org admin | FR-AUTH-2 |
| `GET/POST/PATCH/DELETE` | `/api/organizations/:id/units` | org admin | FR-ADM-1 |
| `GET/PATCH` | `/api/organizations/:id/settings` | org admin | FR-NAV-5, FR-ADM-4 |
| `GET` | `/api/organizations/:id/dashboard` | org member | FR-DASH-1…5 |
| `PATCH` | `/api/organizations/:id/verify` | **super admin only** | Tier promotion |

**Change to an existing endpoint:** `GET /api/organizations` must stop returning
everything. Default it to the caller's own orgs; keep the global typeahead behind an
explicit `?scope=directory` that excludes `kind='personal'` and returns only
`(id, name, short_name, city, logo_url)`. This is the single highest-value line of the
module for G13.

---

## 7. UI surface

| Page | Path | Notes |
| --- | --- | --- |
| Login (rework) | `/login` | Email-first two-step: identify → method. Keep the existing page; add a step. |
| Forgot / reset password | `/forgot`, `/reset/:token` | New, small |
| Accept invitation | `/invite/:token` | Redirects into the existing `ChangePasswordPage` |
| **Org home** | `/org/:orgId` | New. FR-DASH-1…6 |
| Administration → Structure | `/org/:orgId/admin/structure` | Tree editor, FR-ADM-1 |
| Administration → Settings | `/org/:orgId/admin/settings` | Domains, auth methods, nav flags |
| Shell changes | — | Third nav set, org identity block, breadcrumb, sync strip, live badge |

Reuse rather than rebuild: `StatCard`, `Card`, `Badge`, `Tabs`, `Table`, `EmptyState`,
`confirmDialog` from [`ui.tsx`](../../apps/web/src/components/ui.tsx); the checklist
machinery from [`onboarding.tsx`](../../apps/web/src/lib/onboarding.tsx); `useApi` /
`useApiMutation` from [`hooks.ts`](../../apps/web/src/lib/hooks.ts).

---

## 8. Dependencies

**Blocked by**

- [02 Communications](02-communications.md) — **soft.** FR-AUTH-3/4/6 need
  `sendEmail()`, but the email service already exists and 02 is an **S** with no
  upstream dependency. Put both in Phase 0 and this is never a real wait. Tenancy and
  shell work don't touch it at all.

**Blocks**

- [03 RBAC](03-rbac-module-access-audit.md) — needs `settings.modules` and the tier
- [04 People](04-people-and-player-records.md) — needs `org_units` for programme/batch
- [08 Reports](08-reports-impact-exports.md) — needs `org_units` for breakdowns, and
  the tier to scope benchmarks

**Coordinates with**

- [05 Flexible Entry](05-flexible-entry.md) — both change `organizations`. Land the
  `kind` column **once**, in this module's migration, and let 05 consume it.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **No RLS while selling "strict org-level data isolation"** | The most serious item in the whole doc set. Route-layer authz is good but it is one forgotten guard away from a cross-tenant leak, and `GET /organizations` is already that leak. Narrowing that endpoint is a same-day fix; real RLS is a separate project. **Recommend: fix the endpoint now, schedule RLS explicitly, and do not claim isolation in sales material until it exists.** |
| Auth-method sprawl | Four new auth paths, each with its own abuse surface. Rate-limit at the router, not per-handler. |
| Custom JWT vs Supabase Auth | Every feature added here deepens the fork. Decide before SSO, not during. |
| `settings` jsonb has no schema enforcement | Mitigate with a zod schema in `packages/shared` validated on write — matches the existing `format_config` pattern. |
| Domain squatting | First org to claim `gmail.com` blocks everyone. **Require super-admin verification (`org_domains.verified`) before a domain is honoured at login, and deny-list public mail providers.** |

**Open questions** — see [00-index §7](00-index.md#7-open-questions-for-the-prd-author),
items 2 and 7.

---

## 10. Effort

| Workstream | Size | Note |
| --- | --- | --- |
| Org tier + settings + migration + Prisma pull | **S** | One migration, mostly additive |
| `org_domains` + `/auth/identify` + two-step login | **M** | Rate limiting and the enumeration-safe response are the fiddly parts |
| `org_units` tree + CRUD + editor UI | **M** | Tree UI is the bulk |
| Forgot password + reset | **S** | Trivial once 02 exists |
| OTP + rate limiting | **M** | — |
| SSO | **L** | **Recommend deferring** |
| Invitation links | **S** | Reuses `must_change_password` |
| Third nav set + shell (identity block, breadcrumb, sync strip, badge) | **M** | — |
| Org dashboard (KPIs + pending queue + widgets) | **M** | Trend chart deferred to 08 |
| Narrow `GET /organizations` | **S** | Do this first, independently |
| **Module total** | **XL** | **L if SSO is deferred**, which is the recommendation |
