# Sportagon — UI/UX & Design System Brief

**Audience:** Product designer (Claude Design) creating the full visual design + component library.
**Goal:** Turn the current functional-but-basic app into a **world-class, Olympics-grade, multi-tenant SaaS** for end-to-end sports event management — including **live per-sport scoring**, which is the major missing capability today.

> How to use this document: Each section is self-contained and prescriptive. Where you see **[Design decision needed]** make a recommendation and show 2–3 options. Where you see **[Locked]** the value is a constraint — keep it unless there's a strong reason. ASCII wireframes show *intent and hierarchy*, not pixel-final layout.

---

## 0. TL;DR for the designer

1. Build a **token-first design system** (color, type, spacing, radius, elevation, motion) that supports **light + dark** and **per-tenant white-labeling** (each organiser can re-skin brand color + logo).
2. Deliver a **responsive component library** — every component specified across **mobile / tablet / desktop**, with all interaction states.
3. Design **five role-based app experiences** (System Admin, Organiser, Institution/Captain, Official, Participant) on one shared shell.
4. Design the **Scoring System** end-to-end: a generic scoring engine UI plus **sport-specific scorecards** for cricket, football, basketball, volleyball, athletics, swimming, racket sports, combat sports, and more — across three surfaces (Officials console, Live public scoreboard, Compact card).
5. Quality bar: **WCAG 2.2 AA**, real-time, internationalized (multi-language + RTL), broadcast-grade live views.

---

## 1. Product vision & context

Sportagon is a **multi-tenant SaaS** platform that runs competitive sporting events of any scale — from a college fest to a multi-sport games (Olympics-style) with thousands of athletes, dozens of venues, hundreds of officials, and live public audiences.

**What makes the bar "Olympics-grade":**
- Multi-sport, multi-venue, multi-day scheduling with zero ambiguity.
- **Live, accurate, real-time scoring** for every sport, operated by officials and consumed by the public on a big screen and on phones.
- Trustworthy results: every score change is logged, attributable, reversible, and signed off.
- Accessible and localized for a global audience.
- White-labeled so each organiser feels it's *their* platform.

**Tenancy model (drives theming):**
- A **tenant = an organiser** (e.g., "Mumbai University Games 2026"). Each tenant can set a **primary brand color, logo, and accent**. The platform chrome adapts; the core UX stays consistent.
- Below an organiser sit **events → tournaments → sports → disciplines → fixtures (matches)**, and participants belong to **institutions/teams**.

---

## 2. Personas & their jobs-to-be-done

Design each surface around the primary job. Density and tone differ per persona.

| Persona | Context / device | Primary jobs | Design emphasis |
|---|---|---|---|
| **System Admin** (platform owner) | Desktop | Manage master data (sports, disciplines, formats, institutions, roles), oversee all tenants/users | Dense data tables, bulk ops, safety on destructive actions |
| **Organiser** (event ops) | Desktop, some tablet | Create events, approve institutions, build draws/schedules, assign officials & venues, monitor live, publish results | Operational "mission control" — overview + drill-down, status at a glance |
| **Institution / Captain** | Desktop + mobile | Enroll, manage students, build teams & rosters, track approvals & fixtures | Guided, form-heavy, friendly |
| **Official / Scorer / Referee** | **Mobile-first + tablet**, often outdoors, gloves, sun glare, spotty network | **Score matches live**, manage match state, sign off results | **Huge touch targets, high contrast, offline-tolerant, fast, hard to mis-tap** |
| **Participant / Athlete** | **Mobile-first** | See their events, schedule, live scores, results, career stats (the cross-event dashboard already built) | Glanceable, personal, motivating |
| **Spectator / Public** (no login) | Any device + **big-screen/TV** | Watch live scores, schedules, standings, brackets | Broadcast-grade, legible from distance, beautiful |

> **My input:** Officials and Spectators are the two personas most underserved by typical event software and most visible during the live event — invest the most design polish there. A clunky scoring console embarrasses the organiser in front of a live crowd.

---

## 3. Design principles

1. **Clarity over cleverness.** A volunteer official under pressure must never guess. Plain labels, obvious primary action, no hidden gestures for critical tasks.
2. **Progressive disclosure.** Summary loads first; detail on demand. (Already the participant dashboard pattern — apply everywhere.)
3. **Status is always visible.** Every event/match/team/enrollment shows its lifecycle state via consistent, color-coded badges.
4. **Real-time feels alive but never jumpy.** Optimistic updates, smooth count transitions, no layout shift, clear "LIVE" affordances.
5. **Trust through traceability.** Score edits, approvals, and result sign-offs show who/when, and are reversible with an audit trail.
6. **One system, many skins.** Components are tenant-themable without forking layout or logic.
7. **Accessible by default.** AA contrast, keyboard-complete, screen-reader labeled, motion-safe.
8. **Responsive, not adaptive-only.** Same content reflows gracefully from 320px phones to 4K big screens — no "desktop only" dead-ends.

---

## 4. Brand & visual identity

### 4.1 Current state (evolve from this — don't discard)
- **Primary brand:** blue `#2f6fde` (`brand-500`) with a full 50–900 ramp (below). **[Locked as default tenant theme]**
- **Neutrals:** Tailwind **slate** family.
- **Display font:** *Plus Jakarta Sans* is declared as `--font-display` **but is not actually loaded** (no font link) and body falls back to system UI fonts. **Gap to fix** — see Typography.
- **Product name in app:** "Sportagon" (sidebar), subtitle "SEMP Platform". **[Design decision needed]** — finalize the name + wordmark + logomark.

### 4.2 Logo & wordmark — to design
- **Logomark**: a single glyph that works at 24px (favicon, collapsed sidebar) up to a stadium screen. Currently a literal "S" tile — replace with a distinctive mark (suggest something evoking motion/podium/arena, not a generic ball).
- **Wordmark**: lockup with logomark; horizontal + stacked variants.
- **Clear space, minimum sizes, monochrome + reversed (on dark) variants.**
- **Co-branding lockup**: "Powered by Sportagon" + tenant logo, for white-label headers and public pages.

### 4.3 Color system

Build a **layered color model**: *brand* (themable per tenant) → *neutral* (fixed) → *semantic* (fixed meaning) → *sport accents* (fixed) → *data-viz* (categorical + sequential).

**Brand ramp (current default tenant — keep):**
```
brand-50  #eef4fd   brand-300 #93b4ef   brand-600 #2257c0   brand-900 #1c386b
brand-100 #dce8fb   brand-400 #6592e6   brand-700 #1d489c
brand-200 #bcd1f6   brand-500 #2f6fde   brand-800 #1c3f80
```
> Tenant theming overrides `brand-*` only. All ramps must be **generatable from a single tenant primary hex** (define an algorithm/curve so any organiser color produces an accessible 50–900 scale). Provide a fallback if a tenant picks a low-contrast color (auto-darken text, etc.).

**Neutrals:** slate 50–900 (fixed across tenants). Define explicit surface tokens (below) rather than using raw slate in components.

**Semantic colors (fixed meaning, both themes):**
| Token | Use | Light | Notes |
|---|---|---|---|
| `success` | won, approved, completed, live-ok | emerald-500/600 | |
| `warning` | pending, scheduled, attention | amber-500 | |
| `danger` | lost, rejected, cancelled, destructive | rose-600 | |
| `info` | neutral notices | sky-500 | |
| `live` | live/in-progress pulse | **dedicated red** (e.g. `#e5352b`) | distinct from `danger` rose; broadcast "LIVE" red |

> **My input:** Give **LIVE** its own dedicated red token, separate from the `danger` rose, so "this match is live" never reads as "error/loss." This is critical on scoreboards.

**Sport accent colors:** assign each sport a stable accent (used in icons, sport filters, sport headers, schedule color-coding). Provide a 16–24 color **categorical palette** that is colorblind-safe and harmonizes with any tenant brand. Sports must be distinguishable by **icon + label + color** (never color alone).

**Status → tone mapping (already in code — formalize and keep consistent):**
- green: approved, completed, active, ongoing, live(ok), roster_locked, won
- amber: pending, forming, upcoming, submitted, scheduled, draft
- rose: rejected, cancelled, lost
- brand: registration_open
- slate: default/unknown, draw(neutral) — *note draw currently maps amber in participant UI; pick one and standardize.*

**Data-viz palettes:** categorical (for brackets/teams), sequential (for heat/intensity, e.g., medal tally), and diverging (for +/- differentials). Must meet 3:1 against background and be distinguishable in grayscale.

### 4.4 Dark mode **[Required]**
Design **both light and dark from the start** — officials scoring at night and big-screen scoreboards in dark arenas need dark mode. Define a parallel surface/elevation set; don't just invert. Live scoreboards likely default to dark.

### 4.5 Typography
- **Load the display font for real.** Recommend **Plus Jakarta Sans** (already intended) for display/headings + a highly legible UI/number font. **[Design decision needed]:** consider a **tabular-figure** font or enable `font-variant-numeric: tabular-nums` everywhere scores/times/standings appear so digits don't jitter as they change. Scores, timers, and tables **must** use tabular numerals.
- Provide a **type scale** (suggest a 1.2–1.25 modular scale). Define for each step: size / line-height / weight / letter-spacing / use.

| Token | Size (desktop → mobile) | Weight | Use |
|---|---|---|---|
| display-xl | 48 → 32 | 800 | Scoreboard team score, hero |
| display-lg | 36 → 28 | 800 | Public live score |
| h1 | 30 → 24 | 700 | Page titles |
| h2 | 24 → 20 | 700 | Section |
| h3 | 18 → 17 | 600 | Card titles |
| body | 16 → 15 | 400 | Default |
| sm | 14 | 500 | Secondary |
| xs | 12 | 600 | Labels/eyebrows (uppercase, tracking-wide) |
| mono/num | — | 600 | Scores, timers, IDs (tabular) |

- Define **minimum body size 16px on mobile** (avoid iOS zoom on inputs), and a **large-format scale** for big-screen/TV scoreboards (scores legible at 5–10 meters).

### 4.6 Iconography
- One coherent icon set (suggest a single library — outline style, 1.5–2px stroke). Current UI uses ad-hoc unicode glyphs (◆ ◎ ⚇ ⚑ 🏅) — **replace with a consistent set**.
- Define **sport icons** (one per sport) — these appear in nav, filters, cards, scoreboards. Need to read at 16px and 64px.
- Define **status/result icons** (won/lost/draw, live dot, locked, approved).

### 4.7 Imagery, illustration, motion
- **Empty-state illustrations** (set of ~10) in tenant-neutral style that can take a brand tint.
- **Photography guidance** for event hero areas / public pages (athletes, venues), with overlay/scrim rules for text legibility.
- **Motion:** define durations (fast 120ms, base 200ms, slow 320ms), easing, and named motions: score tick, live pulse, skeleton shimmer, page/tab transition, toast in/out, modal. **Respect `prefers-reduced-motion`** — provide reduced variants.

---

## 5. Design tokens (deliverable)

Produce a single **tokens file** (JSON/Style Dictionary friendly) feeding Tailwind v4 `@theme` (current setup) so engineering can wire 1:1. Token groups:

```
color.brand.{50..900}        // themable per tenant
color.neutral.{50..900}      // slate, fixed
color.semantic.{success,warning,danger,info,live}.{bg,fg,border,solid}
color.surface.{base,raised,sunken,overlay,inverse}
color.text.{primary,secondary,muted,inverse,link,onBrand}
color.border.{subtle,default,strong,focus}
color.sport.{cricket,football,...}
space.{0..32}                // 4px base grid
radius.{sm:8, md:12, lg:16, xl:24, full}   // current cards use 16–24
shadow.{xs,sm,md,lg,xl}      // soft, low-spread (current uses shadow-sm)
zindex.{base,dropdown:10,sticky,overlay:50,toast,max}
font.{family,size,weight,leading,tracking}
motion.{duration,easing}
breakpoint.{sm:640,md:768,lg:1024,xl:1280,2xl:1536}   // Tailwind defaults
```

> Two theming layers: **(a) light/dark** mode and **(b) tenant brand**. Tokens must compose so a tenant brand works in both modes. Document the override mechanism (CSS variables on a tenant root class).

---

## 6. Layout, grid & responsive system

### 6.1 Breakpoints **[Locked to Tailwind defaults]**
`sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Plus design explicitly for:
- **xs 320–639** (small phones) — must work.
- **TV/large 1920+** — big-screen scoreboards & public displays.

### 6.2 App shell — **the #1 responsive gap to fix**
Current shell is a **fixed 2-column `260px + 1fr` grid that does not collapse** — it breaks on mobile. Redesign the shell responsively:

- **Desktop (≥lg):** persistent left sidebar (collapsible to icon-rail), top bar with tenant/role context, role switcher, user menu, global search, notifications.
- **Tablet (md):** collapsible sidebar (overlay or rail).
- **Mobile (<md):** sidebar becomes a **drawer** (hamburger) + a **bottom tab bar** for the persona's top 3–5 destinations. Top bar condenses.
- **Content max-width** ~1152px for reading/forms; **full-bleed** for tables, schedules, brackets, scoreboards.

```
DESKTOP                                  MOBILE
┌────────┬───────────────────────────┐  ┌───────────────────────┐
│ Logo   │ Tenant ·Role  🔍  🔔  ◌me │  │ ☰  Tenant      🔔  ◌  │
│ ──────  ├───────────────────────────┤  ├───────────────────────┤
│ Nav grp │                           │  │                       │
│  • item │      Page content         │  │     Page content      │
│  • item │   (max-w or full-bleed)   │  │   (single column)     │
│ Nav grp │                           │  │                       │
│  • item │                           │  ├───────────────────────┤
│ ─────── │                           │  │ [Home][Sched][Live][Me]│ bottom tabs
└────────┴───────────────────────────┘  └───────────────────────┘
```

### 6.3 Responsive content patterns (apply everywhere)
- **Tables → cards.** Desktop = data table; mobile = stacked cards (the `MatchRow` already does this — generalize into a `ResponsiveTable` pattern with column priority: show key columns on mobile, reveal rest on tap/expand).
- **Tabs:** horizontal on desktop, **horizontally scrollable** (no wrap/cramming) on mobile; consider a select-menu fallback for many tabs.
- **Forms/wizards:** multi-column on desktop, single column + sticky footer actions on mobile.
- **Grids:** `1 → 2 → 3 (→4)` columns at `base → sm → lg (→xl)` (event cards already do this).
- **Sticky elements:** primary actions and live-score controls stay reachable (sticky bottom action bar on mobile).

---

## 7. Component library (specify every state)

For **each** component specify: anatomy, sizes, variants, and **all states** — default / hover / focus-visible / active / disabled / loading / error / selected / empty. Define touch target **min 44×44px**. Below is the required inventory; expand each into a full spec page.

**Foundational (exist today — upgrade & standardize):**
- **Button** — variants: primary, secondary/outline, ghost, subtle, **danger**, link; sizes sm/md/lg; with icon-left/right, icon-only, loading spinner, full-width. (Current variants: primary, ghost, outline, danger, subtle — keep, add secondary + link, add loading state.)
- **Inputs** — text, textarea, select, number, search, date/time, file/upload, with label, hint, error, prefix/suffix, char count. (Current `Field/Input/Select/Textarea` — add validation/error visuals, required marker, disabled, loading.)
- **Checkbox / Radio / Toggle** — incl. indeterminate (exists).
- **Card** + CardHeader/Body/Footer (exists) — add interactive/clickable, selected, media, stat variants.
- **Badge / StatusBadge** (exists) — formalize tone mapping; add dot, count, removable.
- **Tabs** (exists) — add scrollable + badge counts + disabled.
- **Table** (exists) — add sort, sticky header, row select + **BulkBar** (exists), pagination, density toggle, responsive card mode, empty/loading rows (skeleton).
- **Modal / Dialog** (exists) — add sizes, sticky header/footer, **confirm dialog** (destructive), bottom-sheet variant on mobile.
- **PageHeader / StatCard / Avatar / Spinner / EmptyState** (exist) — refine; EmptyState gets the new illustrations.

**New components to design:**
- **Toast / Notification** (success/error/info/live) + notification center/inbox.
- **Skeleton loaders** per layout (card, table row, scoreboard, list).
- **Breadcrumbs** (Dashboard › Event › Match — referenced in plan, not built).
- **Dropdown menu / Context menu / Popover / Tooltip.**
- **Date/time range picker** (scheduling).
- **Stepper / Wizard** (exists as `Stepper` — extend for the event-creation wizard, horizontal on desktop / compact on mobile).
- **Command palette / global search** (⌘K) — power-user nav across events/teams/athletes/fixtures.
- **Filter bar / chips** (faceted filtering for schedules, matches, athletes).
- **Avatar group / team crest** (institution logos).
- **Pagination / infinite scroll.**
- **Tag / pill input** (sports, disciplines).
- **Banner / inline alert** (event-level notices, "results provisional").
- **Progress / meter** (roster completeness, schedule readiness).
- **Segmented control** (view switches: list/grid, day selector).
- **Drawer / bottom sheet.**
- **Calendar / agenda** (schedule).

> Provide a **component status matrix**: name × (mobile spec ✓ / tablet ✓ / desktop ✓ / dark ✓ / states ✓ / a11y notes).

---

## 8. Information architecture & key screens by role

Below: the screens to design per persona, with the hierarchy that matters. (✓ = exists, needs redesign; ＋ = new.)

### 8.1 System Admin (platform master data + oversight)
- ✓ Sports, Disciplines, Formats, Institutions, Roles & Permissions (master-data CRUD tables — make them best-in-class data tables: search, sort, bulk, inline edit).
- ✓ All Events / All Users (cross-tenant overview).
- ＋ **Tenant management & white-label settings** (per-organiser brand color, logo, domain).
- ＋ **Scoring rule templates** per sport (define default periods, win conditions — see §9).

### 8.2 Organiser — "Event Operations Console"
This is mission control; design for **overview + drill-down**.
- ✓ Events list → ＋ richer **Event dashboard** (readiness, live now, today's schedule, alerts).
- ✓ Event setup (tournaments, sports, disciplines, venues, formats).
- ✓ Approvals (institution enrollments) — queue UX with bulk approve/reject.
- ✓ Participants, Officials (assignment).
- ✓ Schedule — ＋ upgrade to a true **multi-venue, multi-day calendar/agenda** with drag-to-schedule, conflict detection (venue/official/team double-booking).
- ✓ Standings — ＋ **medal tally** (multi-sport), brackets visualization.
- ＋ **Live ops board:** all in-progress matches across venues, scores updating, flags for attention.
- ＋ **Results publishing & sign-off** workflow.
- ＋ Event public page / microsite editor (what spectators see).

### 8.3 Institution / Captain
- ✓ Overview, Browse events, Teams, Roster, Students, POCs.
- Make roster building delightful: invite links, jersey assignment, squad min/max validation, eligibility checks.
- Mobile-friendly (captains work on phones).

### 8.4 Official — "Match Console" (mobile/tablet-first) — **major upgrade**
- ✓ My matches list (assigned fixtures) → ＋ today/now emphasis.
- ＋ **Scoring console per sport** (the core of §9): pre-match (toss/lineup/coin), live scoring, period control, events log, undo, time/clock, sign-off.
- ＋ Offline-tolerant: queue actions, sync on reconnect, show sync state.
- Design for **outdoor legibility, big touch targets, accidental-tap protection** on irreversible actions (e.g., "End match" requires confirm).

### 8.5 Participant / Athlete (mobile-first — already built, elevate visually)
- ✓ Dashboard (career stats, event cards, recent matches), Event detail (tabs), All matches, Match detail.
- ＋ **Live match view** when their match is in progress (auto-surface), push notification on result.
- ＋ Personal schedule / calendar, medals/achievements.

### 8.6 Spectator / Public (no auth) — **new, broadcast-grade**
- ＋ Event microsite: schedule, live scores, standings/medal tally, brackets, team/athlete pages.
- ＋ **Big-screen scoreboard mode** (full-screen, dark, auto-rotating across live matches) for venue displays.
- ＋ Share/embed scorecards.

---

## 9. The Scoring System (the missing pillar) — design in full

This is the centerpiece. Design a **generic scoring engine** plus **sport-specific scorecards**, each rendered on **three surfaces**.

### 9.1 Three surfaces (design all three for every sport)
1. **Officials Console (input):** mobile/tablet-first, the official drives the match. Optimized for speed + accuracy + recoverability.
2. **Live Public Scoreboard (output, big):** broadcast/spectator, full-screen capable, dark default, legible at distance, auto-updating, beautiful.
3. **Compact Score Card (output, small):** the row/card used in lists, schedules, participant/dashboard, standings (the existing `MatchRow` evolves into this).

### 9.2 Universal scoring concepts (shared across all sports)
Design these once as a framework, then specialize:
- **Match lifecycle:** `scheduled → (pre-match) → live → (paused/half-time/break) → completed → (under review) → confirmed/published`. Each with distinct UI + badge.
- **Pre-match setup:** confirm teams/athletes & lineup, toss/coin/serve choice, starting clock/period, officials present.
- **Period/segment model (generic):** sports divide into segments — *innings, halves, quarters, sets, games, periods, rounds, heats, ends, frames, legs*. The engine handles "current segment, segment scores, aggregate."
- **Scoring units (generic):** *points, goals, runs, sets, time, distance, height, holds, knockouts, judges' scores*. Each sport declares which.
- **Event log / timeline:** every scoring action is a timestamped, attributable entry (goal, wicket, foul, card, substitution, point). **Undo/redo** any recent action. This log powers the live ticker and the post-match report.
- **Clock/timer:** count-up or count-down, start/stop/adjust, with stoppage time; some sports clockless.
- **Win condition & auto-result:** engine computes winner from rules (e.g., best-of-3 sets, higher goals, lower time) but official can override with reason.
- **Confirmation & sign-off:** completing requires official sign-off; produces an immutable result + audit trail; standings/medal tally update.
- **Corrections after completion:** "under review" state, edit with reason, re-publish — visible provenance.
- **Safety:** destructive/irreversible actions (end match, reset) always confirm; big undo affordance; offline queue with conflict resolution.

```
OFFICIAL CONSOLE — universal frame (mobile/tablet)
┌───────────────────────────────────────────┐
│ ‹ Match · Sport · Round       ● LIVE 12:34 │  ← clock + live state
├───────────────────────────────────────────┤
│   TEAM A            vs            TEAM B    │  ← teams/athletes
│     12                            10        │  ← big tappable scores
│  [ +1 ][ +2 ][ +3 ]          [ +1 ][..]    │  ← sport scoring controls
├───────────────────────────────────────────┤
│ Segment: Set 2 of 3   [ End set ][ Pause ] │  ← period control
├───────────────────────────────────────────┤
│ Event log            [ Undo last ⟲ ]       │
│  12:30  A point (ace)                       │
│  11:58  B point                             │
├───────────────────────────────────────────┤
│        [  End match (confirm)  ]            │  ← guarded primary
└───────────────────────────────────────────┘
```

```
LIVE PUBLIC SCOREBOARD — universal frame (dark, big-screen)
┌─────────────────────────────────────────────────────────┐
│  EVENT NAME · SPORT · ROUND                       ● LIVE  │
│                                                           │
│   ┌──────────────┐                ┌──────────────┐        │
│   │  crest  TEAM A│      3  :  2   │TEAM B  crest │        │
│   └──────────────┘                └──────────────┘        │
│            Set scores: 25–20 · 18–25 · 11–9                │
│   Last: A — ace (J. Rao)            Venue · Court 2        │
└─────────────────────────────────────────────────────────┘
```

### 9.3 Per-sport scorecards
For each sport below, design **all three surfaces** + the **pre-match** and **event-log entry types**. Group sports by scoring archetype so the engine + UI reuse maximally.

**Archetype A — Goal/point clock sports** (symmetric, running score, timed)
- **Football/Soccer:** halves + stoppage + (ET/penalties); events: goal (scorer/assist), yellow/red card, sub, penalty. Console: large +goal, card buttons, sub flow. Scoreboard: clock prominent, scorers list.
- **Basketball:** 4 quarters, shot/game clock, fouls, timeouts; +1/+2/+3, team fouls, bonus. Quarter-by-quarter line.
- **Field Hockey / Handball / Water Polo / Futsal:** same archetype, sport-specific events (green/yellow/red, penalty corner, etc.).
- **Netball:** quarters, position-based.

**Archetype B — Set/rally racket & net sports** (best-of-sets, serve)
- **Volleyball:** best-of-5 sets to 25 (15 in 5th), serve/rotation, point per rally; set-by-set line; libero. 
- **Tennis:** sets → games → points (15/30/40/deuce/adv), tiebreak; serve indicator; per-set games. Need the classic tennis grid (games per set, current point).
- **Badminton / Table Tennis / Squash / Pickleball:** best-of games to 21/11; serve indicator; point-by-point.

**Archetype C — Innings/over sports**
- **Cricket:** innings, overs, balls; runs/wickets, run rate, this-over dots, batsmen on strike + bowler, extras, fall of wickets, DLS note, T20/ODI variants. This is the **most complex scorecard** — design a rich console (ball-by-ball entry: runs 0–6, wide/no-ball/bye/leg-bye, wicket types) and a full **batting/bowling scorecard** output. 
- **Baseball/Softball:** innings, balls/strikes/outs, diamond/base state.

**Archetype D — Time/distance/measure (athletics & aquatics)** — *individual + heats*
- **Athletics (Track):** heats → semis → final; lane assignments; **timing to 1/100s**, photo-finish placeholder, reaction time, wind reading, false start. Result = ranked times.
- **Athletics (Field):** jumps/throws — multiple attempts, best mark, fouls (X), height progression for high/pole vault. Attempt grid.
- **Swimming/Aquatics:** lanes, heats, splits per lap, final time, records (WR/NR/PB flags). Heat sheet + results.
- **Cycling, Rowing, Skiing, Speed skating:** time-ranked, similar.

**Archetype E — Judged/scored sports**
- **Gymnastics, Diving, Figure skating, Synchronized swimming:** multiple judges' scores, difficulty + execution, drop high/low, computed total. Judge-panel input + breakdown.
- **Boxing, Taekwondo, Karate:** rounds, judges' scorecards, points, knockdowns/KO, penalties.

**Archetype F — Combat / 1v1 outcome**
- **Wrestling, Judo:** points/holds (ippon/waza-ari), period, golden score, pin. 
- **Fencing:** touches, periods, priority.

**Archetype G — Frame/end/leg sports**
- **Snooker/Billiards:** frames, break, ball-on, points; **Darts:** legs/sets, checkout; **Bowling/Bowls/Curling:** ends/frames; **Archery/Shooting:** ends, arrows/shots, X/10 rings, running total.

**Archetype H — Other**
- **Chess:** clock per player, move list/PGN, result 1–0/½–½/0–1, tournament = Swiss/round-robin standings with tiebreaks. **Esports:** maps/rounds, best-of, per-game scores. **Kabaddi:** raids, points, all-out, halves. **Kho-Kho.**

> **Deliverable per sport:** a one-pager with (1) console wireframe, (2) public scoreboard, (3) compact card, (4) event-log entry types, (5) result/sign-off summary. Start with the **MVP set** below; the engine must make adding sports a config exercise, not a redesign.

**Suggested MVP scoring set (design first):** Football, Basketball, Volleyball, Cricket, Badminton/Table Tennis, Athletics (track + field), Swimming, Tennis. These cover all archetypes A–E and validate the framework.

### 9.4 Scoring system — cross-cutting requirements
- **Roles around scoring:** primary scorer (official), referee/approver, and read-only assistants; spectators read-only. Show who's controlling.
- **Multi-official concurrency:** if two officials open the same match, define ownership/locking + conflict UX.
- **Real-time delivery:** scoreboards & participant/spectator views update live (websockets). Design the **latency/optimistic** UX and a clear "reconnecting…" state.
- **Templates:** organisers/admins configure a sport's scoring rules (periods, target, best-of) per discipline before fixtures — design that config UI (§8.1).
- **Accessibility on scoreboards:** color + text for team identity; never rely on jersey color alone; large legible numerals; screen-reader live regions for score changes.

---

## 10. Cross-product surfaces to design

- **Standings / League table** (exists, basic) — formalize; add form guide, qualification lines, tiebreak notes.
- **Medal tally** (multi-sport) — gold/silver/bronze by institution/nation, sortable.
- **Brackets / draws** — knockout tree, groups, round-robin grid; pan/zoom on mobile; print/export.
- **Schedule / agenda** — multi-venue timeline, day picker, sport/venue/team filters, conflict highlights, my-schedule.
- **Notifications** — in-app inbox + push + email templates (result published, match starting, approval needed).
- **Search (⌘K)** — events, teams, athletes, fixtures, venues.
- **Public event microsite** — landing, schedule, live, results, teams, athletes, sponsors.
- **Onboarding / auth** — sign-in, role selection, first-run, tenant join.

---

## 11. Accessibility (WCAG 2.2 AA — non-negotiable)
- **Contrast:** text ≥ 4.5:1 (≥3:1 large); UI/graphical objects ≥ 3:1; verify tenant-themed colors auto-meet this.
- **Keyboard:** every action reachable & operable; visible **focus-visible** ring (define a focus token, current uses brand ring); logical tab order; no keyboard traps; ⌘K + shortcuts for power users.
- **Screen readers:** semantic landmarks, labeled controls, `aria-live` for scores/toasts/live regions, table semantics, accessible names for icon-only buttons.
- **Targets:** ≥44×44px; spacing to prevent mis-taps (critical for officials).
- **Motion:** honor `prefers-reduced-motion`; no purely-motion information.
- **Color independence:** status/result conveyed by **icon + text + color**, never color alone.
- **Forms:** errors announced, associated with fields, with guidance; never rely on placeholder as label.
- **Zoom/reflow:** usable at 200% zoom and 320px width without horizontal scroll (except data tables/brackets which get intentional scroll).

---

## 12. Internationalization & localization (Olympics = global)
- **Multi-language** UI; design for **text expansion** (+30–40%) — don't pack labels tight.
- **RTL** support (Arabic/Hebrew) — mirror layouts; verify icons/score order.
- **Locale formats:** dates, times (12/24h), numbers, **measurement units** (m/ft, kg/lb) for results.
- **Names:** support diverse name orders, long names, scripts; avoid assuming initials.
- **Time zones:** schedules show local venue time + viewer time; be explicit.
- **Sport/term glossaries** translatable.

---

## 13. States: empty, loading, error, offline (design for all)
- **Loading:** skeletons that match final layout (no spinners for whole pages after first load); optimistic where safe; per-section loaders (existing pattern).
- **Empty:** purposeful illustration + one-line cause + primary CTA (e.g., "You haven't participated in any events yet" — already used; expand to all lists).
- **Error:** friendly, actionable, with retry; never raw stack traces; distinguish 403 (not allowed) vs 404 (not found) vs network.
- **Offline (officials):** banner + queued-actions indicator + auto-sync; never lose a score.
- **Partial/provisional:** "results provisional / under review" banners.

---

## 14. Multi-tenant white-labeling (theming architecture)
- **Tenant theme = brand primary hex + logo + (optional) accent + display name.** Everything else inherits the system.
- Provide a **theme preview** in admin: live-render key components with the chosen color, with contrast warnings.
- **Scope:** chrome (sidebar, headers, buttons, links, focus, charts' brand series) re-skins; semantic colors (success/danger/live) and neutrals **do not** change (consistency + safety).
- **Public pages** can go further (hero imagery, sponsor logos) within guardrails.
- **Custom domain / "powered by" lockup.**
- Document the **default Sportagon theme** (current blue) as the fallback.

---

## 15. Voice & content design
- **Tone:** confident, clear, encouraging; sporty but professional (Olympics broadcast, not casual gaming).
- **Microcopy library:** buttons (verbs: "Approve", "Score match", "End match"), confirmations, empty states, errors, toasts.
- **Status vocabulary:** standardize the lifecycle words (scheduled/live/completed/confirmed, pending/approved/rejected) and never use synonyms inconsistently.
- **Numbers & results:** consistent formatting ("3–2", "W 3-2 vs IITB", times "1:02.45").

---

## 16. Deliverables expected from the designer
1. **Foundations:** finalized brand (logo/wordmark), color system (light/dark + tenant-themable), typography, iconography (incl. sport icons), spacing/radius/elevation/motion — as a **token file**.
2. **Component library** in a design tool: every component in §7 with all states, responsive specs (mobile/tablet/desktop), dark mode, and a11y annotations.
3. **Page designs** for all five roles + public/spectator (§8), responsive at xs/sm/md/lg/xl + TV.
4. **Scoring system** (§9): engine framework UI + the MVP sport set across all three surfaces, with the per-sport one-pagers.
5. **Cross-product surfaces** (§10): standings, medal tally, brackets, schedule, notifications, microsite, onboarding.
6. **Responsive + a11y + i18n annotations** and a **redline/spec** handoff for engineering (maps to Tailwind v4 tokens / existing component names where possible).
7. **A clickable prototype** for the two critical flows: **Official scoring a live match** and **Spectator watching live + standings**.

---

## 17. Acceptance checklist (definition of "done" per screen)
- [ ] Works at 320 / 768 / 1024 / 1440 / 1920px and TV.
- [ ] Light + dark + at least one non-default tenant brand.
- [ ] All states designed (default/hover/focus/active/disabled/loading/empty/error).
- [ ] AA contrast verified (incl. themed colors); focus-visible present; targets ≥44px.
- [ ] Keyboard + screen-reader annotations included.
- [ ] Tabular numerals on all scores/times/tables; no layout shift on live updates.
- [ ] Localizable (text expansion + RTL safe).
- [ ] Maps to design tokens + existing component names; redlined for engineering.

---

## Appendix A — Current state reference (what exists today)
- **Stack:** React + Tailwind **v4** (`@theme` in `index.css`), TanStack Query, React Router. Tokens already defined: `brand-*` ramp, slate neutrals, `--font-display` (Plus Jakarta Sans, *not yet loaded*).
- **Existing component library** (`components/ui.tsx`): Button, Input/Select/Textarea/Field, Card/CardHeader/Body, Badge/StatusBadge, Modal, PageHeader, StatCard, Avatar, Tabs, Stepper, Toggle, EmptyState, Spinner, Checkbox, BulkBar, Table/THead/TH/TR/TD. **Reuse names** so designs map cleanly.
- **Shell:** fixed `260px + 1fr` sidebar (`AppShell.tsx`) — **not responsive yet** (priority fix, §6.2).
- **Roles & homes:** system → master data; organiser → events; institution → /inst; official → /official; participant → /me.
- **Domain model:** events → tournaments → tournament_sports → tournament_disciplines → fixtures; teams (per institution) with team_members; standings computed from completed fixtures (win=3, draw=1). **Fixtures already carry `home_score`/`away_score`/`winner_team_id`/`status`** — the data spine for scoring exists; the **live scoring UX does not** (§9 fills this).
- **Already built (reference for quality bar):** participant cross-event dashboard, event detail (tabs: overview/teams/matches/standings), all-matches list, match detail — mobile-aware, progressive loading, skeleton/empty states.

## Appendix B — Open decisions for the designer to resolve
- Final product **name + logo**.
- **Display/number font** pairing (with tabular figures).
- **Sport accent palette** (colorblind-safe, 16–24 colors).
- **Tenant-color → ramp algorithm** + contrast fallbacks.
- Big-screen scoreboard **default theme** (likely dark) + auto-rotation behavior.
- Bottom-tab destinations per persona on mobile.
- Draw "draw"/tie color (currently inconsistent: amber vs slate).

---

## Appendix C — Screen-by-screen inventory (every existing screen + what to design)

This is the **complete map of screens that exist today**. The designer must produce a redesign for **every one**, at every breakpoint, in light + dark, with all states. Format per screen: **Route · Purpose · Key elements (today) · States · Responsive · Upgrade direction.** `＋` marks net-new screens to add.

> Legend: 🟢 keep & polish · 🟡 restructure · 🔴 rebuild · ＋ new

### C.0 Global chrome & entry

**Auth / Sign-in & Sign-up** — `/auth` 🟡
- *Purpose:* Log in or create an account (participant or institution); marketing split-screen ("Run your entire sports fest from one screen").
- *Elements:* Brand hero panel; toggle login/signup; fields: name, institution name (signup), email, password; submit; demo-login hint.
- *States:* default, loading/submitting, field errors, auth error, success→redirect.
- *Responsive:* two-column on desktop (hero + form); **form-only, stacked** on mobile (hero collapses to compact header).
- *Upgrade:* tenant-aware branding on the hero (organiser logo), social/SSO placeholders, password reset, role-aware welcome, stronger marketing visuals; first-run/onboarding after signup.

**App Shell** — wraps all authenticated routes 🔴 (top responsive priority, see §6.2)
- *Elements:* left sidebar (logo + grouped nav per role), top bar (context subtitle, **role switcher**, avatar/user menu with sign-out), demo-password footer.
- *States:* role-dependent nav, active item, collapsed rail, menu open, multi-role switcher present/absent.
- *Responsive:* **rebuild** — drawer + bottom tabs on mobile, collapsible rail on tablet, persistent on desktop (currently fixed & breaks on mobile).
- *Upgrade:* global search (⌘K), notifications bell + inbox, tenant logo, breadcrumbs slot, environment/tenant indicator.

**Home redirect** — `/` → role home; **catch-all** → role home. *Design:* a branded full-screen loader/splash (currently a bare spinner).

### C.1 System Admin / Platform

**Platform Overview** — `/platform/overview` 🟡
- *Purpose:* Cross-tenant bird's-eye of all events + all users.
- *Elements:* "Platform Overview" heading; lists/tiles of every event and user.
- *Upgrade:* KPI tiles (tenants, events live now, users, matches today), tenant filter, trends, system health; links into any tenant.

**Platform master-data resources** — `/platform/:key` 🟡 (one generic CRUD screen powering **Sports, Disciplines, Tournament Formats, Institutions, Roles & Permissions, Users**)
- *Purpose:* Manage global master data.
- *Elements:* resource table, add/edit, "Unknown section" empty fallback.
- *States:* loading rows (skeleton), empty, error, row actions, edit form/modal, delete confirm.
- *Responsive:* best-in-class **ResponsiveTable** (table↔cards), sticky header, search/sort/bulk.
- *Upgrade:* per-resource tailored UIs: **Roles & Permissions** needs a real permission matrix; **Sports/Disciplines** tie into scoring templates (§9.3); **Institutions** get logos/verification; **Users** get role/impersonation/status.
- *＋ New:* **Tenant management & white-label settings** (brand color picker w/ live preview + contrast check, logo upload, domain), **Scoring rule templates** editor.

### C.2 Organiser — Event Operations

**Events list** — `/events` 🟡
- *Purpose:* All events the organiser runs (draft → wrapped).
- *Elements:* "Events" header + create button; event cards with status; empty state.
- *Responsive:* card grid `1→2→3`.
- *Upgrade:* filters (status/date/sport), search, sort, "live now" emphasis, readiness indicator per event, list/grid toggle.

**Create Event Wizard** — `/events/new` 🟢
- *Purpose:* Guided event creation ("Tell us about the event").
- *Elements:* `Stepper`; fields: name, slug (auto), host city/venue, dates, description.
- *States:* per-step validation, slug-touched logic, submitting, success.
- *Responsive:* stepper sidebar on desktop → **top progress + single column** on mobile; sticky footer nav.
- *Upgrade:* more steps (sports/format presets, branding, visibility), review step, save-as-draft, inline help.

**Event Layout (shell)** — `/events/:eventId` 🟡
- *Purpose:* Per-event wrapper: event title + status + **sub-navigation** to the tabs below.
- *Responsive:* sub-nav becomes scrollable tabs / select on mobile; sticky event header.
- *Upgrade:* breadcrumb, event switcher, quick actions, live indicator if matches in progress.

**Event Dashboard** — `/events/:eventId` (index) 🟡
- *Purpose:* Event mission control.
- *Elements:* "Needs your attention" (blocking items), "Tournaments" (with Manage link).
- *Upgrade:* readiness checklist, today's schedule, **live matches board**, KPIs (teams, fixtures, completion %), alerts (conflicts, unassigned officials), quick links.

**Event Setup** — `/events/:eventId/setup` 🟡 (tabbed)
- **Tournaments tab** 🟢 — list/create tournaments (name, description); empty state; new-tournament modal.
- **Sports tab** 🟡 — per tournament: add sports (name, icon), add disciplines/draws ("100m Sprint, Men's Singles"), format per draw; nested empties.
- **Venues tab** 🟢 — venues + grounds/courts (capacity, type); add venue/ground modals.
- *Responsive:* tabs scrollable on mobile; nested lists become accordions; modals → bottom sheets.
- *Upgrade:* **link scoring templates to disciplines here** (§9), drag-order, bulk import, format config preview, squad min/max.

**Approvals** — `/events/:eventId/approvals` 🟢
- *Purpose:* Review institution enrollment applications.
- *Elements:* filterable table (pending/approved/rejected), **BulkBar** select, approve/reject, reject-reason modal, empty states.
- *Responsive:* table→cards; bulk bar sticky.
- *Upgrade:* application detail drawer, audit trail, counts per filter, search.

**Participants** — `/events/:eventId/participants` 🟡
- *Purpose:* All participants in the event.
- *Elements:* "Participants" heading; search by name/email/institution; **note: this screen has the pre-existing `Badge variant=` bug** flagged earlier.
- *Responsive:* searchable table→cards.
- *Upgrade:* faceted filters (sport/team/institution/status), export, profile drawer, eligibility flags.

**Officials** — `/events/:eventId/officials` 🟡
- *Purpose:* Assign & manage officials.
- *Elements:* "Officials" heading; assign-official modal (search by name/email); list.
- *Upgrade:* per-official assignment load, availability, conflicts, bulk assign, sport competencies.

**Schedule** — `/events/:eventId/schedule` 🔴 (biggest organiser upgrade)
- *Purpose:* Generate fixtures and schedule them.
- *Elements:* grouped by sport; generate fixtures; per-fixture schedule modal (date/time, ground); empties ("No tournaments"/"No sports configured").
- *Responsive:* today complex; needs true calendar.
- *Upgrade:* **multi-venue, multi-day calendar/agenda** with drag-to-schedule, conflict detection (venue/official/team double-booking), filters, day picker, list & timeline views, print/export.

**Standings** — `/events/:eventId/standings` 🟡
- *Purpose:* Championship table (win=3, draw=1) from completed fixtures.
- *Elements:* StatCards (completed matches, institutions scoring, leader), medal-emoji table, empty.
- *Responsive:* table→cards; tabular numerals.
- *Upgrade:* **per-sport standings + multi-sport medal tally**, form guide, qualification lines, tiebreak notes, filters.

**Event Settings** — `/events/:eventId/settings` 🟢
- *Purpose:* Edit event details + manage lifecycle.
- *Elements:* "Event details" form; "Lifecycle" stage control.
- *Upgrade:* branding/visibility, danger zone (archive/delete w/ confirm), sponsors, public-page settings, audit log.

### C.3 Institution / Captain

**Institution Dashboard** — `/inst` 🟢
- *Purpose:* Contingent overview across events.
- *Elements:* institution name header; "My teams" (→ all teams), "Event applications" (→ browse); StatCards; empties.
- *Responsive:* two-column → stacked.
- *Upgrade:* readiness (rosters incomplete, approvals pending), upcoming fixtures, results snapshot.

**Browse Events** — `/inst/events` 🟢
- *Purpose:* Find & apply to open events.
- *Elements:* event cards, apply CTA, status; "No institution linked" + "No open events" empties.
- *Upgrade:* search/filter (sport/city/date), event detail before applying, application status inline.

**Teams** — `/inst/teams` 🟢
- *Purpose:* Enter/manage teams across approved events.
- *Elements:* team cards w/ status; enter-team & **enter-multiple-teams** modals; empty.
- *Responsive:* card grid; modals→sheets.
- *Upgrade:* filter by event/sport, roster-completeness meter, bulk entry polish.

**Roster** — `/inst/teams/:teamId` 🟢 (rich)
- *Purpose:* Build a squad.
- *Elements:* team title+status; "Squad · n/max"; **Add players** modal (manual + paste-list tabs); **invite link**; **Lock roster** (disabled below min, tooltip); import-complete modal.
- *States:* below-min, at-max, locked, loading, import results, errors.
- *Responsive:* squad list → cards; tabbed modal → sheet.
- *Upgrade:* jersey conflicts, eligibility/age checks, drag-reorder, player profiles, CSV upload.

**Students** — `/inst/students` 🟢
- *Purpose:* Everyone representing the institution, grouped by team.
- *Elements:* StatCards; team-grouped cards (link to roster); empty.
- *Upgrade:* search, cross-team dedupe, export, student profiles.

**Points of Contact** — `/inst/pocs` 🟢
- *Purpose:* Staff/captains linked to the institution.
- *Elements:* contact cards w/ role badges; empty.
- *Upgrade:* invite POC, roles/permissions, contact actions.

### C.4 Official — Match day

**My matches (fixtures)** — `/official` 🟢
- *Purpose:* Fixtures assigned to officiate.
- *Elements:* StatCards (live/upcoming/completed); fixture cards (teams, event·venue·time, status, "Open console"); empty.
- *Responsive:* cards stack; large touch targets.
- *Upgrade:* today/now grouping, search/filter, sort by time, live-first, my-venue view.

**Match Console** — `/official/score/:fixtureId` 🔴 (replace with §9 scoring system)
- *Purpose (today):* Basic result entry — "Enter result" (score, winner derived, notes "MoM, walkover…") + "Match control".
- *States:* not-assigned empty, loading, saving, validation, completed.
- *Responsive:* must be mobile/tablet-first, glare-readable, mis-tap-resistant.
- *Upgrade:* **full live scoring console per sport** (§9): pre-match setup, live period/clock control, sport-specific scoring controls, event log + undo, offline queue, guarded "End match" + sign-off, hand-off between officials.

### C.5 Participant (just built — elevate visually)

**Dashboard** — `/me` 🟢 — welcome, **CareerStats**, **My events** grid, **Recent matches** (→ all). Empty: "You haven't participated in any events yet." *Upgrade:* surface live matches, achievements/medals, personal calendar.

**Event detail** — `/me/events/:eventId` 🟢 — tabs: Overview (stats/about), My teams (rosters), My matches, Standings; back to dashboard. *Upgrade:* live tab, share.

**All matches** — `/me/matches` 🟢 — event + status filters, **MatchRow** list, empty. *Upgrade:* date grouping, search, results vs upcoming split.

**Match detail** — `/me/matches/:fixtureId` 🟢 — scoreline, result badge, match details, your team/teammates; back to event. *Upgrade:* **live view when in progress** (consume §9 scoreboard), timeline/event log, MoM.

### C.6 Cross-cutting modals & overlays (design as a set)
Enter-team / enter-multiple-teams · Add players (tabbed) · Invite link / share · Reject application (reason) · Schedule fixture (date/ground) · Add sport / Add discipline / Add tournament / Add venue / Add ground · Assign official (search) · Import-complete summary · Delete/destructive **confirm** dialog. → On mobile these become **bottom sheets**; all need loading/error/validation states and a consistent header/footer/action pattern.

### C.7 ＋ New screens implied by Olympics-grade scope (design these too)
Public event microsite (landing/schedule/live/results/teams/athletes/sponsors) · Big-screen scoreboard (auto-rotating, dark) · Medal tally · Brackets/draws viewer · Notifications inbox · Global search (⌘K) · Scoring templates editor · Tenant/white-label settings · Onboarding/first-run · 403/404/500 & offline pages · Athlete/team public profile.

> **Coverage check for the designer:** every route in `App.tsx` (auth, `/platform/*`, `/events` + 8 event sub-routes, `/inst` ×6, `/official` ×2, `/me` ×4) must have a redesigned, responsive, themed, fully-stated artboard set — plus the modals (C.6) and new screens (C.7).
