# J2 · Run a Championship

> *"Run an event from creation to verified results."*
>
> **Personas:** Championship Organiser, Faculty Coordinator, Student Coordinator, Official
> **Modules:** [09 Core Deltas](../09-championship-core-deltas.md) ●●● · [06 Verification](../06-verification-pipeline.md) ●● · [08a Status report](../08-reports-impact-exports.md) ●● · [02](../02-communications.md) ○
> **Epics:** 8 · **Journey size:** L

---

## The narrative

This is the journey the product already does best. The championship engine — four fixture
generators, a 1,726-line scoring console, a five-scheme standings engine — is real,
tested and in use. **Most of this journey is about finishing it, not building it.**

Priya, a Faculty Coordinator, is running the Inter-Programme Sports Meet: six sports,
twelve programme teams, three weeks, roughly 90 matches.

1. **She creates the championship.** Today the wizard makes her configure six sports from
   scratch. It should offer "Multi-sport meet" and set that up for her — the template
   data already exists in the codebase, it is simply never offered.
2. **Registration opens and entrants apply.** Approvals work today, one row at a time.
   With twelve programmes across six sports, one at a time is the wrong ergonomics.
3. **She builds the structure and generates fixtures.** This works well and needs almost
   nothing.
4. **Officials score matches.** The console is genuinely deep. What it lacks is a way to
   say *"I'm done, this is my submission."*
5. **She watches the meet run.** There is no single place showing what is live right now.
   She has to open matches one at a time.
6. **She locks the results.** This does not exist at all — and it is the single most
   important gap in the product. Right now a completed match can be silently re-scored
   forever, by any organiser or official, with no record.
7. **She reports on operations.** Registrations approved, fixtures scheduled, matches
   completed, results verified — an at-a-glance operational view she can export.

**Where it ends:** every match played, every scorecard locked, standings final and
labelled Verified, and a status report she can send to the Director. Nothing downstream —
certificates, profiles, reports — can be trusted until step 6 exists.

---

## Epic J2-E1 · Create a championship from a template

**Goal:** An organiser can stand up a fully-configured championship from a template instead of an empty form.

**Modules:** [09 §4.2, §4.3](../09-championship-core-deltas.md) · **P1** · **M**
**Satisfies:** FR-EVT-1, FR-EVT-3, FR-EVT-4

### J2-E1-S1 — Start from a template

> **As** a Championship Organiser, **I want** to pick a championship shape when I start,
> **so that** I'm not configuring six sports from an empty form.

```gherkin
Given I start creating a championship
Then I am offered Multi-sport meet, League tournament, Knockout cup, and Start from scratch
When I pick one and complete the profile step
Then a draft championship is created with that template's sports, disciplines, formats and standings rules applied
And I can change anything the template set before opening registration
```

> The templates already exist — [`event-templates.ts`](../../../packages/shared/src/event-templates.ts),
> [`tie-templates.ts`](../../../packages/shared/src/tie-templates.ts), and the recipes the
> demo seeder uses in [`demo-recipes.ts`](../../../apps/api/src/modules/demos/demo-recipes.ts),
> which stands up entire four-championship environments. This story **promotes existing
> capability into the user's hands**; it is not new invention.

### J2-E1-S2 — Classify the championship

> **As** a Championship Organiser, **I want** to record what kind of event this is,
> **so that** it is filterable and reports can group by type.

```gherkin
When I set the type to Inter-Programme
Then it is stored and shown as a column in the championships list
And I can filter the list by type
And leaving it unset is permitted for existing championships
```

### J2-E1-S3 — Work in draft

> **As** a Championship Organiser, **I want** to build the event over several sittings,
> **so that** I don't lose work or publish something half-finished.

```gherkin
Given a championship is in draft
Then it is visible only to me and my organising team
And it does not appear in Discover
And it cannot be enrolled into
And I can leave and resume at any step
```

---

## Epic J2-E2 · Open registration & approve entrants

**Goal:** Entrants apply, and organisers accept or decline them in bulk, with everyone told the outcome.

**Modules:** [09 §4.5](../09-championship-core-deltas.md) · [02](../02-communications.md) · **P0** · **M**
**Satisfies:** FR-EVD-9, FR-DIS-4 · **Phase 0** *(bulk approval)*

### J2-E2-S1 — Open registration

> **As** a Championship Organiser, **I want** to open the championship for entries,
> **so that** teams can apply.

```gherkin
When I move the championship from draft to registration_open
Then public championships appear in Discover
And private championships remain invite-only and 404 by direct id for uninvolved users
And only legal status transitions are permitted
```

### J2-E2-S2 — Approve entrants in bulk

> **As** a Championship Organiser, **I want** to approve or reject many applications at once,
> **so that** twelve programmes across six sports isn't twelve separate clicks per sport.

```gherkin
Given several pending applications
When I select them and approve the selection
Then each is approved individually, stamped with reviewer and timestamp
And each applicant is notified
And a partial failure reports per-application results rather than failing the batch

When I reject an application
Then I must supply a note, which is shown to the applicant
```

### J2-E2-S3 — Invite organisations directly

> **As** a Championship Organiser, **I want** to invite specific institutions,
> **so that** a private inter-college event reaches exactly who I intend.

```gherkin
When I invite an organisation by name from the directory
Then an invitation appears in their Invitations inbox
And they are emailed
And accepting enrols them directly without a separate application
```

### J2-E2-S4 — Track our outbound applications

> **As** a Faculty Coordinator, **I want** to see the status of events we've applied to,
> **so that** I don't check each championship page one by one.

```gherkin
Then I see every championship my institution has applied to, with status Pending, Approved or Rejected
And rejections show the organiser's note
And I am notified when a decision is made
```

---

## Epic J2-E3 · Build the competition structure

**Goal:** The championship's sports, disciplines, formats, venues and point system are defined so fixtures can be generated.

**Modules:** [09](../09-championship-core-deltas.md) · **P0** · **S**
**Satisfies:** FR-EVD-1, FR-EVD-2

*Largely existing capability — [`EventSetupPage.tsx`](../../../apps/web/src/pages/organiser/EventSetupPage.tsx)
and its tabs are strong. Captured for journey completeness.*

### J2-E3-S1 — Configure sports, disciplines and formats

> **As** a Championship Organiser, **I want** to define what's being contested and how,
> **so that** fixtures can be generated correctly.

```gherkin
When I add a sport, its disciplines, a format and entry rules
Then squad minimum and maximum resolve as draw override → discipline default → system default
And the entry type is one of team, individual, doubles or relay
```

### J2-E3-S2 — Venues and grounds

> **As** a Championship Organiser, **I want** to record venues and their grounds,
> **so that** fixtures can be placed somewhere real.

```gherkin
When I add a venue and its grounds
Then grounds are selectable when scheduling a fixture
And a venue cannot be deleted while fixtures reference its grounds
```

### J2-E3-S3 — Set the point system

> **As** a Championship Organiser, **I want** to choose how results become standings points,
> **so that** the table reflects our rules.

```gherkin
When I choose league points, placement, medal, custom or ranking
Then it applies at championship, format or discipline scope
And the most specific rule wins
And choosing custom reminds me that I must enter points manually after each result
```

### J2-E3-S4 — Import a whole setup from a sheet

> **As** a Championship Organiser, **I want** to build the championship from a spreadsheet,
> **so that** a large multi-sport meet doesn't take a day of clicking.

```gherkin
Given a sheet of sections against sport/discipline columns
When I validate it
Then I see what will be created and what is rejected, with nothing written
When I apply it
Then organisations, teams and draws are created, with people matched by phone
And re-applying the same sheet changes nothing
```

> ⚠ **The importer works and is organiser-guarded server-side, but its only UI sits at
> `/platform/import-setup` behind super-admin.** Exposing it to organisers is a routing
> change, not backend work — arguably the highest value-per-line item in the plan.

---

## Epic J2-E4 · Schedule fixtures & assign officials

**Goal:** Fixtures exist, are scheduled against real grounds and times, and each has someone responsible for scoring it.

**Modules:** [09](../09-championship-core-deltas.md) · **P0** · **S**
**Satisfies:** FR-EVD-3

### J2-E4-S1 — Generate fixtures

> **As** a Championship Organiser, **I want** fixtures generated from the entrants and format,
> **so that** I don't build a bracket by hand.

```gherkin
When I generate fixtures for a draw
Then the correct generator runs for knockout, round-robin, groups or ranking
And knockout draws pad to a power of two with byes
And seed order is randomised rather than following registration order
And an existing generated draw is not silently overwritten
```

### J2-E4-S2 — Schedule and edit

> **As** a Championship Organiser, **I want** to set times, grounds and durations,
> **so that** the meet has a workable timetable.

```gherkin
When I set a fixture's time, ground and duration
Then it appears on the schedule timeline
And I can edit a fixture manually without regenerating the draw
```

### J2-E4-S3 — Assign officials

> **As** a Championship Organiser, **I want** to assign an official to each match,
> **so that** somebody is responsible for scoring it.

```gherkin
When I assign an official to a fixture
Then it appears in their Officiating queue
And they gain scoring rights for that fixture only
And they are notified
```

---

## Epic J2-E5 · Score a match live

**Goal:** An official can record a match accurately as it happens, whatever shape that match takes.

**Modules:** [09](../09-championship-core-deltas.md) · **P0** · **M**
**Satisfies:** FR-EVD-4

*The console is the deepest part of the product. These stories capture existing behaviour
plus the submit step that completes it.*

### J2-E5-S1 — Record a match

> **As** an Official, **I want** to record scoring as the match runs,
> **so that** the result is captured accurately and spectators can follow.

```gherkin
Given I am the assigned official and the championship is ongoing
When I record scoring events
Then the live state and an append-only log persist as I go
And viewers of that championship see the updated score
And I can score single matches, multi-rubber ties, and multi-competitor events

Given the championship is still in draft or registration
Then scoring is refused with a clear message
```

### J2-E5-S2 — Record awards

> **As** an Official, **I want** to record player-of-the-match and similar awards,
> **so that** individual performances are captured against the player.

```gherkin
When I record an award for a player
Then it is stored against the fixture and that player
And I choose from a catalogue of award types, with free text as a fallback
```

> The catalogue matters: today `award_name` is free text, so "Player of the Match",
> "player of the match" and "POTM" are three different achievements and nothing is
> countable. See [J4-E4](J4-the-verified-record.md).

### J2-E5-S3 — Handle walkovers and byes

> **As** an Official, **I want** to record a walkover or an unplayed match,
> **so that** the draw progresses correctly.

```gherkin
When I record a walkover
Then the winner advances and the fixture is marked accordingly
And standings treat it per the configured scheme
```

---

## Epic J2-E6 · Watch the event as it happens

**Goal:** Anyone following the championship can see what is happening right now, in one place.

**Modules:** [09 §4.4](../09-championship-core-deltas.md) · **P0** · **M**
**Satisfies:** FR-EVD-4, FR-EVD-7

### J2-E6-S1 — A live view of the whole championship

> **As** a Championship Organiser, **I want** one screen showing every match in progress,
> **so that** I can run the day without opening matches one at a time.

```gherkin
Given matches are in progress
When I open the Live tab
Then I see a card per live fixture with sport, stage, venue, current score, elapsed time and assigned official
And the view refreshes automatically
And clicking a card opens the match console
And with no live matches I see an empty state listing what's next
```

### J2-E6-S2 — Elapsed match time

> **As** a Player, **I want** to see how long a match has been running,
> **so that** a live score has context.

```gherkin
Given a fixture went live at a recorded time
Then the live view shows elapsed minutes since it started
```

> **Deliberate simplification, flagged to product:** this is elapsed-since-kickoff, not a
> stoppable match clock with halves, stoppages and injury time. A real clock is a
> per-sport rabbit hole; this matches the PRD mockup at a fraction of the cost.

### J2-E6-S3 — Standings update as results land

> **As** a Championship Organiser, **I want** standings to recompute automatically,
> **so that** the table is right without me maintaining it.

```gherkin
When a result is recorded
Then standings recompute for the affected scopes
And knockout winners advance and byes propagate
And while any contributing result is unlocked the table is labelled Provisional
```

### J2-E6-S4 — Share the event publicly

> **As** a Championship Organiser, **I want** a public link to the championship,
> **so that** people can follow without an account.

```gherkin
When I generate a share link
Then anyone with it sees overview, standings, fixtures and draws, read-only
And no personal contact details are exposed
And revoking the link stops access
```

---

## Epic J2-E7 · Submit & lock scorecards ★

**Goal:** A scorecard can be submitted for review and then locked, after which the result is official and cannot be quietly changed.

**Modules:** [06](../06-verification-pipeline.md) · **P0** · **M**
**Satisfies:** §8.1, §9 immutability, FR-EVD-6
**Blocks:** all of [J4](J4-the-verified-record.md), all of [J5](J5-leadership-reporting.md)

> ★ **The highest-leverage epic in the plan.** Everything the PRD claims about being a
> permanent, verified system of record resolves here, and today none of it is true:
> `PATCH /fixtures/:id/result` has no state check and can be re-issued without limit, by
> any organiser or the assigned official, with no record of what changed or who changed it.

### J2-E7-S1 — Submit a scorecard

> **As** an Official, **I want** to submit my completed scorecard,
> **so that** it's clear I'm finished and it's ready for review.

```gherkin
Given I have finished scoring
When I submit the scorecard
Then its status moves from draft to submitted, stamped with me and the time
And it appears in the organiser's lock queue
And I can still correct it while it remains submitted
```

### J2-E7-S2 — Lock a scorecard

> **As** a Championship Organiser, **I want** to review and lock a submitted scorecard,
> **so that** the result becomes official and can no longer be quietly changed.

```gherkin
Given a submitted scorecard with both teams set and scores present
When I lock it
Then status becomes locked, stamped with me and the time
And the fixture is completed and the result published as Verified
And the bracket advances, standings recompute, lifetime entries are written,
    achievements are derived, certificates are queued, and an audit entry is written
And if any of those steps fails, none of them is applied and the scorecard stays submitted
```

> **The atomicity clause is the requirement**, not a nicety — PRD §8.1: *"a lock either
> fully propagates or fails cleanly."* Note that today's `refreshStandings` deliberately
> swallows errors (correct for the live hot path, wrong for a lock). Implementation detail
> and the transaction-client trap are in [06 §4.3](../06-verification-pipeline.md).

### J2-E7-S3 — A locked scorecard cannot be edited

> **As** a Sports Secretary, **I want** locked results to be immutable,
> **so that** our record can be trusted.

```gherkin
Given a locked scorecard
When anyone attempts to change its result, live state, points, awards or scorecard link
Then the change is refused with a message explaining that a correction is required
And this applies to organisers, officials and platform admins alike
```

> One `assertNotLocked` helper applied to five routes closes this across the whole
> surface.

### J2-E7-S4 — Lock in bulk

> **As** a Championship Organiser, **I want** to lock many scorecards at once,
> **so that** finishing a 90-match meet isn't 90 separate actions.

```gherkin
Given several submitted scorecards
When I lock the selection
Then each is locked in its own transaction
And I get a per-fixture result, with one failure not preventing the rest
```

> Per-fixture transactions, looped outside — never one transaction across 50 fixtures.
> The Lambda runtime caps a synchronous response at 15s and the pooler at
> `connection_limit=1` per container.

### J2-E7-S5 — Only locked results read as Verified

> **As** a Player, **I want** to know which results are final,
> **so that** I can tell an official record from a provisional one.

```gherkin
Then results from locked scorecards show a Verified badge
And unlocked results are labelled Provisional wherever they appear,
    including standings and the public share page
```

---

## Epic J2-E8 · Operational status report

**Goal:** An organiser can see and export the operational state of the championship at a glance.

**Modules:** [08a](../08-reports-impact-exports.md) · **P1** · **S**
**Satisfies:** FR-EVD-8

*The cheapest genuinely useful reporting in the plan — championship-scoped, live, and
almost unblocked.*

### J2-E8-S1 — See operational status at a glance

> **As** a Championship Organiser, **I want** a single operational view of the championship,
> **so that** I know what's done and what's outstanding.

```gherkin
Given I organise the championship
Then I see KPIs for registrations, approved, pending, matches played, medals awarded and certificates issued
And progress bars for registrations approved, fixtures scheduled, matches completed, results verified and certificates issued
And a needs-attention list of outstanding items with links into context
And the tab is visible only to the organising team
And figures are labelled as live, not final
```

### J2-E8-S2 — Export the status report

> **As** a Faculty Coordinator, **I want** to export the status report,
> **so that** I can circulate it without giving people workspace access.

```gherkin
When I export it
Then a branded PDF or Excel file is produced server-side
And generation runs as a job rather than a synchronous request
And the export is recorded in the audit trail
```

---

## Done looks like

1. Priya creates the Inter-Programme Meet by choosing **Multi-sport meet**; six sports and
   their formats are configured for her.
2. Twelve programmes apply; she approves them in **two bulk actions**, and each is emailed.
3. Fixtures generate; officials are assigned and notified.
4. Officials score matches; the console persists live state; the public share page follows
   along.
5. Priya opens the **Live** tab mid-meet and sees seven matches in progress on one screen.
6. Officials **submit**; Priya **locks** in bulk. Standings finalise and read **Verified**.
7. A locked scorecard **cannot** be edited by anyone — a correction is the only route.
8. She exports the status report for the Director.

Point 6 is the one that does not exist in any form today, and points 7 and 8 depend on it.
