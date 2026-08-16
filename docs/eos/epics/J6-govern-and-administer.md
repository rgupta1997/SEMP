# J6 · Govern & Administer

> *"Control who can do what, and prove what happened."*
>
> **Personas:** Sports Secretary, Faculty Coordinator, Championship Organiser
> **Modules:** [03 RBAC, Module Access & Audit](../03-rbac-module-access-audit.md) ●●● · [06 Verification](../06-verification-pipeline.md) ●● · [01](../01-identity-tenancy-workspace.md) ○ · [08](../08-reports-impact-exports.md) ○
> **Epics:** 5 · **Journey size:** L

---

## The narrative

Every other journey assumes this one works. It is the least visible and the one that
decides whether an institution can actually put its permanent record here.

Akash has ten student coordinators who turn over every year, five faculty coordinators
who don't, and 2,000 students. Some of those people should approve registrations; most
should not. Some should see reports; most should not. And when a result changes three
weeks after a tournament, somebody has to be able to answer *who changed it, when, and
why* — because that is the difference between a system of record and a scoreboard.

Four things have to be true:

1. **Access is configurable, not hard-coded.** Today the `roles` and `permissions` tables
   exist, have a CRUD screen, and **nothing reads them.** Real authorisation is seven
   hard-coded guards in `permissions.ts`. So FR-ADM-3 is not "add a permissions UI" — it
   is building the engine and retrofitting it under working authorisation without
   loosening anything.
2. **Whole modules can be switched off per audience.** Students shouldn't see Reports.
3. **Everything privileged is recorded.** There is no audit log of any kind today —
   only `created_at`/`updated_at` and a few scattered `reviewed_by` columns, which tell
   you current state, never history. **A score can be changed a hundred times and nothing
   anywhere records it.**
4. **Corrections are possible, and visible.** A locked result must be changeable by
   someone with authority, with a stated reason, and with everything downstream — the
   standings, the profile entries, the certificates — corrected with it.

**The most important sequencing note in the whole plan:** ship the **audit half first**,
before the RBAC engine. It is smaller, has no real upstream dependency, and it means the
very first scorecard lock in [J2-E7](J2-run-a-championship.md) is recorded. Build the
lock first and retrofit audit later, and the earliest and most consequential locks are the
ones with no history.

---

## Epic J6-E1 · Roles & permissions

**Goal:** Access is configurable per institution and enforced server-side, replacing hard-coded rules without loosening any of them.

**Modules:** [03 §4.1–§4.4](../03-rbac-module-access-audit.md) · **P0** · **L**
**Satisfies:** FR-ADM-3, §4 Users & Roles, NFR server-side authorisation

> The riskiest work in the doc set: retrofitting a permission engine under a live
> authorisation boundary that has **no RLS behind it**. The governing principle is
> **wrap, don't replace** — `can()` goes *underneath* the existing guards, each guard
> keeps its signature and its tests, and behaviour is preserved by construction.

### J6-E1-S1 — See what can be granted

> **As** a Sports Secretary, **I want** a clear list of the permissions that exist,
> **so that** I can reason about access rather than guess.

```gherkin
Then I see a catalogue of named permissions grouped by area, each with a plain-language label
And the catalogue is defined in code and cannot be edited or invented through the UI
And every permission states whether it applies at organisation or championship scope
```

> Typed, code-owned catalogue synced by the existing `bootstrap-catalog.ts` script. This
> also replaces the current `/platform/roles` screen, where `permission_ids` is edited as
> **a raw JSON array in a textarea**.

### J6-E1-S2 — Configure roles as a matrix

> **As** a Sports Secretary, **I want** to set what each role can do,
> **so that** our committee structure maps onto real access.

```gherkin
Given the seeded roles Organisation Owner, Faculty Coordinator and Student Coordinator
Then I see a matrix of roles against permissions with checkboxes
And the matrix is generated from the catalogue, never hand-maintained
When I change a role's permissions
Then it takes effect for everyone holding that role on their next request
And the change is written to the audit trail
```

### J6-E1-S3 — Assign roles to people

> **As** a Sports Secretary, **I want** to give a coordinator a role,
> **so that** they can do their job and nothing more.

```gherkin
When I assign Faculty Coordinator to a member
Then they immediately gain that role's permissions within my institution only
And they gain nothing in any other institution they belong to
And the assignment is audited
```

### J6-E1-S4 — Enforcement is server-side

> **As** a Sports Secretary, **I want** permissions enforced on the server,
> **so that** hiding a button is not the security model.

```gherkin
Given a user lacks a permission
When they call the endpoint directly, bypassing the interface
Then the request is refused
And the interface hides the action as a convenience only, never as the boundary
```

### J6-E1-S5 — The retrofit changes no existing behaviour

> **As** a Sports Secretary, **I want** the new engine to preserve today's access rules exactly,
> **so that** nobody silently gains or loses access.

```gherkin
Given the existing guards for championship management, team management, team creation,
      user management, self-enrolment and fixture scoring
When each is re-expressed as a call to the permission engine
Then every existing authorisation test still passes unchanged
And a team's own captain retains team management rights alongside organisation admins
And creating teams in bulk still requires rights in every organisation named
```

> Those last two clauses encode the genuinely subtle rules in `teamManager` and
> `teamCreate` — the ones most likely to be silently loosened by a rewrite. Expand
> [`permissions.test.ts`](../../../apps/api/src/http/middleware/permissions.test.ts)
> **before** touching the guards; it is the contract.

### J6-E1-S6 — Role names are not load-bearing strings ⚠

> **As** a Sports Secretary, **I want** to rename a role safely,
> **so that** renaming it doesn't break the product.

```gherkin
When I rename a role
Then authorisation continues to work correctly
And no behaviour depends on the role's display name
```

> ⚠ **Today authorisation resolves roles by name string** — `'Organiser'` and
> `'Official'` — in seven places across the codebase. Renaming a role in the UI right now
> would silently break authorisation. This story is the fix, and it must land with the
> engine.

---

## Epic J6-E2 · Module access by audience

**Goal:** Whole modules can be switched on or off per audience, in one place.

**Modules:** [03 §4.6](../03-rbac-module-access-audit.md) · **P0** · **S**
**Satisfies:** FR-ADM-4

### J6-E2-S1 — Switch modules on and off per audience

> **As** a Sports Secretary, **I want** to control which modules staff and students can reach,
> **so that** people only see what's relevant to them.

```gherkin
Then I see a grid of modules against the Staff and Students audiences
When I disable Reports for Students
Then students no longer see Reports in navigation
And a student calling a reports endpoint directly is refused
And staff are unaffected
```

### J6-E2-S2 — Disabled modules disappear rather than error

> **As** a Student Coordinator, **I want** modules I can't use to be absent,
> **so that** I'm not clicking into dead ends.

```gherkin
Given a module is disabled for my audience
Then it does not appear in navigation at all
And a direct link shows a clear "not available" page rather than a raw error
```

### J6-E2-S3 — Module access gates permissions

> **As** a Sports Secretary, **I want** a disabled module to override individual permissions,
> **so that** there's one place to switch something off.

```gherkin
Given a person holds a permission within a module that is disabled for their audience
Then that permission does not resolve
And enabling the module restores it without reassigning anything
```

> One enforcement point serving both features — the module check is a pre-check inside
> `can()`, not a second parallel system.

---

## Epic J6-E3 · Audit trail

**Goal:** Every privileged action is recorded in an append-only trail that outlives the people named in it.

**Modules:** [03 §4.5](../03-rbac-module-access-audit.md) · **P0** · **M**
**Satisfies:** FR-ADM-2, NFR audit coverage · **Phase 0 — ship before [J2-E7](J2-run-a-championship.md)**

### J6-E3-S1 — Privileged actions are recorded

> **As** a Sports Secretary, **I want** every consequential action recorded,
> **so that** I can prove what happened.

```gherkin
When a privileged action occurs — a result locked or corrected, a registration approved,
     a person verified, a role assigned, a certificate issued or revoked, an organisation
     setting changed, a report exported, an erasure executed
Then an entry records who did it, when, to what, a human-readable summary, and what changed
And system-performed actions are recorded with the actor shown as System
```

> Explicit curated calls, not middleware auto-capture. Auto-capture produces thousands of
> `PATCH /fixtures/x 200` rows and misses the semantics that make a timeline readable —
> the PRD wants a narrative, and the list of actions worth narrating is short.

### J6-E3-S2 — Entries cannot be altered

> **As** a Sports Secretary, **I want** the log to be append-only,
> **so that** it's worth something as evidence.

```gherkin
Then no interface or endpoint permits editing or deleting an audit entry
And the database itself refuses updates and deletes on the audit table
And deleting the thing an entry describes does not delete the entry
```

> Enforced by database grants, not by convention. And no foreign keys — an audit row must
> never be cascade-deleted by the thing it describes, which is the entire point.

### J6-E3-S3 — Read the timeline

> **As** a Faculty Coordinator, **I want** to browse and filter the audit trail,
> **so that** I can answer a specific question quickly.

```gherkin
Then I see a reverse-chronological timeline scoped to my institution
And I can filter by actor, action type, target and date range
And each entry reads as a sentence, not a raw payload
And I only see entries for institutions I have audit rights in
```

### J6-E3-S4 — Entries survive the people in them

> **As** a Sports Secretary, **I want** old entries to remain readable,
> **so that** history doesn't degrade as people leave.

```gherkin
Given the user who performed an action has since been deleted or erased
Then the entry still shows the actor's name as recorded at the time
And the entry still shows what the target was at the time
```

> Denormalised actor and target labels, captured at write time — this is also what makes
> [J4-E10](J4-the-verified-record.md) erasure compatible with an immutable audit log.

---

## Epic J6-E4 · Correct a locked result

**Goal:** A locked result can be corrected by an authorised person, with a stated reason, reversing everything the lock produced.

**Modules:** [06 §4.4](../06-verification-pipeline.md) · [03](../03-rbac-module-access-audit.md) · **P0** · **M**
**Satisfies:** §9 *"corrections only via privileged, audited flows"*
**Depends on:** [J2-E7](J2-run-a-championship.md), [J6-E3](#epic-j6-e3--audit-trail)

### J6-E4-S1 — Unlock with a stated reason

> **As** a Championship Organiser, **I want** to reverse a locked result when it's genuinely wrong,
> **so that** an honest mistake isn't permanent.

```gherkin
Given a locked scorecard and the authority to correct it
When I unlock it
Then I must supply a reason, and it cannot be blank
And the scorecard returns to submitted and becomes editable
And an audit entry records who unlocked it, when, and why
```

> A reason is mandatory. An unlock without one is exactly what the audit trail exists to
> prevent.

### J6-E4-S2 — Everything downstream is reversed

> **As** a Sports Secretary, **I want** a correction to undo everything the lock produced,
> **so that** the record stays consistent.

```gherkin
When a locked result is unlocked
Then the standings contribution is reversed by full recomputation of the affected scope
And lifetime entries and achievements derived from it are superseded
And certificates issued from that lock version are revoked
And all of it happens in one transaction
```

> Recompute the whole scope rather than subtracting a contribution — reversal arithmetic
> is much harder to get right than addition, and `standings.service.ts` already supports
> full recomputation.

### J6-E4-S3 — Re-lock the corrected result

> **As** a Championship Organiser, **I want** to lock the corrected scorecard,
> **so that** the amended result becomes official.

```gherkin
When I lock it again
Then the lock version increments
And downstream artefacts are regenerated against the new version
And replacement certificates are queued
```

### J6-E4-S4 — Corrections are visible, not hidden

> **As** a Player, **I want** to see that a result was amended,
> **so that** the record is honest rather than quietly rewritten.

```gherkin
Given a result has been corrected
Then it shows an amendment notice with the date wherever it appears, including the public page
And a revoked certificate's verification page explains it was superseded
```

> This mirrors what sports federations actually do, and it is the credibility argument for
> the whole product. Silent correction would undermine every "verified" badge elsewhere.

### J6-E4-S5 — Scoring and locking are separate authorities

> **As** a Sports Secretary, **I want** the person who scores not to be the person who locks,
> **so that** locking is a review rather than a rubber stamp.

```gherkin
Given an official has submitted a scorecard
Then locking requires the lock permission, which officials do not hold by default
And correcting a locked result requires a further, separately grantable permission
```

---

## Epic J6-E5 · Tenant isolation & data boundaries

**Goal:** An institution's data is not visible to, or enumerable by, other institutions.

**Modules:** [01](../01-identity-tenancy-workspace.md) · [03](../03-rbac-module-access-audit.md) · **P0** · **M**
**Satisfies:** NFR multi-tenancy & isolation · **Phase 0** *(the directory fix)*

> ⚠ **The most serious gap in the product.** The NFR promises *"strict org-level data
> isolation"*. In reality there is **no RLS anywhere**, and `GET /api/organizations` is an
> open authenticated read returning **every institution on the platform** with a
> typeahead. Any logged-in user can enumerate every customer.
>
> These stories cover the **user-visible** slice. Full RLS is a separate project tracked
> in [99-roadmap §5 R1](../99-roadmap.md) — a permissions UI must not create the
> impression that isolation is solved.

### J6-E5-S1 — Our data is not browsable by outsiders

> **As** a Sports Secretary, **I want** our people and internal data invisible to other institutions,
> **so that** we can put real student records here.

```gherkin
Given I belong to institution A
When I request the organisation list
Then I see only institutions I belong to
And a directory search returns only name, short name, city and logo, never membership
And personal organisations never appear
And I cannot retrieve institution B's people, teams or reports by any endpoint
```

> Narrowing this endpoint is a same-day fix and the single highest-value line in Phase 0.

### J6-E5-S2 — Cross-institution membership is scoped

> **As** a Player, **I want** my two institutions kept separate,
> **so that** one cannot see my standing in the other.

```gherkin
Given I belong to a university and a city club
Then each sees only my membership, verification status and member code with them
And neither sees the other's
And my lifetime record shows results from both only to me
```

### J6-E5-S3 — Deleting an institution is guarded

> **As** a Sports Secretary, **I want** deletion to be deliberate and safe,
> **so that** competition history can't be destroyed by accident.

```gherkin
Given my institution has teams with completed or scored matches
When I attempt to delete it
Then it is refused, and I am told those results must be removed first

Given it has teams or entries but no played matches
Then I must explicitly confirm cascading removal
And only an owner may delete, never an admin
```

> These rules already exist in
> [`organizations.routes.ts`](../../../apps/api/src/modules/iam/organizations.routes.ts) —
> captured here so the retrofit in [J6-E1](#epic-j6-e1--roles--permissions) preserves them
> rather than rediscovering them.

---

## Done looks like

1. Akash defines what Faculty and Student Coordinators can do in a **matrix built from the
   permission catalogue**, not a JSON textarea.
2. He grants Priya approval rights; she gains them in IIMB and **nowhere else**.
3. He disables Reports for students; it vanishes from their navigation and the endpoint
   refuses them.
4. A tournament result is disputed three weeks later. He opens the audit trail, filters to
   that fixture, and sees: scored by an official, locked by an organiser, **corrected**
   with a stated reason, re-locked. Names intact even though that student has since
   graduated.
5. The correction reversed the standings, superseded the achievement, revoked the
   certificate and queued a replacement — **and the public page says the result was
   amended**, rather than quietly showing a different number.
6. A user at another institution **cannot list IIMB, cannot search its people, and cannot
   reach its reports by any endpoint.**

Point 6 is true of almost nothing today, and point 4 is true of nothing at all.
