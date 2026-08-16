# J3 · Enter & Compete

> *"Get my team — or just me — into a competition and play."*
>
> **Personas:** Team Captain, Player
> **Modules:** [05 Flexible Entry](../05-flexible-entry.md) ●●● · [09 Core Deltas](../09-championship-core-deltas.md) ●● · [01](../01-identity-tenancy-workspace.md) ○ · [02](../02-communications.md) ○
> **Epics:** 5 · **Journey size:** M

---

## The narrative

Two people, two very different routes into the same competition.

**Rohan** is the PGP 2024 football captain at IIMB. He picks a squad from the student
directory, names a vice-captain, assigns jersey numbers, and enters the squad into the
Inter-Programme Meet. His institution is behind him at every step. This mostly works
today — the roster builder is good — but there is no way to record a **coach**, which
FR-TEAM-1/2/3 all assume.

**Meera** wants to enter the city open badminton singles. She has no institution. Today
the product tells her, in effect: *first create an organisation, then enrol it, then wait
for approval, then create a team of one, then add yourself to it, then enter that team.*
Six steps and a concept she does not have, to sign up for a singles tournament.

That is the gap this journey closes. The competition model is **not** the obstacle — it
already understands `entry_type ∈ team | individual | doubles | relay`, and `squad_min`
already defaults to 1, so a team of one is legal at the rules layer. The obstacle is
purely the *ownership chain*: four NOT NULL columns and two guards that assume an
organisation admin exists.

The decided approach is a **hidden personal organisation**: on Meera's first independent
entry, one is auto-provisioned behind the scenes so the existing enrolment, roster,
standings and share-page machinery keeps working untouched. **She never sees the word
"organisation".**

**Where it ends:** Rohan's squad is entered and locked; Meera is in the singles draw;
both see their fixtures on their own screens the morning of the match. Neither had to
learn how the data model works.

---

## Epic J3-E1 · Enter without an institution ★

**Goal:** A person with no institution can enter a competition alone or with friends, without ever meeting the concept of an organisation.

**Modules:** [05](../05-flexible-entry.md) · **P0** · **M**
**Satisfies:** the flexible-entry product requirement *(not in the PRD)*

> ★ The reason this module exists. Note the strongest argument for the chosen design:
> **the authorisation layer needs no changes at all** — a personal org's creator is its
> `owner`, so `orgRole()` already passes for `enrollSelf`, `teamCreate` and `teamManager`.

### J3-E1-S1 — Enter as an individual

> **As** a Player, **I want** to enter a competition as myself,
> **so that** I can compete without belonging to any institution.

```gherkin
Given I am signed in, belong to no institution, and the championship allows individual entry
When I choose "Just me" on a championship that is open for registration
Then my entry is submitted in a single action
And I never see the word "organisation" anywhere in the flow
And behind the scenes a personal organisation, enrolment, one-person team and entry are
    created in one transaction — or none of them are

Given the draw's entry type is "individual"
Then I am not asked anything about a squad
```

### J3-E1-S2 — Enter as a small group

> **As** a Team Captain, **I want** to enter with a few friends,
> **so that** an ad-hoc five-a-side team can compete.

```gherkin
When I choose "A group of friends" and name the squad
Then the squad is created with me as captain and entered into the championship
And I get a share link my friends can use to join themselves
And the squad name is what appears in fixtures and standings

Given the draw's entry type is "doubles"
Then I am asked for exactly one partner
```

> The share-link mechanism already exists — `teams.invite_token` with
> `GET /teams/by-token/:token` and `/join`. It needs no work, only surfacing.

### J3-E1-S3 — I appear as a person, not an organisation

> **As** a Player, **I want** to be shown by my own name,
> **so that** standings and fixtures don't display a fake organisation.

```gherkin
Given I entered as an individual
Then standings, fixtures, approvals and public share pages show my name and avatar
And no organisation logo or Verified badge is shown for me
And in an organisation-aggregated standings table I may be suffixed "(Individual)"
```

### J3-E1-S4 — Personal organisations stay invisible

> **As** a Sports Secretary, **I want** individual entrants kept out of organisation lists,
> **so that** our directory and platform statistics aren't polluted.

```gherkin
Then personal organisations never appear in the organisation directory or typeahead,
    the platform organisation list, Discover, the invite picker, the join-an-organisation
    modal, or peer benchmark aggregates
And platform-level counts of organisations exclude them
And a user can hold at most one personal organisation
```

> **The most likely way this feature goes wrong.** Implement as a shared
> `visibleOrgsWhere()` default rather than per-route filters, and add a test asserting
> `GET /organizations` never returns one. See [05 §4.3](../05-flexible-entry.md) for the
> full audit list of eight surfaces.

### J3-E1-S5 — Organisers control individual entry

> **As** a Championship Organiser, **I want** to decide whether individuals may enter,
> **so that** an inter-college championship isn't joined by unaffiliated players.

```gherkin
Given I am configuring a championship
Then "Allow individual entries" defaults to on for public and off for private championships
When it is off
Then the individual entry option is not offered and a direct attempt is refused
```

### J3-E1-S6 — Individual entries still need approval

> **As** a Championship Organiser, **I want** individual entrants in my approvals queue,
> **so that** I control who competes.

```gherkin
Given an individual has applied
Then they appear in the approvals queue rendered as a person, not an institution
And approving or rejecting works identically to an organisation application
```

---

## Epic J3-E2 · Build and manage a squad

**Goal:** A captain can assemble a reusable squad with roles, jersey numbers and a coach.

**Modules:** [09 §4.1](../09-championship-core-deltas.md) · **P0** · **M**
**Satisfies:** FR-TEAM-1, FR-TEAM-2, FR-TEAM-3, FR-TEAM-4

*Mostly existing — [`RosterPage.tsx`](../../../apps/web/src/pages/organization/RosterPage.tsx)
is strong. The real gap is coach.*

### J3-E2-S1 — Create a team

> **As** a Team Captain, **I want** to create a team for a sport,
> **so that** I have a squad that can enter competitions.

```gherkin
Given I am an owner or admin of my institution
When I create a team with a name and sport
Then it belongs to my institution and is reusable across championships
And it starts in a forming state
```

### J3-E2-S2 — Pick the squad

> **As** a Team Captain, **I want** to add players from our directory,
> **so that** I'm choosing from real, verified people.

```gherkin
When I search the directory and add players
Then each is added with a role of player or substitute
And squad size is validated against the resolved minimum and maximum for the draw
And exactly one captain and at most one vice-captain may be assigned
And jersey numbers are unique within the squad
```

### J3-E2-S3 — Record a coach

> **As** a Team Captain, **I want** to record our coach,
> **so that** the team card shows who is responsible for it.

```gherkin
When I assign a coach to the team
Then the coach appears on the team card and roster
And the coach is not counted against squad size limits
And a team may have no coach
```

> ⚠ **Coach does not exist anywhere in the product** — no such value in any role enum.
> The recommendation is `teams.coach_user_id` (a property of the team) rather than a
> squad-member role, precisely so squad-size limits are unaffected. Blocked on
> [open question #5](../00-index.md#7-open-questions-for-the-prd-author).

### J3-E2-S4 — Lock the roster for a championship

> **As** a Team Captain, **I want** to lock my squad for one championship,
> **so that** it's final there without freezing the team everywhere.

```gherkin
Given my team is entered in two championships
When I lock the roster for one of them
Then that entry's squad cannot change
And the team's squad for the other championship is unaffected
And an organiser can unlock it if a genuine change is needed
```

> Per-entry locking, not per-team — this is `team_entries`, and it is **a different
> feature from scorecard locking** ([J2-E7](J2-run-a-championship.md)) despite the shared
> word. Roster locks are reversible by design; scorecard locks are not.

---

## Epic J3-E3 · Enter a squad into competitions

**Goal:** A squad can be entered into the right draws, and reused across championships and seasons.

**Modules:** [09](../09-championship-core-deltas.md) · **P0** · **S**
**Satisfies:** FR-TEAM-4, FR-EVD-9

### J3-E3-S1 — Enter a team into a draw

> **As** a Team Captain, **I want** to enter my squad into a specific sport and discipline,
> **so that** we appear in the right draw.

```gherkin
Given my institution's enrolment in the championship is approved
When I enter my team into a draw
Then an entry is created linking the team to that championship and draw
And only one team per organisation may be entered into the same draw
And the same roster may be entered into several championships at once
```

### J3-E3-S2 — Reuse a roster across seasons

> **As** a Team Captain, **I want** the same team to carry across championships,
> **so that** I'm not rebuilding the squad every time.

```gherkin
Given a team from last season
When I enter it into a new championship
Then its existing members carry over
And I can adjust the squad for this entry before locking it
```

---

## Epic J3-E4 · Discover competitions to enter

**Goal:** Captains and secretaries can find competitions worth entering, and apply to them.

**Modules:** [09 §4.6](../09-championship-core-deltas.md) · **P1** · **M**
**Satisfies:** FR-DIS-1, FR-DIS-2, FR-DIS-3, FR-DIS-4

### J3-E4-S1 — Browse open competitions

> **As** a Team Captain, **I want** to browse competitions I could enter,
> **so that** I find opportunities without being told about them.

```gherkin
Then I see public championships that are open for registration
And I can search and filter by sport and status
And private championships I'm not involved in do not appear
And each card shows whether my institution has already applied, and the status
```

### J3-E4-S2 — Filter by region

> **As** a Sports Secretary, **I want** to filter competitions by region,
> **so that** I can find events we could realistically travel to.

```gherkin
Then I can filter by All, Asia, Europe, Americas or Oceania
And I see header stats for countries, open competitions and regions
And championships without a country set are grouped as unspecified rather than hidden
```

### J3-E4-S3 — Apply to a competition

> **As** a Team Captain, **I want** to apply on behalf of my institution,
> **so that** we can be considered for entry.

```gherkin
Given a championship open for registration
When I apply on behalf of an institution I administer
Then a pending application is created and the organiser is notified
And applying twice for the same institution is refused with a clear message
```

---

## Epic J3-E5 · My matches & my day

**Goal:** A player can see their own fixtures, follow their live matches, and see how their championship is going.

**Modules:** [09](../09-championship-core-deltas.md) · **P0** · **S**
**Satisfies:** FR-EVD-2, participant experience

### J3-E5-S1 — See my upcoming matches

> **As** a Player, **I want** to see my own fixtures,
> **so that** I know where to be and when.

```gherkin
Then I see my upcoming matches with date, time, venue, opponent and sport
And past matches show the result
And this covers every championship I'm in, including ones I entered as an individual
```

### J3-E5-S2 — Follow a match I'm in

> **As** a Player, **I want** to see the live score of my match,
> **so that** teammates and family can follow it.

```gherkin
Given a match I'm in is live
Then I see the current score, updating as the official scores it
And once its scorecard is locked the result shows as Verified
```

### J3-E5-S3 — See my championship

> **As** a Player, **I want** to see the standings and fixtures of a championship I'm in,
> **so that** I know how we're doing.

```gherkin
Then I see standings, my team's fixtures and results
And standings are labelled Provisional while any contributing result is unlocked
```

---

## Done looks like

**Rohan (institution route):**
1. Creates the PGP 2024 football team, picks 15 players from the verified directory,
   names a vice-captain and assigns jersey numbers.
2. Records the coach — which is impossible today.
3. Enters the squad into the Inter-Programme football draw and locks the roster for that
   championship only.
4. Sees the team's fixtures on his own screen.

**Meera (independent route):**
1. Finds the city open badminton singles in Discover.
2. Taps **Enter → Just me**. One action. **The word "organisation" never appears.**
3. Appears in the organiser's approvals queue as *Meera Iyer*, not as a fake institution.
4. Is approved, and sees her fixture the morning of the match.
5. Her personal organisation appears in **no** directory, **no** Discover listing, and
   **no** platform statistic.

Point 5 is the failure mode most likely to slip through and is worth an explicit
regression test.
