# Module 06 — Verification Pipeline & Result Integrity

> **PRD:** §8.1 *"The verification pipeline (the product's spine)"* · §9 NFR
> *"Immutability & integrity: locked scorecards … are append-only/immutable; corrections
> only via privileged, audited flows"* · FR-EVD-6 (Verified badge) · FR-PRO-2 (timeline
> from locked events only)
> **Blocked by:** [03 Audit](03-rbac-module-access-audit.md) *(soft, but land the audit half first)*
> **Blocks:** [04b Lifetime Record](04-people-and-player-records.md), [07 Certificates](07-achievements-certificates.md), [08 Reports](08-reports-impact-exports.md)
> **Size:** **M** — *and it is the highest-leverage module in the entire plan*
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

Every "verified", "permanent", "immutable" and "system of record" claim in the PRD
resolves to this one mechanism. Today it does not exist.

The scope is a single state machine on a scorecard — `draft → submitted → locked` — and
one transaction that fires on lock and propagates everywhere. Nothing more.

It is deliberately narrow. Resist adding scoring features here; the scoring engine is
already good.

---

## 2. What we have today

### 2.1 Scoring is deep and well-built

This is worth saying before the criticism, because the criticism is narrow.

- **Four fixture generators** with unit tests —
  [`knockout.ts`](../../apps/api/src/modules/fixtures/domain/generators/knockout.ts),
  `round-robin.ts`, `groups.ts`, `ranking.ts`, dispatched by `index.ts`, tested in
  [`generators.test.ts`](../../apps/api/src/modules/fixtures/domain/generators/generators.test.ts)
- **A 1,726-line match console** —
  [`MatchConsolePage.tsx`](../../apps/web/src/pages/official/MatchConsolePage.tsx) —
  covering `LiveConsole`, `TieConsole`, `EventConsole`, `EventRankingConsole`,
  `ManualResult`, `CricketManualResult`, `CricketDeck`, `DirectResult`, `WalkoverButton`,
  `AwardsPanel`, `CustomPointsPanel`, `ScorecardPanel`
- **A typed template system** — [`scoring.ts`](../../packages/shared/src/scoring.ts):
  `FormatTemplate` with `fixtureType ∈ single|tie|event`, `scoringMode ∈
  detailed|manual`, contest archetypes `points|sets|rally|cricket|time`
- **A standings engine** —
  [`schemes.ts`](../../apps/api/src/modules/standings/domain/schemes.ts) (pure, tested)
  and `standings.service.ts` (474 lines), five schemes, ordered tiebreakers,
  most-specific-wins rule resolution, three aggregation scopes
- **Knockout auto-advance and bye propagation** — `advanceWinner`, `propagateByes`

### 2.2 …and any of it can be silently rewritten, forever

`PATCH /fixtures/:id/result`
([`fixtures.routes.ts:449`](../../apps/api/src/modules/fixtures/fixtures.routes.ts)):

```ts
router.patch('/fixtures/:id/result', guards.fixtureScorer, validateBody(fixtureResultSchema),
  asyncHandler(async (req, res) => {
    await assertChampionshipStarted(prisma, req.params.id);
    // …validates teams are set and the winner is one of them…
    const updated = await prisma.fixtures.update({
      where: { id: req.params.id },
      data: { home_score: home, away_score: away, winner_team_id: winner,
              status: req.body.status ?? 'completed', … },
    });
```

There is **no state check on the fixture's current status.** A completed match can be
re-scored an unlimited number of times, by any `fixtureScorer` (the assigned official
*or* any championship organiser *or* any super admin), with:

- no record that it changed
- no record of the previous value
- no record of who changed it
- no notification to anyone
- automatic silent recomputation of standings

The only gate is `assertChampionshipStarted` — which blocks scoring *before* the
championship goes `ongoing`, and nothing after.

The same is true of `PATCH /fixtures/:id/live`, `/points`, `/awards` and `/scorecard`.

### 2.3 The propagation that exists is explicitly best-effort

```ts
// Rebuild standings after a fixture's score/status changes. Best-effort: the result
// is already committed, so a recompute hiccup must not fail the scorer's request.
async function refreshStandings(prisma: Prisma, fixtureId: string): Promise<void> {
  try {
    await recomputeStandingsForFixture(prisma, fixtureId);
  } catch (err) {
    console.error(`[standings] recompute failed for fixture ${fixtureId}:`, err);
  }
}
```

That is a **reasonable decision for a live-scoring hot path** — you do not want a
standings bug to block an official mid-match. But it is the exact opposite of PRD §8.1:

> *"This pipeline must be transactional: a lock either fully propagates or fails cleanly."*

Both behaviours are correct in their place. The resolution in §4.3 is to keep
best-effort on live writes and make **lock** the transactional boundary.

### 2.4 The only immutability-flavoured thing in the codebase

Deleting a sport or discipline is refused if any fixture is played or scored —
`beforeDelete` hooks in
[`server.ts:142-156`](../../apps/api/src/http/server.ts). The same protection exists on
organisation deletion. So the codebase already understands "played results are
precious"; it just never applied the idea to the results themselves.

Note also: **"roster lock" is a different feature.** `team_entries` lock/unlock
(`POST /teams/:id/entries/:entryId/lock`) freezes a squad for a championship and is
fully reversible by design. Do not confuse the two in conversation or in code naming.

### 2.5 The dead table

`fixture_events` (`20260627000000_fixture_events.sql`) — a normalised projection of
`live_log`:

```
(id, fixture_id, rubber_key, team_side, event_key, label, points,
 player_user_id, segment, seq, created_at)
```

Applied to the database, **absent from `schema.prisma`**, and **nothing reads or writes
it**. The migration header calls it a pending projection. It is a decision this module
should settle — see §4.6.

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | No scorecard state machine; no `locked` state | §8.1 | P0 |
| G2 | No `locked_at` / `locked_by` | §9 | P0 |
| G3 | Results are unconditionally rewritable after completion | §9 | P0 |
| G4 | No transactional propagation on lock | §8.1 | P0 |
| G5 | No audit of score changes | FR-ADM-2 | P0 |
| G6 | No correction / amendment flow | §9 | P0 |
| G7 | "Verified" badge on the Results tab means nothing | FR-EVD-6 | P0 |
| G8 | No submit step — officials cannot hand off for review | §8.1 | P1 |
| G9 | Lifetime entries, achievements, certificates have no trigger to fire from | FR-PRO-2, FR-CRT-2 | P0 |
| G10 | `fixture_events` is dead — decide writer or drop | — | P2 |
| G11 | No dispute/challenge record | §9 | P2 |

---

## 4. What we could do

### 4.1 The state machine

```
        record score            submit              lock
draft ──────────────▶ draft ──────────▶ submitted ────────▶ locked
  ▲                                         │                  │
  └────────── unlock (audited) ─────────────┴──────────────────┘
                  requires 'fixture.unlock'
```

```sql
alter table fixtures
  add column if not exists scorecard_status text not null default 'draft',
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references users(id) on delete set null,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references users(id) on delete set null,
  add column if not exists lock_version int not null default 0;

alter table fixtures add constraint fixtures_scorecard_status_check
  check (scorecard_status in ('draft','submitted','locked'));

create index if not exists idx_fixtures_scorecard_status
  on fixtures (tournament_discipline_id, scorecard_status);
```

`lock_version` increments on each unlock→relock so downstream artefacts (certificates,
lifetime entries) can be matched to the version of the result they were generated from.
Cheap now, essential when a corrected result must invalidate a printed certificate.

**Enforcement — one guard, applied to five routes.** All of `/result`, `/live`,
`/points`, `/awards`, `/scorecard` gain:

```ts
async function assertNotLocked(prisma: Prisma, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId }, select: { scorecard_status: true },
  });
  if (fx?.scorecard_status === 'locked') {
    throw new BusinessRuleError(
      'This scorecard is locked. A locked result can only be changed through a correction.');
  }
}
```

That single function closes G3 across the whole surface. It is a two-hour change and it
is the difference between a scoring app and a system of record.

### 4.2 Who may do what

Maps onto the permissions from [03](03-rbac-module-access-audit.md):

| Action | Permission | Who, today |
| --- | --- | --- |
| Record / edit while `draft` | `fixture.score` | assigned official, organiser, super |
| Submit | `fixture.score` | the scorer |
| **Lock** | `fixture.lock` | **organiser only — not the scoring official** |
| Unlock / correct | `fixture.unlock` | organiser; consider restricting to a senior role |

The separation matters: PRD §8.1 has the scorer submit and *"an authorised role reviews
and Locks"*. A scorer who can lock their own card provides no review. If
[03](03-rbac-module-access-audit.md) hasn't landed, express this with the existing
`organisesChampionship()` check and retrofit the permission later.

### 4.3 The lock transaction — the actual spine

One function. One `prisma.$transaction`. Everything or nothing.

```ts
export async function lockScorecard(prisma: Prisma, fixtureId: string, actor: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const fx = await loadFixtureForLock(tx, fixtureId);

    assertLockable(fx);                    // status submitted|draft, teams set, scores present

    // 1 · publish the verified result
    await tx.fixtures.update({ where: { id: fx.id },
      data: { scorecard_status: 'locked', locked_at: new Date(), locked_by: actor.id,
              status: 'completed' } });

    // 2 · advance the bracket (existing logic, moved inside the transaction)
    await advanceWinner(tx, fx);

    // 3 · standings — NOT best-effort here; a failure must roll the lock back
    await recomputeStandingsForFixture(tx, fx.id);

    // 4 · lifetime entries for every participant        → module 04
    await writeLifetimeEntries(tx, fx);

    // 5 · achievements: medals, placements, awards       → module 07
    await deriveAchievements(tx, fx);

    // 6 · queue certificates                             → module 07
    await queueCertificates(tx, fx);

    // 7 · audit                                          → module 03
    await auditInTx(tx, { action: 'fixture.locked', … });

    return fx;
  });
}
```

Steps 4–6 are **no-op stubs until their modules land**. Build the transaction with the
stubs in place — that way 04, 07 and 08 each plug into an existing seam rather than
re-opening this code.

Step 8, outside the transaction: notify participants
([02](02-communications.md)) once committed. Never inside — an email cannot be rolled
back.

**Transaction-scope caution.** `recomputeStandingsForFixture` currently takes the
`PrismaClient`. It must accept a transaction client instead
(`Prisma.TransactionClient`). Check `standings.service.ts` for raw `$queryRaw` /
`$executeRaw` calls — those need the tx client too or they will run outside the
transaction and silently break atomicity. This is the single most likely implementation
bug in the module.

**Timeout caution.** The runtime uses the Supabase transaction pooler with
`connection_limit=5`. A lock transaction touching six tables is fine, but a *bulk* lock
of 50 fixtures must not be one transaction. Lock per fixture, loop outside.

### 4.4 Corrections (G6)

PRD: *"corrections only via privileged, audited flows"*. Do **not** allow silent edits
of a locked card.

```
POST /api/fixtures/:id/unlock   { reason }      requires 'fixture.unlock'
```

The unlock transaction is the lock transaction in reverse: reverse the standings
contribution, mark derived `lifetime_entries` and `achievements` as superseded, revoke
queued or issued certificates for that `lock_version`, write an audit entry carrying the
reason, and return the card to `submitted`. Re-locking increments `lock_version`.

`reason` is mandatory. An unlock without a stated reason is the thing the audit trail
exists to prevent.

Consider surfacing corrections publicly on the results view — "Result amended
12 Aug 2026" — which is what sports federations do and what makes the record credible.

### 4.5 What "Verified" means (G7)

Once this lands, FR-EVD-6's badge has a definition:

> **Verified** = `scorecard_status = 'locked'`

Results not locked show as provisional. Standings computed from unlocked results should
be labelled "Provisional standings". This is a small copy change with a large effect on
how seriously an institution treats the numbers.

### 4.6 Settle `fixture_events` (G10)

Three options:

| Option | Assessment |
| --- | --- |
| **Write it during lock** | Project `live_log` into normalised rows at lock time, giving queryable per-player match events (goals, points) — which is what [04](04-people-and-player-records.md)'s per-sport career stats (FR-PRO-3) actually needs. Adds one step to the transaction. |
| Write it live | Doubles the write cost on the hot scoring path for no immediate benefit. |
| **Drop the table** | Honest, removes drift, but throws away the per-player statistics substrate. |

**Recommendation: write it during lock.** FR-PRO-3 asks for "appearances, goals, MVP
awards" — `live_log` already contains player-attributed events but as unqueryable JSON.
Projecting at lock is the cheapest way to make career statistics real, and it fits the
"lock is when data becomes canonical" model precisely.

If per-player stats are cut from scope, drop the table instead. Leaving it dead is the
only bad answer.

### 4.7 Bulk lock

Organisers will not lock 60 fixtures individually. Provide
`POST /api/championships/:id/fixtures/lock-bulk` taking fixture ids, looping
`lockScorecard` per fixture, returning a per-fixture result array. Partial success is
correct here — one unlockable fixture should not block the other 59.

Surface it on [`ResultsPage.tsx`](../../apps/web/src/pages/organiser/ResultsPage.tsx)
with the existing `BulkBar`.

---

## 5. Data model changes

| Change | Table |
| --- | --- |
| `+ scorecard_status, submitted_at, submitted_by, locked_at, locked_by, lock_version` | `fixtures` |
| CHECK + index on `scorecard_status` | `fixtures` |
| `+ superseded_at`, `+ lock_version` | `lifetime_entries`, `achievements`, `certificates` *(defined in [04](04-people-and-player-records.md)/[07](07-achievements-certificates.md); noted here because the lock/unlock transaction is what writes them)* |

One migration: `…_scorecard_lock.sql`. Additive, idempotent. Backfill decision:
**existing completed fixtures stay `draft`.** Do not retroactively mark historical
results as verified — that would be the first lie the audit trail tells. If historical
data must be treated as canonical, lock it deliberately with `locked_by = null` and
`source='migrated'` so it is distinguishable forever.

---

## 6. API surface

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/fixtures/:id/submit` | `fixture.score` | draft → submitted |
| `POST` | `/api/fixtures/:id/lock` | `fixture.lock` | The transaction |
| `POST` | `/api/fixtures/:id/unlock` | `fixture.unlock` | Requires `reason` |
| `POST` | `/api/championships/:id/fixtures/lock-bulk` | `fixture.lock` | Per-fixture results |
| `GET` | `/api/championships/:id/lock-status` | `event.manage` | Counts by state, for the dashboard queue |

**Changed:** `/result`, `/live`, `/points`, `/awards`, `/scorecard` all gain
`assertNotLocked`. This is a **behavioural break** for any client that re-PATCHes a
completed fixture — check the match console's retry/resume paths before shipping.

---

## 7. UI surface

| Surface | Change |
| --- | --- |
| [`MatchConsolePage.tsx`](../../apps/web/src/pages/official/MatchConsolePage.tsx) | "Submit scorecard" action; read-only mode when locked, with a clear locked banner |
| [`ResultsPage.tsx`](../../apps/web/src/pages/organiser/ResultsPage.tsx) | Status column (Draft / Submitted / **Verified**); Lock action; bulk lock via `BulkBar`; "Amend" behind a confirm |
| [`StandingsPage.tsx`](../../apps/web/src/pages/organiser/StandingsPage.tsx) | "Provisional" label while unlocked results exist |
| Org dashboard ([01](01-identity-tenancy-workspace.md)) | "N scorecards ready to lock → Lock" — the PRD's FR-DASH-2 CTA finally has a target |
| [`PublicChampionshipPage.tsx`](../../apps/web/src/pages/public/PublicChampionshipPage.tsx) | Verified badge; amendment notice |
| Correction dialog | `confirmDialog()` + mandatory reason textarea |

---

## 8. Dependencies

**Blocked by**

- [03](03-rbac-module-access-audit.md) — soft. The lock works without audit, but an
  unaudited lock is a contradiction. **Land 03's audit half before this module**, and
  the RBAC half can follow.

**Blocks (all hard)**

- [04b](04-people-and-player-records.md) — FR-PRO-2 is explicitly "from locked events"
- [07](07-achievements-certificates.md) — certificates generate "from verified results"
- [08](08-reports-impact-exports.md) — reports over mutable data are not reportable

**Build order note:** implement the transaction with **stubbed steps 4–6** so 04 and 07
plug in without reopening this file. That is what makes this an M and not an L.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **Transaction-client plumbing** | `recomputeStandingsForFixture` and any raw SQL inside it must run on the tx client. Getting this wrong produces a transaction that *looks* atomic and isn't — the worst failure mode, because it passes review. Verify with a deliberate failure-injection test. |
| Pooler + long transactions | `connection_limit=5` on the transaction pooler. Keep the lock transaction tight; never bulk-lock inside one transaction. |
| Behavioural break for the console | The console currently re-PATCHes freely. Audit its resume/retry paths against `assertNotLocked` before release. |
| Organisers locking too early | Locking is meant to be a commitment, and people will lock by accident. Require confirmation, make unlock available to organisers (not just super admins), and make the amendment trail visible rather than punitive. |
| Backfill temptation | Someone will suggest marking all historical completed fixtures as locked so the Verified badge looks good. Don't. §5. |
| Standings reversal on unlock | Reversing a contribution is harder than adding one. Simplest correct approach: **recompute the whole scope from scratch** rather than subtracting. `standings.service.ts` already supports full recomputation; use it. |

**Open question:** should a locked result be *publicly* amendable-with-notice (federation
practice) or silently corrected? Recommendation: visible notice — it is the credibility
argument for the whole product.

---

## 10. Effort

| Workstream | Size |
| --- | --- |
| Schema: lock columns, CHECK, index, migration | **S** |
| `assertNotLocked` across the five write routes | **S** |
| Submit + lock + unlock endpoints and guards | **S** |
| `lockScorecard` transaction with stubbed downstream steps | **M** — *includes the tx-client plumbing, the real work* |
| Unlock/correction: standings reversal by full recompute, supersede downstream | **M** |
| Bulk lock | **S** |
| `fixture_events` projection at lock | **S** |
| Console read-only mode + submit action | **S** |
| Results page status column, lock UI, bulk bar, amend dialog | **M** |
| Verified/Provisional labelling across results, standings, public pages | **S** |
| Failure-injection tests for atomicity | **S** |
| **Module total** | **M** |

> **This is the best value-per-unit-effort in the plan.** An M-sized module that turns
> three PRD claims from false to true and unblocks three other modules.
