# EOS Organisation Workspace — Journey Map & Epic Index

> Companion to the module docs in [`docs/eos/`](../00-index.md). Those slice the work by
> **what gets built**; this slices it by **what someone is trying to do**.
>
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API; Render retired. No
> long-lived process, 15s synchronous ceiling. See [`DEPLOYMENT.md`](../../../DEPLOYMENT.md).

---

## 1. How this is organised

Six end-to-end journeys. Each is a thing a real person is trying to accomplish, start to
finish, regardless of which technical module the work lands in.

| Journey | Who it's for | The one-line story | Doc |
| --- | --- | --- | --- |
| **J1** | Sports Secretary | *"Get my institution set up so my people can actually use this."* | [J1-institution-onboarding.md](J1-institution-onboarding.md) |
| **J2** | Championship Organiser | *"Run an event from creation to verified results."* | [J2-run-a-championship.md](J2-run-a-championship.md) |
| **J3** | Team Captain / Player | *"Get my team — or just me — into a competition and play."* | [J3-enter-and-compete.md](J3-enter-and-compete.md) |
| **J4** | Player / Sports Secretary | *"Turn results into a permanent, provable record."* | [J4-the-verified-record.md](J4-the-verified-record.md) |
| **J5** | Sports Secretary / Faculty Coordinator | *"Show leadership what our sports programme achieved."* | [J5-leadership-reporting.md](J5-leadership-reporting.md) |
| **J6** | Sports Secretary / Faculty Coordinator | *"Control who can do what, and prove what happened."* | [J6-govern-and-administer.md](J6-govern-and-administer.md) |

Every journey doc contains: the narrative, the personas involved, the modules it
consumes, its epics, and a "done looks like" acceptance statement for the journey as a
whole.

> **Build order lives in [`01-execution-order.md`](01-execution-order.md)** — all 40
> epics sequenced into six dependency-ordered waves, with the critical path and a
> minimum-viable track if capacity is tight. Journeys describe *what the product does*;
> that doc describes *what order to build it in*. They are deliberately different
> orderings.

## Two generated files

All 40 epics and 144 stories, including the full Gherkin, are exported in two formats
with different jobs:

| File | For | Shape |
| --- | --- | --- |
| [`epics.csv`](epics.csv) | **Machines** — Jira / Linear bulk import | Flat, no blank rows, UTF-8 with BOM |
| [`epics.xlsx`](epics.xlsx) | **People** — reading and review in Excel | Colour-coded by wave, blank row between epics, frozen header, autofilter, `Key` legend sheet |

Both are **generated**, never hand-maintained. Edit the markdown, then:

```bash
node docs/eos/epics/build-csv.mjs      # markdown -> epics.csv
node docs/eos/epics/build-xlsx.mjs     # epics.csv -> epics.xlsx
```

`build-csv.mjs` parses the epic index tables below, the journey docs, and the dependency
table in [`01-execution-order.md`](01-execution-order.md). It **fails** if an epic depends
on something in a later wave. `build-xlsx.mjs` is dependency-free — it writes the OOXML
zip directly, because the `xlsx` package already in the repo cannot set cell fills in its
community build.

Columns: `Issue Type, Key, Epic Link, Journey, Wave, Summary, Description, Acceptance
Criteria, Personas, Modules, Priority, T-Shirt, Depends On, Flags`. Rows are emitted in
**execution order** (wave, then epic, each epic immediately above its stories), so both
files read as a build sequence. Stories carry `Epic Link` for parent mapping and inherit
their epic's `Wave`; `Flags` marks `high-leverage` and `blocked-on-decision`.

**Colour key** (also on the workbook's `Key` sheet — strong fill = epic, tint beneath =
its stories):

| | Wave | Epics | |
| --- | --- | :-: | --- |
| 🟥 | **W0 Unblock** | 2 | Nothing depends on anything; all of it unblocks something |
| 🟧 | **W1 Foundations** | 8 | The spine and the tenant |
| 🟨 | **W2 Propagate** | 8 | The lock fans out; the access model lands |
| 🟩 | **W3 Records** | 7 | People first-class; results become permanent history |
| 🟦 | **W4 Surface** | 10 | What users actually see |
| 🟪 | **W5 Artefacts** | 4 | Certificates and the annual report |
| ⬜ | **Held** | 1 | Blocked on a decision, not on engineering |

> **Working in Excel:** open `epics.xlsx`, not the CSV — the CSV has no formatting and
> the workbook is what the colour coding is for. **Close either file before re-running a
> build script**, or the write fails with `EBUSY` (Excel takes an exclusive lock). And
> don't save edits back over a generated file — change the markdown and regenerate,
> otherwise your edit is lost on the next run.

---

## 2. Personas

Stories are written against these seven, **by full name** — no abbreviations anywhere in
the epic docs or the CSV, so a ticket read in isolation still says who it is for.

### Institution roles (PRD §4)

| Persona | Who they are | Maps to |
| --- | --- | --- |
| **Sports Secretary** | The PRD's primary persona ("Akash Menon, Sports Secretary, IIM Bangalore"). Owns the institution's account, full access. Also referred to as the Organisation Owner. | `organization_members.role = 'owner'` |
| **Faculty Coordinator** | Approvals, reports, communications, full events-host access. ~5 per institution. | `organization_members.role = 'admin'` + a seeded org role |
| **Student Coordinator** | Communications and full events-host access. No approvals, no reports. ~10 per institution. | `organization_members.role = 'member'` + a seeded org role |

### Existing product actors

| Persona | Who they are | Maps to |
| --- | --- | --- |
| **Championship Organiser** | Runs one championship: setup, fixtures, approvals, results. | `user_championship_roles` with the `Organiser` role |
| **Official** | Assigned to matches; records scores in the console. Also called the Scorer. | `championship_officials`, `fixtures.official_id` |
| **Team Captain** | Builds and manages a squad, enters it into competitions. | `team_members.role ∈ captain \| vice_captain` |
| **Player** | Competes. Owns a lifetime record. Called a Participant in the PRD. | `team_members.role ∈ player \| substitute`, or an unaffiliated entrant |

### Two deliberate notes on persona coverage

**The independent entrant is a Player, not a separate persona.** Module 05's solo entrant
and ad-hoc squad are covered by the Player and Team Captain operating *without an
institution behind them*. Their journey is [J3](J3-enter-and-compete.md) §Epic J3-E1 —
written so that the word "organisation" never appears in their path, per the module 05
decision.

**Platform Admin (Sportagon) appears only where an action is genuinely platform-only.**
It was not selected as a primary persona, so stories are written from the institution's
side wherever possible — e.g. *"As a Sports Secretary I request verification"* rather
than *"As a Platform Admin I verify"*. The platform-side action is then expressed inside
the acceptance criteria. Three places genuinely require it and are marked
**[platform action]**: organisation tier promotion, master-data catalogue changes, and
support access to the email log.

---

## 3. Journey ↔ module coverage matrix

Proof that journey-first organisation loses no module. Every module doc's scope appears
in at least one journey.

| Module | J1 | J2 | J3 | J4 | J5 | J6 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| [01 Identity, Tenancy & Shell](../01-identity-tenancy-workspace.md) | ●●● | | ○ | | ○ | ○ |
| [02 Communications](../02-communications.md) | ●● | ○ | ○ | ○ | | |
| [03 RBAC, Module Access & Audit](../03-rbac-module-access-audit.md) | ● | | | | | ●●● |
| [04a People Directory](../04-people-and-player-records.md) | ●●● | | ○ | | ○ | |
| [04b Lifetime Record](../04-people-and-player-records.md) | | | | ●●● | ○ | |
| [05 Flexible Entry](../05-flexible-entry.md) | | ○ | ●●● | | | |
| [06 Verification Pipeline](../06-verification-pipeline.md) | | ●● | | ●●● | ○ | ●● |
| [07a Achievements](../07-achievements-certificates.md) | | ○ | | ●●● | ○ | |
| [07b Certificates](../07-achievements-certificates.md) | | | | ●●● | | ○ |
| [08a Event status report](../08-reports-impact-exports.md) | | ●● | | | ○ | |
| [08b/c Reports & exports](../08-reports-impact-exports.md) | | | | | ●●● | ○ |
| [09 Championship Core Deltas](../09-championship-core-deltas.md) | | ●●● | ●● | | | |

●●● primary owner · ●● substantial · ● partial · ○ touches

---

## 4. Epic index

**40 epics and 144 stories** across the six journeys. Priority is inherited from the
PRD's own P0/P1/P2 on the requirements each epic satisfies. Sizing is T-shirt at epic
level only, consistent with [`99-roadmap.md`](../99-roadmap.md).

### J1 · Institution onboarding — *"Get my institution set up"*

| Epic | Title | Personas | Modules | P | Size |
| --- | --- | --- | --- | :-: | :-: |
| J1-E1 | Institution identity & verified tenancy | Sports Secretary | 01 | P0 | M |
| J1-E2 | Email-first sign-in & account recovery | Sports Secretary, Faculty Coordinator, Student Coordinator, Player | 01, 02 | P0 | M |
| J1-E3 | Invite the sports office team | Sports Secretary, Faculty Coordinator | 01, 02, 03 | P0 | M |
| J1-E4 | Programme & batch structure | Sports Secretary | 01 | P0 | M |
| J1-E5 | Bulk-import the student roll | Sports Secretary, Faculty Coordinator | 04a | P0 | M |
| J1-E6 | Verify players | Faculty Coordinator, Student Coordinator | 04a, 02 | P0 | S |
| J1-E7 | The workspace shell & daily command centre | Sports Secretary, Faculty Coordinator, Student Coordinator | 01 | P0 | L |

### J2 · Run a championship — *"Creation to verified results"*

| Epic | Title | Personas | Modules | P | Size |
| --- | --- | --- | --- | :-: | :-: |
| J2-E1 | Create a championship from a template | Championship Organiser, Faculty Coordinator | 09 | P1 | M |
| J2-E2 | Open registration & approve entrants | Championship Organiser, Faculty Coordinator | 09, 02 | P0 | M |
| J2-E3 | Build the competition structure | Championship Organiser | 09 | P0 | S |
| J2-E4 | Schedule fixtures & assign officials | Championship Organiser | 09 | P0 | S |
| J2-E5 | Score a match live | Official | 09 | P0 | M |
| J2-E6 | Watch the event as it happens | Championship Organiser, Faculty Coordinator, Player | 09 | P0 | M |
| J2-E7 | Submit & lock scorecards | Official, Championship Organiser | 06 | P0 | M |
| J2-E8 | Operational status report | Championship Organiser, Faculty Coordinator | 08a | P1 | S |

### J3 · Enter & compete — *"Get into a competition and play"*

| Epic | Title | Personas | Modules | P | Size |
| --- | --- | --- | --- | :-: | :-: |
| J3-E1 | Enter without an institution | Player, Team Captain | 05 | P0 | M |
| J3-E2 | Build and manage a squad | Team Captain | 09 | P0 | M |
| J3-E3 | Enter a squad into competitions | Team Captain | 09 | P0 | S |
| J3-E4 | Discover competitions to enter | Team Captain, Sports Secretary | 09 | P1 | M |
| J3-E5 | My matches & my day | Player, Team Captain | 09 | P0 | S |

### J4 · The verified record — *"Results become permanent and provable"*

| Epic | Title | Personas | Modules | P | Size |
| --- | --- | --- | --- | :-: | :-: |
| J4-E1 | Locked results propagate atomically | Championship Organiser | 06 | P0 | M |
| J4-E2 | Lifetime participation timeline | Player, Sports Secretary | 04b | P0 | M |
| J4-E3 | Career statistics per sport | Player | 04b | P0 | M |
| J4-E4 | Achievements from verified results | Player, Sports Secretary | 07a | P0 | M |
| J4-E5 | Claim an external achievement | Player, Faculty Coordinator | 07a | P1 | M |
| J4-E6 | Certificate templates & branding | Sports Secretary | 07b | P0 | M |
| J4-E7 | Generate certificates in bulk | Sports Secretary, Faculty Coordinator | 07b, 02 | P0 | L |
| J4-E8 | Public QR verification | Anyone | 07b | P1 | S |
| J4-E9 | Organisation Hall of Fame | Sports Secretary | 07a | P1 | M |
| J4-E10 | Right to erasure | Player, Sports Secretary | 04b | P0 | M |

### J5 · Leadership reporting — *"Show what we achieved"*

| Epic | Title | Personas | Modules | P | Size |
| --- | --- | --- | --- | :-: | :-: |
| J5-E1 | Participation report | Sports Secretary, Faculty Coordinator | 08b | P0 | M |
| J5-E2 | Performance report | Sports Secretary, Faculty Coordinator | 08b | P1 | S |
| J5-E3 | Diversity & inclusion report | Sports Secretary, Faculty Coordinator | 08b, 04a | P1 | M |
| J5-E4 | Anonymised peer benchmark | Sports Secretary | 08b | P1 | M |
| J5-E5 | Annual Sports Impact Report | Sports Secretary | 08c | P1 | L |

### J6 · Govern & administer — *"Who can do what, and what happened"*

| Epic | Title | Personas | Modules | P | Size |
| --- | --- | --- | --- | :-: | :-: |
| J6-E1 | Roles & permissions | Sports Secretary | 03 | P0 | L |
| J6-E2 | Module access by audience | Sports Secretary | 03 | P0 | S |
| J6-E3 | Audit trail | Sports Secretary, Faculty Coordinator | 03 | P0 | M |
| J6-E4 | Correct a locked result | Championship Organiser, Sports Secretary | 06, 03 | P0 | M |
| J6-E5 | Tenant isolation & data boundaries | Sports Secretary | 01, 03 | P0 | M |

---

## 5. Build order — journeys vs phases

Journeys are how the product is *experienced*; the phases in
[`99-roadmap.md`](../99-roadmap.md) are how it gets *built*. They are not the same
ordering, and forcing them to match would be a mistake — J1 looks like the obvious
starting point, but its biggest epic (J1-E7, the workspace shell) depends on data that
J4's pipeline produces.

| Phase | Epics that land | What becomes true |
| --- | --- | --- |
| **0** | J1-E2, J1-E3 · J6-E3 · J6-E5 (the `GET /organizations` fix) · parts of J2-E2 | People can be invited and recover their accounts; privileged actions are recorded |
| **1** | J1-E1, J1-E4 · J2-E7 · J4-E1 · J3-E1 · J2-E1/E3/E4/E6 · J2-E8 | An institution exists as a tenant; results can be locked; solo entry works |
| **2** | J1-E5, J1-E6 · J1-E7 · J4-E2, J4-E3, J4-E4 · J6-E1, J6-E2 | People are managed and verified; results become permanent history |
| **3** | J4-E6, J4-E7, J4-E8, J4-E9 · J5-E1…E5 | Certificates and leadership reporting |
| **deferred** | J4-E5, J4-E10 pending legal sign-off | See open questions |

**The single highest-leverage epic is J2-E7 / J4-E1** (submit-and-lock, and its atomic
propagation). Until it exists, J4 is impossible and J5 is untrustworthy.

---

## 6. Cross-journey dependencies

Where one journey's epic hard-blocks another's:

```
J1-E1 (tenancy) ──▶ J1-E4 ──▶ J1-E5 ──▶ J5-E1 (participation by programme)
J1-E5 (people)  ──▶ J5-E3 (D&I — needs gender captured at import)
J2-E7 (lock)    ──▶ J4-E1 ──┬─▶ J4-E2, J4-E3  (lifetime record)
                            ├─▶ J4-E4 ──▶ J4-E7  (certificates)
                            └─▶ J5-E1…E5         (trustworthy reports)
J6-E1 (RBAC)    ──▶ enforcement in every other journey (guards work meanwhile)
J6-E3 (audit)   ──▶ should precede J2-E7 so the first lock is recorded
```

---

## 7. Conventions used in the epic docs

- **IDs**: `J{n}-E{n}` for epics, `J{n}-E{n}-S{n}` for stories. Stable — referenced from
  the CSV and safe to quote in tickets.
- **Stories**: `As a <persona>, I want <capability>, so that <outcome>.`
- **Acceptance criteria**: Gherkin (`Given / When / Then`), covering the happy path plus
  the edge cases that actually bite. Not exhaustive — where a rule is already specified
  in a module doc, the AC references it rather than restating it.
- **`[platform action]`** marks a step only Sportagon can perform.
- **`⚠`** marks a story blocked on an unresolved product or legal question — see
  [00-index §7](../00-index.md#7-open-questions-for-the-prd-author).
- **Sizes** are T-shirt at the epic level only. Stories are not individually sized;
  size the epic, slice the stories in planning.

---

## 8. What these epics deliberately do not cover

- **Non-functional work without a user-facing journey** — RLS, the scale baseline, cold
  starts. Tracked in [`99-roadmap.md`](../99-roadmap.md) §5, not here. J6-E5 covers only
  the user-visible slice of isolation.
- **The notification service v2 refactor** — a [separate track](../../notification-service-plan.md)
  with its own plan; it changes no journey.
- **Naming/vocabulary cleanup and dead-page deletion** — [module 09](../09-championship-core-deltas.md)
  hygiene, no user story attached.
- **SSO** — deferred (P2). If it returns, it is one epic in J1.
