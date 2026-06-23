// Multi-competitor event engine (swimming heats, powerlifting categories). Unlike a
// single/tie fixture there are no two teams - many participants record a mark per
// sub-event, and marks aggregate into team (org) points. Pure functions; the console
// stores EventState in fixtures.live_state.event.

import type { EventSpec } from '@semp/shared';

export interface ParticipantResult {
  id: string;                       // local row id
  name: string;                     // competitor name
  org?: string | null;             // org name this result counts towards (display label)
  orgId?: string | null;           // org id (chosen from the championship's entered orgs)
  category?: string | null;        // for pickOne events: the single sub-event contested
  marks: Record<string, number | null>; // subEvent.key -> mark (time/weight/points)
}

export interface EventState { participants: ParticipantResult[] }

export function initEvent(): EventState { return { participants: [] }; }

export function hydrateEvent(raw: any): EventState {
  const ps = Array.isArray(raw?.participants) ? raw.participants : [];
  return {
    participants: ps.map((p: any, i: number) => ({
      id: typeof p?.id === 'string' ? p.id : `p${i}`,
      name: typeof p?.name === 'string' ? p.name : '',
      org: p?.org ?? null,
      orgId: p?.orgId ?? null,
      category: typeof p?.category === 'string' ? p.category : null,
      marks: p?.marks && typeof p.marks === 'object' ? p.marks : {},
    })),
  };
}

// Times are stored as seconds (number). Officials may type plain seconds ("62.4") or
// mm:ss(.s) ("1:02.4"); both parse to the same value. Returns null for blank/garbage.
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const mm = Number(m); const ss = Number(sec);
    if (!isFinite(mm) || !isFinite(ss)) return null;
    return mm * 60 + ss;
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// Inverse of parseTimeInput for display: under a minute stays plain seconds; a minute
// or more becomes m:ss(.s) with the seconds zero-padded.
export function formatTime(sec: number): string {
  if (!isFinite(sec)) return '';
  if (sec < 60) return String(sec);
  const m = Math.floor(sec / 60);
  const rest = (sec - m * 60).toFixed(2).replace(/\.?0+$/, '');
  const [whole, frac] = rest.split('.');
  return `${m}:${whole.padStart(2, '0')}${frac ? `.${frac}` : ''}`;
}

// Aggregation key/label = the org when set, else the participant (individual ranking).
// Keyed by orgId (stable) when present, falling back to the org name for legacy rows.
const keyOf = (p: ParticipantResult) => (p.orgId ?? (p.org && p.org.trim() ? p.org.trim() : p.id));
const labelOf = (p: ParticipantResult) => (p.org && p.org.trim() ? p.org.trim() : (p.name || 'Unnamed'));

// Rank participants within one sub-event (1 = best). Participants without a mark are
// excluded. Ties share the better rank's points by simple ordinal ranking.
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

// Team (org) points from the configured aggregation rule:
//   medals     -> medalPoints[rank-1] per sub-event (5/3/1 …)
//   placePoints-> (N - rank + 1) per sub-event
//   sumBest    -> sum of each participant's marks across sub-events (team total)
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

// Simple team-ranking model - the default for multi-competitor events. Rather than
// entering per-athlete marks, the official just gives each org a finishing place; points
// are awarded by placement from medalPoints (place 1 -> medalPoints[0], etc).
export interface RankRow { orgId: string | null; org: string; place: number | null }
export function placementPoints(place: number | null | undefined, medalPoints: number[]): number {
  return place && place >= 1 ? (medalPoints[place - 1] ?? 0) : 0;
}

// Per-sub-event ranking shown to the official so the points trail is visible ("who
// placed where, and what their org earned"). Only meaningful for rank-based aggregates
// (medals/placePoints); a sumBest event has no per-sub ranking, so this returns [].
export interface SubEventRow { rank: number; name: string; org?: string | null; mark: number; points: number }
export interface SubEventBlock { key: string; label: string; rows: SubEventRow[] }

export function subEventResults(spec: EventSpec, state: EventState): SubEventBlock[] {
  if (spec.result.aggregate === 'sumBest') return [];
  const medals = spec.result.medalPoints ?? [5, 3, 1];
  const n = state.participants.length;
  const blocks: SubEventBlock[] = [];
  for (const se of spec.subEvents) {
    const ranks = rankSubEvent(spec, state, se.key);
    if (ranks.size === 0) continue;
    const rows: SubEventRow[] = [];
    for (const [pid, rank] of ranks) {
      const p = state.participants.find((x) => x.id === pid);
      if (!p) continue;
      const points = spec.result.aggregate === 'medals' ? (medals[rank - 1] ?? 0) : Math.max(0, n - rank + 1);
      rows.push({ rank, name: p.name || 'Unnamed', org: p.org ?? null, mark: p.marks[se.key] as number, points });
    }
    rows.sort((a, b) => a.rank - b.rank);
    blocks.push({ key: se.key, label: se.label, rows });
  }
  return blocks;
}
