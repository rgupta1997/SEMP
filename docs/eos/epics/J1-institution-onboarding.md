# J1 · Institution Onboarding

> *"Get my institution set up so my people can actually use this."*
>
> **Personas:** Sports Secretary, Faculty Coordinator, Student Coordinator
> **Modules:** [01 Identity & Tenancy](../01-identity-tenancy-workspace.md) ●●● · [04a People](../04-people-and-player-records.md) ●●● · [02 Communications](../02-communications.md) ●● · [03 RBAC](../03-rbac-module-access-audit.md) ●
> **Epics:** 7 · **Journey size:** L

---

## The narrative

Akash is the Sports Secretary at IIM Bangalore. A demo went well and the institution has
signed up. Today his sports data lives in four WhatsApp groups, a shared Drive folder of
spreadsheets, and the memory of last year's committee — which graduated in April.

What has to happen, in order:

1. **IIMB becomes a real tenant.** Not a row in a global directory anyone can see — a
   verified institution with `@iimb.ac.in` claimed, so anyone with that email lands in
   the right workspace and nobody else can.
2. **Akash can get in, and get back in.** Email-first sign-in that recognises the domain.
   A forgotten password that he can fix himself, at 11pm, without messaging anyone.
3. **His team joins him.** Five faculty coordinators, ten student coordinators — invited
   by email, setting their own passwords, with the right level of access. Not a
   spreadsheet of temporary credentials relayed over WhatsApp.
4. **The institution's shape is described.** PGP, EPGP, PhD; batches within each. This is
   what makes "participation by programme" possible later, and it must exist before the
   student roll is imported.
5. **The students arrive.** 2,000 of them, from the registrar's export, in one upload —
   with a validation report for the rows that don't match, not a silent partial import.
6. **They get verified.** Pending → Verified, in bulk, so "1,847 verified athletes" is a
   number Akash can defend.
7. **Akash has somewhere to stand.** A workspace home that tells him what needs his
   attention today, rather than dropping him on a participant profile.

**Where it ends:** Akash logs in at `iimb.ac.in`, sees his institution's name and a
Verified badge, and a dashboard telling him three registrations need review. His
coordinators have their own logins. 2,000 students are in the directory, tagged by
programme and batch. Nothing has been run yet — but the institution exists, and it is
his.

**What today's product actually does instead:** he creates an "organisation" that every
other user on the platform can see and search; there is no way to invite anyone by email;
there is no concept of a programme or a batch; there is no list of his people; and
logging in drops him at `/profile`, a participant view.

---

## Epic J1-E1 · Institution identity & verified tenancy

**Goal:** IIMB exists as a verified institution tenant with its email domain claimed,
distinct from the lightweight community orgs anyone can create.

**Modules:** [01 §4.1, §4.2](../01-identity-tenancy-workspace.md) · **P0** · **M**
**Satisfies:** FR-AUTH-2, §7 Organisation entity

### J1-E1-S1 — Register an institution

> **As** a Sports Secretary, **I want** to register my institution with its name, logo and city,
> **so that** my people see a workspace that looks like ours, not a generic tool.

```gherkin
Given I am signed in and belong to no institution
When I create an organisation and supply name, short name, city and logo
Then it is created with kind='community' and verified=false
And I become its owner
And it does not appear in any other user's organisation directory listing
```

### J1-E1-S2 — Claim our email domain

> **As** a Sports Secretary, **I want** to claim `@iimb.ac.in` for my institution,
> **so that** anyone from IIMB is routed to our workspace automatically.

```gherkin
Given I am the owner of an institution
When I add the domain "iimb.ac.in"
Then it is stored against my institution with verified=false
And it has no effect on sign-in until a platform admin verifies it

Given a domain is already claimed and verified by another institution
When I try to add the same domain
Then I am told the domain is already claimed
And I am not told which institution holds it
```

```gherkin
Given I try to add a public mail provider such as "gmail.com"
When I submit it
Then it is rejected against the public-provider deny-list
```

### J1-E1-S3 — Request verification `[platform action]`

> **As** a Sports Secretary, **I want** my institution verified,
> **so that** the Verified badge and the workspace features are switched on.

```gherkin
Given my institution has at least one claimed domain
When I request verification
Then Sportagon is notified and the request is recorded

Given a platform admin approves the request
Then kind becomes 'institution' and verified becomes true
And my claimed domains become verified and start routing sign-in
And the Verified badge appears in my sidebar
And an audit entry records who verified it and when
```

> **Note:** promotion to the institution tier is deliberately a super-admin action, not a
> self-service one — the Verified badge is a trust signal and must not be self-issued.

### J1-E1-S4 — Configure workspace settings

> **As** a Sports Secretary, **I want** to control which sign-in methods my institution allows,
> **so that** we match our own security policy.

```gherkin
Given my institution is verified
When I enable password and one-time code, and leave SSO off
Then only those methods are offered on the sign-in screen for my domain
And the settings are validated against a schema before saving
```

---

## Epic J1-E2 · Email-first sign-in & account recovery

**Goal:** A person types their work email and the product knows who they are and where
they belong — and can recover their own account without human help.

**Modules:** [01 §4.2, §4.4](../01-identity-tenancy-workspace.md) · [02](../02-communications.md) · **P0** · **M**
**Satisfies:** FR-AUTH-1, FR-AUTH-2, FR-AUTH-3, FR-AUTH-4, FR-AUTH-7
**Depends on:** J1-E1-S2 · **Phase 0**

### J1-E2-S1 — Email-first identification

> **As** a Sports Secretary, **I want** the sign-in screen to recognise my institution from my email,
> **so that** I get confirmation I'm in the right place before I type a password.

```gherkin
Given "iimb.ac.in" is a verified domain for IIM Bangalore
When I enter "akash@iimb.ac.in" on the sign-in screen
Then I see "IIM Bangalore — Organisation identified" with the institution's logo
And I am offered only the sign-in methods that institution permits

Given I enter an email whose domain is not claimed by any institution
Then I am shown the generic sign-in form
And the response is identical whether or not an account exists for that address
```

> The last clause is load-bearing: this endpoint is an unauthenticated oracle and must
> never confirm account existence. See [01 §4.2](../01-identity-tenancy-workspace.md).

### J1-E2-S2 — Institution trust stats

> **As** a Sports Secretary, **I want** to see our record counts on the sign-in screen,
> **so that** the workspace feels like our institution's own system of record.

```gherkin
Given my institution is identified from my email domain
Then I see records kept, events per year and medals won for that institution
And the figures come from a cached aggregate, not a live count
And no figure is displayed at all if the aggregate is unavailable
```

### J1-E2-S3 — Reset a forgotten password

> **As** a Faculty Coordinator, **I want** to reset my own password by email,
> **so that** I'm not blocked at 11pm before a tournament.

```gherkin
When I request a reset for my address
Then a single-use token with an expiry is created and only its hash is stored
And an email is sent via the email service
And the response and its timing are identical whether or not the address exists

Given I open a valid, unexpired, unconsumed reset link
When I set a new password
Then the token is consumed and cannot be reused
And any existing sessions are invalidated

Given I open a link that is expired or already consumed
Then I am told it is no longer valid and offered a fresh one
```

```gherkin
Given I request resets repeatedly
When I exceed the per-address or per-IP rate limit
Then further requests are refused without revealing why
```

### J1-E2-S4 — Sign in with a one-time code

> **As** a Student Coordinator, **I want** to sign in with a code emailed to me,
> **so that** I don't need to remember another password.

```gherkin
Given my institution permits one-time codes
When I request a code
Then a 6-digit code valid for 10 minutes is emailed to me
And it is single-use
And after 5 incorrect attempts it is invalidated and I must request another
And I can switch back to password sign-in at any point
```

---

## Epic J1-E3 · Invite the sports office team

**Goal:** Coordinators are invited by email and set their own passwords. No relayed
temporary credentials.

**Modules:** [01 §4.4](../01-identity-tenancy-workspace.md) · [02](../02-communications.md) · [03](../03-rbac-module-access-audit.md) · **P0** · **M**
**Satisfies:** FR-AUTH-6, FR-ADM-3 (assignment) · **Phase 0**

### J1-E3-S1 — Invite a coordinator by email

> **As** a Sports Secretary, **I want** to invite a faculty coordinator by email address,
> **so that** they can join without me handling their password.

```gherkin
When I invite "priya@iimb.ac.in" as a Faculty Coordinator
Then an invitation with a single-use expiring token is created
And an email is sent containing the acceptance link
And she appears in my members list as Invited until she accepts

Given the invited address is outside my institution's verified domains
Then I am warned before the invitation is sent, and may proceed deliberately
```

### J1-E3-S2 — Accept an invitation and set a password

> **As** a Faculty Coordinator, **I want** to click the invitation link and choose my own password,
> **so that** nobody else ever knows my credentials.

```gherkin
Given I open a valid invitation link
When I set a password
Then my account is activated with the role stated in the invitation
And the token is consumed
And I land on the workspace home, not a participant profile

Given I already have a Sportagon account with that email
When I open the link
Then the institution membership is added to my existing account
And I am not asked to create a second account
```

> Reuses the existing `must_change_password` full-screen flow — see
> [01 §2.1](../01-identity-tenancy-workspace.md). The mechanism works today; only
> delivery is missing.

### J1-E3-S3 — Manage the sports office team

> **As** a Sports Secretary, **I want** to change a coordinator's role or remove them,
> **so that** access matches who is actually on the committee this year.

```gherkin
When I change a member's role
Then the change takes effect immediately and is written to the audit trail

Given a member is the only remaining active owner or admin
When I try to demote, deactivate or remove them
Then it is refused, and I am told to promote someone else first
```

> That last rule already exists as `assertNotLastAdmin()` in
> [`organizations.routes.ts`](../../../apps/api/src/modules/iam/organizations.routes.ts)
> — reuse it, do not reimplement.

### J1-E3-S4 — Committee handover

> **As** a Sports Secretary, **I want** to hand ownership to next year's secretary,
> **so that** the institution's record survives the committee turning over.

```gherkin
Given I am the owner
When I promote another active member to owner and step down to admin
Then they hold full access and I do not
And the handover is recorded in the audit trail
```

> This is the PRD's core problem statement made concrete — *"data is lost each academic
> year or with each committee handover"*.

---

## Epic J1-E4 · Programme & batch structure

**Goal:** The institution's shape is described, so people can be tagged and reports can
be broken down.

**Modules:** [01 §4.3](../01-identity-tenancy-workspace.md) · **P0** · **M**
**Satisfies:** FR-ADM-1 · **Blocks:** J1-E5, J5-E1

### J1-E4-S1 — Build the structure tree

> **As** a Sports Secretary, **I want** to define our programmes and their batches,
> **so that** people can be placed in the institution's real structure.

```gherkin
When I add a programme "PGP" and batches "PGP 2024" and "PGP 2025" beneath it
Then the tree renders as Institution → Programme → Batch
And each node shows a derived member count, never a stored one
And display order is editable
```

### J1-E4-S2 — Edit and remove units

> **As** a Sports Secretary, **I want** to rename or remove a unit,
> **so that** the structure stays accurate as programmes change.

```gherkin
When I rename a programme
Then everyone assigned to it reflects the new name immediately

Given a unit has members assigned
When I try to delete it
Then I am warned how many people are affected and must confirm
And on confirmation their unit assignment is cleared, not their record
```

---

## Epic J1-E5 · Bulk-import the student roll

**Goal:** 2,000 students in one upload, with a real validation report.

**Modules:** [04a §4.3](../04-people-and-player-records.md) · **P0** · **M**
**Satisfies:** FR-PPL-4, §8.3 · **Depends on:** J1-E4

### J1-E5-S1 — Validate before importing

> **As** a Faculty Coordinator, **I want** to check my spreadsheet before committing it,
> **so that** I fix problems rather than discovering them afterwards.

```gherkin
Given I upload a CSV or XLSX and map its columns
When I run validation
Then I get a per-row report of what will be created, matched or rejected
And nothing is written to the database
And rows naming a programme or batch that does not exist are rejected with a clear message
And no org unit is created implicitly
```

```gherkin
Given the file contains two rows with the same phone number
Then both are flagged as a duplicate pair in the report before import
```

> Copy the validate-then-apply split from
> [`matrix-import.routes.ts`](../../../apps/api/src/modules/import/matrix-import.routes.ts).
> It is idempotent and already returns a structured error report.

### J1-E5-S2 — Import the roll

> **As** a Faculty Coordinator, **I want** to commit the validated file,
> **so that** our students are in the directory.

```gherkin
Given a validated file
When I apply the import
Then each person is resolved by user id, then phone, then email, and only otherwise created
And each is added to my institution with their programme, batch and member code
And every imported person starts at verification='pending'
And the import is recorded in the audit trail with a row count
And re-running the same file makes no further changes
```

### J1-E5-S3 — Add one person

> **As** a Faculty Coordinator, **I want** to add a single student,
> **so that** a late joiner doesn't require a spreadsheet.

```gherkin
When I add a person with name, email, phone, programme and batch
Then they are created or matched to an existing account by phone or email
And they start at verification='pending'
And their member code is unique within my institution
```

### J1-E5-S4 — Capture demographics and consent

> **As** a Sports Secretary, **I want** demographic data collected with recorded consent,
> **so that** we can report on inclusion without holding anything we shouldn't.

```gherkin
Given a person is created by import or self-signup
Then the consent version in force is recorded against their account, with a timestamp
And date of birth, gender and scholarship status may be supplied
And "prefer not to say" is an available value for gender, stored as itself rather than as a null

Given demographic data has been collected
Then gender and scholarship status are never displayed against a named individual anywhere
And they do not appear in the people directory, on a profile, or in any export that names people
And non-disclosure is reported as its own category, never inferred or silently excluded
```

> ✅ **Decided 2026-08-12: collect gender, date of birth and scholarship status.** This
> unblocks [J5-E3](J5-leadership-reporting.md) entirely — without it, FR-RPT-4's whole D&I
> report and FR-RPT-2's women-participation headline KPI could not be built.
>
> Two things still to do before the first row is collected: **the consent text needs
> legal review**, and scholarship status is financially sensitive, so the
> aggregate-display-only rule above is a hard constraint rather than a preference.

---

## Epic J1-E6 · Verify players

**Goal:** "1,847 verified athletes" becomes a defensible number.

**Modules:** [04a §4.4](../04-people-and-player-records.md) · [02](../02-communications.md) · **P0** · **S**
**Satisfies:** FR-PPL-1, FR-PPL-2, FR-PPL-3, FR-PPL-5, FR-PPL-6

### J1-E6-S1 — Browse the people directory

> **As** a Faculty Coordinator, **I want** a searchable directory of our people,
> **so that** I can find anyone without going through teams.

```gherkin
Then I see name, member code, programme/batch, primary sport, event count and verification status
And I can filter by Verified, Pending, Rejected or All, each showing a live count
And I can search by name and combine it with the status filter
And clicking a row opens that person's profile
```

> This **replaces** [`StudentsPage.tsx`](../../../apps/web/src/pages/organization/StudentsPage.tsx),
> which lists teams and their members — a person in no team is invisible there. Redirect
> the old route rather than 404.

### J1-E6-S2 — Verify and reject

> **As** a Faculty Coordinator, **I want** to verify people individually or in bulk,
> **so that** 2,000 imported rows become a trusted roll.

```gherkin
When I verify a pending person
Then their status becomes verified, stamped with who verified it and when
And an audit entry is written
And they are notified

When I reject a person
Then I must supply a reason, which is stored and shown to them

Given I select many pending people
When I verify the selection in one action
Then each transition is applied and audited individually
```

### J1-E6-S3 — Verification is per-institution

> **As** a Sports Secretary, **I want** verification to mean "verified by us",
> **so that** another organisation's judgement is not inherited into our roll.

```gherkin
Given a person is verified by IIM Bangalore and is also a member of a city cricket club
Then they show as Verified in IIMB's directory
And their status in the club's directory is unaffected
```

> This is why verification lives on `organization_members`, not `users` —
> [04 §4.1](../04-people-and-player-records.md).

---

## Epic J1-E7 · The workspace shell & daily command centre

**Goal:** Akash lands somewhere that tells him what needs doing today.

**Modules:** [01 §4.5, §4.6](../01-identity-tenancy-workspace.md) · **P0** · **L**
**Satisfies:** FR-NAV-1…5, FR-DASH-1…6

### J1-E7-S1 — An institution workspace shell

> **As** a Sports Secretary, **I want** a workspace that shows my institution's identity,
> **so that** it reads as ours rather than a generic tool.

```gherkin
Given I am an owner or admin of a verified institution
When I sign in
Then I land on the institution home, not a participant profile
And the sidebar shows our logo, name and a "Sports Org · Verified" badge
And navigation covers Home, People, Teams, Events, Discover, Achievements, Certificates, Reports, Administration
And the Events item carries a live count of matches in progress
And the top bar shows a breadcrumb, section title and my name and role
```

> Today `roleHome('system')` returns `/platform/sports` and there is no institution shell
> at all — see [01 §2.3](../01-identity-tenancy-workspace.md).

### J1-E7-S2 — Attention-first dashboard

> **As** a Sports Secretary, **I want** to see what needs my attention,
> **so that** I start with decisions rather than navigation.

```gherkin
Then I see live KPIs: total players, active teams, upcoming events, awaiting approval, certificates pending, matches live now
And "matches live now" is visually accented when greater than zero
And I see a pending-actions queue, each item with a count and a one-tap CTA that deep-links into context
And an item appears only when its underlying capability exists
```

> Generalises the "Needs your attention" block already in
> [`EventDashboard.tsx`](../../../apps/web/src/pages/organiser/EventDashboard.tsx) from
> championship scope to institution scope. Two of the PRD's four example CTAs — *scorecard
> ready to lock* and *achievement claim to validate* — depend on
> [J2-E7](J2-run-a-championship.md) and [J4-E5](J4-the-verified-record.md). **Ship the
> queue with the CTAs that work and let it grow; do not block the dashboard on them.**

### J1-E7-S3 — Participation trend

> **As** a Sports Secretary, **I want** to see participation across recent seasons,
> **so that** I can answer "are we growing?" without building a spreadsheet.

```gherkin
Then I see unique participants per season for the last six seasons
And a year-on-year delta against the previous season
And where there is no prior season, the delta shows "no comparison available" rather than a percentage
```

> Depends on the aggregates from [J5-E1](J5-leadership-reporting.md). Ship the dashboard
> without the chart if that hasn't landed.

### J1-E7-S4 — Live and upcoming events

> **As** a Faculty Coordinator, **I want** current and upcoming events on the home page,
> **so that** I can see what's running without hunting.

```gherkin
Then I see date, title, sport summary and a status chip of Live, Registration, Upcoming or Completed
And there is a link through to the full events list
```

### J1-E7-S5 — Sync confidence strip

> **As** a Sports Secretary, **I want** to see how much data the workspace holds and when it last updated,
> **so that** I trust it as our system of record.

```gherkin
Then I see "synced across N records · updated Xm ago" with a real count from a cached aggregate
And if the aggregate is unavailable the strip is hidden entirely
```

> A fabricated trust signal is worse than none — if the number cannot be real, remove the
> strip.

### J1-E7-S6 — Configurable navigation

> **As** a Sports Secretary, **I want** to merge or split navigation groupings,
> **so that** the workspace matches how we talk about our own operation.

```gherkin
Given I merge Events & Competitions into one item
Then the sidebar renders one item and both sets of pages remain reachable
And the same applies to Records & Achievements
```

---

## Done looks like

The journey is complete when all of the following are true in one sitting:

1. Akash signs in by typing `akash@iimb.ac.in`, sees **IIM Bangalore — Organisation
   identified**, and authenticates with his chosen method.
2. He lands on an institution home showing the IIMB logo, a **Verified** badge, and a
   pending-actions queue.
3. Priya, a faculty coordinator, received an emailed invitation, set her own password,
   and has approval rights Akash granted — with no credential ever relayed by hand.
4. The structure tree shows PGP → PGP 2024 / PGP 2025 with live member counts.
5. 2,000 students imported from one file, with a validation report for the rejected rows,
   and re-running the file changes nothing.
6. 1,847 of them are Verified, in bulk, each transition audited.
7. Someone at another institution searching the platform **cannot see IIMB's people, and
   cannot enumerate IIMB itself.**

Point 7 is the one most likely to be forgotten and is the whole point of tenancy — it is
tested explicitly in [J6-E5](J6-govern-and-administer.md).
