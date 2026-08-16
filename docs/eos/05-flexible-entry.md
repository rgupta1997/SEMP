# Module 05 — Flexible Entry (solo & ad-hoc participation)

> **PRD:** none. This is a **new product requirement** raised alongside the PRD:
> *"currently an org is compulsory to participate in an event, then we form a team. We
> want to go with a little flexibility — suppose there is a team of 2 people who want to
> participate, or an individual cricket team."*
> **Blocked by:** [01 Identity](01-identity-tenancy-workspace.md) (shares the `organizations.kind` column)
> **Blocks:** [08 Reports](08-reports-impact-exports.md) (soft — benchmarks must exclude personal orgs)
> **Size:** **M**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

Let a person enter a championship **without belonging to an institution** — as an
individual, a pair, or a small self-assembled squad — using the machinery that already
exists, and without the word "organisation" ever appearing in their path.

Out of scope: public self-service signup redesign, payment/entry fees, waivers.

---

## 2. What we have today

### 2.1 The mandatory chain

Every route into a championship runs through an organisation. Four separate NOT NULL
constraints enforce it:

```
teams.organization_id                       not null
team_entries.organization_id                not null
team_entries.championship_organization_id   not null
standings.organization_id                   not null
```

And the entry flow is org-gated at every step:

1. `POST /championships/:id/enroll` is guarded by **`enrollSelf`** —
   *"Only an organization owner/admin can enroll that organization"*
   ([`permissions.ts:136`](../../apps/api/src/http/middleware/permissions.ts))
2. It writes `championship_organizations` with `status='pending'`
   ([`enrollment.routes.ts:22`](../../apps/api/src/modules/enrollment/enrollment.routes.ts))
3. An organiser approves it
4. `POST /teams` is guarded by **`teamCreate`** — *"You can only create teams for an
   organization you own or administer"*
5. `POST /teams/:id/entries` links the roster to the championship, requiring the
   approved `championship_organization_id`

So a solo badminton player must: create an organisation, enrol it, wait for approval,
create a team of one, add themselves to it, and enter that team. In practice the UI
nudges them into exactly this — [`DiscoverPage.tsx`](../../apps/web/src/pages/DiscoverPage.tsx)'s
`ApplyModal` offers "pick an existing org or create one", and
[`JoinOrgModal.tsx`](../../apps/web/src/components/JoinOrgModal.tsx) exists because the
alternative is worse.

### 2.2 What already supports individuals — more than you'd expect

The competition model is **not** the obstacle. It already handles individual formats:

```ts
ENTRY_TYPE = ['team', 'individual', 'doubles', 'relay']
```

`disciplines.entry_type` / `squad_min` / `squad_max`, overridable per draw on
`tournament_disciplines`, resolved by
[`resolveEntryRules()`](../../apps/api/src/modules/tournaments/domain/entry-rules.ts):

```ts
// tournament_discipline override wins, else the master discipline, else defaults
entry_type: override.entry_type ?? master?.entry_type ?? 'team'
squad_min:  override.squad_min  ?? master?.squad_min  ?? 1
squad_max:  override.squad_max  ?? master?.squad_max  ?? 15
```

`squad_min` defaults to **1**. A team of one is already legal at the rules layer, and
`assertCanAddMember` / `assertCanLockRoster` in
[`roster-policy.ts`](../../apps/api/src/modules/teams/domain/roster-policy.ts) enforce
against these resolved values.

Ranking events go further — swimming/powerlifting/athletics fixtures are deliberately
team-less, with competitors held as JSON in `fixtures.live_state.event.participants`.

**The obstacle is purely the ownership chain, not the competition model.** That is why
this module is M and not L.

### 2.3 The one genuinely awkward case

The user's phrasing — *"an individual cricket team"* — is a team sport entered by a
self-assembled group with no institution behind them: five friends entering a 5-a-side
tournament. They need a real roster with real members, just no institutional owner. The
design below handles this identically to the solo case; only `squad_max` differs.

---

## 3. What's pending

| # | Gap | P |
| --- | --- | --- |
| G1 | No entry path that doesn't require an organisation | P0 |
| G2 | `enrollSelf` and `teamCreate` guards hard-require org admin rights | P0 |
| G3 | No way to invite a friend into an ad-hoc squad | P0 |
| G4 | Standings, Discover, org typeahead and benchmarks would surface personal orgs as clutter | P0 |
| G5 | An individual entrant's identity displays as an org name, not a person's name | P0 |
| G6 | No org-free approval flow — organisers see a fake org in the approvals queue | P1 |
| G7 | Ranking-event competitors still have no persistent identity | P1 → owned by [04](04-people-and-player-records.md) §4.6 |

---

## 4. What we could do

### 4.1 The chosen approach: hidden personal orgs  ✅ decided

On a person's first independent entry, silently create:

```
organizations(kind='personal', name=<person's name>, created_by=<user>, verified=false)
organization_members(user_id=<user>, role='owner', status='active')
```

…then run the existing enrolment and team flow unchanged.

**Why this over making the FKs nullable.** The alternative — `entrant_type ∈
org|independent` with nullable org columns — is conceptually honest but expensive:
`standings.organization_id` is NOT NULL and the standings service aggregates *per
organization* at three scopes; `championship_organizations` is the approval row and the
join target for `team_entries`; the public share pages, the matrix importer and every
`group by organization_id` query would need a null branch. That is a wide, low-reward
refactor of the most load-bearing part of the system.

The personal org costs one column value and a set of display/filter rules. Everything
downstream — approvals, rosters, fixtures, standings, share links, notifications —
keeps working with zero changes.

**The honest downside:** the data model says "organisation" where the domain means
"person". Mitigations are in §4.3 and §4.5; the target-state note is in §4.6.

### 4.2 Guard changes (G2)

Two guards need a new branch, both small and both in
[`permissions.ts`](../../apps/api/src/http/middleware/permissions.ts):

```ts
// enrollSelf: allow enrolling your own personal org
const enrollSelf = asyncHandler(async (req, _res, next) => {
  const u = req.user!;
  if (u.isSuperAdmin) return next();
  if (await orgRole(u.id, req.body?.organization_id, ORG_ADMIN)) return next();
  throw new ForbiddenError('Only an organization owner/admin can enroll that organization');
});
```

No change is actually needed here — the personal org's creator **is** its `owner`, so
`orgRole()` already passes. Same for `teamCreate` and `teamManager`.

**This is the strongest argument for the approach: the authorisation layer needs no
changes at all.** The only new server-side logic is provisioning.

What *is* needed is a guard on abuse: cap personal orgs at **one per user**, enforced by
a partial unique index, so the feature can't be used to spam the org table.

```sql
create unique index if not exists uq_personal_org_per_user
  on organizations (created_by) where kind = 'personal';
```

### 4.3 Hiding personal orgs (G4)

A personal org must never appear where a real organisation is expected. Audit list —
every one of these needs a `kind <> 'personal'` filter:

| Surface | File |
| --- | --- |
| Org typeahead / directory read | [`organizations.routes.ts`](../../apps/api/src/modules/iam/organizations.routes.ts) `GET /` |
| Platform org master list | [`PlatformInstitutionsPage.tsx`](../../apps/web/src/pages/platform/PlatformInstitutionsPage.tsx) |
| "Your communities" | [`OrganizationsPage.tsx`](../../apps/web/src/pages/OrganizationsPage.tsx) |
| Invite picker | [`InvitePanel.tsx`](../../apps/web/src/components/InvitePanel.tsx) |
| Join-an-org modal | [`JoinOrgModal.tsx`](../../apps/web/src/components/JoinOrgModal.tsx) |
| Matrix importer section→org matching | [`matrix-import.routes.ts`](../../apps/api/src/modules/import/matrix-import.routes.ts) |
| Peer benchmark aggregates | [08](08-reports-impact-exports.md) — **hard privacy requirement** |
| Org-level reports & counts | [08](08-reports-impact-exports.md) |

**Recommendation: make the filter the default, not an opt-in.** Add a shared
`visibleOrgsWhere()` helper in the API and have list endpoints use it, so a new list
route inherits the exclusion instead of forgetting it. A personal org leaking into the
platform directory is the most likely way this feature goes wrong.

### 4.4 Display identity (G5)

Wherever an entrant is shown — standings rows, fixture cards, approvals, public share
pages — a personal org must render as the **person**, not the org row:

```
kind = 'personal'  →  show the owner's name + avatar, no org logo, no "Verified" chip
                      optionally suffixed "(Individual)" in standings
```

Best implemented once as a `displayEntrant(org, owner)` helper in
`packages/shared`, used by both the API's serialisers and the web display components,
rather than as ten independent ternaries.

Ad-hoc squads keep the squad name the creator chose (`teams.name`) — the personal org
stays invisible entirely.

### 4.5 The entry UX

The important half. The user experience must be:

```
Discover → [Championship] → Enter
   ┌─ Enter as … ────────────────────────────────┐
   │  ○ IIM Bangalore        (your organisation) │
   │  ○ Just me              (individual entry)  │
   │  ○ A group of friends   (name your squad)   │
   └─────────────────────────────────────────────┘
```

- **"Just me"** — provision personal org, enrol, create a 1-person team, enter the draw,
  all in one server call. The user sees one confirmation.
- **"A group of friends"** — same, plus a squad name and the existing
  `teams.invite_token` share link (`GET /teams/by-token/:token` + `/join`) so friends
  can join themselves. **That mechanism already exists and needs no work** — it is the
  single best-fitting piece of existing code for G3.
- Entry types are honoured: if the draw is `individual`, skip the squad question
  entirely; if `doubles`, ask for exactly one partner.

One new endpoint doing the whole chain atomically:

```
POST /api/championships/:id/enter-solo
  { mode: 'individual' | 'squad', squad_name?, tournament_discipline_id }
  → { organization, team, team_entry, championship_organization }
```

Wrapped in `prisma.$transaction` — a half-created personal org with no entry is exactly
the litter this design must avoid.

**Approval (G6):** individual entries still land in the organiser's approvals queue as
`championship_organizations` rows, which is correct — organisers should control who
enters. [`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) just
needs to render them as people rather than institutions, via the same
`displayEntrant()` helper. Organisers who don't want individual entries should be able
to switch them off per championship — a `settings.allowIndividualEntry` flag on the
championship, defaulting to on for public championships and off for private ones.

### 4.6 Target state, recorded so nothing blocks it

The personal org is a pragmatic shim. If the product later needs true independent
entrants — most likely when standings need to rank individuals against each other rather
than orgs — the migration path is:

1. Add `entrant_type` to `team_entries` and `standings`
2. Make `organization_id` nullable on both
3. Backfill: personal orgs become `entrant_type='independent'` with `user_id` set
4. Delete the personal org rows

Because all personal orgs are marked by `kind` and capped one-per-user, that backfill is
a single deterministic query. **Nothing in this module should introduce a
personal-org-specific column elsewhere**, which would make step 3 harder.

---

## 5. Data model changes

Minimal — that is the point.

| Change | Table | Notes |
| --- | --- | --- |
| `kind = 'personal'` | `organizations` | Column already added by [01](01-identity-tenancy-workspace.md) — **do not add it twice** |
| unique index `uq_personal_org_per_user` | `organizations` | Partial, on `created_by where kind='personal'` |
| `+ settings.allowIndividualEntry` | `championships` | Or a plain boolean column; a `settings` jsonb on championships doesn't exist yet, so a boolean is simpler |

No new tables. No nullable-FK migrations. No changes to `standings`, `team_entries`,
`teams` or `fixtures`.

---

## 6. API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/championships/:id/enter-solo` | authed | The whole chain, transactional |
| `GET` | `/api/me/personal-org` | authed | Resolve or report absence |
| — | `GET /api/organizations` | *changed* | Exclude `kind='personal'` by default |
| — | `PATCH /api/championships/:id` | *changed* | Accepts `allow_individual_entry` |

Existing endpoints (`/enroll`, `/teams`, `/teams/:id/entries`, `/teams/by-token/:token`)
are **unchanged** and continue to work for the org path.

---

## 7. UI surface

| Surface | Change |
| --- | --- |
| [`DiscoverPage.tsx`](../../apps/web/src/pages/DiscoverPage.tsx) `ApplyModal` | Three-way "Enter as…" chooser replacing the current org-picker-or-create |
| Squad invite | Reuse `teams.invite_token` share link; surface it right after squad creation |
| [`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) | Render individual entrants as people |
| Standings / fixtures / public pages | `displayEntrant()` — person name for `kind='personal'` |
| `EventSettingsPage.tsx` | "Allow individual entries" toggle |
| Org lists everywhere | Personal orgs filtered out |
| Participant home | An individual entry appears under Championships like any other |

---

## 8. Dependencies

**Blocked by**

- [01](01-identity-tenancy-workspace.md) — only for the `kind` column. If 01 slips, this
  module can ship the column itself; just make sure only one migration adds it.

**Blocks (soft)**

- [08](08-reports-impact-exports.md) — peer benchmarks and institution counts must
  exclude `kind='personal'`. Getting this wrong inflates every platform-level statistic.

**Independent of** 02, 03, 04, 06, 07, 09 — this module can be built by one person in
parallel with anything.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **Personal orgs leaking into directories** | The most likely failure. Mitigate with the shared `visibleOrgsWhere()` default rather than per-route filters. Add a test asserting `GET /organizations` never returns `kind='personal'`. |
| Statistics inflation | "N organisations on the platform" quietly becomes "N orgs + every solo entrant". Audit every count query, not just list queries. |
| Standings semantics | An individual ranked in an org-aggregated table is conceptually odd but visually fine — they are one entrant among many. It becomes genuinely wrong only if an org's *aggregate* score is compared against a single person's. Flag to product: is a mixed championship (institutions + individuals) intended, or are individual entries only for open/public events? |
| Orphan personal orgs | A user who starts an entry and abandons it leaves a personal org. Transactional creation prevents the half-state; a periodic sweep for personal orgs with zero entries older than 30 days handles the rest. The `demo-teardown.service.ts` manifest pattern is a working precedent for a sweep. |
| Abuse | One personal org per user, enforced by index. Entries still need organiser approval. Low risk. |

**Open question for product:** should individual entrants be allowed into *private*
championships at all? Current recommendation: no — default the flag off for private, on
for public.

---

## 10. Effort

| Workstream | Size |
| --- | --- |
| `kind='personal'` semantics + one-per-user index | **S** |
| `POST /championships/:id/enter-solo` transactional chain | **S** |
| `visibleOrgsWhere()` helper + apply across ~8 list surfaces | **M** |
| `displayEntrant()` helper + apply across standings/fixtures/approvals/public pages | **M** |
| "Enter as…" UX in `ApplyModal` + entry-type awareness | **M** |
| Squad invite (reuse existing invite token) | **S** |
| `allow_individual_entry` flag + settings toggle | **S** |
| Orphan sweep | **S** |
| **Module total** | **M** |
