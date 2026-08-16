# Module 03 — RBAC, Module Access & Audit Trail

> **PRD:** §6.12 FR-ADM-2 (audit trail), FR-ADM-3 (roles & permissions), FR-ADM-4
> (module access) · §4 Users & Roles · NFR "role-based authorisation enforced
> server-side on every endpoint; audit coverage of all privileged actions"
> **Blocked by:** [01 Identity](01-identity-tenancy-workspace.md) (for `settings.modules` and the tier)
> **Blocks:** nothing hard — but [06](06-verification-pipeline.md) and [07](07-achievements-certificates.md) should write audit entries from day one, so land the audit half early
> **Size:** **L**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

Two things that look like one:

1. **Make the RBAC tables real.** They exist, they have a CRUD screen, and **nothing
   reads them.** This is not "add a permissions UI" — it is building the engine and
   retrofitting it under working authorisation without breaking it.
2. **Add an audit trail.** There is none. Zero. This is the requirement that makes
   "permanent system of record" a defensible claim rather than a slogan.

Module-access toggles (FR-ADM-4) ride along because they are the same enforcement point.

---

## 2. What we have today

### 2.1 Authorisation that works — hard-coded, and actually well built

[`apps/api/src/http/middleware/permissions.ts`](../../apps/api/src/http/middleware/permissions.ts)
(176 lines) is the real boundary. Its header comment states the model plainly:

> *Authority is championship-scoped (organiser of THIS championship), organization-scoped
> (an owner/admin member of the org), or platform-wide (super admin).*

`makeGuards(prisma)` returns:

| Primitive | What it checks |
| --- | --- |
| `organisesChampionship(userId, champId)` | A `user_championship_roles` row with the `Organiser` role (role id memoized once per process) |
| `orgRole(userId, orgId, roles)` | An `organization_members` row with `status='active'` and a matching role. `ORG_ADMIN = ['owner','admin']` |

| Guard | Applies to |
| --- | --- |
| `championshipManager(resolve)` | Super admin, or organiser of the resolved championship |
| `championshipCrudGuard({body, byId})` | Same, resolving from body on POST and `:id` otherwise |
| `teamManager` | Org owner/admin, **or** the team's own captain/vice-captain |
| `teamCreate` | Owner/admin of every org named in the body (handles the bulk case) |
| `manageUser` | Owner/admin of the target user's home org |
| `enrollSelf` | Owner/admin of the org being enrolled |
| `fixtureScorer` | Assigned official, or organiser of the owning championship |

Plus `resolvers.*`, which walk a sponsor / tournament / venue / ground / tournament-sport
/ discipline / fixture back to its owning championship — the pattern that makes
championship-scoped authority work on deeply nested resources.

There are unit tests:
[`permissions.test.ts`](../../apps/api/src/http/middleware/permissions.test.ts).

**This code is good and should not be thrown away.** The problem is not its quality;
it is that the rules are expressed in TypeScript rather than data, so they cannot be
configured per institution, listed in a UI, or audited.

### 2.2 The RBAC tables — a facade

```
permissions (id, code UNIQUE, label, rules jsonb[])
roles       (id, name UNIQUE, description, permission_ids uuid[])
user_championship_roles (user_id, championship_id, role_id, assigned_by, assigned_at)
```

Mounted through the generic CRUD factory in
[`server.ts`](../../apps/api/src/http/server.ts) (super-admin writes only), rendered by
the generic [`ResourcePage.tsx`](../../apps/web/src/components/ResourcePage.tsx) via
[`resources.ts`](../../apps/web/src/lib/resources.ts) at `/platform/roles`, where
`permission_ids` is edited as **a raw JSON array in a textarea**.

Two structural problems beyond "nothing reads them":

- `roles.permission_ids` is a `uuid[]` with **no foreign keys**. Delete a permission and
  the arrays silently keep dangling ids.
- `permissions.rules` is `jsonb[]` with no documented schema and no consumer.

The entire runtime integration is **role lookup by name string** — `'Organiser'` and
`'Official'` — in seven places:

```
http/middleware/permissions.ts:14          modules/championships/championships.routes.ts:154,155,206
modules/fixtures/fixtures.routes.ts:146    modules/iam/user-invitations.service.ts:25
modules/notifications/audience.ts:50,51    modules/demos/demo-seeder.service.ts:69
```

**`roles.permission_ids` is never read by anything.** Its only appearance outside the
CRUD plumbing is a zod field in
[`schemas.ts:105`](../../packages/shared/src/schemas.ts) validating writes to a table
nobody consults.

Two consequences worth planning around: renaming a role in the UI silently breaks
authorisation (the lookups are string literals), and the `permissions` table is
decorative in the strict sense — deleting every row in it would change no behaviour.

Client-side there is [`permissions.tsx`](../../apps/web/src/lib/permissions.tsx), which
mirrors the server rules for UX. It is a mirror, correctly — not a boundary.

### 2.3 Audit — nothing

No `audit_log`, no history table, no change-tracking middleware, no event log.

What exists instead is per-table actor breadcrumbs, which are useful but are *current
state*, not *history*:

| Table | Breadcrumb |
| --- | --- |
| `championship_organizations` | `applied_by`, `reviewed_by`, `reviewed_at` |
| `user_championship_roles` | `assigned_by`, `assigned_at` |
| `championship_officials` | `assigned_by` |
| `championship_invitations` | `invited_by`, `accepted_by`, `responded_at` |
| `user_invitations` | `invited_by`, `accepted_user_id`, `responded_at` |
| `demo_requests`, `feedback` | `handled_by` |
| `demo_sandboxes` | `created_by` |
| everything | `created_at`, `updated_at` via the `set_updated_at()` trigger |

You can see *who currently owns* an approval. You cannot see that it was approved,
reversed, and re-approved by someone else. And crucially — **a score can be changed a
hundred times and nothing anywhere records it.**

### 2.4 Module access — nothing

No feature-flag table, column, or UI. FR-ADM-4's per-module Students/Staff toggles have
no substrate at all.

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | Permission catalogue is undefined — no list of what the codes mean | FR-ADM-3 | P0 |
| G2 | `roles.permission_ids` is unenforced and unread | FR-ADM-3 | P0 |
| G3 | No `can()` resolution function | FR-ADM-3 | P0 |
| G4 | Roles are championship-scoped only; org-scoped roles are a separate hard-coded enum | FR-ADM-3, §4 | P0 |
| G5 | PRD role names don't match DB role names | §4 | P0 |
| G6 | No permission-matrix UI (raw JSON textarea today) | FR-ADM-3 | P0 |
| G7 | No audit log | FR-ADM-2 | P0 |
| G8 | No audit timeline UI | FR-ADM-2 | P0 |
| G9 | No module-access store or enforcement | FR-ADM-4 | P0 |
| G10 | Deleted permissions leave dangling ids in role arrays | — | P1 |

---

## 4. What we could do

### 4.1 The governing principle: wrap, don't replace

The temptation is to rip out `makeGuards` and replace it with a generic
`requirePermission('x.y')` middleware. **Do not.** Reasons:

- The guards encode genuinely subtle rules (`teamManager`'s "org admin *or* the team's
  own captain"; `teamCreate`'s bulk multi-org check). Re-expressing those as data risks
  silently loosening them.
- They are the only thing standing between users and each other's data, with no RLS
  behind them.
- They have tests. A rewrite starts from zero confidence.

**The approach:** introduce `can()` *underneath* the existing guards. Each guard keeps
its signature and its tests, and internally becomes a caller of `can()`. Behaviour is
preserved by construction, and every existing test is a regression test for the
migration.

```ts
// after
const teamManager: RequestHandler = asyncHandler(async (req, _res, next) => {
  const u = req.user!;
  const team = await loadTeam(req.params.id);
  if (await can(u.id, 'team.manage', { orgId: team.organization_id, teamId: team.id })) return next();
  throw new ForbiddenError('Only the team captain or an organization owner/admin can manage this team');
});
```

`can()` resolves in order: super admin → explicit grant from a role the user holds in
the relevant scope → built-in fallback rule (the current hard-coded logic). The fallback
stays until the data model is proven, then is removed one permission at a time.

### 4.2 The permission catalogue

Permissions become a **seeded, code-owned catalogue** — not user-created rows. They
ship in `packages/shared/src/permissions.ts` as a typed const and are synced into the
`permissions` table by the existing
[`bootstrap-catalog.ts`](../../apps/api/scripts/bootstrap-catalog.ts) script, which
already owns global master data.

```ts
export const PERMISSIONS = {
  'org.manage':            { label: 'Manage organisation settings',  scope: 'org' },
  'org.member.manage':     { label: 'Add & remove members',          scope: 'org' },
  'people.view':           { label: 'View the people directory',     scope: 'org' },
  'people.verify':         { label: 'Verify players',                scope: 'org' },
  'team.manage':           { label: 'Manage teams & squads',         scope: 'org' },
  'event.create':          { label: 'Create championships',          scope: 'org' },
  'event.manage':          { label: 'Manage a championship',         scope: 'championship' },
  'event.approve':         { label: 'Approve registrations',         scope: 'championship' },
  'fixture.score':         { label: 'Record scores',                 scope: 'championship' },
  'fixture.lock':          { label: 'Lock a scorecard',              scope: 'championship' },
  'fixture.unlock':        { label: 'Reverse a locked result',       scope: 'championship' },
  'achievement.validate':  { label: 'Validate achievement claims',   scope: 'org' },
  'certificate.issue':     { label: 'Issue certificates',            scope: 'org' },
  'report.view':           { label: 'View reports',                  scope: 'org' },
  'audit.view':            { label: 'View the audit trail',          scope: 'org' },
} as const;
```

Typed codes mean `can(userId, 'fixture.lok')` is a compile error, and the matrix UI can
be generated from the catalogue instead of hand-maintained.

`permissions.rules` (the undocumented `jsonb[]`) should be **dropped** — it has no
consumer and no schema. Better an honest empty column than a mystery one.

### 4.3 Fixing the scope problem (G4)

Today there are two unrelated role systems:

| System | Table | Scope |
| --- | --- | --- |
| Championship roles | `user_championship_roles` → `roles` | one championship |
| Org roles | `organization_members.role` (a plain string enum) | one org |

FR-ADM-3 wants one configurable table. Two options:

**Option A — add org-scoped role assignments (recommended).**
Keep `organization_members.role` as the *coarse* membership grade (it drives
`assertNotLastAdmin`, join requests, and a lot of working code). Add a separate
`user_org_roles(user_id, organization_id, role_id)` for *fine* permission grants. A user
is `admin` (grade) **and** holds `Faculty Coordinator` (role). `can()` unions both.

*Why:* nothing existing breaks. `orgRole()` keeps working unchanged.

**Option B — collapse `organization_members.role` into the roles table.**
Conceptually cleaner, one system. But it means migrating five enum values into rows,
rewriting `orgRole()`, `assertNotLastAdmin()`, the members UI, the matrix importer's
`poc` mapping, and the demo seeder. High blast radius for a cosmetic gain.

**Recommend A.** Revisit B only if the two systems visibly confuse admins in practice.

### 4.4 Reconciling the PRD's role names (G5)

PRD §4 names three roles; the DB has five membership grades plus championship roles:

| PRD §4 role | Maps to |
| --- | --- |
| Super Admin | `organization_members.role = 'owner'` + a seeded `Super Admin` org role |
| Faculty Coordinator | grade `admin` + seeded `Faculty Coordinator` org role (approvals, reports, comms, full events host) |
| Student Coordinator | grade `member` + seeded `Student Coordinator` org role (comms, full events host) |

Note the PRD's "Super Admin" is **org-level**, colliding with the platform-level
`users.is_super_admin`. In UI copy, call the platform one **Platform Admin** and the org
one **Organisation Owner**. Getting this wrong in the UI is a support-ticket generator.

This is [open question #2](00-index.md#7-open-questions-for-the-prd-author) — confirm
before seeding.

### 4.5 The audit trail

One append-only table. Not per-entity history tables — those multiply and nobody queries
them.

```sql
create table if not exists audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_user_id uuid,                       -- null = System
  actor_label   text,                       -- denormalised: survives user deletion
  organization_id uuid,                     -- scope for the org-level timeline
  championship_id uuid,
  action        text not null,              -- 'fixture.locked', 'registration.approved', …
  target_type   text not null,              -- 'fixture', 'championship_organization', …
  target_id     uuid,
  target_label  text,                       -- denormalised: "IIMB vs IIMA, Football SF"
  summary       text,                       -- human sentence for the timeline
  diff          jsonb,                      -- { field: { from, to } }
  ip            inet,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_org_at on audit_log (organization_id, at desc);
create index if not exists idx_audit_champ_at on audit_log (championship_id, at desc);
create index if not exists idx_audit_target on audit_log (target_type, target_id, at desc);
```

Design decisions worth stating:

- **`bigserial`, not uuid.** This table is append-only and time-ordered; a monotonic key
  keeps the index tight and makes "everything since X" trivial.
- **Denormalised `actor_label` and `target_label`.** The PRD requires entries to survive
  ("immutable, append-only"). If a user is deleted under right-to-erase, the audit line
  must still read sensibly. Store the label at write time.
- **No FKs.** Deliberate, matching the `notifications.organization_id` precedent — an
  audit row must never be cascade-deleted by the thing it describes. This is the whole
  point of an audit log.
- **Enforce append-only at the database**, not by convention: `revoke update, delete on
  audit_log from <app role>`. A trigger raising on UPDATE/DELETE is the belt-and-braces
  version.

Write path — one helper, called explicitly:

```ts
await audit(req, {
  action: 'fixture.locked',
  target: { type: 'fixture', id: fx.id, label: fixtureLabel(fx) },
  organizationId, championshipId,
  summary: `Locked the scorecard for ${fixtureLabel(fx)}`,
  diff: { status: { from: 'submitted', to: 'locked' } },
});
```

**Explicit calls, not middleware auto-capture.** Auto-capture produces thousands of
meaningless rows ("PATCH /fixtures/x 200") and misses the semantics that make a timeline
readable. The PRD wants a *narrative* — "results published, profiles updated by system,
registrations approved, certificates generated, scorecards locked". That is a curated
list, and it is short.

**Coverage list for v1** (privileged actions only):

```
auth.login.failed (throttled)   org.created / org.verified / org.settings.changed
org.member.added / .role_changed / .removed / .approved / .declined
people.verified / people.rejected / people.bulk_imported
championship.created / .status_changed / .deleted
registration.approved / .rejected
fixture.result_recorded / fixture.locked / fixture.unlocked / fixture.corrected
achievement.claim_validated / .rejected
certificate.batch_generated / .revoked
role.assigned / .revoked        permission.role_changed
report.exported                 data.erasure_requested / .executed
```

### 4.6 Module access (FR-ADM-4)

Store in `organizations.settings.modules` from
[01](01-identity-tenancy-workspace.md) §4.1 — no second flag system:

```jsonc
"modules": { "people": ["staff"], "teams": ["staff","students"], "reports": ["staff"] }
```

Audience is derived from `organization_members.role`: `owner|admin|captain` → `staff`,
`member|alumni` → `students`. Enforced as a `can()` pre-check — if the module is off for
your audience, no permission in it resolves true. One enforcement point, both features.

Nav rendering reads the same flags, so a disabled module disappears rather than 403-ing.

---

## 5. Data model changes

| Change | Notes |
| --- | --- |
| **new** `user_org_roles` | `(user_id, organization_id, role_id)`, unique triple, cascade on all three |
| **new** `role_permissions` | `(role_id, permission_id)` with **real FKs** — replaces `roles.permission_ids` |
| **new** `audit_log` | Above. Grant insert+select only. |
| `+ scope` on `permissions` | `'platform' \| 'org' \| 'championship'` |
| `+ organization_id` on `roles` | Nullable. Null = platform-seeded role; set = an org's custom role |
| `- rules` from `permissions` | Unused `jsonb[]`, no schema, no reader |
| *(deprecate)* `roles.permission_ids` | Keep the column, stop reading it, drop in a later migration once `role_permissions` is proven |

Two migrations, not one: `…_rbac_engine.sql` and `…_audit_log.sql`. The audit half can
ship independently and earlier, which is what you want.

---

## 6. API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/permissions/catalogue` | authed | Typed catalogue for the matrix UI |
| `GET/POST/PATCH/DELETE` | `/api/organizations/:id/roles` | `org.manage` | Custom org roles |
| `PUT` | `/api/roles/:id/permissions` | `org.manage` / super | Set the matrix row |
| `GET/POST/DELETE` | `/api/organizations/:id/members/:mid/roles` | `org.member.manage` | Assign/revoke |
| `GET` | `/api/organizations/:id/audit` | `audit.view` | Paged timeline; filter by actor/action/target/date |
| `GET` | `/api/championships/:id/audit` | `event.manage` | Championship-scoped timeline |
| `GET/PATCH` | `/api/organizations/:id/settings/modules` | `org.manage` | FR-ADM-4 |

**Existing behaviour that changes:** `/api/permissions` and `/api/roles` currently allow
super-admin CRUD via the generic factory. Permissions become read-only (catalogue is
code-owned); roles stay writable but gain `organization_id` scoping.

---

## 7. UI surface

| Page | Path | Notes |
| --- | --- | --- |
| Roles & permissions matrix | `/org/:orgId/admin/roles` | Roles as rows, permission groups as columns, checkboxes. **Generated from the catalogue** — never hand-listed. Replaces the JSON textarea. |
| Member role assignment | Extends the existing members page | Add a role multi-select to [`PocsPage.tsx`](../../apps/web/src/pages/organization/PocsPage.tsx) |
| Audit trail | `/org/:orgId/admin/audit` | Reverse-chronological timeline, filters, infinite scroll. Style follows [`NotificationsPage.tsx`](../../apps/web/src/pages/NotificationsPage.tsx). |
| Module access | `/org/:orgId/admin/modules` | Toggle grid, module × audience |

Client mirror: [`permissions.tsx`](../../apps/web/src/lib/permissions.tsx) gains a
`useCan('fixture.lock')` hook fed by a capability list on `GET /auth/me`, so the UI stops
duplicating rule logic and just asks.

---

## 8. Dependencies

**Blocked by**

- [01](01-identity-tenancy-workspace.md) — needs `organizations.settings` for module
  access and the institution tier to know when to show admin surfaces

**Should land before (soft)**

- [06](06-verification-pipeline.md) — the lock is the single most important audited
  action; building it and retrofitting audit later means the first locks are unrecorded
- [07](07-achievements-certificates.md) — certificate issuance must be audited

**Recommended split:** ship `audit_log` + the `audit()` helper **first and separately**,
before the RBAC engine. It is smaller, has no upstream dependency beyond a scope column,
and unblocks 06/07 writing correct history from their first commit.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **Retrofitting authz under a live system** | The highest-risk work in the doc set. Mitigated by the wrap-don't-replace approach and by treating [`permissions.test.ts`](../../apps/api/src/http/middleware/permissions.test.ts) as the contract. Expand those tests *before* touching the guards. |
| Over-modelling | It is easy to build a policy engine nobody configures. Ship ~15 permissions and 3 seeded roles. Resist per-field permissions. |
| Audit volume | At the stated scale (25 concurrent matches, 10 events) the curated list produces thousands of rows per event, not millions. Partition only if it becomes a problem. |
| Audit is only as good as its call sites | An explicit-call design means a forgotten call is a silent hole. Mitigate with a checklist in the PR template for any route touching the coverage list in §4.5. |
| Right-to-erase vs immutable audit | Same tension as [04](04-people-and-player-records.md). Denormalised `actor_label` lets you null `actor_user_id` and keep the line. Confirm that satisfies the legal reading. |
| RLS is still absent | This module makes authorisation *configurable*, not *defence-in-depth*. RLS remains a separate, unscheduled project. Do not let a nice permissions UI create the impression that isolation is solved. |

---

## 10. Effort

| Workstream | Size |
| --- | --- |
| `audit_log` table + `audit()` helper + append-only grants | **S** |
| Instrument the ~25 v1 actions across existing routes | **M** |
| Audit timeline UI + filters | **S** |
| Permission catalogue + `role_permissions` + bootstrap sync | **S** |
| `can()` engine + capability list on `/auth/me` | **M** |
| Retrofit the 7 existing guards onto `can()` + expand tests | **M** *(highest risk)* |
| `user_org_roles` + seeded PRD roles + assignment UI | **M** |
| Permission-matrix UI generated from the catalogue | **M** |
| Module-access store + enforcement + toggle UI + nav integration | **S** |
| **Module total** | **L** |
