# Ranking‑event points standings — Swimming & Powerlifting

**Status:** Swimming ✅ + Powerlifting ✅ scoring implemented (powerlifting = "same as swimming"); remaining = non‑scoring UI (placement override, roster‑composition setting)
**Owner:** Eng
**Context:** Product flagged that points standings for the ranking events (Swimming, Powerlifting) don't match the official rulebook. This doc summarises the rulebook, pinpoints where our calculation diverges, proposes the fix, and lists the open questions we need product to confirm before we implement.

> **Update — Swimming is done.** Per‑sub‑event medal scales now exist, the engine applies them, and the swimming config is the full **13 events** with relays at **10/7/3**. New swimming draws are correct automatically; **already‑scored swimming needs a one‑time backfill** (`apps/api/scripts/backfill-event-scoring.ts`) to refresh the stored spec and recompute existing standings. Powerlifting is untouched pending the §5 answers.

---

## 1. TL;DR

Two concrete defects, both in Swimming:

1. **Relays are scored on the wrong scale.** The rulebook awards relays **10 / 7 / 3** (gold/silver/bronze) but our engine applies the individual‑event scale **5 / 3 / 1** to *every* event, relays included.
2. **Two events are missing** from our Swimming config: **Men's 100m Freestyle** and **Mixed 4×25m Medley Relay** — so our standings are computed over 11 events instead of 13.

Powerlifting's structure (weight categories, "team = 3 male + 2 female") looks correct in shape, but the **per‑category points scale isn't in the screenshots** — we need product to confirm it before we can call that calc correct.

Root cause for #1 is a single line: the engine has only one medal scale per event type. Fix = let each event carry its own scale.

---

## 2. The official rules (from the rulebook)

### 2.1 Swimming — 13 events

| # | Event | Type | Gold | Silver | Bronze |
|---|-------|------|-----:|-------:|-------:|
| a | Men's 25m Freestyle | Individual | 5 | 3 | 1 |
| b | Men's 50m Freestyle | Individual | 5 | 3 | 1 |
| c | **Men's 100m Freestyle** | Individual | 5 | 3 | 1 |
| d | Men's 25m Backstroke | Individual | 5 | 3 | 1 |
| e | Men's 25m Butterfly | Individual | 5 | 3 | 1 |
| f | Men's 25m Breaststroke | Individual | 5 | 3 | 1 |
| g | Women's 25m Freestyle | Individual | 5 | 3 | 1 |
| h | Women's 50m Freestyle | Individual | 5 | 3 | 1 |
| i | Women's 25m Backstroke | Individual | 5 | 3 | 1 |
| j | Women's 25m Butterfly | Individual | 5 | 3 | 1 |
| k | Women's 25m Breaststroke | Individual | 5 | 3 | 1 |
| l | Mixed 4×25m Freestyle Relay | **Relay** | **10** | **7** | **3** |
| m | **Mixed 4×25m Medley Relay** | **Relay** | **10** | **7** | **3** |

- **11 individual events** → 5 / 3 / 1
- **2 relay events** → 10 / 7 / 3
- A team's (org's) total = **sum of medal points across all 13 events**.

### 2.2 Powerlifting — weight categories

| Gender | Category | Range |
|--------|----------|-------|
| Men | ≤63.0 kg | up to 63.0 |
| Men | ≤74.0 kg | 63.01 – 74.0 |
| Men | ≤85.0 kg | 74.01 – 85.0 |
| Men | ≤96.0 kg | 85.01 – 96.0 |
| Women | ≤62.0 kg | up to 62.0 |
| Women | 62.0 kg+ | 62.01 and above |

**Rule 17:** *"Total cumulative score of the team across 5 categories (3 male & 2 female) will be considered for final points calculation."*
→ Each team fields **5 lifters: 3 male + 2 female**, and the team score is the **sum** of those 5 lifters' category results.

---

## 3. Where our calculation diverges

Our ranking events use a "multi‑competitor event" model: each sub‑event is ranked, the top finishers earn medal points for their org, and an org's total is the sum across sub‑events. The math lives in `packages/shared/src/event-scoring.ts` (`aggregateEvent`), and the per‑sport config in `packages/shared/src/event-templates.ts`.

### 3.1 Swimming gap analysis

| Rulebook event | In our config? | Rulebook pts | Our pts | Status |
|---|---|---|---|---|
| Men's 25/50m Free, 25m Bk/Fly/Br | ✅ | 5/3/1 | 5/3/1 | OK |
| **Men's 100m Freestyle** | ❌ missing | 5/3/1 | — | **Bug: event not scored** |
| Women's 25/50m Free, 25m Bk/Fly/Br | ✅ | 5/3/1 | 5/3/1 | OK |
| Mixed 4×25m **Freestyle Relay** | ✅ | **10/7/3** | **5/3/1** | **Bug: wrong scale** |
| Mixed 4×25m **Medley Relay** | ❌ missing | **10/7/3** | — | **Bug: event not scored** |

Net effect: every relay is **under‑credited** (10/7/3 → 5/3/1) and two events are dropped entirely, so the table is wrong for any team that medals in a relay or the missing events.

**Why:** `aggregateEvent` reads a single scale —
```
const medals = spec.result.medalPoints ?? [5, 3, 1];   // applied to ALL sub-events
```
There is no way today to say "this sub‑event pays 10/7/3."

### 3.2 Powerlifting gap analysis

| Aspect | Rulebook | Ours | Status |
|---|---|---|---|
| Categories (4 men + 2 women) | 6 | 6 | OK |
| One lifter contests one category | yes | yes (`pickOne`) | OK |
| Team total = sum of its lifters' results | yes | yes (medals summed per org) | OK *if* points scale is 5/3/1 |
| Team composition = exactly 3 male + 2 female | required | **not enforced** | Needs decision |
| Per‑category points scale | **not in screenshots** | assumed 5/3/1 | **Open question** |

Powerlifting is structurally fine; the risk is the **points scale per category** (the screenshots only give categories + the cumulative rule, not the gold/silver/bronze values) and whether we must **enforce/validate** the 3M+2F roster.

---

## 4. Proposed approach

### 4.1 Data‑model change — per‑event point scales

Add an optional medal scale to each sub‑event; fall back to the event‑level scale when absent. Minimal, backwards‑compatible.

```
SubEventSpec {
  key: string;
  label: string;
  medalPoints?: number[];   // NEW — overrides the event default for this sub-event
  kind?: 'individual' | 'relay';  // NEW (optional) — for labelling/visuals only
}
```

`aggregateEvent` / `detailedContributions` change from a single scale to a per‑sub‑event lookup:
```
const scale = subEvent.medalPoints ?? spec.result.medalPoints ?? [5, 3, 1];
```

This is the whole fix for the relay scoring; everything downstream (standings feed, medal tally) already sums correctly.

### 4.2 Swimming config (corrected, 13 events)

- Add **Men's 100m Freestyle** (5/3/1) and **Mixed 4×25m Medley Relay** (10/7/3).
- Tag both relays with `medalPoints: [10, 7, 3]` and `kind: 'relay'`.
- Individual events inherit the event default `[5, 3, 1]`.

### 4.3 Powerlifting (final design — "same as swimming")

**Decision:** powerlifting scores **exactly like swimming** — accumulate medal points and feed them straight into standings. No separate placement (10/7/4/1) conversion.

- Each lifter competes in one weight category (`pickOne`). Within a category, lifters are ranked by lift total (heaviest wins) → **5 / 3 / 1**.
- **Ties** (equal totals): both lifters take the place's points — no split. *(Organiser override = edit the marks; a dedicated "force placement" control is a later UI item.)*
- An org's contribution = **sum of its lifters' category points** (+ gold/silver/bronze from each category's top three), fed directly into the championship standings — same path swimming uses.

**This is already what the shipped powerlifting template does** (6 categories, `pickOne`, 5/3/1, `aggregate: medals`). So the core points need **no code change** — the only correctness fix that touches it is the shared tie rule (below), which it now inherits.

**Team composition (lifters/team, male/female ratio):** a **per‑discipline setting** the organiser configures when adding the discipline (e.g. "5 lifters, max 3 male / 2 female", or leave open) — **not hardcoded**, so other tournaments can differ. Scoring sums whatever lifters the org fields; the limit is a roster/registration rule, not part of the points math. *(Setup‑UI item — not yet built.)*

### 4.4 Tie rule (both sports)

Per answer 5, tied competitors **share the place and both earn its points** (competition ranking "1‑2‑2‑4": two firsts both score gold, no silver, next distinct mark is third). Implemented once in shared `rankSubEvent`, so it applies to swimming, powerlifting and athletics, in both the console display and the standings feed.

### 4.4 Recompute / backfill

These events feed championship standings via `live_state.eventStandings`. After the config + engine change, standings recompute on the next score edit; we'll trigger a one‑time recompute for any already‑scored ranking fixtures so existing data is corrected.

---

## 5. Decisions (answered by product)

1. **Powerlifting per‑category points:** **5 / 3 / 1**, same as swimming individuals. ✅
2. **Powerlifting team composition:** **not hardcoded** — a per‑discipline setting the organiser configures when adding the discipline (lifters/team + male/female ratio, or leave open). Other tournaments may differ, so we keep it open + configurable. ✅
3. **Relay entries:** one relay team per org per relay event. ✅
4. **Team tie‑breaks:** yes — standard medal‑tally tie‑break (most golds → silvers → bronzes). ✅
5. **Within‑event ties:** **both competitors take the place's points** (no split); **organiser can override** a placement. ✅

**Powerlifting standings model — resolved:** follow swimming exactly (sum 5/3/1 category points straight into standings). The earlier "winner gets 10 / 2nd 7 / … placement" idea — and its blank 3rd‑place value — is **dropped**. No open items remain for swimming or powerlifting scoring; remaining work is non‑scoring UI (organiser placement override, per‑discipline roster‑composition setting).

---

## 6. Proposed visualization

Goal: make it obvious *how* each point was earned, so a flagged number is traceable in one screen. Three linked views.

### A. Event ledger — who medalled in each event, with points
```
SWIMMING — Event results
────────────────────────────────────────────────────────────────────────
Event                              🥇 Gold (pts)   🥈 Silver (pts)  🥉 Bronze (pts)
────────────────────────────────────────────────────────────────────────
Men's 100m Freestyle               IIM‑B   (5)     IIM‑A   (3)      IIM‑C   (1)
Women's 25m Butterfly              IIM‑A   (5)     IIM‑C   (3)      IIM‑B   (1)
Mixed 4×25m Freestyle Relay  RELAY IIM‑A  (10)     IIM‑C   (7)      IIM‑B   (3)
Mixed 4×25m Medley Relay     RELAY IIM‑C  (10)     IIM‑B   (7)      IIM‑A   (3)
────────────────────────────────────────────────────────────────────────
  RELAY rows are visually tagged (chip) + show the 10/7/3 scale inline.
```

### B. Team standings — points + medal tally (the headline)
```
SWIMMING — Standings
────────────────────────────────────────────────
Rank  Team     Points   🥇   🥈   🥉
────────────────────────────────────────────────
 1    IIM‑A      48      4    3    2
 2    IIM‑B      39      3    2    4
 3    IIM‑C      31      2    4    1
────────────────────────────────────────────────
  Sort by Points; tie‑break by 🥇 then 🥈 then 🥉 (per Q4).
  Each row expands → view C.
```

### C. Team drill‑down — event‑by‑event contribution (traceability)
```
IIM‑A — 48 pts  (🥇4 · 🥈3 · 🥉2)
────────────────────────────────────────────
Event                          Place   Pts
────────────────────────────────────────────
Men's 25m Freestyle             🥈 2     3
Men's 100m Freestyle            🥇 1     5
Women's 25m Butterfly           🥇 1     5
Mixed 4×25m Freestyle Relay     🥇 1    10   ← relay scale
Mixed 4×25m Medley Relay        🥉 3     3   ← relay scale
…                                       ──
                                 Total  48
```

The same three views work for Powerlifting (events → weight categories; "Place" → rank within category; the relay tag is simply unused).

---

## 7. Implementation outline (after sign‑off)

1. `SubEventSpec` gains `medalPoints?` / `kind?` (shared types + zod).
2. `aggregateEvent` + `detailedContributions` use per‑sub‑event scale.
3. Swimming template → 13 events, relays at 10/7/3.
4. Powerlifting → confirmed per‑category scale + chosen roster rule (Q2).
5. Tie‑break logic (Q4/Q5) in the standings sort + within‑event ranking.
6. Standings UI → the 3 views in §6.
7. One‑time recompute of already‑scored ranking fixtures.

Small, well‑contained change. The only "real" logic change is the per‑event scale (step 2); the rest is config + UI.
