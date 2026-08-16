# Roadmap — Sequencing, Sizing & Risk

> Rolls up the nine module docs into a dependency-ordered build plan.
> Sizing is **T-shirt only** (S/M/L/XL) — no calendar, no dev-days. Convert to a
> schedule once team size and allocation are fixed.
>
> Read [00-index.md](00-index.md) first for the gap analysis and dependency graph.
>
> **Epic-level sequencing** — all 40 epics in six dependency-ordered waves, with the
> critical path — is in [`epics/01-execution-order.md`](epics/01-execution-order.md).
> The phases below are the same plan at module granularity.
>
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API
> (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process
> and a 15s synchronous ceiling — this is why Phase 3 carries queue infrastructure (R11).
> See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. The three things that decide this plan

**1. Communications is a cheap unlock that has no PRD section.**
FR-AUTH-3 (password reset), FR-AUTH-4 (OTP), FR-AUTH-6 (invitation links) and FR-CRT-2
(certificate delivery) all silently depend on being able to send email, and today the
API cannot. But a **Lambda email service already exists** — it has simply never been
wired to this project. We render branded HTML, it owns transport, retries and DNS. That
makes [02](02-communications.md) an **S** with zero upstream dependencies that unblocks
four requirements across two modules. **It goes first because it is cheap, not because
it is large.**

*The in-house notification service is a separate track with its own plan
([`docs/notification-service-plan.md`](../notification-service-plan.md)); its Supabase
Realtime transport is under POC and nothing here depends on the outcome.*

**2. The verification pipeline is the highest leverage work in the plan.**
[06](06-verification-pipeline.md) is an **M**. It turns three false PRD claims true
("verified", "immutable", "system of record"), and it unblocks
[04b](04-people-and-player-records.md), [07](07-achievements-certificates.md) and
[08](08-reports-impact-exports.md). Nothing else in the plan has that ratio. If a single
module ships this quarter, it is this one.

**3. "Roles & permissions" is a build, not an extension.**
The `roles` and `permissions` tables exist and have a CRUD screen, which makes
FR-ADM-3 look like a UI task. Nothing reads them — authorisation is hard-coded in
[`permissions.ts`](../../apps/api/src/http/middleware/permissions.ts). Sizing this as
"add a permissions page" would be wrong by an order of magnitude. It is an **L**, and the
riskiest work in the doc set because it retrofits under a live authorisation boundary.

---

## 2. Phased plan

Phases are **dependency-ordered, not calendar-ordered**. Within a phase, tracks A and B
are independent and can run concurrently.

---

### Phase 0 · Foundations and unblocking

*Goal: remove the invisible blockers and bank the cheap wins, so later phases are never
waiting on something small.*

| Track | Work | Module | Size |
| --- | --- | --- | --- |
| A | Email integration: typed client + env wiring, branded layout + 5 templates, dev sink, send log, rate limiting | [02](02-communications.md) | **S** |
| A | **Confirm the email service contract and who owns bounce/suppression** — *see [02 §5](02-communications.md); blocks nothing, but decides scope* | [02](02-communications.md) | **S** |
| A | `auth_tokens` + forgot-password + invitation links *(reuses the existing `must_change_password` flow)* — **pulled forward from Phase 1 now that email is available immediately** | [01](01-identity-tenancy-workspace.md) | **S** |
| B | Audit log table + `audit()` helper + append-only grants | [03](03-rbac-module-access-audit.md) | **S** |
| B | Instrument ~25 privileged actions | [03](03-rbac-module-access-audit.md) | **M** |
| B | **Narrow `GET /organizations`** — closes the open cross-tenant read | [01](01-identity-tenancy-workspace.md) | **S** |
| B | Quick wins: matrix-import re-route, bulk approval, delete 3 dead pages, vocabulary rename | [09](09-championship-core-deltas.md) | **S** |

**Exit criteria**
- A password-reset email arrives in a real `.ac.in` inbox, rendered correctly in Gmail
  **and** Outlook
- An invited user receives a link and sets their own password — no relayed temp password
- Every privileged action writes an audit row; the log cannot be updated or deleted
- `GET /api/organizations` no longer returns every organisation on the platform
- An organiser can reach matrix import without super-admin rights

**Phase size: M** — *was M when 02 was a full email build; stays M because the freed
capacity absorbed the auth flows pulled forward from Phase 1.*

---

### Phase 1 · The spine and the tenant

*Goal: make "verified" mean something, and make an institution a real tenant with a
workspace to stand in.*

| Track | Work | Module | Size |
| --- | --- | --- | --- |
| A | **Verification pipeline** — lock state machine, `assertNotLocked`, lock transaction with stubbed downstream steps, corrections, bulk lock, Verified/Provisional labelling | [06](06-verification-pipeline.md) | **M** |
| A | Event status report (nearly unblocked, immediately useful) | [8a](08-reports-impact-exports.md) | **S** |
| B | Org tier + `settings` + `org_domains` + email-first login | [01](01-identity-tenancy-workspace.md) | **M** |
| B | `org_units` (Programme/Batch) tree + editor | [01](01-identity-tenancy-workspace.md) | **M** |
| B | Forgot password, OTP, invitation links *(now unblocked by Phase 0)* | [01](01-identity-tenancy-workspace.md) | **M** |
| B | Third nav set, org identity block, org dashboard | [01](01-identity-tenancy-workspace.md) | **M** |
| C | **Flexible entry** — hidden personal orgs, "Enter as…" UX, squad invites | [05](05-flexible-entry.md) | **M** |
| C | Championship deltas: coach, `type`, Live tab, template picker, region | [09](09-championship-core-deltas.md) | **M** |

**Exit criteria**
- A scorecard can be submitted, locked, and cannot then be edited
- A locked result propagates atomically — or fails cleanly, verified by failure injection
- An institution admin logs in via their work domain and lands on an org dashboard
- A solo player enters a championship without seeing the word "organisation"

**Phase size: L** · *Track A is the priority; B and C are parallel capacity.*

---

### Phase 2 · Records and access control

*Goal: people become first-class, results become permanent history, and permissions
become configurable.*

| Track | Work | Module | Size |
| --- | --- | --- | --- |
| A | People directory: membership attributes, programme/batch, bulk import wiring, verification workflow, consent capture | [04a](04-people-and-player-records.md) | **M** |
| A | Lifetime record: `lifetime_entries` written by the lock, per-sport career stats, profile page, right-to-erase | [04b](04-people-and-player-records.md) | **L** |
| B | Achievements: typed records derived at lock, award-type catalogue, claims + validation queue, org Hall of Fame | [07a](07-achievements-certificates.md) | **M** |
| C | RBAC engine: permission catalogue, `role_permissions`, `can()`, retrofit the 7 guards, org roles, matrix UI, module access | [03](03-rbac-module-access-audit.md) | **L** |

**Exit criteria**
- An admin sees every person in their institution, with verification states and filters
- A locked result appears on the participant's permanent profile automatically
- "Medals won" is a real countable number
- `can()` backs every existing guard, with the original tests green

**Phase size: L**

**Sequencing note:** 04b and 07a both plug into the lock transaction's stubbed steps from
Phase 1. Doing them close together avoids reopening that code twice.

---

### Phase 3 · Artefacts and intelligence

*Goal: the outputs an institution actually shows people — certificates and the annual
report.*

| Track | Work | Module | Size |
| --- | --- | --- | --- |
| A | **Rendering spike** — one certificate template + QR, end to end | [07b](07-achievements-certificates.md) | **S** |
| A | Certificates: schema, gapless numbering, renderer + 4 layouts, generation queue, register, public QR verification, revocation | [07b](07-achievements-certificates.md) | **L** |
| B | Org reports: season helper, snapshots, four aggregations, charting, reports page | [8b](08-reports-impact-exports.md) | **L** |
| B | Export service + Annual Impact Report *(shares the job queue with 07b — sequence after it)* | [8c](08-reports-impact-exports.md) | **L** |

**Exit criteria**
- A batch of participation certificates generates, issues, and verifies by QR
- A corrected result revokes its certificates and queues replacements
- An Annual Sports Impact Report exports as a branded PDF from locked data only

**Phase size: XL**

---

### Phase 4 · Deferred by recommendation

Not "later" as a euphemism — these are deliberate deferrals with stated reasoning.

| Work | Module | Size | Why deferred |
| --- | --- | --- | --- |
| SSO (Google / Microsoft) | [01](01-identity-tenancy-workspace.md) | **L** | P2. Don't hand-roll OAuth. Decide the Supabase-Auth question *before* starting. |
| **RLS / real tenant isolation** | cross-cutting | **L** | Not a PRD line item, but the NFR claims it. Needs its own project. **See §5.** |
| PPT export | [8c](08-reports-impact-exports.md) | **M** | P1, fiddliest, least used. Ship PDF + Excel first. |
| Realtime scoring (≤3s NFR) | [09](09-championship-core-deltas.md) | **L** | Measure the current 10s poll before committing to websockets. |
| Share cards | [07a](07-achievements-certificates.md) | **M** | P1. Most visible, least load-bearing. |
| Multiple emails per person | [04](04-people-and-player-records.md) | **S** | P2. |
| Scale verification (2,000 users / 25 concurrent matches) | — | **S** | `perf-http.ts` / `perf-score.ts` exist. **Run them and publish a baseline** before the number is promised to anyone. |

---

## 3. Sizing roll-up

| Module | Size | Split |
| --- | --- | --- |
| [01 Identity, Tenancy & Workspace Shell](01-identity-tenancy-workspace.md) | **XL** | **L if SSO deferred** — which is the recommendation |
| [02 Communications](02-communications.md) | **S** | Email wiring only — the service exists. Notification service is a [separate track](../notification-service-plan.md). |
| [03 RBAC, Module Access & Audit](03-rbac-module-access-audit.md) | **L** | Audit half is **M**, ship it first and separately |
| [04 People & Player Records](04-people-and-player-records.md) | **L** | 4a **M** · 4b **L** |
| [05 Flexible Entry](05-flexible-entry.md) | **M** | — |
| [06 Verification Pipeline](06-verification-pipeline.md) | **M** | **Highest leverage in the plan** |
| [07 Achievements & Certificates](07-achievements-certificates.md) | **L** | 7a **M** · 7b **L** |
| [08 Reports, Impact & Exports](08-reports-impact-exports.md) | **L** | 8a **S** · 8b **L** · 8c **L** |
| [09 Championship Core Deltas](09-championship-core-deltas.md) | **M** | Fully parallelisable |

**By phase:** 0 = M · 1 = L · 2 = L · 3 = XL · 4 = deferred

**Distribution:** 1 XL, 4 L, 4 M. The weight sits in Phase 3, which is also the phase
most safely cut or staged if the timeline compresses — certificates and reports are
valuable but nothing depends on them.

---

## 4. Parallelisation

Three independent tracks exist from Phase 1 onward:

```
Track A  (critical path)   02 → 06 → 04b → 07a → 07b
Track B  (tenancy/access)  02 → 01 → 03  → 04a → 08b/8c
Track C  (independent)     05, 09, 8a          — no dependencies, any time
```

Track C is the natural home for a third developer, someone new to the codebase, or work
done while A or B is blocked. It contains 4 P0 gaps and needs an explicit owner —
see §5.

---

## 5. Risk register

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | **No RLS, no tenant isolation** while the NFR claims "strict org-level data isolation". `GET /organizations` is currently an open read of every institution. | Cross-tenant data exposure; a claim in sales material that isn't true | Narrow the endpoint in **Phase 0** (S). Schedule RLS as its own project. **Do not claim isolation until it exists.** |
| R2 | **Module 09 never gets scheduled** because PRD §6.5–6.8 are struck through as already built | 13 gaps including 4 P0s silently dropped | Give Track C a named owner in Phase 1 |
| R3 | **Communications forgotten** because it has no PRD section | Auth work stalls at 80% with no way to send a reset link | It is Phase 0, track A, and only an **S** — the email Lambda already exists. Confirm the contract and bounce ownership ([02 §5](02-communications.md)) before starting. |
| R15 | **Shared email service blast radius** | A send loop in SEMP degrades deliverability for every other project behind that Lambda | Global daily send cap with an alarm; rate-limit the two public trigger endpoints at the router |
| R4 | **RBAC retrofit loosens authorisation** under a live boundary with no RLS behind it | Silent privilege escalation | Wrap-don't-replace; expand [`permissions.test.ts`](../../apps/api/src/http/middleware/permissions.test.ts) **before** touching guards |
| R5 | **Lock transaction isn't actually atomic** — `recomputeStandingsForFixture` and its raw SQL must run on the tx client | Looks correct, passes review, corrupts standings | Failure-injection test as an explicit exit criterion of Phase 1 |
| R6 | Reports built on unlocked data | A polished report that contradicts the system a week later; trust damage worse than having no report | Hard rule: org reports count **locked results only**. Do not start 8b before 06. |
| R7 | Benchmark deanonymisation on a small platform | Privacy breach; explicit PRD "hard privacy rule" violation | k≥5 cohort floor, exclude self, exclude personal orgs, no org identifier in the return type |
| R8 | **Right-to-erase vs immutable lifetime profile** — the PRD requires both | Legal exposure, or a broken permanence promise | [04 §4.7](04-people-and-player-records.md) proposes erase-the-person-keep-the-result. **Needs sign-off, not implementation.** |
| R9 | Personal orgs leak into directories, counts and benchmarks | Inflated platform statistics; confusing UX | Shared `visibleOrgsWhere()` default + a test asserting exclusion |
| R10 | PDF/certificate rendering is capability the team hasn't built here | Phase 3 estimate is soft | Spike one template + QR end-to-end **before** committing to the template model |
| R11 | **The API is Lambda-only** (staging proven, Render retired), so there is no long-lived process for background work | Certificate generation and report exports have nowhere to run; both exceed the 15s function timeout | SQS → worker Lambda, specified in [07 §4.6](07-achievements-certificates.md). New infrastructure + IAM + local-dev story — cost it once in Phase 3 and let [8c](08-reports-impact-exports.md) reuse it. Email needs no worker (the email Lambda owns retries). |
| R12 | ~~D&I reporting has no source data~~ **Resolved 2026-08-12** — gender, DOB and scholarship status will be collected | Was: FR-RPT-4 and FR-RPT-2's headline KPI unbuildable | Collected in [04a](04-people-and-player-records.md) **with consent**, `prefer_not_to_say` first-class, aggregate display only. Residual risk is now sequencing: gate the D&I tab until 04a lands. |
| R13 | Scale NFR (2,000 users, 25 concurrent matches) is unverified | A number promised that may not hold | Run the existing perf probes; publish a baseline before it is committed |
| R14 | Migration collisions — 01, 04, 05 all touch `organizations`/`organization_members` | Rebase pain, duplicate columns | `organizations.kind` is added **once**, in 01. Sequence 01 before 04 and 05. |

---

## 6. Decisions already taken

Recorded so they are not relitigated.

| Decision | Choice | Where |
| --- | --- | --- |
| PRD "Organisation" vs today's `organizations` | Upgrade in place; `kind ∈ community\|institution\|personal` | [01 §4.1](01-identity-tenancy-workspace.md) |
| Solo / small-squad entry | Hidden auto-provisioned personal org; no schema surgery | [05 §4.1](05-flexible-entry.md) |
| RBAC approach | Wrap the existing guards with `can()`, don't replace | [03 §4.1](03-rbac-module-access-audit.md) |
| Audit capture | Explicit curated calls, not middleware auto-capture | [03 §4.5](03-rbac-module-access-audit.md) |
| Person attributes | On `organization_members`, not `users` — verification is per-institution | [04 §4.1](04-people-and-player-records.md) |
| PDF rendering | `@react-pdf/renderer`, not Puppeteer | [07 §4.5](07-achievements-certificates.md) |
| Email | Existing Lambda service; we render HTML, it delivers. Defer SMS. | [02 §4.1](02-communications.md) |
| Email dispatch path | API calls `sendEmail()` directly everywhere for now; the notification service consumes the same client later | [02 §6](02-communications.md) |
| Background jobs | SQS → worker Lambda (no long-lived process exists) | [07 §4.6](07-achievements-certificates.md) |
| Season | Derived from `settings.season`, not a new table | [08 §4.1](08-reports-impact-exports.md) |
| Executive summary | Templated slots, not LLM-generated, for v1 | [08 §4.6](08-reports-impact-exports.md) |
| Coach | `teams.coach_user_id`, not a squad role | [09 §4.1](09-championship-core-deltas.md) |
| Certificate numbering | Counter row with `SELECT … FOR UPDATE`, allocated at issue | [07 §4.4](07-achievements-certificates.md) |
| SSO | Deferred; decide the Supabase Auth question first | [01 §4.4](01-identity-tenancy-workspace.md) |

---

## 7. Open questions blocking estimates

Answers change scope. Collected in
[00-index §7](00-index.md#7-open-questions-for-the-prd-author).

| # | Question | Affects |
| --- | --- | --- |
| 1 | FR-EVD-5 is missing from the PRD — deleted or a numbering slip? | Coverage |
| 2 | PRD roles (Super Admin / Faculty Coordinator / Student Coordinator) vs DB roles — replacement or layer? | [03](03-rbac-module-access-audit.md) sizing |
| ~~3~~ | ✅ **Answered:** collect gender, DOB and scholarship status. Consent text still needs legal review before collection begins. | [04a](04-people-and-player-records.md) |
| 4 | Right-to-erase vs immutable profile — which wins? | [04b](04-people-and-player-records.md), legal |
| 5 | Is a coach a squad member, org member, or a team property? | [09](09-championship-core-deltas.md) |
| 6 | Certificate signatories — per org, per template, or per event? | [07b](07-achievements-certificates.md) template model |
| 7 | "2,000 consecutive users" — concurrent? | Scale commitment |
| 8 | Is PPT genuinely required for v1? | [8c](08-reports-impact-exports.md) sizing |
| 9 | Should individual entrants be allowed into private championships? | [05](05-flexible-entry.md) |
| ~~10~~ | ✅ **Answered:** add it, as `organization_members.scholarship`. Financially sensitive — aggregate display only, never in a named export. | [04a](04-people-and-player-records.md), [8b](08-reports-impact-exports.md) |

---

## 8. If the timeline compresses

Cut in this order, with reasoning:

1. **Phase 4 entirely** — already deferred by recommendation.
2. **8c Exports + Impact report** — high effort, and the reports remain viewable
   on-screen without it. Costs a §10 success metric, so flag it explicitly.
3. **8b Org reports** — valuable but nothing depends on them.
4. **7b Certificates** — genuinely painful to cut (it is the most visible artefact an
   institution gets) but nothing else breaks.
5. **03 RBAC engine** — keep the audit half, defer the permission engine. Hard-coded
   authorisation keeps working; only configurability is lost.

**Never cut:** [02](02-communications.md) (an **S** that unblocks auth), [06](06-verification-pipeline.md)
(blocks everything and is the product's core claim), and Phase 0's
`GET /organizations` narrowing (open security gap).

The minimum defensible release is **Phase 0 + Phase 1 + 04a**: an institution can log in
by domain, manage its people, run an event, and lock a verified result. That is a system
of record. Everything after it is leverage on that foundation.
