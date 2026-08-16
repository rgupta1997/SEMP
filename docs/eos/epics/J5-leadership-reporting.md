# J5 · Leadership Reporting

> *"Show leadership what our sports programme achieved."*
>
> **Personas:** Sports Secretary, Faculty Coordinator
> **Modules:** [08b/c Reports & Exports](../08-reports-impact-exports.md) ●●● · [04a People](../04-people-and-player-records.md) ○ · [01](../01-identity-tenancy-workspace.md) ○ · [06](../06-verification-pipeline.md) ○ · [07a](../07-achievements-certificates.md) ○
> **Epics:** 5 · **Journey size:** L

---

## The narrative

It is April. Akash has a budget meeting with the Director in ten days, and the questions
are always the same: *How many students actually played? Is that up or down? How did we
do against other schools? Are women participating? What did we win?*

Today he answers this by opening four spreadsheets and a WhatsApp group, and the answer
takes a week and is partly guesswork. This is the fragmentation the PRD's problem
statement describes — *"leadership cannot answer basic questions… or benchmark against
peer institutions."*

What the journey delivers:

1. **Participation** — how many unique students played, by sport and by programme, with a
   year-on-year delta.
2. **Performance** — medals, win rate, records, top performers.
3. **Diversity & inclusion** — women's participation by sport, first-time athletes,
   programmes represented.
4. **Peer benchmark** — how IIMB compares against an anonymised platform median and top
   decile. Never against a named institution.
5. **The Annual Sports Impact Report** — a branded, exportable document with an
   auto-drafted executive summary that he can put in front of the board.

**The two hard truths about this journey:**

**It is the tail of the dependency chain.** Almost everything it displays is produced by
another module. Building it early produces a beautiful dashboard of numbers nobody should
trust — which is worse than having no dashboard, because it *looks* authoritative. Every
figure must derive from **locked** results ([J2-E7](J2-run-a-championship.md)); the
exception is the operational status report, which is explicitly live and lives in
[J2-E8](J2-run-a-championship.md).

**Two requirements had no source data — now decided.** `users` has no gender or date of
birth, and nothing anywhere records scholarship status, so FR-RPT-4's D&I report and
FR-RPT-2's headline women-participation KPI were unbuildable. **Decided 2026-08-12: all
three are collected**, in [J1-E5-S4](J1-institution-onboarding.md), with consent and
aggregate-display-only. This journey is no longer blocked on a decision — only on
sequencing: D&I cannot ship before J1-E5 lands.

---

## Epic J5-E1 · Participation report

**Goal:** Leadership can answer how many people played, in what, and whether that is growing.

**Modules:** [08b §4.1, §4.2](../08-reports-impact-exports.md) · **P0** · **M**
**Satisfies:** FR-RPT-1, FR-RPT-2, FR-DASH-3
**Depends on:** [J1-E4](J1-institution-onboarding.md) *(programmes)*, [J1-E5](J1-institution-onboarding.md) *(people)*, [J2-E7](J2-run-a-championship.md) *(locked results)*

### J5-E1-S1 — Define our academic year

> **As** a Sports Secretary, **I want** to set when our sporting year starts,
> **so that** year-on-year figures match how we actually report.

```gherkin
When I set our season to start in June
Then a championship belongs to the season containing its start date
And seasons are labelled in the form 2025-26
And every report and every export uses the same definition
```

> Derived from a setting, not a new table — this handles institutions with different
> academic calendars, which a hard-coded April–March would not. One shared helper so the
> API and the web app cannot disagree; two implementations is how a page and its export
> stop matching.

### J5-E1-S2 — Headline participation figures

> **As** a Sports Secretary, **I want** participation KPIs with year-on-year change,
> **so that** I can answer "are we growing?" in one sentence.

```gherkin
Given a selected season
Then I see unique participants, events held, matches played and medals won
And each shows the change against the previous season
And only locked results contribute to any figure
And where there is no previous season, the delta reads "no comparison available" rather than a percentage
```

### J5-E1-S3 — Participation by sport and by programme

> **As** a Faculty Coordinator, **I want** participation broken down,
> **so that** I can see which sports and programmes are actually engaged.

```gherkin
Then I see unique participants per sport as a ranked breakdown
And unique participants per programme, using our structure tree
And a person who played three sports counts once in the total and once per sport
And people with no programme assigned are grouped as unassigned rather than dropped
```

### J5-E1-S4 — Six-season trend

> **As** a Sports Secretary, **I want** a participation trend across recent seasons,
> **so that** the dashboard chart and the report agree.

```gherkin
Then I see unique participants per season for the last six seasons
And the figures are identical to those on the institution dashboard
```

---

## Epic J5-E2 · Performance report

**Goal:** Leadership can see competitive performance, not just turnout.

**Modules:** [08b §4.2](../08-reports-impact-exports.md) · **P1** · **S**
**Satisfies:** FR-RPT-3 · **Depends on:** [J4-E4](J4-the-verified-record.md) *(achievements)*

### J5-E2-S1 — Performance KPIs

> **As** a Sports Secretary, **I want** our medal and win-rate figures,
> **so that** I can report competitive performance, not just turnout.

```gherkin
Then I see total medals, win rate, records set and selections, each with a season-on-season delta
And medals come from recorded achievements rather than being recomputed from fixtures
And win rate counts only locked results
```

### J5-E2-S2 — Medals by sport

> **As** a Faculty Coordinator, **I want** medals broken down by sport,
> **so that** I can see where we're strong.

```gherkin
Then I see gold, silver and bronze counts per sport
And a total per sport
```

### J5-E2-S3 — Top performers

> **As** a Sports Secretary, **I want** a list of our standout athletes,
> **so that** I can recognise them.

```gherkin
Then I see players ranked by medals and awards for the season
And awards are counted using the award-type catalogue, not raw free text
And each name links to that player's profile
```

> The catalogue dependency is real: without [J4-E4-S2](J4-the-verified-record.md), "MVP",
> "mvp" and "Most Valuable Player" are three separate things and this list is wrong.

---

## Epic J5-E3 · Diversity & inclusion report

**Goal:** Leadership can report honestly on inclusion, in aggregate and without exposing individuals.

**Modules:** [08b §4.2](../08-reports-impact-exports.md) · [04a](../04-people-and-player-records.md) · **P1** · **M**
**Satisfies:** FR-RPT-4 · **Depends on:** [J1-E5-S4](J1-institution-onboarding.md)

> ✅ **Unblocked 2026-08-12** — gender, date of birth and scholarship status will be
> collected. The dependency is now sequencing, not a decision: this epic cannot ship
> before [J1-E5-S4](J1-institution-onboarding.md) lands. **Gate the tab entirely rather
> than shipping it with empty or estimated figures.**

### J5-E3-S1 — Women's participation

> **As** a Sports Secretary, **I want** women's participation figures,
> **so that** I can report on inclusion honestly.

```gherkin
Given gender has been captured with consent
Then I see women's participation as a count and a share, with a year-on-year delta
And a breakdown by sport
And people who chose not to disclose are reported as a separate category, never inferred or excluded silently
```

### J5-E3-S2 — First-time athletes

> **As** a Faculty Coordinator, **I want** to know how many people competed for the first time,
> **so that** I can measure whether we're widening participation.

```gherkin
Then a person counts as first-time if they have no lifetime entry before this season
And the figure is shown with a year-on-year delta
```

### J5-E3-S3 — Representation by programme

> **As** a Sports Secretary, **I want** to see which programmes are represented,
> **so that** I can spot who we're not reaching.

```gherkin
Then I see participants per programme as a share of that programme's membership
And programmes with zero participants are shown explicitly rather than omitted
```

> Showing the zeroes is the point — an inclusion report that silently drops the
> programmes nobody reached is answering the wrong question.

### J5-E3-S4 — Individuals are never identifiable

> **As** a Sports Secretary, **I want** demographic data reported only in aggregate,
> **so that** we don't expose individuals.

```gherkin
Then gender is never displayed against an individual anywhere in the product
And any breakdown cell below a minimum cohort size is suppressed rather than shown
And the same rule applies to scholarship status
```

### J5-E3-S5 — Scholarship athletes

> **As** a Sports Secretary, **I want** to report on scholarship athletes,
> **so that** the D&I picture is complete.

```gherkin
Given scholarship status is recorded against a person's membership
Then I see the count with a year-on-year delta, and the share of total participants
And the figure is shown only in aggregate
And no individual is ever identified as a scholarship athlete anywhere in the product or in any export
```

> ✅ **Decided 2026-08-12:** add it as `organization_members.scholarship` —
> membership-scoped, because a person can hold a scholarship at one institution and not
> another.
>
> This is the most sensitive field in the product: it is financial, it concerns (often)
> students, and it invites judgement. The aggregate-only rule is a hard constraint, not a
> default — it must not appear in the people directory, on a profile, or in any named
> export.

---

## Epic J5-E4 · Anonymised peer benchmark

**Goal:** An institution can see how it compares to its peers without any peer being identifiable.

**Modules:** [08b §4.4](../08-reports-impact-exports.md) · **P1** · **M**
**Satisfies:** FR-RPT-5

> The PRD's hard privacy rule: *"no other institution's players, results, or identity are
> ever exposed."* On a platform with few institutions, a median can itself be a
> deanonymisation vector — the constraints below are the feature, not decoration.

### J5-E4-S1 — Compare against the platform

> **As** a Sports Secretary, **I want** to see how we compare to similar institutions,
> **so that** I can tell the Director whether we're doing well.

```gherkin
Given peer benchmarking is enabled for my institution
Then I see us against the platform median and the top decile on participation rate,
     events per year, women's participation, and medals per 100 athletes
And I see our percentile on each
And no other institution is named, ranked or made identifiable
```

### J5-E4-S2 — Refuse to report on thin cohorts

> **As** a Sports Secretary, **I want** the benchmark to stay silent when the sample is too small,
> **so that** we can't reverse-engineer another institution's numbers.

```gherkin
Given fewer than five institutions match a comparison cohort
Then the benchmark shows "insufficient data" rather than a figure
And my own institution is excluded from the cohort it is compared against
And personal organisations are excluded from every aggregate
```

> Excluding personal organisations matters more than it sounds: a solo entrant counted as
> an institution would badly skew "medals per 100 athletes". See
> [J3-E1-S4](J3-enter-and-compete.md).

### J5-E4-S3 — Benchmarking is opt-in per institution

> **As** a Sports Secretary, **I want** benchmarking to be a deliberate setting,
> **so that** we aren't compared without our knowledge.

```gherkin
Given benchmarking is disabled for my institution
Then the tab is not shown and the endpoint refuses the request
```

---

## Epic J5-E5 · Annual Sports Impact Report

**Goal:** An institution can produce a branded, exportable annual report from verified data.

**Modules:** [08c §4.5, §4.6](../08-reports-impact-exports.md) · **P1** · **L**
**Satisfies:** FR-RPT-6, §9 exports · **§10 success metric:** *100% of orgs generating it each year*

### J5-E5-S1 — Generate the report

> **As** a Sports Secretary, **I want** to generate our annual impact report,
> **so that** I have something to put in front of the board.

```gherkin
When I generate the report for a season
Then it is produced as a background job with a progress indicator
And the branded output reads "IIM BANGALORE — SPORTS IMPACT 2025–26 · Powered by Sportagon EOS · Verified data"
And it contains headline metrics, participation, performance and inclusion sections
And every figure derives from locked results only
```

> Lambda's 15-second synchronous ceiling makes the job model mandatory, not a preference.
> It shares the queue built for [J4-E7](J4-the-verified-record.md) — **sequence
> certificates first and reuse it.**

> The "Verified data" line in the branding is only honest if the locked-results-only rule
> holds. If that rule is relaxed, the line must come off.

### J5-E5-S2 — Auto-drafted executive summary

> **As** a Sports Secretary, **I want** a written summary I can edit,
> **so that** I'm not writing the narrative from scratch.

```gherkin
Then a summary is drafted from the computed figures
And every number in it matches the charts beside it exactly
And I can edit it before exporting
And my edits are preserved on re-export of the same season
```

> Templated slots rather than generated prose, deliberately: the numbers are the product,
> and a template cannot produce a figure that contradicts the chart next to it. Revisit
> once the templated version is in real use.

### J5-E5-S3 — Export in the format I need

> **As** a Sports Secretary, **I want** PDF and Excel exports,
> **so that** I can circulate it and work with the underlying numbers.

```gherkin
When I export
Then a branded PDF renders server-side with our logo
And an Excel export carries the underlying figures with formatted headers
And charts are rendered server-side and embedded as images
And the export is recorded in the audit trail
```

> **PowerPoint is P1 and the most fiddly of the three.** Recommend shipping PDF and Excel,
> and adding PPT on demand — see
> [open question #8](../00-index.md#7-open-questions-for-the-prd-author).

### J5-E5-S4 — Report and export never disagree

> **As** a Sports Secretary, **I want** the exported document to match the screen,
> **so that** I'm not caught out in the meeting.

```gherkin
Given I view a report and export the same season
Then every figure is identical
And both are produced from the same computed result, not two calculation paths
```

---

## Done looks like

Ten days before the budget meeting, Akash:

1. Opens **Reports**, picks season **2025–26**.
2. **Participation:** 1,204 unique students, ▲18% year on year, broken down by sport and
   by programme — the PGP/EPGP/PhD tree from [J1-E4](J1-institution-onboarding.md).
3. **Performance:** 47 medals, win rate, medals by sport, top performers linking to real
   profiles.
4. **Diversity:** women's participation by sport with a year-on-year delta — *provided
   gender was captured at import with consent*.
5. **Benchmark:** IIMB against the platform median and top decile on four metrics, with
   **no institution named** and "insufficient data" wherever the cohort is under five.
6. Clicks **Generate report**, edits two sentences of the drafted summary, exports a
   branded PDF.
7. Every figure in that PDF derives from a **locked** scorecard, and matches the screen
   exactly.

If step 7 is not true, this entire journey is worse than not shipping it.
