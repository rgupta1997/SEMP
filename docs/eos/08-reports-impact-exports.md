# Module 08 — Reports, Impact & Export Service

> **PRD:** §6.11 FR-RPT-1…6 (participation, performance, D&I, peer benchmark, Annual
> Sports Impact Report) · FR-EVD-8 (event status report + export) · FR-DASH-3
> (participation trend) · §9 NFR "Exports: Excel & PDF … and PPT … render server-side
> with org branding" · §10 success metric *"100% of orgs generating the Annual Sports
> Impact Report each academic year"*
> **Blocked by:** [01 Identity](01-identity-tenancy-workspace.md) *(org_units)*, [04 People](04-people-and-player-records.md) *(gender/DOB — hard for D&I)*, [06 Verification](06-verification-pipeline.md) *(trustworthiness)*, [07 Achievements](07-achievements-certificates.md) *(soft — medals)*
> **Blocks:** nothing
> **Size:** **L**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

The module that answers *"what did our sports programme actually achieve this year?"*
in a form a Director can put in front of a board.

Four report tabs, one exportable annual report, one event status report, and the export
service that renders all of them.

This is the **last module in the dependency chain** — almost everything it displays is
produced by another module. Building it early produces a beautiful dashboard of numbers
nobody should trust.

---

## 2. What we have today

### 2.1 Reports: nothing

No `/reports` route in [`App.tsx`](../../apps/web/src/App.tsx). No reports module in
`apps/api/src/modules/`. No analytics tables, no aggregate tables, no materialised views.

### 2.2 Exports: nothing

No PDF, Excel or PowerPoint generation anywhere. `xlsx` (SheetJS) **is** a dependency of
`apps/web` — but it is used exclusively for **reading** spreadsheets during import
([`lib/import.ts:53`](../../apps/web/src/lib/import.ts)).

The only thing the product can currently produce as a download is a **blank CSV
template** (`downloadCsvTemplate`, surfaced by
[`BulkImportModal.tsx`](../../apps/web/src/components/BulkImportModal.tsx)).

### 2.3 What exists that reports could be built from

Reports are an aggregation problem, and most of the raw material is there:

| Source | Gives |
| --- | --- |
| `standings` (materialised, 3 scopes) | Points, W/D/L per org — already computed by [`standings.service.ts`](../../apps/api/src/modules/standings/standings.service.ts) |
| `fixtures` | Matches played, results, dates, per-sport counts |
| `team_members` + `team_entries` | Unique participants per championship, per sport |
| `championship_organizations` | Registration and approval counts |
| `fixture_awards` | Award counts (unnormalised — see [07](07-achievements-certificates.md)) |
| `championships` | Events held, dates, seasons |

The nearest thing to a report today is
[`StandingsPage.tsx`](../../apps/web/src/pages/organiser/StandingsPage.tsx) — medal
tally and points views with per-org expandable breakdown, refreshed every 10s. It is a
live leaderboard, not an institutional report: single-championship, no history, no
export.

### 2.4 What is missing at the source, not the presentation

Three requirements cannot be built at all, regardless of effort in this module:

| Requirement | Missing source | Status |
| --- | --- | --- |
| FR-RPT-4 D&I — "women participation", "women's participation by sport" | `users` has no gender column | ✅ **Decided 2026-08-12 — collect it.** Owned by [04a](04-people-and-player-records.md). |
| FR-RPT-2 "participation by programme" | No programme/batch on a person | Owned by [01](01-identity-tenancy-workspace.md) (`org_units`) + [04a](04-people-and-player-records.md) |
| FR-RPT-4 "first-time athletes" | — | Derivable from `lifetime_entries` ([04b](04-people-and-player-records.md)) |
| FR-RPT-4 "scholarship athletes" | No field anywhere | ✅ **Decided 2026-08-12 — add it**, as `organization_members.scholarship` |

**All of FR-RPT-4 is now buildable** — but only *after* [04a](04-people-and-player-records.md)
collects the data with consent. The ordering still holds: this module cannot ship the D&I
tab before that lands, and FR-RPT-2's "women participation" headline KPI has the same
dependency. **Gate the tab rather than shipping it with empty or estimated figures.**

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | No reports module or route | FR-RPT-1 | P0 |
| G2 | No aggregation layer | FR-RPT-1…4 | P0 |
| G3 | No season/academic-year concept | FR-RPT-2 (YoY) | P0 |
| G4 | No gender data → D&I impossible *(decided: collect it; blocked on [04a](04-people-and-player-records.md))* | FR-RPT-4 | P0 |
| G5 | No programme/batch → breakdown impossible | FR-RPT-2 | P0 |
| G6 | No peer-benchmark aggregation or privacy boundary | FR-RPT-5 | P1 |
| G7 | No export service (PDF / Excel / PPT) | FR-RPT-6, §9 | P1 |
| G8 | No Annual Impact Report generator or executive summary | FR-RPT-6 | P1 |
| G9 | No event status report tab | FR-EVD-8 | P1 |
| G10 | No participation trend for the dashboard | FR-DASH-3 | P1 |
| G11 | No scholarship-athlete field *(decided: add `organization_members.scholarship`)* | FR-RPT-4 | P1 |

---

## 4. What we could do

### 4.1 Define "season" first (G3)

Every YoY delta in the PRD ("▲ 18% YoY", "2025–26") presumes a season, and there is no
season concept in the schema. `tournaments` are called seasons in the UI but are
*within* a championship, not across the institution.

Recommendation — **derive, don't model**: an academic year defined per organisation in
`organizations.settings`:

```jsonc
"season": { "startMonth": 6, "label": "academic" }   // June–May
```

A championship belongs to the season containing its `start_date`. This needs no new
table, no backfill, and handles institutions with different academic calendars — which a
hard-coded April–March or January–December would not.

Add a shared `seasonOf(date, settings)` helper in `packages/shared` so the API and the
web app agree. Getting two implementations of this is how YoY numbers stop matching
between a page and its export.

### 4.2 Aggregation: computed on read, cached — not a warehouse

The temptation is a star schema. Resist it. Scale is modest (a large institution: ~2,000
people, ~20 championships/year, ~2,000 fixtures/year) and the source tables are already
indexed for these access patterns.

```
apps/api/src/modules/reports/
  reports.routes.ts
  domain/
    participation.ts     ← pure aggregation, unit-testable
    performance.ts
    diversity.ts
    benchmark.ts
    season.ts
  report-cache.service.ts
```

Follow the existing separation of pure `domain/` functions from I/O — the pattern used
by [`schemes.ts`](../../apps/api/src/modules/standings/domain/schemes.ts) and the
fixture generators, both of which have real unit tests. Report maths is exactly the kind
of code that must be tested without a database.

Cache with a simple table rather than an in-memory cache (the API may run multiple
instances):

```sql
create table if not exists report_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  report_kind text not null,          -- participation | performance | diversity | benchmark
  season text not null,               -- '2025-26'
  data jsonb not null,
  computed_at timestamptz not null default now()
);
create unique index if not exists uq_report_snapshot
  on report_snapshots (organization_id, report_kind, season);
```

Invalidate on lock ([06](06-verification-pipeline.md)) rather than on a timer — the
lock is already the "canonical data changed" event, and reusing it means reports are
never stale in a way that matters.

### 4.3 Only count locked results

Every number in every report must derive from `scorecard_status='locked'` data.
Non-negotiable, for a simple reason: a report exported as a PDF and sent to a board is
a snapshot that cannot be corrected. If it counted provisional results, it will disagree
with the system a week later and the institution will stop trusting both.

Where a report must show in-progress data (the event status report, FR-EVD-8), label it
explicitly as live/provisional. The Annual Impact Report shows locked data only.

### 4.4 Peer benchmark (FR-RPT-5) — the privacy-critical one

> *"Hard privacy rule: no other institution's players, results, or identity are ever
> exposed."*

Design constraints, all mandatory:

1. **Aggregate-only queries.** Platform-wide aggregation, never a per-org list.
2. **Exclude `kind='personal'`** organisations ([05](05-flexible-entry.md)) — a solo
   entrant is not a peer institution and would badly skew "medals per 100 athletes".
3. **Exclude the requesting org from its own comparison set**, or "You vs median" is
   partly you.
4. **Minimum cohort size.** If fewer than **k = 5** institutions match a comparison
   cohort, return "insufficient data" rather than a number. With 3 institutions and a
   known peer set, a median is a deanonymisation vector.
5. **Feature-flagged per org** (`settings.flags.peerBenchmark`) as the PRD requires.
6. **Comparisons only on the four named metrics** — participation rate, events per year,
   women participation, medals per 100 athletes. No open-ended metric API.

Implement as a dedicated `benchmark.ts` with **no ability to return an org identifier**
in its return type. Make the privacy rule a type-level guarantee, not a code review
convention.

### 4.5 The export service (G7)

One service, three formats, used by both the status report and the impact report:

```
apps/api/src/modules/exports/
  export.service.ts
  renderers/{pdf,xlsx,pptx}.ts
  templates/{status-report,impact-report}.tsx
```

| Format | Library | Note |
| --- | --- | --- |
| PDF | **`@react-pdf/renderer`** | Same choice as [07](07-achievements-certificates.md) — one renderer, one learning curve, shared branded layout components |
| Excel | **`exceljs`** | `xlsx` (SheetJS) is already present but its write path is weak on styling; `exceljs` handles branded headers and number formats properly |
| PPT | **`pptxgenjs`** | The only realistic pure-JS option. Charts are the hard part — pre-render them as images and place them. |

Charts: render server-side to PNG (e.g. via a lightweight SVG chart built in code, then
rasterised) and embed. Do **not** attempt live chart libraries in a headless context.

Generation is a job, not a request. A full impact report with charts will comfortably
exceed the **15-second function timeout** (`TIMEOUT_SEC` in `deploy-lambda.sh`, inside
API Gateway's 29s ceiling) — and since the API is Lambda-only
now, there is no long-lived process to fall back on. `POST` returns a job id, the work
happens on an SQS-triggered worker Lambda, the client polls for status and downloads
when ready.

This is the **same queue** [07 §4.6](07-achievements-certificates.md) specifies for
certificate generation. **Build it once there and reuse it here — sequence 07b before
8c.** Unlike certificates, an export is one long job rather than many short ones, so
watch the 15-minute Lambda ceiling on very large reports; if that becomes real, split
per-section and assemble.

Every export writes an audit entry (`report.exported`) — an exported D&I report contains
sensitive aggregate data and its distribution should be traceable.

### 4.6 The Annual Sports Impact Report (FR-RPT-6)

The PRD's flagship deliverable, and a §10 success metric.

Branded output: *"IIM BANGALORE — SPORTS IMPACT 2025–26 · Powered by Sportagon EOS ·
Verified data"*, headline metrics, and **an auto-drafted executive summary**.

On the executive summary: the honest options are a **template-with-slots** approach
("Participation grew {pct}% to {n} athletes across {sports} sports, with {women}%
women's participation…") or an LLM-generated narrative from the computed figures.

**Recommendation: template-with-slots for v1.** Reasons: the numbers are the product,
not the prose; a template is deterministic, testable, and cannot hallucinate a figure
that contradicts the chart beside it; and it needs no inference infrastructure or
per-report cost. Make the summary editable before export — an institution will want to
add context a template cannot know. Revisit LLM drafting once the templated version is
in real use and its limits are known.

The "Verified data" line in the branding is only defensible if §4.3 holds.

### 4.7 Event status report (FR-EVD-8)

The one report that is *not* blocked on much — it is operational, live, and
championship-scoped:

- KPIs: registrations, approved, pending, matches played, medals, certificates
- Progress bars: registrations approved, fixtures scheduled, matches completed, results
  verified (needs [06](06-verification-pipeline.md)), certificates issued (needs
  [07](07-achievements-certificates.md))
- Needs-attention task list — generalise the existing "Needs your attention" block in
  [`EventDashboard.tsx`](../../apps/web/src/pages/organiser/EventDashboard.tsx)
- Export

It adds a tenth tab to
[`championship-nav.ts`](../../apps/web/src/lib/championship-nav.ts) with
`manage: true`. **This is the cheapest genuinely useful thing in the module** and can
ship well before the org-level reports.

---

## 5. Data model changes

| Change | Notes |
| --- | --- |
| **new** `report_snapshots` | Cache, §4.2 |
| **new** `export_jobs` | `(id, org_id, kind, format, status, file_url, requested_by, error)` — shared with [07](07-achievements-certificates.md)'s queue if built together |
| `+ settings.season` | `organizations.settings`, from [01](01-identity-tenancy-workspace.md) |
| `+ settings.flags.peerBenchmark` | Same |
| `+ scholarship` flag | `organization_members` — ✅ decided; the column itself is added by [04a](04-people-and-player-records.md) |

Light by design. This module reads far more than it writes.

---

## 6. API surface

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/organizations/:id/reports/participation?season=` | `report.view` | FR-RPT-2 |
| `GET` | `/api/organizations/:id/reports/performance?season=` | `report.view` | FR-RPT-3 |
| `GET` | `/api/organizations/:id/reports/diversity?season=` | `report.view` | FR-RPT-4 |
| `GET` | `/api/organizations/:id/reports/benchmark?season=` | `report.view` + flag | FR-RPT-5 |
| `GET` | `/api/organizations/:id/reports/trend` | `report.view` | FR-DASH-3 |
| `POST` | `/api/organizations/:id/reports/impact/generate` | `report.view` | FR-RPT-6, async |
| `GET` | `/api/export-jobs/:id` | requester | Poll status |
| `GET` | `/api/export-jobs/:id/download` | requester | Signed URL |
| `GET` | `/api/championships/:id/status-report` | `event.manage` | FR-EVD-8 |
| `POST` | `/api/championships/:id/status-report/export` | `event.manage` | FR-EVD-8 export |

---

## 7. UI surface

| Page | Path | Notes |
| --- | --- | --- |
| Reports | `/org/:orgId/reports` | Four tabs; Benchmark hidden unless flagged; D&I hidden until [04](04-people-and-player-records.md) lands |
| Impact report generator | `/org/:orgId/reports/impact` | Season picker, preview, editable summary, export buttons |
| Event status report | `/championships/:id/status-report` | New tab, `manage: true` |
| Dashboard trend chart | [01](01-identity-tenancy-workspace.md)'s org home | FR-DASH-3 |

**Charting:** there is no charting library in `apps/web` today. This module introduces
one. Recommend **Recharts** — small, React-native API, composes with the existing
hand-rolled Tailwind components, and works with the CSS-variable theming in
[`theme.ts`](../../apps/web/src/lib/theme.ts). Follow one consistent palette across every
chart; a reports module whose four tabs each use different colours reads as four
products.

Reuse `StatCard`, `Progress`, `Tabs`, `Card`, `Table`, `EmptyState` from
[`ui.tsx`](../../apps/web/src/components/ui.tsx) — the KPI strips in the PRD mockups are
`StatCard` rows.

---

## 8. Dependencies

**Blocked by**

| Module | Hardness | What for |
| --- | --- | --- |
| [01](01-identity-tenancy-workspace.md) | **Hard** | `org_units` for programme breakdowns; `settings.season`; the org shell to hang `/reports` on |
| [04](04-people-and-player-records.md) | **Hard for D&I** | Gender is a prerequisite for FR-RPT-4 and for FR-RPT-2's women-participation KPI |
| [06](06-verification-pipeline.md) | **Hard in principle** | §4.3 — reports over unlocked data are not reportable |
| [07a](07-achievements-certificates.md) | Soft | Medal counts; without it, recompute medals from fixtures every time |
| [05](05-flexible-entry.md) | Soft but important | Personal orgs must be excluded from benchmarks and platform counts |
| [03](03-rbac-module-access-audit.md) | Soft | `report.view`; `report.exported` audit |

**Blocks:** nothing. This is the tail of the chain.

**Recommended split:**

- **8a — Event status report** (FR-EVD-8). Nearly unblocked, immediately useful, small.
- **8b — Org reports** (FR-RPT-1…4). After 01, 04, 06.
- **8c — Export service + Impact report** (FR-RPT-6). Share the job queue with
  [07b](07-achievements-certificates.md).

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **Building on unverified data** | The defining risk. A polished report over mutable results actively damages trust — it looks authoritative and isn't. **Do not ship org-level reports before [06](06-verification-pipeline.md).** The status report (8a) is exempt because it is explicitly live. |
| **Benchmark deanonymisation** | With a small platform, "top 10% of institutions" may be two known universities. The k≥5 floor and the type-level no-identifier guarantee are the mitigations. Review this before the feature is enabled for anyone. |
| Gender data ethics | Collecting gender to report on it is legitimate and is the point of D&I reporting — but it must be consented, optional, and never displayed per-individual. Aggregate only, minimum cohort sizes here too. |
| Three export formats is a lot | PPT in particular is fiddly and least used. **Consider shipping PDF + Excel, and adding PPT on demand.** The PRD lists it as P1. |
| YoY with no history | A first-year institution has no prior year. Every delta needs a defined "no comparison available" state; do not render "▲ ∞%". |
| Chart library introduction | First charting dependency in the app. Pick once, use everywhere, define the palette up front. |
| Report/export divergence | If the on-screen report and the exported PDF compute numbers by different paths they *will* disagree. Compute once server-side; the export consumes the same JSON the page does. |

**Open questions**

1. Scholarship-athlete status (FR-RPT-4) has no field and no obvious source. Drop, or add
   to `organization_members`?
2. Is PPT genuinely required for v1, or is PDF + Excel enough?
3. Should the executive summary be LLM-drafted later? (Recommend: revisit after the
   templated version is in use.)

---

## 10. Effort

### 8a — Event status report

| Workstream | Size |
| --- | --- |
| Aggregation endpoint + KPIs + progress + task list | **S** |
| Status report tab + UI | **S** |
| Export (once 8c exists) | **S** |
| **8a total** | **S** |

### 8b — Org reports

| Workstream | Size |
| --- | --- |
| Season helper + `report_snapshots` + invalidation on lock | **S** |
| Participation aggregation + tests | **M** |
| Performance aggregation + tests | **S** |
| Diversity aggregation + tests | **S** |
| Benchmark aggregation + privacy floor + type-level guarantees | **M** |
| Charting library introduction + palette | **S** |
| Reports page, four tabs, KPI strips, charts | **L** |
| **8b total** | **L** |

### 8c — Exports & Impact report

| Workstream | Size |
| --- | --- |
| Export service scaffold + job queue *(shared with [07b](07-achievements-certificates.md))* | **M** |
| PDF renderer + branded layout | **M** |
| Excel renderer | **S** |
| PPT renderer | **M** *(consider deferring)* |
| Server-side chart rasterisation | **M** |
| Impact report template + templated executive summary + editing | **M** |
| **8c total** | **L** |

| | |
| --- | --- |
| **Module total** | **L** *(XL if PPT and benchmark both stay in v1)* |
