// Web display helpers for multi-competitor events (swimming heats, powerlifting
// categories, athletics). The pure scoring/aggregation now lives in @semp/shared so the
// API standings service reuses the exact same maths; this file keeps the web-only bits
// (time parse/format, hydration, the per-sub-event display table) and re-exports the
// shared helpers the console imports from here.

import type { EventSpec } from '@semp/shared';
import {
  aggregateEvent, placementPoints, rankSubEvent,
  resultStatusOf, liftsBreakdown, liftsOf, RELAY_ROW_PREFIX,
  type AggRow, type EventOrgContribution, type EventScoringOpts, type EventState, type ParticipantResult, type ResultStatus,
} from '@semp/shared';

export { aggregateEvent, placementPoints, rankSubEvent };
export type { AggRow, EventOrgContribution, EventState, ParticipantResult };

export function initEvent(): EventState { return { participants: [] }; }

/** A result (a mark, DNS / DNF / DQ, or lifts still being entered) in this category. */
export function hasResultIn(p: ParticipantResult, cat?: string | null): boolean {
  return !!cat && (typeof p.marks[cat] === 'number' || !!resultStatusOf(p, cat) || !!liftsOf(p, cat));
}

/** Drop a category's lifts along with its mark. */
const withoutLifts = (p: ParticipantResult, key: string): Pick<ParticipantResult, 'lifts'> => {
  if (!p.lifts?.[key]) return p.lifts ? { lifts: p.lifts } : {};
  const { [key]: _l, ...lifts } = p.lifts;
  return { lifts };
};

/**
 * The sub-events on screen: the ones the scorer chose, then any other with a result in it,
 * so nothing already typed is hidden. Unknown keys (an event since removed) are dropped.
 */
export function chosenEvents(state: EventState, keys: string[]): string[] {
  const known = new Set(keys);
  const picked = (state.events ?? []).filter((k, i, a) => known.has(k) && a.indexOf(k) === i);
  const withResults = keys.filter((k) => !picked.includes(k) && state.participants.some((p) => hasResultIn(p, k)));
  return [...picked, ...withResults];
}

/** Add a sub-event to the screen, or take it off along with every mark and status in it. */
export function toggleEvent(state: EventState, keys: string[], key: string): EventState {
  const on = chosenEvents(state, keys);
  if (!on.includes(key)) return { ...state, events: [...on, key] };
  return {
    ...state,
    events: on.filter((k) => k !== key),
    participants: state.participants.map((p) => {
      const { [key]: _m, ...marks } = p.marks;
      const { [key]: _s, ...statuses } = p.statuses ?? {};
      return { ...p, marks, ...(p.statuses ? { statuses } : {}), ...withoutLifts(p, key) };
    }),
  };
}

// ---- Who is in each race (whole-sport swimming) -----------------------------------------
// A race's lineup is the rows that get a time box. No lineup stored = everyone eligible
// (old matches, and fields of one swimmer per institute). A relay race's rows are one per
// institute, kept beside the swimmers with RELAY_ROW_PREFIX ids.

export { RELAY_ROW_PREFIX };
export const isRelayRow = (p: Pick<ParticipantResult, 'id'>): boolean => p.id.startsWith(RELAY_ROW_PREFIX);

/** Legs in a relay from its label ("4x25m ..." -> 4); 4 when the label does not say. */
export function relayLegs(label: string): number {
  const m = /(\d+)\s*x\s*\d+/i.exec(label);
  return m ? Number(m[1]) : 4;
}

/** One relay row per institute among the swimmers, added once and kept. */
export function withRelayRows(state: EventState): EventState {
  const have = new Set(state.participants.filter(isRelayRow).map((p) => p.orgId ?? p.org));
  const add: ParticipantResult[] = [];
  for (const p of state.participants) {
    if (isRelayRow(p)) continue;
    const k = p.orgId ?? p.org;
    if (!k || have.has(k)) continue;
    have.add(k);
    add.push({ id: `${RELAY_ROW_PREFIX}${k}`, name: `${p.org ?? 'Institute'} relay`, phone: null, org: p.org ?? null, orgId: p.orgId ?? null, category: null, marks: {} });
  }
  return add.length ? { ...state, participants: [...state.participants, ...add] } : state;
}

/** The rows a race can hold: institutes for a relay, swimmers otherwise. */
export function raceField(state: EventState, relay: boolean): ParticipantResult[] {
  return state.participants.filter((p) => isRelayRow(p) === relay);
}

/** True when some institute has more than one swimmer - then each race needs its swimmers picked. */
export function needsLineups(state: EventState): boolean {
  const seen = new Set<string>();
  for (const p of raceField(state, false)) {
    const k = p.orgId ?? p.org ?? p.id;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/**
 * Ids in this race: its stored lineup plus anyone already with a result. With no stored lineup,
 * the whole field - unless an institute has several swimmers, then only those with a result
 * (a race picked before lineups existed must not suddenly list every swimmer).
 */
export function lineupOf(state: EventState, key: string, relay: boolean, exclusive = false): string[] {
  const field = raceField(state, relay);
  // One class per competitor (powerlifting): the class they are in is their own `category`.
  if (exclusive) return field.filter((p) => p.category === key || hasResultIn(p, key)).map((p) => p.id);
  const stored = state.lineups?.[key];
  if (!stored) return (relay || !needsLineups(state) ? field : field.filter((p) => hasResultIn(p, key))).map((p) => p.id);
  const ids = new Set(stored);
  return field.filter((p) => ids.has(p.id) || hasResultIn(p, key)).map((p) => p.id);
}

const clearIn = (p: ParticipantResult, key: string): ParticipantResult => {
  const { [key]: _m, ...marks } = p.marks;
  const { [key]: _s, ...statuses } = p.statuses ?? {};
  return { ...p, marks, ...(p.statuses ? { statuses } : {}), ...withoutLifts(p, key) };
};

/** Put a row in a race or take it out; out also clears its result there (and relay swimmers). */
export function setInLineup(state: EventState, key: string, relay: boolean, id: string, on: boolean, exclusive = false): EventState {
  if (exclusive) {
    // In: this class becomes theirs, and any result in their old class goes. Out: no class.
    return {
      ...state,
      participants: state.participants.map((p) => {
        if (p.id !== id) return p;
        const old = p.category && p.category !== key ? p.category : null;
        const cleared = old ? clearIn(p, old) : p;
        return on ? { ...cleared, category: key } : { ...clearIn(p, key), category: null };
      }),
    };
  }
  const now = lineupOf(state, key, relay);
  const next = on ? (now.includes(id) ? now : [...now, id]) : now.filter((x) => x !== id);
  const { [id]: _gone, ...restMembers } = state.relayMembers?.[key] ?? {};
  return {
    ...state,
    lineups: { ...(state.lineups ?? {}), [key]: next },
    ...(on || !state.relayMembers?.[key] ? {} : { relayMembers: { ...state.relayMembers, [key]: restMembers } }),
    participants: on ? state.participants : state.participants.map((p) => (p.id === id ? clearIn(p, key) : p)),
  };
}

/** The swimmers who swam one institute's relay leg list, capped at the legs. */
export function setRelayMembers(state: EventState, key: string, rowId: string, ids: string[], legs: number): EventState {
  const unique = ids.filter((x, i) => ids.indexOf(x) === i).slice(0, legs);
  return { ...state, relayMembers: { ...(state.relayMembers ?? {}), [key]: { ...(state.relayMembers?.[key] ?? {}), [rowId]: unique } } };
}

/**
 * Add a race (relay rows created when it is a relay; an empty lineup when swimmers must be
 * picked) or remove it with every result, lineup and relay list in it.
 */
export function toggleRace(state: EventState, keys: string[], key: string, relay: boolean, exclusive = false): EventState {
  const adding = !chosenEvents(state, keys).includes(key);
  if (!adding) {
    const next = toggleEvent(state, keys, key);
    const { [key]: _l, ...lineups } = next.lineups ?? {};
    const { [key]: _r, ...relayMembers } = next.relayMembers ?? {};
    return {
      ...next,
      ...(next.lineups ? { lineups } : {}),
      ...(next.relayMembers ? { relayMembers } : {}),
      // A removed class frees its competitors for another.
      ...(exclusive ? { participants: next.participants.map((p) => (p.category === key ? { ...p, category: null } : p)) } : {}),
    };
  }
  if (exclusive) return toggleEvent(state, keys, key);
  const base = relay ? withRelayRows(state) : state;
  const next = toggleEvent(base, keys, key);
  return !relay && needsLineups(next) ? { ...next, lineups: { ...(next.lineups ?? {}), [key]: [] } } : next;
}

/** One-screen categories: the class picker moves only competitors without a result; the rest keep theirs. */
export function moveUnplacedTo(state: EventState, cat: string): EventState {
  return { ...state, participants: state.participants.map((p) => (hasResultIn(p, p.category) ? p : { ...p, category: cat, marks: {} })) };
}

export function hydrateEvent(raw: any): EventState {
  const ps = Array.isArray(raw?.participants) ? raw.participants : [];
  const events = Array.isArray(raw?.events) ? raw.events.filter((k: unknown): k is string => typeof k === 'string') : null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const lineups = raw?.lineups && typeof raw.lineups === 'object'
    ? Object.fromEntries(Object.entries(raw.lineups as Record<string, unknown>).map(([k, v]) => [k, strings(v)])) : null;
  const relayMembers = raw?.relayMembers && typeof raw.relayMembers === 'object'
    ? Object.fromEntries(Object.entries(raw.relayMembers as Record<string, unknown>).map(([k, v]) => [k,
      v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([r, ids]) => [r, strings(ids)])) : {}])) : null;
  return {
    ...(events ? { events } : {}),
    ...(lineups ? { lineups } : {}),
    ...(relayMembers ? { relayMembers } : {}),
    participants: ps.map((p: any, i: number) => ({
      id: typeof p?.id === 'string' ? p.id : `p${i}`,
      name: typeof p?.name === 'string' ? p.name : '',
      phone: typeof p?.phone === 'string' ? p.phone : null,
      org: p?.org ?? null,
      orgId: p?.orgId ?? null,
      category: typeof p?.category === 'string' ? p.category : null,
      marks: p?.marks && typeof p.marks === 'object' ? p.marks : {},
      ...(p?.statuses && typeof p.statuses === 'object' ? { statuses: p.statuses } : {}),
      ...(p?.lifts && typeof p.lifts === 'object' ? { lifts: p.lifts } : {}),
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
export interface SubEventRow { rank: number | null; name: string; org?: string | null; mark: number | null; points: number; status?: ResultStatus; breakdown?: string | null }
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
      rows.push({ rank, name: p.name || 'Unnamed', org: p.org ?? null, mark: p.marks[se.key] as number, points, breakdown: liftsBreakdown(p, se.key) });
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
