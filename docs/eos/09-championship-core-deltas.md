# Module 09 — Championship Core Deltas

> **PRD:** §6.5 Teams & Squads · §6.6 Events — List & Creation · §6.7 Event Detail ·
> §6.8 Discover — **all four struck through in the PRD as "Borrow from Championship
> Modules"**, i.e. assumed already built.
> **Blocked by:** nothing
> **Blocks:** nothing
> **Size:** **M**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

The PRD strikes out §6.5–6.8 on the assumption that the existing championship modules
already cover them. **That assumption is about 85% correct** — which is impressive, and
also means there is a real 15% that would otherwise fall through the gap between "the
PRD says it's done" and "nobody built it".

This module is that residue: the specific requirements inside the struck-through
sections that are genuinely missing, plus the codebase hygiene (dead pages, dead
vocabulary, a mis-scoped route) that should be cleared while touching these areas.

Everything here is **independent and parallelisable** — no dependencies in either
direction. Good work for someone joining, or for filling gaps while the critical path
is blocked.

---

## 2. What we have today

Rather than restate the whole competition engine, here is the honest per-requirement
delta. Full verdicts are in the [traceability matrix](00-index.md#5-prd-traceability-matrix).

### 2.1 Teams (§6.5) — strong, missing one concept

[`TeamsPage.tsx`](../../apps/web/src/pages/organization/TeamsPage.tsx),
[`RosterPage.tsx`](../../apps/web/src/pages/organization/RosterPage.tsx) (541 lines),
[`teams.routes.ts`](../../apps/api/src/modules/teams/teams.routes.ts) (641 lines),
[`roster-policy.ts`](../../apps/api/src/modules/teams/domain/roster-policy.ts),
[`EnterChampionshipsModal.tsx`](../../apps/web/src/components/EnterChampionshipsModal.tsx).

Team CRUD, bulk create, member CRUD + bulk, per-entry lock/unlock, jersey numbers,
invite tokens, squad min/max enforcement, one-captain/one-vice-captain UI enforcement.

**Missing: coach.** `TEAM_MEMBER_ROLE = ['captain','vice_captain','player','substitute']`
— no coach value exists in any enum in the product. FR-TEAM-1/2/3 all reference a coach.

**Partially missing: team status lifecycle.** `TEAM_STATUS =
['forming','submitted','approved','roster_locked']` exists in the schema, but only
roster-locking is actually driven by the product, and it operates on `team_entries`
(per-championship), not on `teams`. FR-TEAM-4's "Selection → Active" has no
implementation.

### 2.2 Events list & creation (§6.6) — good, template picker missing

[`CreateEventWizard.tsx`](../../apps/web/src/pages/organiser/CreateEventWizard.tsx) —
4 steps (profile → sports & disciplines → invite orgs → open registration), creates a
draft at step 1. [`MyChampionshipsPage.tsx`](../../apps/web/src/pages/MyChampionshipsPage.tsx),
[`HostPage.tsx`](../../apps/web/src/pages/HostPage.tsx).

**Missing: an event `type`.** FR-EVT-1's "Multi-sport / Inter-college / Inter-programme /
Single sport" has no column on `championships`.

**Missing: a template picker (FR-EVT-4).** This one is frustrating because the templates
*exist*:

- [`event-templates.ts`](../../packages/shared/src/event-templates.ts) — swimming,
  powerlifting, athletics ranking specs
- [`tie-templates.ts`](../../packages/shared/src/tie-templates.ts) — badminton, TT,
  tennis rubber structures
- [`demo-templates.ts`](../../packages/shared/src/demo-templates.ts) — full championship
  recipes used by the demo seeder

They are resolved **implicitly by sport name** (`eventTemplateFor`, `tieTemplateFor`) or
used only by [`demo-recipes.ts`](../../apps/api/src/modules/demos/demo-recipes.ts). The
organiser is never offered a choice. Meanwhile the demo seeder can stand up a complete
four-championship environment from a recipe — the machinery for FR-EVT-4 is *already
written*, just not exposed.

### 2.3 Event detail (§6.7) — two tabs missing

[`championship-nav.ts`](../../apps/web/src/lib/championship-nav.ts) defines nine tabs
with `manage`-gating, rendered by
[`EventLayout.tsx`](../../apps/web/src/pages/organiser/EventLayout.tsx):

```
Overview · Setup* · Organising team* · Approvals* · Participants
Schedule · Results · Standings · Settings*          (* = organiser only)
```

**Missing: a Live tab (FR-EVD-4).** Live scoring exists — and is the deepest part of the
product — but lives at `/score/:fixtureId`, reached from the officiating queue.
Organisers watching an event have no single "what is happening right now" console.
`ResultsPage` shows live scores inline, which is close but not the match console the PRD
describes (sport, stage, venue, live clock, scores).

**Missing: a live clock.** No fixture has an elapsed-time concept; `duration_minutes` is
scheduling metadata.

**Missing: the Status report tab (FR-EVD-8).** Owned by
[08](08-reports-impact-exports.md) §4.7 as work item **8a** — noted here only because
the tab lands in this module's nav file.

**Partial: bulk registration approval (FR-EVD-9).**
[`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) approves one
at a time; the PRD asks for bulk.

**Meaningless until [06](06-verification-pipeline.md): the Verified badge (FR-EVD-6).**

### 2.4 Discover (§6.8) — works, no geography

[`DiscoverPage.tsx`](../../apps/web/src/pages/DiscoverPage.tsx): card grid, search, sport
and status filters, pagination, apply CTA with org-or-create modal, per-card application
status. Private championships correctly filtered out of listings for uninvolved users
(`20260723010000_championship_visibility.sql`).

**Missing: region/country (FR-DIS-2/3).** `championships` has a free-text `venue` string
and `venues` rows carry city/country — but nothing normalised to filter "Asia / Europe /
Americas / Oceania" on, and no header stats for countries/regions.

**Missing: outbound request tracking (FR-DIS-4).** Applying creates a
`championship_organizations` row, but there is no "our pending applications" view for
the requesting org — you have to revisit each championship card to see status.

### 2.5 Hygiene worth clearing

**Unrouted dead pages** — present in the tree, referenced by nothing:

| File | Note |
| --- | --- |
| [`EventsListPage.tsx`](../../apps/web/src/pages/organiser/EventsListPage.tsx) | Superseded by `MyChampionshipsPage` / `HostPage` |
| [`InstitutionDashboard.tsx`](../../apps/web/src/pages/organization/InstitutionDashboard.tsx) | Pre-unification shell |
| [`BrowseEventsPage.tsx`](../../apps/web/src/pages/organization/BrowseEventsPage.tsx) | Superseded by `DiscoverPage` |
| `EventOfficialsPage.tsx` | Not dead — embedded by `EventOrganisersPage`, but not routed directly |

**Matrix import is mis-scoped.** The API route
([`matrix-import.routes.ts`](../../apps/api/src/modules/import/matrix-import.routes.ts),
371 lines, validate + apply, idempotent, phone-matched) is **championship-scoped and
organiser-guarded**. But the only UI —
[`ChampionshipMatrixImportPage.tsx`](../../apps/web/src/pages/platform/ChampionshipMatrixImportPage.tsx)
— sits at `/platform/import-setup` behind `RequireRole roles={['system']}`. An organiser
who could legitimately use it cannot reach it. **This is a routing change, not backend
work** — arguably the highest value-per-line item in the doc set.

**Dead vocabulary** — the `POC` / `Institution` / `account_type` cleanup catalogued in
[00-index §3](00-index.md#dead-vocabulary--stop-using-it). Collected here so it happens
once rather than being smeared across nine modules.

**Stale deploy artefacts.** The API now runs on Lambda (`apps/api/src/lambda.ts`, proven
on staging) and **Render is retired**, but the repo still carries `render.yaml`, and the
header comment on `lambda.ts` still reads *"additive only, does not change local/Render
behaviour … `main.ts` is still what `npm run dev` / `npm start` / Render use."* Delete
`render.yaml`, correct the comment, and check `DEPLOYMENT.md`. Left alone, the next
person to read `lambda.ts` will believe Lambda is the optional path.

Also stale: the README documents `npm run seed` and `npm run smoke`, **neither of which
exists** in any `package.json`. Same PR.

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | No coach role | FR-TEAM-1/2/3 | P0 |
| G2 | Team status lifecycle not driven | FR-TEAM-4 | P1 |
| G3 | No championship `type` field | FR-EVT-1 | P0 |
| G4 | No template picker in the wizard | FR-EVT-4 | P1 |
| G5 | No Live tab / organiser live console | FR-EVD-4 | P0 |
| G6 | No live match clock | FR-EVD-4 | P1 |
| G7 | Bulk approval missing | FR-EVD-9 | P0 |
| G8 | No region/country on championships | FR-DIS-2/3 | P1 |
| G9 | No outbound participation-request tracker | FR-DIS-4 | P1 |
| G10 | Matrix import unreachable by organisers | — | P1 |
| G11 | Dead pages | — | P2 |
| G12 | Dead vocabulary (POC / Institution / account_type) | — | P2 |
| G14 | Stale deploy artefacts: `render.yaml`, the `lambda.ts` header comment, README's non-existent `seed`/`smoke` scripts | — | P2 |
| G13 | Team cards grid — PRD wants cards, we have a table | FR-TEAM-1 | P2 |

---

## 4. What we could do

### 4.1 Coach (G1)

Three placements, and the choice matters:

| Option | Assessment |
| --- | --- |
| **Add `'coach'` to `TEAM_MEMBER_ROLE`** | Simplest — one CHECK widened, one enum value, roster UI already handles roles. But a coach is usually **not a squad member**, and squad-size limits (`squad_min`/`squad_max`, enforced by [`roster-policy.ts`](../../apps/api/src/modules/teams/domain/roster-policy.ts)) would wrongly count them. Fixable by excluding coaches from the count, but that is a special case in a rule engine that currently has none. |
| **Add `'coach'` to `ORGANIZATION_MEMBER_ROLE`** | Wrong scope — a coach coaches a team, not an organisation. |
| **`teams.coach_user_id`** | A coach is a property of the team, not a squad member. No squad-count interaction, no rule special-casing, trivially queried. Limits a team to one coach — which matches FR-TEAM-1's card fields ("captain, coach"). |

**Recommend `teams.coach_user_id`** (nullable FK to `users`, `on delete set null`). If
multiple coaches are needed later, a `team_staff` table is a clean addition; widening a
member role is not.

This is [open question #5](00-index.md#7-open-questions-for-the-prd-author) — confirm the
intent before building.

### 4.2 Championship type (G3)

```sql
alter table championships add column if not exists type text;
alter table championships add constraint championships_type_check
  check (type is null or type in ('multi_sport','inter_college','inter_programme','single_sport','open'));
```

Nullable, so existing rows need no backfill guess. Drives FR-EVT-1's list column and
FR-EVT-2's filters, and gives FR-EVT-4's templates something to key on.

### 4.3 Template picker (G4) — exposing what exists

Add step 0 to [`CreateEventWizard.tsx`](../../apps/web/src/pages/organiser/CreateEventWizard.tsx):

```
How would you like to start?
  ▸ Multi-sport meet          (clone the Inter-College format)
  ▸ League tournament         (round-robin + knockout)
  ▸ Knockout cup              (single elimination)
  ▸ Start from scratch
```

Each template is a declarative recipe — sports, disciplines, formats, standings rules —
applied after the draft is created. **The shape already exists** in
[`demo-recipes.ts`](../../apps/api/src/modules/demos/demo-recipes.ts) and
[`demo-templates.ts`](../../packages/shared/src/demo-templates.ts), which the demo seeder
uses to build entire championships. Promote those from `demos/` into a shared
`championship-templates` module and let both the seeder and the wizard consume them.

This is refactoring existing capability into the user's hands rather than new invention,
and it is the cheapest way to close a P1.

### 4.4 The Live tab (G5)

Not a new scoring engine — an **organiser-facing aggregate view** of matches currently
live in this championship:

- Cards per live fixture: sport, stage, venue, current score, elapsed time, official
- Click → the existing [`MatchConsolePage.tsx`](../../apps/web/src/pages/official/MatchConsolePage.tsx)
- Auto-refresh on the same interval as `StandingsPage`'s existing 10s poll

One new nav entry in `championship-nav.ts` (not `manage`-gated — participants and
spectators benefit too) and one endpoint returning live fixtures for a championship.
`GET /championships/:id/fixtures` and the flattening logic in
[`fixtures-list.ts`](../../apps/api/src/modules/championships/fixtures-list.ts) already
do most of the query work.

**Live clock (G6):** derive from `fixtures.scheduled_at` plus a `started_at` stamped when
status flips to `live`, rather than modelling a stoppable match clock. A real clock
(with stoppages, halves, injury time) is a per-sport rabbit hole. Displaying "LIVE 67'"
from an elapsed-since-kickoff calculation matches the PRD mockup at a fraction of the
cost. Flag the simplification to product.

**On the ≤3s latency NFR:** the current model is polling. Before treating that as a gap,
measure it — a 10s poll fails the letter of the NFR but the perceived-latency question is
whether *spectators* notice. If real-time is required, that is a websocket/Supabase
Realtime project of its own, not a line item here.

### 4.5 Bulk approval (G7)

[`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) gains the
existing `BulkBar` component and a `PATCH /championship-organizations/bulk` endpoint
taking ids + decision. The single-row logic in
[`enrollment.routes.ts:66`](../../apps/api/src/modules/enrollment/enrollment.routes.ts)
(including its notification side-effect) is extracted and looped. Small.

### 4.6 Region and request tracking (G8, G9)

`championships.country` + `championships.region` (derivable from country via a static
map in `packages/shared` — no need to store both, but storing region denormalised makes
the filter cheap). Chips as FR-DIS-3 specifies.

FR-DIS-4's tracker is a new tab on the org's Invitations page —
[`InvitationsPage.tsx`](../../apps/web/src/pages/organization/InvitationsPage.tsx)
already shows inbound invitations; outbound applications are the mirror, reading
`championship_organizations where organization_id = :id`. The data exists; only the view
is missing.

### 4.7 Hygiene (G10–G12)

| Item | Action |
| --- | --- |
| Matrix import | Add `/championships/:id/import` routed inside `EventLayout` with `manage: true`. The existing page component is reusable nearly as-is; the API guard is already correct. Keep the platform route for super admins. |
| Dead pages | Delete `EventsListPage.tsx`, `InstitutionDashboard.tsx`, `BrowseEventsPage.tsx`. Confirm zero imports first. |
| Vocabulary | Rename `PocsPage.tsx` → `OrgMembersPage.tsx`, `PlatformInstitutionsPage.tsx` → `PlatformOrganizationsPage.tsx`, `InstitutionFormModal.tsx` → `OrganizationFormModal.tsx`; rename `poc_credentials` → `owner_credentials` in the create-org response (**API contract change — coordinate with the web client in the same PR**); drop `users.account_type` once the demo seeder stops writing it. |

Do the vocabulary rename as **one PR, no behaviour change**, so it is reviewable as a
pure rename. Mixing it into feature work is how renames get abandoned half-done.

---

## 5. Data model changes

| Change | Table |
| --- | --- |
| `+ coach_user_id` | `teams` |
| `+ type` (nullable + CHECK) | `championships` |
| `+ country`, `+ region` | `championships` |
| `+ started_at` | `fixtures` — for the live clock |
| `- account_type` | `users` — **last**, after the seeder stops writing it |

One small migration: `…_championship_deltas.sql`. All additive except the final drop,
which should be its own later migration.

---

## 6. API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `PATCH` | `/api/championship-organizations/bulk` | G7 |
| `GET` | `/api/championships/:id/live` | G5 — live fixtures |
| `GET` | `/api/organizations/:id/applications` | G9 — outbound tracker |
| `GET` | `/api/championship-templates` | G4 — promoted from `demo-recipes` |
| `POST` | `/api/championships/:id/apply-template` | G4 |
| — | `POST /api/teams`, `PATCH /api/teams/:id` | *changed* — accept `coach_user_id` |
| — | `POST /api/championships` | *changed* — accept `type`, `country` |

---

## 7. UI surface

| Surface | Change |
| --- | --- |
| [`RosterPage.tsx`](../../apps/web/src/pages/organization/RosterPage.tsx) | Coach picker (reuse [`PeoplePicker.tsx`](../../apps/web/src/components/PeoplePicker.tsx)) |
| [`TeamsPage.tsx`](../../apps/web/src/pages/organization/TeamsPage.tsx) | Coach + squad size on the row; optional card grid (G13, P2) |
| [`CreateEventWizard.tsx`](../../apps/web/src/pages/organiser/CreateEventWizard.tsx) | Template step 0; `type` field |
| [`championship-nav.ts`](../../apps/web/src/lib/championship-nav.ts) | `+ Live` tab; `+ Status report` tab (from [8a](08-reports-impact-exports.md)) |
| New Live page | Live fixture cards, auto-refresh, deep link to console |
| [`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) | `BulkBar` |
| [`DiscoverPage.tsx`](../../apps/web/src/pages/DiscoverPage.tsx) | Region chips, header stats |
| [`InvitationsPage.tsx`](../../apps/web/src/pages/organization/InvitationsPage.tsx) | Outbound applications tab |
| Matrix import | New organiser-reachable route |
| — | Delete 3 dead pages; rename 3 files |

---

## 8. Dependencies

**None in either direction.** Every item is independently shippable.

Two soft couplings worth noting:

- The **Status report** tab (FR-EVD-8) is content owned by
  [8a](08-reports-impact-exports.md) but lands in this module's nav file — coordinate the
  nav change once.
- The **Verified badge** (FR-EVD-6) is display-only here; its meaning comes from
  [06](06-verification-pipeline.md).

**This makes 09 the ideal parallel track** and the natural home for work done while the
critical path (02 → 01, and 06) is in flight.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **"The PRD says this is done"** | The main risk of this module is that it is never scheduled, because §6.5–6.8 are struck through. 13 gaps including 4 P0s live inside those sections. Make sure it gets an owner. |
| Coach placement | Getting it wrong means either polluting squad counts or an awkward migration later. Confirm intent first ([open question #5](00-index.md#7-open-questions-for-the-prd-author)). |
| Live clock scope creep | "Live 67'" invites a proper match clock with stoppages, halves and injury time — per sport. Ship elapsed-since-kickoff and say so explicitly. |
| Vocabulary rename touching an API contract | `poc_credentials` is returned by `POST /organizations`. Rename server and client together, or accept both keys for one release. |
| Deleting dead pages | Verify no dynamic imports or route strings reference them. `EventOfficialsPage` in particular is **not** dead — it is embedded, just not routed. |
| Latency NFR | Do not silently accept the 10s poll as compliant with a ≤3s requirement. Either measure and re-negotiate the number, or scope a realtime project. |

---

## 10. Effort

| Workstream | Size |
| --- | --- |
| Coach: column, API, roster picker, team list display | **S** |
| Championship `type` + list column + filters | **S** |
| Template picker: promote `demo-recipes` to shared templates, wizard step, apply endpoint | **M** |
| Live tab: endpoint, page, cards, auto-refresh | **M** |
| Live clock (`started_at` + elapsed display) | **S** |
| Bulk approval | **S** |
| Region/country + Discover chips + header stats | **S** |
| Outbound application tracker | **S** |
| Matrix import re-route for organisers | **S** |
| Team status lifecycle (FR-TEAM-4) | **S** |
| Delete dead pages | **S** |
| Vocabulary rename (single no-behaviour-change PR) | **S** |
| Stale deploy artefacts: drop `render.yaml`, fix the `lambda.ts` comment, correct the README | **S** |
| Team cards grid (G13) | **S** *(P2, optional)* |
| **Module total** | **M** |
