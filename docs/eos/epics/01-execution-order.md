# Execution Order

> Epic-level sequencing for all 40 epics, derived from their actual dependencies.
> The phases in [`99-roadmap.md`](../99-roadmap.md) are **module**-level; this is the
> same plan at the granularity you'd actually assign work at.
>
> **Runtime:** API on **AWS Lambda** + API Gateway; Render retired. No long-lived
> process, 15s synchronous ceiling. See [`DEPLOYMENT.md`](../../../DEPLOYMENT.md).

---

## 1. The shape of it

Six waves. **Waves are sequential.** Within a wave, epics are parallel **except for three
pairs** that have an internal order (§11). A wave ends when its exit criteria hold — not
on a date.

```
W0  Unblock          ██                    2 epics   · nothing depends on anything
W1  Foundations      ████████              8 epics   · the spine + the tenant
W2  Propagate        ████████              8 epics   · lock fans out; access model
W3  Records          ███████               7 epics   · people + permanent history
W4  Surface          ██████████           10 epics   · the things users see
W5  Artefacts        ████                  4 epics   · certificates + reporting
--  Held             █                     1 epic    · J4-E10, awaiting legal
```

### The critical path

Seven links deep. Everything else has slack; this doesn't.

```
J6-E3 ──▶ J2-E7 ──▶ J4-E1 ──▶ J4-E4 ──▶ J4-E6 ──▶ J4-E7 ──▶ J5-E5
audit     lock      propagate  achieve   template  issue     impact report
 (W0)      (W1)       (W2)      (W3)      (W4)      (W5)       (W5)
```

Two things follow from that, and they're the whole reason to read this doc:

- **J6-E3 (audit) is first, and it is not negotiable.** It's an S. Build the lock before
  it and your earliest, most consequential locks are the ones with no history — you
  cannot retrofit a record of something that already happened.
- **Slipping J2-E7 slips five epics**, across three journeys. Nothing else in the plan
  has that blast radius.

---

## 2. Wave 0 · Unblock

*Nothing here depends on anything. All of it unblocks something. Start today.*

| Epic | Title | Size | Why now |
| --- | --- | :-: | --- |
| **J6-E3** | Audit trail | **M** | ★ Critical path. Must precede the first lock. |
| **J6-E5** | Tenant isolation & data boundaries | **M** | S1 alone (narrowing `GET /organizations`) closes an open cross-tenant read — a same-day fix. |

**Plus two infrastructure items** that aren't user-facing epics but gate Wave 1:

| Work | Module | Size | Gates |
| --- | --- | :-: | --- |
| Email wiring — typed client, templates, dev sink, rate limits | [02](../02-communications.md) | **S** | J1-E2, J1-E3 |
| Hygiene — matrix-import re-route, dead pages, vocabulary, `render.yaml` | [09](../09-championship-core-deltas.md) | **S** | nothing, but it gets cheaper the earlier it's done |

**Also settle two things that cost nothing now and block later:**
- Confirm the **email service contract** and who owns bounce/suppression ([02 §5](../02-communications.md)).
- Get the **consent text** reviewed — it gates J1-E5 in Wave 3.

**Exit:** a password-reset email lands in a real `.ac.in` inbox · every privileged action
writes an immutable audit row · `GET /organizations` no longer returns every institution.

---

## 3. Wave 1 · Foundations

*The spine and the tenant. Four epics that unblock the rest, plus four with no
dependencies at all — good parallel capacity.*

| Epic | Title | Size | Depends on |
| --- | --- | :-: | --- |
| **J2-E7** ★ | Submit & lock scorecards | **M** | J6-E3 |
| **J1-E1** | Institution identity & verified tenancy | **M** | — |
| **J1-E2** | Email-first sign-in & account recovery | **M** | W0 email |
| **J1-E3** | Invite the sports office team | **M** | W0 email |
| J2-E1 | Create a championship from a template | **M** | — *(free)* |
| J2-E3 | Build the competition structure | **S** | — *(free)* |
| J3-E4 | Discover competitions to enter | **M** | — *(free)* |
| J3-E5 | My matches & my day | **S** | — *(free)* |

> **J1-E1 quietly gates three other epics** — J1-E4, J3-E1 and J6-E1 all need
> `organizations.kind` and `settings`. Land that column **once**, here.

**Exit:** a scorecard can be submitted, locked, and then not edited by anyone · an
institution admin signs in via their work domain · coordinators self-serve their own
passwords.

---

## 4. Wave 2 · Propagate

*The lock starts fanning out, and the access model lands.*

| Epic | Title | Size | Depends on |
| --- | --- | :-: | --- |
| **J4-E1** ★ | Locked results propagate atomically | **M** | J2-E7 |
| **J3-E1** ★ | Enter without an institution | **M** | J1-E1 |
| J1-E4 | Programme & batch structure | **M** | J1-E1 |
| J6-E1 | Roles & permissions | **L** | J1-E1 |
| J6-E4 | Correct a locked result | **M** | J2-E7, J6-E3 |
| J2-E2 | Open registration & approve entrants | **M** | — |
| J2-E4 | Schedule fixtures & assign officials | **S** | J2-E3 |
| J3-E2 | Build and manage a squad | **M** | — |

> **Build J4-E1 with its downstream steps stubbed.** J4-E2, J4-E4 and J4-E7 then plug
> into an existing seam in later waves instead of reopening the transaction three times.
> This is what keeps module 06 an M rather than an L.

> **J6-E1 is the riskiest epic in the plan** — retrofitting a permission engine under a
> live authorisation boundary with no RLS behind it. Expand
> [`permissions.test.ts`](../../../apps/api/src/http/middleware/permissions.test.ts)
> **before** touching any guard.

**Exit:** a lock propagates atomically or fails cleanly, proven by failure injection · a
solo player enters without meeting the word "organisation" · `can()` backs every existing
guard with the original tests green.

---

## 5. Wave 3 · Records

*People become first-class; results become permanent history.*

| Epic | Title | Size | Depends on |
| --- | --- | :-: | --- |
| **J4-E4** ★ | Achievements from verified results | **M** | J4-E1 |
| J4-E2 | Lifetime participation timeline | **M** | J4-E1 |
| J1-E5 | Bulk-import the student roll | **M** | J1-E4, consent text |
| J2-E5 | Score a match live | **M** | J2-E4 |
| J2-E6 | Watch the event as it happens | **M** | J2-E5 |
| J3-E3 | Enter a squad into competitions | **S** | J3-E2, J2-E2 |
| J6-E2 | Module access by audience | **S** | J6-E1 |

> **J1-E5 must capture gender, DOB and scholarship status** — decided 2026-08-12. If it
> ships without them, J5-E3 in Wave 4 cannot be built at all. The consent text needs to
> be signed off before this wave starts, not during it.

**Exit:** "medals won" is a real countable number · a locked result appears on a player's
permanent profile automatically · an admin can see every person in their institution.

---

## 6. Wave 4 · Surface

*The largest wave, and the most parallel — ten epics, few interdependencies. This is where
the product starts looking like the PRD.*

| Epic | Title | Size | Depends on |
| --- | --- | :-: | --- |
| **J4-E6** ★ | Certificate templates & branding | **M** | J1-E1 |
| J1-E6 | Verify players | **S** | J1-E5 |
| J1-E7 | The workspace shell & daily command centre | **L** | J1-E1 |
| J4-E3 | Career statistics per sport | **M** | J4-E2 |
| J4-E5 | Claim an external achievement | **M** | J4-E4 |
| J4-E9 | Organisation Hall of Fame | **M** | J4-E4 |
| J2-E8 | Operational status report | **S** | J2-E7 |
| J5-E1 | Participation report | **M** | J1-E5, J2-E7 |
| J5-E2 | Performance report | **S** | J4-E4 |
| J5-E3 | Diversity & inclusion report | **M** | J1-E5 |

> **J1-E7's dashboard needs the pending-actions CTAs that only now exist** — "scorecard
> ready to lock" (J2-E7) and "claim to validate" (J4-E5). Placing the shell here rather
> than in Wave 1 is deliberate: build it early and it's a frame around empty widgets.

> **Do the certificate rendering spike inside J4-E6** — one template plus a QR, end to
> end. It's the only genuinely new technical capability in the plan, and it de-risks
> Wave 5's L.

**Exit:** the institution home shows real pending actions · a verified roll of people ·
three of the four report tabs are live and derive only from locked results.

---

## 7. Wave 5 · Artefacts

*The outputs an institution shows other people.*

| Epic | Title | Size | Depends on |
| --- | --- | :-: | --- |
| **J4-E7** ★ | Generate certificates in bulk | **L** | J4-E6, J4-E1, W0 email |
| J4-E8 | Public QR verification | **S** | J4-E7 |
| J5-E4 | Anonymised peer benchmark | **M** | J5-E1, J3-E1 |
| J5-E5 | Annual Sports Impact Report | **L** | J5-E1…E4, J4-E7 |

> **J4-E7 introduces the SQS → worker Lambda queue**, and J5-E5 reuses it. Sequence
> J4-E7 first and the export queue is nearly free; sequence J5-E5 first and you build it
> twice. This is the only new infrastructure in the plan — cost it once.

**Exit:** 300 certificates generate with gapless numbering and a working QR page · the
Annual Impact Report exports as branded PDF from locked data only.

---

## 8. Held

| Epic | Title | Blocked on |
| --- | --- | --- |
| **J4-E10** | Right to erasure | Legal sign-off on the erase-the-person-keep-the-result recommendation in [04 §4.7](../04-people-and-player-records.md) |

Buildable at any point once the decision lands — the tombstone mechanism is the same
whichever way it goes, and the retention set is configurable, so a different answer is a
settings change rather than a migration. **Don't let it block Wave 3.**

---

## 9. If you only have capacity for one track

Run the critical path and drop the rest:

```
W0  J6-E3 audit  +  email wiring
W1  J2-E7 submit & lock
W2  J4-E1 atomic propagation
W3  J4-E2 lifetime timeline  +  J4-E4 achievements
W4  J1-E5 people  +  J5-E1 participation
```

That sequence alone makes the product a **system of record**: results lock, they
propagate permanently to player profiles, and leadership can report on verified data.
Certificates, the workspace shell and the remaining reports are leverage on top of it —
valuable, but nothing depends on them.

Conversely, **the worst possible order** is to start with the visible things — the
workspace shell, the reports, the certificates. Each would be built on mutable data and
would need reworking once the lock lands.

---

## 10. Intra-wave ordering

Three dependencies sit **inside** a wave rather than across waves. They're legal, but
they mean those waves aren't fully parallel — assign them to the same person or the same
sprint, in this order:

| Wave | Order | Why not split across waves |
| :-: | --- | --- |
| **3** | `J2-E5 Score a match live` → `J2-E6 Watch the event as it happens` | The live view renders what scoring produces. Both are mostly existing capability; splitting them would leave a near-empty wave. |
| **5** | `J4-E7 Generate certificates` → `J4-E8 Public QR verification` | Nothing to verify until certificates issue. E8 is an **S** riding directly on E7. |
| **5** | `J4-E7 Generate certificates` → `J5-E5 Annual Impact Report` | E5 reuses the SQS worker queue E7 introduces. Build the queue once. |

`build-csv.mjs` reports these on every run and **fails** on any dependency pointing at a
*later* wave — so a mis-sequenced epic can't quietly reach a sprint board.

---

## 11. Dependency table

The machine-readable source. [`build-csv.mjs`](build-csv.mjs) parses this table into the
`Wave` and `Depends On` columns of [`epics.csv`](epics.csv), so tracker rows carry their
own sequencing. Edit here, then re-run the generator.

| Epic | Wave | Depends On | Reason |
| --- | :-: | --- | --- |
| J6-E3 | 0 | — | Critical path start; must precede the first lock |
| J6-E5 | 0 | — | Open cross-tenant read; S1 is a same-day fix |
| J2-E7 | 1 | J6-E3 | Locks must be audited from the first one |
| J1-E1 | 1 | — | Gates J1-E4, J3-E1, J6-E1 via `organizations.kind` + `settings` |
| J1-E2 | 1 | — | Needs Wave 0 email wiring |
| J1-E3 | 1 | — | Needs Wave 0 email wiring |
| J2-E1 | 1 | — | No dependencies |
| J2-E3 | 1 | — | Largely existing capability |
| J3-E4 | 1 | — | No dependencies |
| J3-E5 | 1 | — | Largely existing capability |
| J4-E1 | 2 | J2-E7 | The lock transaction is what propagates |
| J3-E1 | 2 | J1-E1 | Needs `organizations.kind='personal'` |
| J1-E4 | 2 | J1-E1 | Org units hang off the tenant |
| J6-E1 | 2 | J1-E1 | Needs `settings` for module access |
| J6-E4 | 2 | J2-E7, J6-E3 | Corrections reverse a lock, and must be audited |
| J2-E2 | 2 | — | Bulk approval can be pulled into Wave 0 |
| J2-E4 | 2 | J2-E3 | Fixtures need the structure |
| J3-E2 | 2 | — | Coach is additive to existing roster work |
| J4-E4 | 3 | J4-E1 | Achievements derive at lock |
| J4-E2 | 3 | J4-E1 | Timeline entries are written by the lock |
| J1-E5 | 3 | J1-E4 | Import resolves programme/batch; needs consent text signed off |
| J2-E5 | 3 | J2-E4 | Scoring needs fixtures and officials |
| J2-E6 | 3 | J2-E5 | Live view shows what scoring produces |
| J3-E3 | 3 | J3-E2, J2-E2 | Entry needs a squad and an approved enrolment |
| J6-E2 | 3 | J6-E1 | Module access is enforced inside can() |
| J4-E6 | 4 | J1-E1 | Templates need org branding; do the rendering spike here |
| J1-E6 | 4 | J1-E5 | Nothing to verify until people are imported |
| J1-E7 | 4 | J1-E1 | Dashboard CTAs need J2-E7 and J4-E5 to exist first |
| J4-E3 | 4 | J4-E2 | Stats aggregate over timeline entries |
| J4-E5 | 4 | J4-E4 | Claims join the same achievement record |
| J4-E9 | 4 | J4-E4 | Hall of Fame reads achievements |
| J2-E8 | 4 | J2-E7 | "Results verified" progress needs the lock |
| J5-E1 | 4 | J1-E5, J2-E7 | Needs people, programmes and locked results |
| J5-E2 | 4 | J4-E4 | Medals come from achievements |
| J5-E3 | 4 | J1-E5 | Needs gender and scholarship captured at import |
| J4-E7 | 5 | J4-E6, J4-E1 | Introduces the SQS worker queue |
| J4-E8 | 5 | J4-E7 | Nothing to verify until certificates issue |
| J5-E4 | 5 | J5-E1, J3-E1 | Must exclude personal orgs from aggregates |
| J5-E5 | 5 | J5-E1, J4-E7 | Reuses the certificate job queue |
| J4-E10 | held | J4-E2 | Blocked on legal sign-off, not on engineering |
