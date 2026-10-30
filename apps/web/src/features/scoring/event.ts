// Web display helpers for multi-competitor events (swimming heats, powerlifting
// categories, athletics). The pure scoring/aggregation now lives in @semp/shared so the
// API standings service reuses the exact same maths; this file keeps the web-only bits
// (time parse/format, hydration, the per-sub-event display table) and re-exports the
// shared helpers the console imports from here.

import type { EventSpec } from '@semp/shared';
import {
  aggregateEvent, placementPoints, rankSubEvent,
  resultStatusOf,
  type AggRow, type EventOrgContribution, type EventScoringOpts, type EventState, type ParticipantResult, type ResultStatus,
} from '@semp/shared';

export { aggregateEvent, placementPoints, rankSubEvent };
export type { AggRow, EventOrgContribution, EventState, ParticipantResult };

export function initEvent(): EventState { return { participants: [] }; }

/** A result (a mark, or DNS / DNF / DQ) in this category. */
export function hasResultIn(p: ParticipantResult, cat?: string | null): boolean {
  return !!cat && (typeof p.marks[cat] === 'number' || !!resultStatusOf(p, cat));
}

/** One-screen categories: the class picker moves only competitors without a result; the rest keep theirs. */
export function moveUnplacedTo(state: EventState, cat: string): EventState {
  return { participants: state.participants.map((p) => (hasResultIn(p, p.category) ? p : { ...p, category: cat, marks: {} })) };
}

export function hydrateEvent(raw: any): EventState {
  const ps = Array.isArray(raw?.participants) ? raw.participants : [];
  return {
    participants: ps.map((p: any, i: number) => ({
      id: typeof p?.id === 'string' ? p.id : `p${i}`,
      name: typeof p?.name === 'string' ? p.name : '',
      phone: typeof p?.phone === 'string' ? p.phone : null,
      org: p?.org ?? null,
      orgId: p?.orgId ?? null,
      category: typeof p?.category === 'string' ? p.category : null,
      marks: p?.marks && typeof p.marks === 'object' ? p.marks : {},
      ...(p?.statuses && typeof p.statuses === 'object' ? { statuses: p.statuses } : {}),
    })),
  };
}

// Times are stored as seconds (number). Officials may type plain seconds ("62.4") or
// m:ss(.s) ("1:02.4"); both parse to the same value. A typo is refused with a reason,
// never read as some other time: one colon at most, under 60 seconds after it, above 0.
export function readTimeInput(raw: string): { value: number | null; error: string | null } {
  const s = raw.trim();
  if (!s) return { value: null, error: null };
  const plain = /^\d+(\.\d+)?$/;
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !plain.test(parts[1])) {
      return { value: null, error: 'Use seconds (31.45) or minutes:seconds (1:02.45).' };
    }
    const ss = Number(parts[1]);
    if (ss >= 60) return { value: null, error: 'Seconds after the colon must be under 60.' };
    const total = Number(parts[0]) * 60 + ss;
    return total > 0 ? { value: total, error: null } : { value: null, error: 'A time must be more than 0.' };
  }
  if (!plain.test(s)) return { value: null, error: 'Use seconds (31.45) or minutes:seconds (1:02.45).' };
  const n = Number(s);
  return n > 0 ? { value: n, error: null } : { value: null, error: 'A time must be more than 0.' };
}

/** The time typed, in seconds; null when blank or not a valid time. */
export function parseTimeInput(raw: string): number | null {
  return readTimeInput(raw).value;
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

// Simple team-ranking model - the default for multi-competitor events. The official gives
// each org a finishing place; points are awarded by placement (medalPoints).
export interface RankRow { orgId: string | null; org: string; place: number | null }

// Per-sub-event ranking shown to the official so the points trail is visible ("who placed
// where, and what their org earned"). Only meaningful for rank-based aggregates
// (medals/placePoints); a sumBest event has no per-sub ranking, so this returns [].
/** A placed finisher (rank, mark), or one with a DNS / DNF / DQ (no rank, no points). */
export interface SubEventRow { rank: number | null; name: string; org?: string | null; mark: number | null; points: number; status?: ResultStatus }
export interface SubEventBlock { key: string; label: string; rows: SubEventRow[] }

export function subEventResults(spec: EventSpec, state: EventState, opts: EventScoringOpts = {}): SubEventBlock[] {
  if (spec.result.aggregate === 'sumBest') return [];
  const n = state.participants.length;
  const blocks: SubEventBlock[] = [];
  for (const se of spec.subEvents) {
    // A sub-event's own scale (a relay's) wins over the event's, as the standings score it.
    const medals = se.medalPoints ?? spec.result.medalPoints ?? [5, 3, 1];
    const ranks = rankSubEvent(spec, state, se.key, opts);
    if (ranks.size === 0 && !state.participants.some((p) => resultStatusOf(p, se.key))) continue;
    const rows: SubEventRow[] = [];
    for (const [pid, rank] of ranks) {
      const p = state.participants.find((x) => x.id === pid);
      if (!p) continue;
      const points = spec.result.aggregate === 'medals' ? (medals[rank - 1] ?? 0) : Math.max(0, n - rank + 1);
      rows.push({ rank, name: p.name || 'Unnamed', org: p.org ?? null, mark: p.marks[se.key] as number, points });
    }
    rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    // Then whoever has a status, so the record says why they were not placed.
    for (const p of state.participants) {
      const status = resultStatusOf(p, se.key);
      if (status) rows.push({ rank: null, name: p.name || 'Unnamed', org: p.org ?? null, mark: null, points: 0, status });
    }
    blocks.push({ key: se.key, label: se.label, rows });
  }
  return blocks;
}
