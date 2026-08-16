# Module 04 — People Directory & Player Lifetime Records

> **PRD:** §6.4 People (FR-PPL-1…6) · §6.9 FR-PRO-1…4 (Lifetime Profile) · §8.3 Player
> onboarding · §7 Player entity · NFR privacy & retention
> **Blocked by:** [01 Identity](01-identity-tenancy-workspace.md) (`org_units`), [06 Verification](06-verification-pipeline.md) (lifetime timeline)
> **Blocks:** [08 Reports](08-reports-impact-exports.md) (D&I and programme breakdowns)
> **Size:** **L**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

The PRD's headline promise — *"Every verified achievement strengthens a player's
lifetime profile — long after they graduate"* — lives or dies here.

Two halves:

1. **The directory** (FR-PPL-*): an institution's roll of players and students, with
   programme/batch, verification workflow, bulk import, search.
2. **The lifetime record** (FR-PRO-*): a permanent, auto-built, non-editable history of
   a person's verified sporting results and career statistics.

The second half is **blocked on [06](06-verification-pipeline.md)** — "auto-built
exclusively from verified (locked) events" is impossible while nothing locks.

---

## 2. What we have today

### 2.1 There is no player entity

Worth stating plainly because it shapes everything: **there is no `players` or
`athletes` table.** A player is a `users` row joined to a roster through `team_members`.

```
users(id, name, email UNIQUE, phone, avatar_url, is_active, password_hash,
      is_super_admin, organization_id?, account_type?, must_change_password)
```

That is the entire person model. Against PRD §7's Player entity, we are missing:
**player ID, programme/batch, DOB, gender, multiple emails, verification status, and a
global cross-org Sportagon ID.**

Phone is uniquely indexed on the last 10 digits
(`20260627010000_users_phone_unique.sql`) — a partial unique *expression* index, which
is why Prisma doesn't show phone as unique. Phone is the de-facto identity key across
the product: the matrix importer matches people by phone, `user_invitations` are
addressed by phone, and `findUserByPhone()` in
[`users.helpers.ts`](../../apps/api/src/modules/iam/users.helpers.ts) is the first
resolution step everywhere a person is added.

Individual competitors in ranking events are worse off — they live **only as JSON**
inside `fixtures.live_state.event.participants` (`{ id, name, phone, org, marks }`),
not as rows. They have no profile and no history. See §4.6.

### 2.2 The "directory" pages that exist, and what they actually are

| Page | Reality |
| --- | --- |
| [`PlatformUsersPage.tsx`](../../apps/web/src/pages/platform/PlatformUsersPage.tsx) | A genuine user table — but platform-wide and **super-admin only**. Not an org directory. |
| [`StudentsPage.tsx`](../../apps/web/src/pages/organization/StudentsPage.tsx) | Named like a directory, but it lists **teams and their members**. A person in no team is invisible. |
| [`PocsPage.tsx`](../../apps/web/src/pages/organization/PocsPage.tsx) | Org members with join-request approvals. Membership admin, not a player roll. |

So an institution administrator today **cannot see a list of their people.** They can
see their teams, and their staff.

### 2.3 Bulk import — a good component, barely used

[`BulkImportModal.tsx`](../../apps/web/src/components/BulkImportModal.tsx) +
[`lib/import.ts`](../../apps/web/src/lib/import.ts) handle CSV, paste, and `.xlsx` via
SheetJS, with column mapping, validation and a downloadable blank template. It is the
right component and mostly satisfies FR-PPL-4 already.

It is wired into **exactly one screen** (`PlatformUsersPage` → `POST /api/users/bulk`).

Meanwhile these bulk endpoints exist server-side with **no importer attached at all**:

```
POST /organizations/:id/members/bulk     ← FR-PPL-4 is largely a wiring job
POST /teams/:id/members/bulk
POST /teams/bulk
POST /venues/bulk
```

Rosters add players through [`PeoplePicker.tsx`](../../apps/web/src/components/PeoplePicker.tsx),
a searching multi-select — good UX for a squad of 15, useless for onboarding 400
students.

### 2.4 Verification — exists, but for the wrong thing

There are two working pending→approved workflows, and **neither verifies a person**:

- `organization_members.status ∈ active|past|pending|rejected` — *"can this person join
  this org?"* (`20260625000000_org_member_status_pending.sql`, approve/decline routes in
  [`organizations.routes.ts`](../../apps/api/src/modules/iam/organizations.routes.ts))
- `championship_organizations.status ∈ pending|approved|rejected` — *"can this org enter
  this event?"*

FR-PPL-2's Verified/Pending/Rejected is a third, different thing: *"is this person who
they claim to be, and are they genuinely a member of this institution's programme?"*
`users` has only `is_active`.

### 2.5 The lifetime profile as it stands

[`ParticipantDashboard.tsx`](../../apps/web/src/pages/participant/ParticipantDashboard.tsx)
at `/profile`, fed by `GET /me/dashboard`
([`me.routes.ts`](../../apps/api/src/modules/iam/me.routes.ts)).

Career statistics are five global integers:

```
stats: { total_events, total_matches, wins, losses, draws }
```

That is the whole of FR-PRO-3. No per-sport split, no goals, no MVP count, no season
history.

Achievements ([`ParticipantAchievementsPage.tsx`](../../apps/web/src/pages/participant/ParticipantAchievementsPage.tsx),
`GET /me/achievements`) derive entirely from `fixture_awards` — free-text award names
typed by an official in the match console's `AwardsPanel`. Grouped and counted
client-side. No medals from results, no records, no selections.

And critically: **the profile is visible only to its owner.** There is no route for an
administrator to open a player's profile (FR-PPL-5), and nothing public or shareable.

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | No org-scoped person directory | FR-PPL-1 | P0 |
| G2 | No player ID (e.g. `PGP24-113`) | FR-PPL-1 | P0 |
| G3 | No programme/batch on a person | FR-PPL-1 | P0 |
| G4 | No person-level verification states or workflow | FR-PPL-2/6 | P0/P1 |
| G5 | Bulk import not wired to org people | FR-PPL-4 | P0 |
| G6 | No admin route to a player's profile | FR-PPL-5 | P0 |
| G7 | No lifetime timeline built from locked results | FR-PRO-2 | P0 |
| G8 | Career stats are five global counters, not per-sport | FR-PRO-3 | P0 |
| G9 | No verified-credentials list on the profile | FR-PRO-4 | P1 |
| G10 | No DOB, no gender, no scholarship flag → **D&I reporting is impossible** *(decided 2026-08-12: collect all three)* | §7, FR-RPT-4 | P0 |
| G11 | No multiple-emails support | §7 | P2 |
| G12 | No global cross-org Sportagon ID | §7 | P1 |
| G13 | Ranking-event competitors exist only as JSON — no profile, no history | — | P1 |
| G14 | No right-to-erase flow | NFR privacy | P0 |
| G15 | No consent capture at profile creation | NFR privacy | P0 |

---

## 4. What we could do

### 4.1 Where person attributes belong: on the membership, not the user

The central design call. A person can belong to several organisations
(`organization_members` is many-to-many). "Verified", "PGP24-113", "PGP 2024 batch" are
**not facts about a human — they are facts about a human's relationship with one
institution.** IIMB verifies you; a cricket club you also joined has not.

```sql
alter table organization_members
  add column if not exists org_unit_id     uuid references org_units(id) on delete set null,
  add column if not exists member_code     text,          -- 'PGP24-113'
  add column if not exists verification    text not null default 'pending',
  add column if not exists verified_by     uuid references users(id) on delete set null,
  add column if not exists verified_at     timestamptz,
  add column if not exists rejection_note  text;

alter table organization_members add constraint organization_members_verification_check
  check (verification in ('pending','verified','rejected'));

create unique index if not exists uq_org_member_code
  on organization_members (organization_id, lower(member_code)) where member_code is not null;
```

`member_code` scoped-unique per org solves G2 without a global ID scheme.

**Keep on `users` only what is genuinely global:** name, email, phone, avatar, DOB,
gender. Those are properties of the human.

```sql
alter table users
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists consent_at timestamptz,
  add column if not exists consent_version text;
alter table users add constraint users_gender_check
  check (gender is null or gender in ('male','female','other','prefer_not_to_say'));
```

**Scholarship status is membership-scoped, not global** — a person can be on a sports
scholarship at one institution and not at another:

```sql
alter table organization_members
  add column if not exists scholarship boolean not null default false;
```

> **✅ Decided (2026-08-12): collect gender, DOB and scholarship status.** This closes
> what was G10 and unblocks FR-RPT-4 entirely — the Diversity & Inclusion report, and
> FR-RPT-2's "women participation" headline KPI with its YoY delta. Without these
> columns [08](08-reports-impact-exports.md) would have shipped with a tab that could not
> be built.
>
> Three conditions attach to that decision, and they are not optional:
> 1. **`prefer_not_to_say` is a first-class value**, never a null to be inferred around,
>    and non-disclosure is reported as its own category rather than silently excluded.
> 2. **Consent is captured and versioned** at profile creation (`users.consent_at`,
>    `consent_version`) — see §4.7.
> 3. **Aggregate display only.** Gender and scholarship status are never shown against a
>    named individual anywhere in the product, and breakdown cells below a minimum cohort
>    size are suppressed. Scholarship status in particular is financially sensitive: it
>    must not appear in the people directory, on a profile, or in any export that names
>    people.

**Alternative considered — a separate `players` table.** Rejected. It would fork every
join in the product (`team_members.user_id`, `fixture_awards.recipient_user_id`,
`user_championship_roles`, notifications) and create a permanent question of whether a
given person is a user, a player, or both. Membership-scoped attributes give the same
expressiveness with none of the forking.

### 4.2 The directory (FR-PPL-1…3, 5)

`GET /api/organizations/:id/people` returning a joined view: user identity +
membership attributes + derived counts (event history count) + verification chip.

Filter tabs with live counts per state, plus All — reuse
[`useTableControls`](../../apps/web/src/lib/hooks.ts) and the `Tabs`/`Pills`/`Table`
primitives from [`ui.tsx`](../../apps/web/src/components/ui.tsx). This is a
well-trodden pattern in the codebase; the page should look like
[`PlatformUsersPage.tsx`](../../apps/web/src/pages/platform/PlatformUsersPage.tsx).

Row click → `/org/:orgId/people/:userId` — the admin-facing profile (FR-PPL-5), which
is the same profile component as `/profile` with an org-admin frame around it.

**`StudentsPage.tsx` should be replaced by this**, not sat alongside it. Two pages both
claiming to list people is how directories rot.

### 4.3 Bulk import (FR-PPL-4) — mostly wiring

`BulkImportModal` + `POST /organizations/:id/members/bulk` already exist. Work needed:

- Extend the bulk endpoint to accept `org_unit`, `member_code`, `dob`, `gender`
- Resolve programme/batch **by name** against `org_units`, creating nothing implicitly —
  an unrecognised programme is a validation error with a clear message, not a silent new
  unit. (The matrix importer's validate-then-apply split in
  [`matrix-import.routes.ts`](../../apps/api/src/modules/import/matrix-import.routes.ts)
  is the pattern to copy — it is idempotent and returns a structured error report,
  exactly what FR-PPL-4 asks for.)
- Person resolution order, matching the rest of the codebase: `user_id` → phone →
  email → provision new
- Imported people land as `verification='pending'` — import is not verification

### 4.4 Verification workflow (FR-PPL-6, §8.3)

`pending → verified | rejected`, driven by an admin holding `people.verify`
([03](03-rbac-module-access-audit.md)). Bulk-selectable from the directory using the
existing `BulkBar` component. Every transition writes an audit entry and, once
[02](02-communications.md) exists, notifies the person.

§8.3 says verification "creates/activates the player's verified Sportagon profile" —
in this model, verification flips the chip and makes the person eligible to appear in
verified counts and reports. No separate profile object is created.

### 4.5 The lifetime record (FR-PRO-1…4)

**This is where [06](06-verification-pipeline.md) is a hard block.** FR-PRO-2 requires
the timeline be built "exclusively from verified (locked) events" with "manual edits not
permitted". Until fixtures lock, every entry would be provisional and silently mutable —
the opposite of the promise.

```sql
create table if not exists lifetime_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete restrict,
  organization_id uuid,                    -- who they represented; FK-less, survives org deletion
  championship_id uuid,
  fixture_id uuid,
  sport_id uuid,
  occurred_on date not null,
  kind text not null check (kind in ('participation','result','medal','award','record','selection')),
  title text not null,                     -- 'Inter-College Football — Runner-up'
  detail jsonb not null default '{}'::jsonb,
  source text not null default 'locked_result'
    check (source in ('locked_result','validated_claim','migrated')),
  created_at timestamptz not null default now()
);
create index if not exists idx_lifetime_user_date on lifetime_entries (user_id, occurred_on desc);
```

Written **only** by the lock transaction in 06 and by claim validation in
[07](07-achievements-certificates.md). No update or delete endpoint exists; corrections
flow through 06's audited unlock/relock, which reverses and rewrites entries. `on delete
restrict` on `user_id` and FK-less org/championship references keep the record standing
when its context is removed — that is the "survives graduation" requirement made
literal.

**Career statistics (FR-PRO-3)** become a derived view over `lifetime_entries` +
`fixtures`, grouped by sport. Cache it — recompute on lock, store on a
`career_stats(user_id, sport_id, …)` table, because the profile is a hot read and the
aggregation joins four tables.

**Verified credentials (FR-PRO-4)** is a straight join to `certificates` from
[07](07-achievements-certificates.md).

### 4.6 Ranking-event competitors (G13)

Individual competitors in swimming/powerlifting/athletics events exist only inside
`fixtures.live_state.event.participants` JSON. They already carry `{ name, phone, org }`
— and phone is the identity key used everywhere else.

Recommendation: at lock time, resolve each participant's phone to a `users` row via the
existing `findUserByPhone()`, and write `lifetime_entries` for the ones that match.
Unmatched competitors stay JSON-only. This is a small addition to 06's lock transaction
and turns a whole category of results — currently invisible — into real player history.

### 4.7 Privacy: right-to-erase vs the permanent record (G14)

> **DECIDED 2026-08-16 — the proposed resolution below is confirmed.** Erasure clears
> identity; `lifetime_entries` and `achievements` stay, attributed to the tombstoned
> user id. This is no longer an open question.
>
> It is already load-bearing in the schema: `lifetime_entries.user_id` and
> `achievements.user_id` are `on delete restrict`
> ([`20260816060000_lifetime_and_achievements.sql`](../../supabase/migrations/20260816060000_lifetime_and_achievements.sql)),
> so deleting a person outright **fails** while they hold records. Erasure therefore has
> to be the anonymising flow described here — there is no path that quietly drops the
> record instead. The only code that legitimately hard-deletes users is demo teardown,
> which removes their records explicitly first.
>
> Outstanding for **J4-E10**: the `POST /me/erasure` endpoint, the `users.erased_at`
> tombstone column, and rendering an erased participant as "Withdrawn participant".
> The *policy* is settled; the mechanism is not built.

**These two PRD requirements directly contradict each other**, and it needed a decision,
not an implementation:

> §9: *"comply with applicable data-protection law … right-to-erase data for any user"*
> §9: *"lifetime profiles persist post-graduation by design"* · FR-PRO-2: *"immutable"*

Resolution — **erase the person, keep the result**:

| Data | On erasure |
| --- | --- |
| Identity: name, email, phone, avatar, DOB, gender | Deleted |
| `organization_members` rows | Deleted |
| `users` row | Retained as a tombstone: id, `erased_at`, no PII |
| `lifetime_entries` | Retained, `user_id` intact, displayed as "Withdrawn participant" |
| `fixtures`, scores, standings | Untouched — another team's result depends on them |
| `audit_log` | Retained; `actor_label` already denormalised for exactly this |

### Why this is the right split

The contradiction dissolves once you stop treating "the record" as one thing. There are
**three** categories being conflated:

| # | Category | Example | Whose data is it? |
| --- | --- | --- | --- |
| 1 | **Identity** | name, email, phone, DOB, gender, avatar, scholarship flag | The individual's. Erasable, unambiguously. |
| 2 | **The competition record** | that a match happened, the score, who won | **Jointly owned** by every participant and the organiser. Erasing one person's presence falsifies the opposing team's record and the institution's. Closer to a public sporting register than to personal data held for one person's benefit. |
| 3 | **The participation link** | "person X played in match Y" | The contested middle. |

The recommendation resolves category 3 by **pseudonymisation rather than retention**:
keep the row, keep `user_id` — but once the tombstone holds no name, email, phone, DOB
or gender, that UUID no longer identifies anyone. Data that cannot be attributed to an
identifiable person without additional information that has itself been destroyed is a
much weaker claim to being personal data than a retained record would be.

**Two conditions that argument depends on** — and both must be built, or the
pseudonymisation claim is hollow:

1. **Strip the erased person from anything that re-identifies them.** "Runner-up,
   Inter-Programme Football 2026, PGP 2024" alongside a 15-name roster narrows to one
   person quickly. On erasure, remove them from displayed rosters and from named
   per-player attributions (goals, awards). Keep the team result, the score and the
   anonymous participation count.
2. **Set a retention period on the audit trail.** `actor_label` is denormalised
   precisely so entries survive — but it holds a name. Retain for a defined,
   documented period (institutional record-retention norms are typically ~7 years),
   then purge the label while keeping the entry.

### Certificates deserve a separate answer — let the person choose

A certificate is unusual: it is a document *issued to* the person, often already in their
possession and submitted to third parties. Auto-revoking it on erasure would **harm** the
person exercising the right — their QR verification would break and a credential they
rely on would stop being provable.

**Recommend: certificates are opt-in to erasure, defaulting to retained.** The erasure
screen asks explicitly: *"You have 3 certificates. Keep them verifiable, or erase them
too?"* Most people will keep them; that is the asset they wanted from the product.

### Make it institutional policy, not a product constant

A university with statutory record-keeping duties and a corporate league have different
answers. **Put the retention set behind `organizations.settings`** rather than hard-coding
one interpretation platform-wide.

### The cheapest place to solve this is the consent text, not the code

If, at profile creation, the person is told plainly — *"your competition results become
part of this institution's permanent sporting record and are retained after you leave;
your personal identifying details can be erased on request"* — then retention rests on a
disclosed basis and the scope of an erasure request is settled in advance rather than
argued afterwards.

> **⚠ This is a recommendation, not legal advice, and it needs sign-off from whoever
> owns your legal position** — for Indian institutions that means reading it against the
> DPDP Act 2023 (which does permit refusing erasure where retention is necessary for a
> legal purpose), and against GDPR if you ever take EU students.
>
> **It should not block the build.** The tombstone mechanism is identical whichever way
> the call goes, and making the retention set configurable means a different answer is a
> settings change rather than a migration. Build it; get the consent copy reviewed in
> parallel. **Do not ship the people directory without consent capture** (G15).

---

## 5. Data model changes

| Change | Table |
| --- | --- |
| `+ org_unit_id, member_code, verification, verified_by, verified_at, rejection_note, scholarship` | `organization_members` |
| `+ date_of_birth, gender, consent_at, consent_version, erased_at` | `users` |
| `+ settings.retention` | `organizations` — which categories an erasure removes (§4.7) |
| **new** `lifetime_entries` | — |
| **new** `career_stats` | Cached per `(user_id, sport_id)` |
| **new** `user_emails` | `(user_id, email, is_primary, verified)` — G11, **P2, defer** |
| unique index | `(organization_id, lower(member_code))` |

Migration: `…_people_and_lifetime.sql`. Note it touches `organization_members`, which
[01](01-identity-tenancy-workspace.md) also touches — **sequence 01 first** and rebase.

---

## 6. API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/organizations/:id/people` | `people.view` | FR-PPL-1/2/3 |
| `POST` | `/api/organizations/:id/people` | `org.member.manage` | FR-PPL-4 single |
| `POST` | `/api/organizations/:id/people/bulk` | `org.member.manage` | FR-PPL-4 bulk *(extend the existing members/bulk route)* |
| `POST` | `/api/organizations/:id/people/import/validate` | `org.member.manage` | Dry-run + error report |
| `POST` | `/api/organizations/:id/people/:userId/verify` · `/reject` | `people.verify` | FR-PPL-6 |
| `POST` | `/api/organizations/:id/people/verify/bulk` | `people.verify` | Bulk verify |
| `GET` | `/api/people/:userId/profile` | `people.view` in a shared org, or self | FR-PPL-5, FR-PRO-1…4 |
| `GET` | `/api/people/:userId/stats` | same | FR-PRO-3 |
| `POST` | `/api/me/erasure` | self | G14 |

Existing `GET /me/dashboard` and `GET /me/achievements` stay; the new profile endpoint
generalises them so one component serves both self-view and admin-view.

---

## 7. UI surface

| Page | Path | Notes |
| --- | --- | --- |
| **People directory** | `/org/:orgId/people` | Replaces `StudentsPage.tsx`. Table + status tabs with counts + search + `BulkBar` verify. |
| Add person / bulk import | modal | `BulkImportModal` wired to the new endpoint, with validate-then-apply |
| **Player profile (admin view)** | `/org/:orgId/people/:userId` | Header with VERIFIED badge, lifetime timeline, per-sport career stats, credentials list |
| Player profile (self view) | `/profile` | Same components, existing route |
| Verification queue | directory filtered to `pending` | Not a separate page — a tab |
| Consent notice | signup + first login | Records `consent_at`/`consent_version` |
| Erasure request | profile settings | Confirmation via `confirmDialog()` |

Reuse: `Table`, `Tabs`, `Badge`, `StatusBadge`, `BulkBar`, `SearchInput`, `Avatar`,
`EmptyState`, `confirmDialog` from [`ui.tsx`](../../apps/web/src/components/ui.tsx); the
existing achievement row component
[`AchievementRow.tsx`](../../apps/web/src/components/participant/AchievementRow.tsx) and
[`CareerStats.tsx`](../../apps/web/src/components/participant/CareerStats.tsx).

---

## 8. Dependencies

**Blocked by**

- [01](01-identity-tenancy-workspace.md) — `org_units` must exist before programme/batch
  means anything (hard, for FR-PPL-1)
- [06](06-verification-pipeline.md) — **hard block on the entire FR-PRO-2/3 half.** The
  directory half can ship first.
- [03](03-rbac-module-access-audit.md) — `people.view` / `people.verify` permissions;
  verification transitions should be audited from the first one
- [02](02-communications.md) — soft; verification outcomes should notify the person

**Blocks**

- [08](08-reports-impact-exports.md) — hard. No gender → no D&I report. No
  programme/batch → no participation-by-programme breakdown.

**Recommended split:** ship **4a Directory** (FR-PPL-*) as soon as 01 lands, and
**4b Lifetime Record** (FR-PRO-*) after 06. They share a page but not a critical path.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **Collecting DOB and gender** | Necessary for D&I, but it is sensitive personal data about (often) students. Needs consent copy, `prefer_not_to_say`, and aggregate-only display. Get the consent text reviewed before collecting a single row. |
| **Right-to-erase vs immutability** | Unresolved contradiction in the PRD. §4.7 proposes a resolution; it needs sign-off, not just implementation. |
| Duplicate people | Phone is the de-facto key but is nullable, and email is unique while phone is only *partially* unique. Bulk-importing 400 students will surface duplicates. Build a merge tool, or at minimum a duplicate report in the import validator. |
| `StudentsPage` replacement | Deleting a page users know is a small migration of habit. Redirect the old route rather than 404. |
| Profile visibility | FR-PPL-5 lets an admin open any player's profile. Scope it: only orgs the viewer shares with the subject. Easy to get wrong and it is a privacy incident when you do. |
| Career-stat cache staleness | If `career_stats` is only recomputed on lock, a corrected result must recompute too. Make it part of 06's transaction, not a cron. |

**Open questions:** [00-index §7](00-index.md#7-open-questions-for-the-prd-author),
items 3 (gender/DOB collection) and 4 (erasure vs immutability).

---

## 10. Effort

### 4a — Directory

| Workstream | Size |
| --- | --- |
| Membership attribute columns + user demographic columns + migration | **S** |
| `GET /organizations/:id/people` + filters + counts | **S** |
| Directory page (table, tabs, search, bulk bar) | **M** |
| Bulk import wiring + validate/apply + error report | **M** |
| Verification workflow (single + bulk, audited, notified) | **S** |
| Consent capture | **S** |
| **4a total** | **M** |

### 4b — Lifetime record

| Workstream | Size |
| --- | --- |
| `lifetime_entries` + write path inside 06's lock transaction | **M** |
| `career_stats` per-sport aggregation + cache + recompute on correction | **M** |
| Profile page: timeline, stats, credentials, admin frame | **M** |
| Ranking-event competitor resolution by phone | **S** |
| Right-to-erase flow + tombstoning | **M** |
| **4b total** | **L** |

| | |
| --- | --- |
| **Module total** | **L** |
