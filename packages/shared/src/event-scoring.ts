// Pure scoring helpers for multi-competitor events (swimming heats, powerlifting
// categories, athletics). Shared by the web console and the API standings service so
// both compute org points + medals identically. No DOM / Prisma deps - pure functions.

import type { EventSpec } from './scoring.js';

export interface ParticipantResult {
  id: string;                            // local row id
  name: string;                          // competitor name
  phone?: string | null;                 // phone used to look the competitor up
  org?: string | null;                   // org name this result counts towards (label)
  orgId?: string | null;                 // org id (an entered org of the championship)
  category?: string | null;              // for pickOne events: the single sub-event contested
  marks: Record<string, number | null>;  // subEvent.key -> mark (time/weight/points)
}

export interface EventState { participants: ParticipantResult[] }

// One row of the simple team-ranking model (the default for events): an org's place.
export interface EventRankingRow { orgId: string | null; org: string; place: number | null; points?: number }

// An org's standings contribution from one event fixture: championship points + medals.
// Both consoles persist this (live_state.eventStandings) so the standings service can stay
// dumb (no spec resolution server-side).
export interface EventOrgContribution { orgId: string; org: string; points: number; gold: number; silver: number; bronze: number }

const keyOf = (p: ParticipantResult) => (p.orgId ?? (p.org && p.org.trim() ? p.org.trim() : p.id));
const labelOf = (p: ParticipantResult) => (p.org && p.org.trim() ? p.org.trim() : (p.name || 'Unnamed'));

// Points awarded for a finishing place from the medal/placement scale (place 1 ->
// medalPoints[0], etc). Place <1 / missing earns nothing.
export function placementPoints(place: number | null | undefined, medalPoints: number[]): number {
  return place && place >= 1 ? (medalPoints[place - 1] ?? 0) : 0;
}

// Rank participants within one sub-event (1 = best). Participants without a mark are
// excluded. Simple ordinal ranking (ties take adjacent ranks).
export function rankSubEvent(spec: EventSpec, state: EventState, subKey: string): Map<string, number> {
  const entries = state.participants
    .map((p) => ({ id: p.id, mark: p.marks[subKey] }))
    .filter((e): e is { id: string; mark: number } => typeof e.mark === 'number');
  entries.sort((a, b) => (spec.result.winnerIs === 'min' ? a.mark - b.mark : b.mark - a.mark));
  const ranks = new Map<string, number>();
  entries.forEach((e, i) => ranks.set(e.id, i + 1));
  return ranks;
}

export interface AggRow { key: string; label: string; points: number }

// Team (org/individual) points from the configured aggregation rule:
//   medals      -> medalPoints[rank-1] per sub-event
//   placePoints -> (N - rank + 1) per sub-event
//   sumBest     -> sum of each participant's marks across sub-events
export function aggregateEvent(spec: EventSpec, state: EventState): AggRow[] {
  const points = new Map<string, number>();
  const labels = new Map<string, string>();
  const bump = (p: ParticipantResult, pts: number) => {
    const k = keyOf(p);
    labels.set(k, labelOf(p));
    points.set(k, (points.get(k) ?? 0) + pts);
  };

  if (spec.result.aggregate === 'sumBest') {
    for (const p of state.participants) {
      const sum = spec.subEvents.reduce((acc, se) => acc + (typeof p.marks[se.key] === 'number' ? (p.marks[se.key] as number) : 0), 0);
      bump(p, sum);
    }
  } else {
    const medals = spec.result.medalPoints ?? [5, 3, 1];
    const n = state.participants.length;
    for (const se of spec.subEvents) {
      const ranks = rankSubEvent(spec, state, se.key);
      for (const [pid, rank] of ranks) {
        const p = state.participants.find((x) => x.id === pid);
        if (!p) continue;
        const pts = spec.result.aggregate === 'medals' ? (medals[rank - 1] ?? 0) : Math.max(0, n - rank + 1);
        bump(p, pts);
      }
    }
  }

  return [...points.entries()]
    .map(([key, pts]) => ({ key, label: labels.get(key) ?? key, points: pts }))
    .sort((a, b) => b.points - a.points);
}

// Per-org standings contribution from the simple team-ranking model (the default event
// console): each org's finishing place -> points + a gold/silver/bronze for places 1/2/3.
export function rankingContributions(rows: EventRankingRow[], medalPoints: number[]): EventOrgContribution[] {
  const out: EventOrgContribution[] = [];
  for (const r of rows) {
    if (!r.orgId || !r.place || r.place < 1) continue;
    out.push({
      orgId: r.orgId,
      org: r.org,
      points: typeof r.points === 'number' ? r.points : placementPoints(r.place, medalPoints),
      gold: r.place === 1 ? 1 : 0,
      silver: r.place === 2 ? 1 : 0,
      bronze: r.place === 3 ? 1 : 0,
    });
  }
  return out;
}

// Per-org standings contribution from the detailed per-athlete console: points via the
// aggregation rule, medals from each sub-event's top-3 athletes' orgs. Only athletes with
// an orgId count towards standings (individual entries are display-only).
export function detailedContributions(spec: EventSpec, state: EventState): EventOrgContribution[] {
  const byOrg = new Map<string, EventOrgContribution>();
  const ensure = (orgId: string, org: string) => {
    let c = byOrg.get(orgId);
    if (!c) { c = { orgId, org, points: 0, gold: 0, silver: 0, bronze: 0 }; byOrg.set(orgId, c); }
    return c;
  };

  // Points: aggregateEvent keys org-bearing participants by orgId; credit those.
  const orgIds = new Set(state.participants.map((p) => p.orgId).filter((x): x is string => !!x));
  for (const row of aggregateEvent(spec, state)) {
    if (orgIds.has(row.key)) ensure(row.key, row.label).points += row.points;
  }

  // Medals: each sub-event's top-3 athletes' orgs earn gold/silver/bronze.
  if (spec.result.aggregate !== 'sumBest') {
    for (const se of spec.subEvents) {
      const ranks = rankSubEvent(spec, state, se.key);
      for (const [pid, rank] of ranks) {
        if (rank > 3) continue;
        const p = state.participants.find((x) => x.id === pid);
        if (!p?.orgId) continue;
        const c = ensure(p.orgId, labelOf(p));
        if (rank === 1) c.gold += 1; else if (rank === 2) c.silver += 1; else c.bronze += 1;
      }
    }
  }

  return [...byOrg.values()];
}
