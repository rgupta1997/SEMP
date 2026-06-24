// Web display helpers for multi-competitor events (swimming heats, powerlifting
// categories, athletics). The pure scoring/aggregation now lives in @semp/shared so the
// API standings service reuses the exact same maths; this file keeps the web-only bits
// (time parse/format, hydration, the per-sub-event display table) and re-exports the
// shared helpers the console imports from here.

import type { EventSpec } from '@semp/shared';
import {
  aggregateEvent, placementPoints, rankSubEvent,
  type AggRow, type EventOrgContribution, type EventState, type ParticipantResult,
} from '@semp/shared';

export { aggregateEvent, placementPoints, rankSubEvent };
export type { AggRow, EventOrgContribution, EventState, ParticipantResult };

export function initEvent(): EventState { return { participants: [] }; }

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

// Simple team-ranking model - the default for multi-competitor events. The official gives
// each org a finishing place; points are awarded by placement (medalPoints).
export interface RankRow { orgId: string | null; org: string; place: number | null }

// Per-sub-event ranking shown to the official so the points trail is visible ("who placed
// where, and what their org earned"). Only meaningful for rank-based aggregates
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
