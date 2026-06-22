# Sportagon - UI/UX Development Guide (Design → Production)

**Purpose:** Translate the `Design/` prototype (from Claude Design) into the production app (`apps/web` React + Tailwind v4 + TanStack Query, `apps/api` Express + Prisma), **without losing the CRUD, permissions, and role-specific conditioning** that the prototype did not cover.

> Read order: this guide → the prototype in `Design/` (run `Design/Sportagon.html`) → the original brief `docs/ui-ux-design-brief.md`. This guide is the **authoritative bridge** between them.

---

## 0. Asset map - what we have

| Asset | What it is | Use it for |
|---|---|---|
| `Design/styles/tokens.css` | **Final design tokens** (oklch brand ramp, neutrals, semantic, LIVE red, gold, sport accents, spacing, radius, shadow, motion, light+dark, density) | Source of truth for `apps/web/src/index.css` `@theme` |
| `Design/app/components.jsx` | Component library mirroring our `ui.tsx` names | Spec for upgrading `apps/web/src/components/ui.tsx` |
| `Design/app/shell.jsx`, `chrome.jsx` | Responsive shell, role nav (`ROLES`/`NAV`/`BOTTOM`), topbar, bottom tabs, ⌘K | Rebuild `AppShell.tsx` |
| `Design/app/scoring.jsx`, `console.jsx`, `scoreboard.jsx` | **Scoring engine** (archetype reducer), official console, public scoreboard/big-screen | New scoring module (the missing pillar) |
| `Design/app/screens-ops/results/misc.jsx` | Live Ops, Official matches, Spectator, Standings, Medals, Schedule, Participant dash | Screen designs |
| `Design/styles/*.css` | Component/shell/scoreboard/console/card/screen CSS | Visual reference for Tailwind classes |

**Critical caveat (the reason this guide exists):** the prototype goes deep on the *live-event read experience* and renders **every other route as a generic `Placeholder`** (see `screens-misc.jsx` → `Placeholder`). It also **re-cast the personas** (added "Spectator", dropped "Institution/Captain") and has **no permissions layer**. Production must restore all of that. Sections 5–7 are dedicated to it.

---

## 1. Insights - what the prototype gets right (adopt as-is)

1. **Token-first, layered color model** with a real **tenant white-label engine**: `applyBrand(hue, chroma, dark)` generates an accessible oklch ramp from a single organiser hue (`Design/app/app.jsx`). Neutrals + semantics stay fixed; only `--brand-*` re-skins. This is exactly the multi-tenant requirement - implement it.
2. **Dedicated `--live` red** distinct from `--danger`, with a glow - used consistently for LIVE state. Keep this separation.
3. **Formalized `STATUS_TONE` map** as a *single source of truth* for status→color (`components.jsx`). Resolves the earlier amber/slate "draw" inconsistency. Port verbatim.
4. **Archetype-driven scoring engine**: each sport declares an `archetype` (`clock`/`sets`/`rally`/`tennis`/`cricket`/`time`); one `scoreReducer` + per-archetype controls/scoreboards. Adding a sport = config, not a rewrite. This is the right architecture.
5. **Three scoring surfaces** (official console / public scoreboard / compact card) all reading the same match state. Undo via a history stack; **guarded sign-off**; offline sync badge.
6. **Responsive shell**: collapsible sidebar → icon rail → mobile drawer + **bottom tab bar**, topbar with role switch, theme toggle, notifications, ⌘K command palette. This fixes today's non-responsive shell.
7. **Tabular numerals (`tnum`) everywhere** scores/times/tables appear; `tick` animation on score change; `fade-up` page transitions; density variable.
8. **Olympics-grade surfaces**: Live Ops mission control (KPIs + alerts + live cards + up-next), Standings with form guide + qualification line, Medal tally with podium, Schedule agenda with venue chips, big-screen auto-rotating scoreboard.

> Net: **adopt the prototype's visual system and scoring architecture wholesale.** Our job is to (a) port it to the production stack and (b) build the CRUD + RBAC it skipped.

---

## 2. Persona reconciliation (do this first - it drives everything)

The prototype's roles ≠ production's roles. Reconcile to **production's five app roles + a public surface**:

| Production `AppRole` (`lib/auth.tsx`) | Prototype equivalent | Status |
|---|---|---|
| `system` (System Admin) | `admin` | ✅ present (Overview, Tenants, Sports&Scoring, Design System) |
| `organiser` | `organiser` | ✅ present (Live Ops, Schedule, Approvals, Officials, Standings, Medals, Events, Settings) |
| `institution` (Institution/Captain) | **- missing -** | ❌ **prototype dropped it** - design from the brief + existing pages |
| `official` | `official` | ✅ present (My Matches → Console) |
| `participant` (Athlete) | `participant` | ✅ present (Dashboard, My Matches, Standings) |
| **public/spectator** (no auth) | `spectator` | ➕ prototype adds this; production has no such role yet - build as **unauthenticated** microsite + big-screen |

**Action:** keep production's `ROLES`/`NAV`/`BOTTOM` aligned to the five `AppRole`s, port the prototype's nav shapes, and **author the full Institution/Captain experience** (the most CRUD-heavy persona - teams, rosters, students, POCs, enrollment) which the prototype omitted. Add the public/spectator surface as a separate unauthenticated route tree.

---

## 3. Design language → production mapping (what to change in code)

### 3.1 Tokens - `apps/web/src/index.css`
Replace the current minimal `@theme` with the full token set from `Design/styles/tokens.css`:
- Port **brand ramp (oklch)**, **neutrals**, **semantic + `--live` + gold**, **surface/text/border** tokens for **both light and `.dark`**, shadows, spacing, radius, motion, z-index, `--density`.
- Port **sport accents** (`--sport-*`).
- Add the **tenant brand engine** `applyBrand(hue, chroma, dark)` (from `app.jsx`) wired to the authenticated tenant; default = Sportagon azure (`#2f6fde`, hue 256). Provide curated hue presets + contrast fallback.
- **Load the fonts for real** (Archivo / Archivo Expanded / Geist Mono - or the chosen pairing). Today `--font-display` is declared but never loaded. Enable `font-variant-numeric: tabular-nums` on a `.tnum` utility.
- Honor `prefers-reduced-motion` (disable `tick`/`fade-up`/pulse).

### 3.2 Components - `apps/web/src/components/ui.tsx`
Names already match the prototype. Upgrade each to the prototype spec and **add the missing ones**. Per component, implement *all states* (default/hover/focus-visible/active/disabled/loading/error/selected/empty) and ≥44px targets.

- **Upgrade:** `Button` (+`secondary`, +`loading`, +`block`, icon/iconRight), `Badge`/`StatusBadge` (port `STATUS_TONE`/`STATUS_LABEL` single source of truth), `Card`/`StatCard` (+icon/accent/delta), `Avatar` (hashed hue), `Tabs` (+count), `EmptyState`, `PageHeader` (+eyebrow), `Field`/`Input`/`Select` (+error/required), `Toggle`, `Spinner`, `Table`.
- **Add (new):** `Crest` (team/institution mark), `Segmented`, `Modal`/`Dialog` + **`ConfirmDialog`** (destructive), **`Toast`/toaster**, **`Skeleton`** set, `Breadcrumbs`, `DropdownMenu`, `Popover`, `Tooltip`, `DateTimePicker`/range, `Stepper`/`Wizard`, **`CommandPalette` (⌘K)**, `FilterBar`/`Chip`, `Pagination`, `Banner`/inline alert, `Drawer`/`BottomSheet`, `ResponsiveTable` (table↔card), `Meter`/progress, `TagInput`, `AvatarGroup`.

### 3.3 Shell - `apps/web/src/components/AppShell.tsx` (rebuild)
Port `shell.jsx` + `chrome.jsx`: responsive sidebar (collapse → rail → mobile drawer), bottom tabs (`BOTTOM[role]`), topbar (tenant context, role switch, theme toggle, notifications bell, ⌘K), `Logomark`/`Wordmark`, `SportChip`. Keep the existing `roleHome`/`navFor` semantics but per-role grouped nav like the prototype.

### 3.4 Scoring module (new) - `apps/web/src/features/scoring/`
Port `scoring.jsx` (formatters + `scoreReducer`), `console.jsx` (`MatchConsole`, `ScoreControls`, `CricketDeck`, `ConfirmEnd`), `scoreboard.jsx` (`Scoreboard`, `BigScreen`, `CompactScoreCard`). Replace the basic `MatchConsolePage`. Define a `SPORTS` registry (archetype/segLabel/segMax/unit/accent). Wire writes through the API with optimistic updates + offline queue (§8).

---

## 4. Build phases (suggested order)
1. **Foundations:** tokens + fonts + tenant brand engine + dark mode.
2. **Components:** upgrade `ui.tsx` + add new components (esp. Modal/ConfirmDialog/Toast/Skeleton - needed by every CRUD screen).
3. **Shell + RBAC primitives:** responsive shell, `usePermissions`/`<Can>` gate (§5).
4. **Read screens:** Live Ops, Standings, Medals, Schedule, dashboards (port directly).
5. **Scoring system:** console + scoreboards + write path.
6. **CRUD screens:** every create/edit/delete surface with permission gating (§6–7).
7. **Public/spectator microsite + big-screen.**
8. **A11y + i18n + polish pass.**

---

## 5. Permissions & role conditioning (GAP #1 - do not neglect)

The prototype has **no permission layer**; production must. The data model already supports it: `permissions(code,label,rules)`, `roles(permission_ids)`, `user_event_roles(user,event,role)`, plus `users.is_super_admin` and `users.account_type`. Authority is **event-scoped** (a user can be Organiser of event A but only a Participant in event B).

### 5.1 Client permission primitive
Add a single gate derived from the auth context (`lib/auth.tsx` already returns `user`, `institution`, `event_roles`, `memberships`):

```ts
// lib/permissions.ts (new)
// can(perm, { eventId? }) → boolean, resolved from auth ctx:
//   super_admin ⇒ true
//   else union of permission codes from the user's roles for that event
//   + ownership rules (own team / own institution / own profile)
```

Expose `usePermissions()` and a declarative component:

```tsx
<Can perform="event.update" in={eventId} fallback={null}>
  <Button>Edit event</Button>
</Can>
```

**Rules:**
- **Gate at three levels:** (1) route (redirect/403 page), (2) action visibility (hide or disable+tooltip), (3) field-level (read-only inputs).
- **Hide vs disable:** *hide* actions a role can never do in this context; *disable with tooltip* actions blocked by state (e.g., "Roster locked", "Event completed"). Never show a control that 403s on click.
- **Client checks are UX only** - the API must enforce every permission server-side (it already scopes `/me/*` to `req.user.id`; extend to all mutations). Client mirrors server truth.
- **Active-role conditioning:** the shell renders the nav/screens for `activeRole` (role switcher). A super admin previewing a shell still sees real data scoped to that role's permissions.

### 5.2 Role × capability matrix (high level)
✅ full · 🟡 own/scoped only · ➖ read-only · �-  none

| Capability | system | organiser | institution/captain | official | participant | public |
|---|---|---|---|---|---|---|
| Platform master data (sports, disciplines, formats, roles, institutions, users) | ✅ | �screen- | �screen- | �screen- | �-  | �- |
| Tenants & white-label settings | ✅ | 🟡 own tenant brand | �- | �- | �- | �- |
| Events (create/edit/delete/lifecycle) | ✅ | 🟡 own events | ➖ browse | ➖ assigned | ➖ played | ➖ public |
| Tournaments / sports / disciplines / venues / formats (per event) | ✅ | 🟡 own events | �- | �- | �- | �- |
| Enrollments / approvals | ✅ | 🟡 approve for own events | 🟡 apply (own institution) | �- | �- | �- |
| Teams & rosters (members add/remove, lock, invite) | ✅ | ➖ view | 🟡 own institution/team | �- | 🟡 self (join via invite, leave) | �- |
| Fixtures (generate/schedule/edit/delete) | ✅ | 🟡 own events | �- | ➖ assigned | ➖ own | ➖ public |
| **Scoring** (live input, sign-off) | ✅ | 🟡 oversee/correct | �- | 🟡 assigned matches | �- | �- |
| Officials (assign/remove) | ✅ | 🟡 own events | �- | 🟡 self availability | �- | �- |
| Standings / medals / schedule | ✅ | 🟡 own | ➖ | ➖ | ➖ | ➖ |

> `screen-` = visible only via the System Admin shell. Author the exact `permission.code` list (e.g., `event.create`, `event.update`, `fixture.score`, `team.member.add`, `enrollment.approve`, `tenant.brand.update`) and seed them into `permissions`/`roles`. Keep codes `entity.action`.

### 5.3 Role-specific conditioning rules (apply on every screen)
- **Organiser** sees only **their** events everywhere (already enforced in `events.routes.ts`); their Live Ops/Standings/Schedule are event-scoped.
- **Institution/Captain** sees only **their institution's** enrollments, teams, students, POCs. Captain (`team_members.role in captain/vice_captain`) can edit rosters; ordinary members cannot.
- **Official** sees only **assigned** fixtures; can score only those; `End match & sign off` is the only state-changing action and is guarded.
- **Participant** sees only events/teams/matches they're in (the `/me/*` endpoints already do this). Read-only except join/leave team and edit own profile.
- **Public** (no auth) sees published, non-sensitive data only (live scores, schedule, standings, medals, public team/athlete pages). No PII, no draft events.
- **State conditioning (independent of role):** lock actions by lifecycle - e.g., can't add players when `roster_locked`; can't edit a `confirmed` result without entering **review**; can't delete an event with fixtures (offer archive); registration actions only when `registration_open`.

---

## 6. CRUD UX patterns (GAP #2 - do not neglect)

Every entity needs **Create / Read / Update / Delete** with consistent UX. Define these patterns once and reuse.

### 6.1 Create
- **Trigger:** primary `Button` in `PageHeader` actions (or empty-state CTA), gated by `<Can perform="entity.create">`.
- **Surface:** `Modal` (short forms) or full-page **`Wizard`/`Stepper`** (multi-step like event creation). On mobile, modals become **bottom sheets**.
- **Form:** `Field` + `Input`/`Select`/`DateTimePicker`/`TagInput`; required markers; inline validation (zod schemas already exist in `@semp/shared`); disable submit while invalid; **loading** state on submit; success **Toast** + optimistic insert (TanStack `useApiMutation` invalidation already wired).
- **Errors:** field-level (from zod) + form-level banner for server errors; never lose entered data.

### 6.2 Read (list + detail)
- **List:** `ResponsiveTable` (table on desktop, cards on mobile) **or** card grid; with `FilterBar`/chips, search, sort, **`Pagination`/infinite scroll**, density toggle; **Skeleton** rows on load; **EmptyState** with cause + CTA.
- **Detail:** `PageHeader` + `Breadcrumbs` + `Tabs`; progressive loading (summary first, sections on demand - already the participant pattern).

### 6.3 Update
- **Inline edit** for single fields (status, jersey number) where fast; **edit form** (same component as create, pre-filled) for full edits. Optimistic update + rollback on error + Toast. Show "Saved" affordance. Respect field-level permissions (read-only inputs when not allowed).

### 6.4 Delete / destructive
- **Always** via `ConfirmDialog` (ported from `console.jsx`'s `ConfirmEnd`): states the consequence, names the item, requires explicit confirm; **type-to-confirm** for high-impact (delete event/tenant). Prefer **archive/soft-delete** over hard delete for anything with history (events, fixtures with results). Disable delete when dependencies exist, explain why.

### 6.5 Bulk
- Row selection + **`BulkBar`** (already exists) for bulk approve/reject/assign/delete; show count, confirm destructive bulk, report partial failures.

### 6.6 Cross-cutting
- Optimistic by default for safe writes; pessimistic + spinner for irreversible ones.
- Every mutation → Toast (success/error) and query invalidation.
- All modals/forms keyboard- and screen-reader-complete (§8).

---

## 7. Per-entity CRUD + permission spec

For each entity: where it lives, who can do what, the surface to use. (Routes reference current `App.tsx`; new ones marked ➕.)

| Entity | Screen(s) | Create | Update | Delete | Who | Notes |
|---|---|---|---|---|---|---|
| **Event** | `/events`, `/events/new` (wizard), `/events/:id/settings` | Wizard | Settings form + inline lifecycle | Archive (confirm, type-to-confirm) | organiser (own), system | Block delete if fixtures exist → archive |
| **Tournament** | setup → Tournaments tab | Modal | Modal | Confirm | organiser | |
| **Sport (in event)** | setup → Sports tab | Modal | Modal | Confirm | organiser | links to scoring template |
| **Discipline / draw** | setup → Sports tab | Modal | Modal | Confirm | organiser | entry type, squad min/max |
| **Venue / Ground** | setup → Venues tab | Modal | Modal | Confirm | organiser | |
| **Format** | platform → Formats | Modal | Modal | Confirm | system | master data |
| **Fixture** | `/events/:id/schedule` | Generate (algorithm) + manual add | Schedule modal (time/ground/official) + inline | Confirm | organiser | conflict detection on save |
| **Enrollment / Approval** | `/events/:id/approvals` (organiser), `/inst/events` (apply) | Apply (institution) | Approve / Reject (reason) + **bulk** | - | organiser approves; institution applies | reject requires note |
| **Team** | `/inst/teams`, `/inst/teams/:id` | Modal (single + multi) | Inline/name | Confirm (if not locked) | institution/captain | scoped to own institution |
| **Roster member** | `/inst/teams/:id` | Add (manual + paste) / invite link | Jersey/role inline | Remove (confirm) | captain | block when `roster_locked`; squad min/max; lock action |
| **Official** | `/events/:id/officials` | Assign (search) + bulk | - | Remove (confirm) | organiser | availability/conflict |
| **Result / Score** | Official **Match Console** | live scoring actions | edit via **review** after confirm | - | official (assigned) | guarded sign-off; audit trail |
| **Institution** | platform → Institutions; `/inst` profile | Modal | Form (own profile: institution) | Confirm | system; institution edits own | logo, verification |
| **User** | platform → Users; profile | Invite/create | Role/status; self-profile | Deactivate (confirm) | system; self edits own | impersonation = system only |
| **Role / Permission** | platform → Roles & Permissions | Modal | **Permission matrix** editor | Confirm | system | drives §5 |
| **Sponsor** | event settings | Modal | Modal | Confirm | organiser | public page |
| **Scoring template** | platform → Sports & Scoring; per-discipline | Modal | Form (periods/target/best-of) | Confirm | system; organiser per event | feeds scoring engine |
| **Tenant / white-label** | platform → Tenants ➕ | Modal | Brand color (live preview + contrast check), logo, domain | Confirm | system; organiser own brand | §3.1 engine |
| **Own profile** | account menu ➕ | - | Form (name/phone/avatar/password) | - | self | every role |

> Every row's actions are wrapped in `<Can>` and reflect state conditioning (§5.3). Each list has Skeleton + EmptyState + error states; each form uses the shared create/edit pattern (§6).

---

## 8. Real-time & scoring write-path (officials)
- **Reads** (scoreboards, spectator, participant live, Live Ops) subscribe to live match state (websocket/poll); design **optimistic UI**, `tick` number animation, **no layout shift**, and explicit **"reconnecting…"**.
- **Writes** (console): each scoring action → optimistic local reduce (port `scoreReducer`) + queued API write. **Offline mode**: queue actions, show the `sync-badge` ("Offline · N queued"), auto-sync on reconnect, resolve conflicts (last-writer + audit). Only the **assigned official** (or system/organiser-correct) can write - gate `fixture.score`.
- **Sign-off** transitions `live → confirmed`, writes `winner/score`, updates standings/medals, and is **guarded** (`ConfirmEnd`). Post-confirm edits require a **review** state with reason (provenance shown publicly as "provisional/under review").

---

## 9. Accessibility carried through CRUD & dialogs (don't drop it on forms)
- **Forms:** `<label>` associated to every control (no placeholder-as-label), required announced, errors tied to fields via `aria-describedby`, error summary focusable, submit disabled state communicated.
- **Dialogs:** focus trap, return focus to trigger on close, `Esc` closes, `aria-modal`, labelled title; bottom sheets same semantics on mobile.
- **Destructive confirms:** clear consequence text; primary/destructive button not the default focus for type-to-confirm flows.
- **Tables:** header scope, sortable columns announce state, row actions have accessible names; responsive card mode keeps semantics.
- **Live regions:** `aria-live` for score changes, toasts, sync state.
- **Targets/contrast/keyboard/motion:** ≥44px, AA (incl. themed brand - verify in the contrast check), full keyboard path, `prefers-reduced-motion`.
- **Color independence:** status/result via icon + text + color (the `StatusBadge` already pairs dot + label).

---

## 10. Definition of done (per developed screen)
- [ ] Matches prototype visual system (tokens/components) in **light + dark + ≥1 non-default tenant brand**.
- [ ] Responsive at 320 / 768 / 1024 / 1440 / 1920 (+ TV for scoreboards).
- [ ] **All CRUD present where applicable** (create/edit/delete/bulk) using the shared patterns (§6).
- [ ] **Permission-gated** (`<Can>`): correct hide/disable, route guard, field read-only; verified for **every role** + public, and **enforced server-side**.
- [ ] **State conditioning** applied (lifecycle locks, ownership scoping).
- [ ] All states: loading (skeleton) / empty / error / success / optimistic-rollback.
- [ ] A11y complete (§9); tabular numerals; no layout shift on live updates.
- [ ] Localizable (text expansion + RTL); tabular/locale-correct numbers, dates, units.

---

## Appendix - prototype → production file map
| Prototype | Production target |
|---|---|
| `Design/styles/tokens.css` | `apps/web/src/index.css` (`@theme`) + brand engine |
| `Design/app/components.jsx` | `apps/web/src/components/ui.tsx` (upgrade + new) |
| `Design/app/shell.jsx` + `chrome.jsx` | `apps/web/src/components/AppShell.tsx` (rebuild) + `lib/nav.ts` |
| `Design/app/scoring.jsx`/`console.jsx`/`scoreboard.jsx` | `apps/web/src/features/scoring/*` + API write path |
| `Design/app/screens-ops/results/misc.jsx` | `pages/organiser/*`, `pages/official/*`, `pages/participant/*`, ➕ `pages/public/*` |
| `Design/app/app.jsx` (`applyBrand`, store) | tenant theming + scoring store/query layer |
| (none - **build new**) | `lib/permissions.ts` (`usePermissions`, `<Can>`), all CRUD forms/dialogs, Institution/Captain screens, public microsite, platform/admin CRUD |
