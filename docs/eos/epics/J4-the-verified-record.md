# J4 · The Verified Record

> *"Turn results into a permanent, provable record."*
>
> **Personas:** Player, Sports Secretary, Faculty Coordinator, Championship Organiser
> **Modules:** [06 Verification](../06-verification-pipeline.md) ●●● · [04b Lifetime Record](../04-people-and-player-records.md) ●●● · [07a Achievements](../07-achievements-certificates.md) ●●● · [07b Certificates](../07-achievements-certificates.md) ●●● · [02](../02-communications.md) ○
> **Epics:** 10 · **Journey size:** XL

---

## The narrative

This is the journey the product is *named* for. The PRD's headline promise:

> *"Every verified achievement strengthens a player's lifetime profile — long after they
> graduate."*

Today that promise is entirely unbacked. There is no lock, so nothing is verified. There
is no lifetime entry table, so nothing is permanent. There is no achievements record —
winning a final produces a `winner_team_id` and a standings row, and nothing else, so
"medals won" has no source. And certificates do not exist in any form: no table, no
renderer, no QR, not a single dependency in any `package.json`.

The journey, once built:

1. **A scorecard is locked** ([J2-E7](J2-run-a-championship.md)) and, in one transaction,
   fans out into everything below. If any part fails, none of it happens.
2. **Ananya's timeline gains an entry** — "Inter-Programme Football, Runner-up, March
   2026" — written by the system, editable by nobody.
3. **Her career statistics update**, split by sport, not five global counters.
4. **Achievements are recorded** as typed rows: a silver medal, a semi-final placement,
   a Player of the Match award with a normalised name that can actually be counted.
5. **She claims a state-level selection** the platform can't see; a coordinator validates
   it, and it joins the same record marked as a validated claim rather than a result.
6. **Certificates generate in bulk** from the locked results, numbered immutably, each
   carrying a QR code.
7. **A recruiter scans the QR** two years after she graduates and gets a page confirming
   it is genuine — the product's most-seen surface by people who will never log in.
8. **The institution has a Hall of Fame** built from the same records.
9. **And if she asks to be erased**, the identity goes and the match result stays —
   because a locked result is a record of an event that happened, jointly owned by
   everyone who was in it.

**Where it ends:** a graduate has a permanent, verifiable sporting record, and the
institution has an accumulating history that survives every committee handover.

---

## Epic J4-E1 · Locked results propagate atomically ★

**Goal:** Locking a result fans out into every downstream record in a single transaction, or not at all.

**Modules:** [06 §4.3](../06-verification-pipeline.md) · **P0** · **M**
**Satisfies:** §8.1 · **Blocks:** every other epic in J4, and all of [J5](J5-leadership-reporting.md)
**Depends on:** [J2-E7](J2-run-a-championship.md)

> ★ Build this transaction **with stubbed downstream steps** so J4-E2, J4-E4 and J4-E7
> plug into an existing seam instead of reopening it three times. That is what keeps
> module 06 an M.

### J4-E1-S1 — One lock, one transaction

> **As** a Championship Organiser, **I want** locking to either fully succeed or fully fail,
> **so that** the record is never half-written.

```gherkin
Given a submitted scorecard
When I lock it
Then the result is published, the bracket advances, standings recompute,
     lifetime entries are written, achievements are derived, certificates are queued,
     and an audit entry is recorded — all in one transaction
And if any step fails, none is applied and the scorecard remains submitted
And I see which step failed
```

### J4-E1-S2 — Notify after commit, never inside

> **As** a Player, **I want** to be told when my result is official,
> **so that** I know it counts.

```gherkin
Given a lock has committed
Then participants are notified that the result is verified
And notification failure does not roll back the lock
```

> An email cannot be rolled back — so it must sit outside the transaction. Small detail,
> easy to get wrong, corrupts the atomicity guarantee if placed inside.

### J4-E1-S3 — Individual competitors are resolved to people

> **As** a Player, **I want** my swimming result on my profile,
> **so that** ranking events count toward my record like team matches do.

```gherkin
Given a ranking event where competitors are held as event data with names and phones
When the scorecard is locked
Then each competitor whose phone matches a user gets a lifetime entry
And unmatched competitors are recorded on the fixture but create no entry
```

> Today these competitors exist **only as JSON** inside `fixtures.live_state`. Resolving
> them by phone at lock time — reusing the existing `findUserByPhone()` — turns a whole
> category of currently invisible results into real player history for a few lines of
> work.

---

## Epic J4-E2 · Lifetime participation timeline

**Goal:** Every player has a permanent, system-written timeline of verified results that survives them leaving the institution.

**Modules:** [04b §4.5](../04-people-and-player-records.md) · **P0** · **M**
**Satisfies:** FR-PRO-1, FR-PRO-2

### J4-E2-S1 — A timeline built only from locked results

> **As** a Player, **I want** a timeline of everything I've competed in,
> **so that** I have a complete record of my sporting career.

```gherkin
Then I see one entry per event with role, performance, date and any medal or honour chips
And entries appear only for locked results
And provisional results do not appear at all
And entries are ordered most recent first
```

### J4-E2-S2 — Nobody can edit the timeline

> **As** a Sports Secretary, **I want** the timeline to be system-written only,
> **so that** it is trustworthy as an institutional record.

```gherkin
Then no user interface offers editing or deleting a timeline entry
And no API endpoint permits it
And the only route to change one is a correction to the underlying result
```

### J4-E2-S3 — The record survives leaving

> **As** a Player, **I want** my record to persist after I graduate,
> **so that** it's still provable years later.

```gherkin
Given I am removed from my institution, or the institution is deleted
Then my lifetime entries remain intact and attributed to me
And they still name the organisation I represented at the time
```

> Implemented by `on delete restrict` on the user reference and FK-less organisation and
> championship references — the "survives graduation" promise made literal at the schema
> level.

### J4-E2-S4 — An admin can view a player's profile

> **As** a Faculty Coordinator, **I want** to open any of our players' profiles,
> **so that** I can answer questions about their record.

```gherkin
Given I hold people.view in an institution the player belongs to
Then I can open their profile from the directory
And I see the same timeline, statistics and credentials they see

Given I share no institution with that player
Then I cannot open their profile
```

> The scoping clause matters — FR-PPL-5 lets an admin open "a player's" profile, and
> without a boundary that is a privacy incident.

---

## Epic J4-E3 · Career statistics per sport

**Goal:** A player's career statistics are aggregated per sport from verified results, and stay correct after a correction.

**Modules:** [04b §4.5](../04-people-and-player-records.md) · **P0** · **M**
**Satisfies:** FR-PRO-3

### J4-E3-S1 — Statistics split by sport

> **As** a Player, **I want** my statistics broken down by sport,
> **so that** they mean something.

```gherkin
Then I see appearances, wins, losses and draws per sport
And medals and awards per sport
And an overall summary across all sports
And only locked results contribute
```

> Today this is five global integers — `total_events`, `total_matches`, `wins`, `losses`,
> `draws` — with no per-sport split at all.

### J4-E3-S2 — Per-player match contributions

> **As** a Player, **I want** goals and similar contributions counted,
> **so that** my statistics reflect what I actually did.

```gherkin
Given the scoring log attributed events to me
When the scorecard is locked
Then those events are projected into queryable per-player rows
And my statistics include sport-appropriate contributions such as goals or points
```

> This is what the **dead `fixture_events` table** was created for — applied in
> migrations, absent from the Prisma schema, no reader or writer today. Writing it at
> lock time is the cheapest way to make FR-PRO-3's "goals, MVP awards" real. If per-player
> statistics are cut, drop the table instead; leaving it dead is the only bad answer.

### J4-E3-S3 — Statistics stay correct after a correction

> **As** a Sports Secretary, **I want** statistics to reflect corrections,
> **so that** the numbers never drift from the results.

```gherkin
Given a locked result is corrected
Then affected career statistics are recomputed as part of that transaction
And not on a delayed schedule
```

---

## Epic J4-E4 · Achievements from verified results

**Goal:** Medals, placements and awards become typed, countable records rather than free text.

**Modules:** [07a §4.1](../07-achievements-certificates.md) · **P0** · **M**
**Satisfies:** FR-ACH-2

### J4-E4-S1 — Medals and placements are recorded

> **As** a Player, **I want** medals recorded when I win,
> **so that** "medals won" is a real number.

```gherkin
When a final is locked
Then the winning squad receives gold and the runner-up silver
And a third-place playoff produces bronze
And elimination in an earlier knockout round produces a placement such as Semi-finalist
And a ranking event awards medals by finishing place
And team achievements fan out to each squad member as individual achievements
```

> The placement vocabulary already exists as `STANDINGS_PLACEMENT` — reuse it rather than
> inventing a second one.

### J4-E4-S2 — Award names are countable

> **As** a Sports Secretary, **I want** awards drawn from a catalogue,
> **so that** "MVP awards" can be counted.

```gherkin
Given an official is recording an award
Then they choose from a catalogue such as Player of the Match, MVP, Top Scorer
And free text remains available as a fallback
And existing free-text awards are preserved without a type
```

> Without this, FR-RPT-3's "top performers" and FR-PRO-3's "MVP awards" cannot be
> computed — "Player of the Match", "player of the match" and "POTM" are three different
> strings today.

### J4-E4-S3 — Achievements only from locked results

> **As** a Sports Secretary, **I want** achievements tied to verified results,
> **so that** the Hall of Fame is defensible.

```gherkin
Then an achievement exists only where its source result is locked
And each records the lock version it derived from
And unlocking supersedes the achievements it produced
```

---

## Epic J4-E5 · Claim an external achievement

**Goal:** Achievements earned outside the platform can be claimed and validated into the record.

**Modules:** [07a §4.2](../07-achievements-certificates.md) · **P1** · **M**
**Satisfies:** FR-ACH-3

### J4-E5-S1 — Submit a claim

> **As** a Player, **I want** to claim an achievement earned outside the platform,
> **so that** my state selection is part of my record.

```gherkin
When I submit a claim with type, title, date, optional evidence link and a note
Then it is created as pending against my institution
And coordinators who can validate claims are notified
And it does not appear on my profile while pending
```

### J4-E5-S2 — Validate a claim

> **As** a Faculty Coordinator, **I want** to review claims before they enter the record,
> **so that** unverified assertions don't dilute it.

```gherkin
Given a pending claim
When I approve it
Then an achievement is created marked as a validated claim, distinguishable from a result-derived one
And the claimant is notified
And the decision is audited

When I reject it
Then I must supply a reason, which is shown to the claimant
```

### J4-E5-S3 — Claims surface on the dashboard

> **As** a Faculty Coordinator, **I want** pending claims in my attention queue,
> **so that** they don't sit unreviewed.

```gherkin
Then the institution dashboard shows a count of pending claims with a Validate action
```

---

## Epic J4-E6 · Certificate templates & branding

**Goal:** An institution can configure branded certificate templates it is willing to issue.

**Modules:** [07b §4.3](../07-achievements-certificates.md) · **P0** · **M**
**Satisfies:** FR-CRT-1

### J4-E6-S1 — Choose from approved templates

> **As** a Sports Secretary, **I want** a gallery of certificate templates,
> **so that** I can see what we can issue.

```gherkin
Then I see Winner, Runner-up, Participation and Special templates
And each shows how many certificates have been issued from it
And I can preview one rendered with sample data without issuing anything
```

### J4-E6-S2 — Apply our branding

> **As** a Sports Secretary, **I want** our logo, colours and signatories on certificates,
> **so that** they are recognisably ours.

```gherkin
When I configure a template with our logo, background, colours and signatories
Then a preview reflects it immediately
And signature images are stored privately and served only through signed URLs
```

> Signature images are a forgery vector if the bucket is public. Private bucket, signed
> URLs, never expose the raw asset.

> **Scope discipline:** ship 3–4 fixed layouts with configurable text, logo, background
> and signatories. **Do not build a WYSIWYG certificate designer.** It is the most likely
> place for this module to triple in size.

---

## Epic J4-E7 · Generate certificates in bulk

**Goal:** Certificates generate in bulk from verified results with immutable numbering, and recipients are told.

**Modules:** [07b §4.4, §4.6](../07-achievements-certificates.md) · [02](../02-communications.md) · **P0** · **L**
**Satisfies:** FR-CRT-2, FR-CRT-3, FR-CRT-5

### J4-E7-S1 — Generate a batch

> **As** a Faculty Coordinator, **I want** to generate certificates for everyone in an event at once,
> **so that** 300 certificates aren't a day of work.

```gherkin
Given a championship with locked results
When I generate a batch for all participants, or for winners only, or for chosen people
Then certificate records are created as queued and I get an immediate response
And generation proceeds in the background
And I can watch progress
```

> The API is Lambda-only with a 15-second synchronous ceiling, so this **must** be a job.
> The recommendation is SQS with one message per certificate: no timeout risk, retries and
> a dead-letter queue for free, and it parallelises. See
> [07 §4.6](../07-achievements-certificates.md).

### J4-E7-S2 — Immutable, gapless numbering

> **As** a Sports Secretary, **I want** every certificate uniquely and permanently numbered,
> **so that** a registrar can rely on it.

```gherkin
Then each issued certificate carries a number in the form CERT-{ORGCODE}-{YYYY}-{NNNNN}
And numbers are unique platform-wide
And numbers are allocated at issue, so a failed render burns no number
And concurrent generation produces no duplicates and no gaps
```

> Parallel workers make the counter lock load-bearing rather than theoretical — which is
> exactly why a counter row with `SELECT … FOR UPDATE` was chosen over `max(no)+1`. Note
> the existing deploy script already caps reserved concurrency at 10 with
> `connection_limit=1`, so contention stays bounded.

### J4-E7-S3 — The issued register

> **As** a Sports Secretary, **I want** a register of every certificate,
> **so that** I can answer "was one issued for this student?"

```gherkin
Then I see player, type, event, certificate number and status of Queued, Generating, Issued, Failed or Revoked
And I can search and filter it
And failed rows show the error and can be retried
```

### J4-E7-S4 — Recipients are told

> **As** a Player, **I want** to be notified when my certificate is ready,
> **so that** I can download it.

```gherkin
Given my certificate is issued
Then I am notified in-app and by email
And it appears in the credentials list on my profile
And I can download it
```

### J4-E7-S5 — Certificates freeze what they attest

> **As** a Sports Secretary, **I want** a certificate to render identically in five years,
> **so that** it remains a valid document.

```gherkin
Then the certificate stores a frozen snapshot of name, event, result and date at issue time
And later changes to the player's name, the team or the championship name do not alter it
And the verification page displays the frozen snapshot, never a live join
```

---

## Epic J4-E8 · Public QR verification

**Goal:** Anyone holding a certificate can confirm it is genuine, without an account.

**Modules:** [07b §4.7](../07-achievements-certificates.md) · **P1** · **S**
**Satisfies:** FR-CRT-4

> This is the product's most-seen surface by people who will never log in — recruiters,
> parents, other institutions checking a claim. It should be the best-looking page in the
> product.

### J4-E8-S1 — Scan to verify

> **As** anyone holding a certificate, **I want** to scan its QR code,
> **so that** I can confirm it is genuine.

```gherkin
Given a certificate with a QR code
When I scan it
Then I reach a public page needing no account
And I see player, event, result, certificate number, issuing organisation and issue date
And the page carries a clear "Verified by Sportagon EOS" mark
```

### J4-E8-S2 — Revoked certificates say so

> **As** a recruiter, **I want** to know if a certificate was superseded,
> **so that** I'm not misled by an out-of-date document.

```gherkin
Given a certificate was revoked because its result was corrected
When I scan it
Then I see it was superseded, with the date
And the page does not 404 or silently disappear
```

> An honest audit outcome, not a disappearance. A revoked certificate that someone has
> already printed and submitted is a real-world problem — the page must explain, not
> vanish.

### J4-E8-S3 — Verification leaks nothing

> **As** a Sports Secretary, **I want** the public page limited to the certificate,
> **so that** it isn't an entry point into our data.

```gherkin
Then the page shows only that certificate's frozen details
And no contact details, no other results and no institution roster are exposed
And an invalid or tampered token shows a generic not-found page
```

---

## Epic J4-E9 · Organisation Hall of Fame

**Goal:** An institution has a presentable record of what it has won, built from verified achievements.

**Modules:** [07a §4.1](../07-achievements-certificates.md) · **P1** · **M**
**Satisfies:** FR-ACH-1, FR-ACH-2

### J4-E9-S1 — Institution achievements page

> **As** a Sports Secretary, **I want** a page of our achievements,
> **so that** we can show what the institution has won.

```gherkin
Then I see medals won, records set, selections and a this-season figure
And team achievements and individual achievements as cards with photo, sport, name, achievement and year
And only verified achievements appear
```

### J4-E9-S2 — Achievement feed

> **As** a Faculty Coordinator, **I want** a reverse-chronological feed of achievements,
> **so that** I can see what's happened recently.

```gherkin
Then I see verified wins, records, selections and honours newest first, with timestamps
```

### J4-E9-S3 — Shareable achievement cards

> **As** a Sports Secretary, **I want** a branded image for an achievement,
> **so that** we can post it.

```gherkin
When I choose Share card
Then a branded image is generated with our logo and the achievement details
And I can download it
```

> P1 and the last thing to build in this journey — most visible, least load-bearing.

---

## Epic J4-E10 · Right to erasure ⚠

**Goal:** A person can have their personal data erased without falsifying anyone else's competition record.

**Modules:** [04b §4.7](../04-people-and-player-records.md) · **P0** · **M**
**Satisfies:** §9 privacy & retention

> ⚠ **Blocked on a decision, not on engineering.** The PRD requires both *"right-to-erase
> data for any user"* and *"lifetime profiles persist post-graduation by design"* with
> profiles *"immutable"*. These contradict. The stories below implement the proposed
> resolution — **erase the person, keep the result** — which needs sign-off from whoever
> owns the legal position before it is built. See
> [open question #4](../00-index.md#7-open-questions-for-the-prd-author).

### J4-E10-S1 — Request erasure

> **As** a Player, **I want** to request erasure of my personal data,
> **so that** I can exercise my rights.

```gherkin
When I request erasure
Then I am shown exactly what will be deleted and what will be retained, and why
And I must confirm explicitly
And the request is recorded in the audit trail
```

### J4-E10-S2 — Erase identity, retain the record

> **As** a Sports Secretary, **I want** match results to survive an erasure,
> **so that** other participants' records aren't falsified.

```gherkin
Given an erasure is executed
Then name, email, phone, avatar, date of birth and gender are deleted
And institution memberships are deleted
And the user row is retained as a tombstone with no personal data
And lifetime entries, achievements and certificates are retained, displayed as "Withdrawn participant"
And fixtures, scores and standings are untouched
And audit entries are retained, using the denormalised actor label
```

> The argument: a locked match result is a record of an event that happened, jointly owned
> by every participant and the organising institution — closer to a public competition
> record than to personal data held for one individual's benefit. Erasing one player from
> a team result would falsify the opposing team's record too.

---

## Done looks like

1. An official submits; an organiser locks. In **one transaction** the result publishes,
   standings recompute, Ananya's timeline gains an entry, a silver medal is recorded, a
   certificate is queued, and an audit line is written. A forced failure in any step
   leaves **none** of it applied.
2. Ananya's profile shows a timeline no interface can edit, statistics split by sport, and
   a credentials list.
3. Her state selection is claimed, validated by a coordinator, and joins the record marked
   as a claim rather than a result.
4. 300 participation certificates generate in the background, numbered
   `CERT-IIMB-2026-00001` upward with **no gaps and no duplicates**, and recipients are
   emailed.
5. A recruiter scans one two years after she graduates and sees a page confirming it,
   built from the frozen snapshot — even though she left, and even though her name in the
   system has changed.
6. An organiser corrects one result; its certificates are revoked, the scan explains why,
   and a replacement is queued.

Step 1's failure case is the acceptance test that matters most, and it is the one most
likely to pass review while being wrong — see the transaction-client trap in
[06 §9](../06-verification-pipeline.md).
