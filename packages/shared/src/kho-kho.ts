import { aggregateScore, foldRally, type KernelState, type RallyEvent, type RallyLog } from './rally-kernel.js';
import { periodLengthMs } from './match-clock.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import { canonicalTeamSport } from './team-presets.js';

// ============================================================================
// Kho kho on top of the period kernel.
//
// The kernel already plays the match: one period per turn, decided on the total.
// What it cannot know is WHO IS CHASING - only the chasing side scores - plus the
// two kho kho endings that leave the turn count short or the score level:
//
//   follow-on          a side 9+ ahead after the first innings sends the other in to
//                      chase again; if they are still behind after it, the leader
//                      "won by an innings" without chasing a second time.
//   minimum chase      still level: each side chases once more and the faster
//                      first out wins. Like a shoot-out, the scoreline stays level.
//
// Everything here is read from the log, so undo and a second device agree.
// ============================================================================

/** Lead after the first innings that allows a follow-on, when the format names none. */
export const DEFAULT_FOLLOW_ON_LEAD = 9;
/** The referee stops a minimum chase this long past the time it has to beat. */
export const MIN_CHASE_GRACE_MS = 30_000;

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

export function isKhoKhoFormat(format?: Pick<ScoringFormat, 'sport'> | null): boolean {
  return !!format && canonicalTeamSport(format.sport) === 'kho-kho';
}

export function followOnLead(format: ScoringFormat): number {
  return Number(format.rulesSheet?.followOnLead) || DEFAULT_FOLLOW_ON_LEAD;
}

/** A lead above this makes the follow-on compulsory (IIMK: above 9); null = always the leader's choice. */
export function followOnCompulsoryAbove(format: ScoringFormat): number | null {
  const v = format.rulesSheet?.followOnCompulsoryAbove;
  return typeof v === 'number' && v >= 0 ? v : null;
}

export interface KhoStatus {
  /** Who chases the first turn (the toss). null until it is recorded. */
  firstChaser: Side | null;
  /** The side enforcing a follow-on, if one was given. */
  followOnBy: Side | null;
  /** Who chases the turn in progress. null before the toss or once the match is over. */
  chaser: Side | null;
  /** Offered at the end of the first innings when the lead is big enough; compulsory past the format's limit. */
  followOnOffer: { leader: Side; lead: number; compulsory: boolean } | null;
  /** A follow-on side still behind after its second chase: the leader has won. */
  wonByInnings: Side | null;
}

/** Turns banked so far (periods the kernel has closed). */
const turnsDone = (state: KernelState) => state.finished.filter((u) => u.level === 0).length;

/** Who chases turn `i` (0-based), given the toss and any follow-on. */
export function chaserOfTurn(i: number, firstChaser: Side, followOnBy: Side | null): Side {
  if (followOnBy && i === 2) return other(followOnBy);
  if (followOnBy && i === 3) return followOnBy;
  return i % 2 === 0 ? firstChaser : other(firstChaser);
}

export function khoStatus(format: ScoringFormat, log: RallyLog, state: KernelState): KhoStatus {
  const regulation = format.levels[format.levels.length - 1]?.target ?? 0;
  let firstChaser: Side | null = null;
  let followOnBy: Side | null = null;
  let ended = 0;
  let pointSinceInnings = false;
  for (const ev of log) {
    if (ev.t === 'endPeriod') ended += 1;
    else if (ev.t === 'chaseFirst' && ended === 0) firstChaser = ev.side;
    // Only between the innings, before the third turn has started.
    else if (ev.t === 'followOn' && ended === 2 && regulation >= 4 && !pointSinceInnings) followOnBy = ev.side;
    else if (ev.t === 'point' && ended === 2) pointSinceInnings = true;
  }

  const done = turnsDone(state);
  const total = aggregateScore(state);
  const chaser = firstChaser && !state.ended ? chaserOfTurn(done, firstChaser, followOnBy) : null;

  let followOnOffer: KhoStatus['followOnOffer'] = null;
  if (regulation >= 4 && done === 2 && !followOnBy && !pointSinceInnings && !state.ended) {
    const lead = Math.abs(total[0] - total[1]);
    const above = followOnCompulsoryAbove(format);
    if (lead >= followOnLead(format)) followOnOffer = { leader: total[0] > total[1] ? 'A' : 'B', lead, compulsory: above != null && lead > above };
  }

  let wonByInnings: Side | null = null;
  if (followOnBy && done === 3 && !state.ended) {
    const [lead, trail] = followOnBy === 'A' ? [total[0], total[1]] : [total[1], total[0]];
    if (trail < lead) wonByInnings = followOnBy;
  }

  return { firstChaser, followOnBy, chaser, followOnOffer, wonByInnings };
}

// ---- minimum chase ----------------------------------------------------------

export interface MinChaseRound { A?: number | null; B?: number | null }

export interface MinChaseState {
  rounds: MinChaseRound[];
  /** Whose chase is next. */
  next: Side;
  /** For the second chaser in a round: stop the chase past this (time to beat + 30 s). */
  limitMs: number | null;
  winner: Side | null;
}

const asTime = (ms: number | null | undefined) => (ms == null ? Number.POSITIVE_INFINITY : ms);

/**
 * Rounds of minimum chase, read from `minChase` events. The side that chased first
 * in the match chases first in every round; a round where both took equally long,
 * or neither got an out, is followed by another.
 */
export function minChaseState(log: RallyLog, firstChaser: Side | null): MinChaseState {
  const first = firstChaser ?? 'A';
  const rounds: MinChaseRound[] = [];
  let winner: Side | null = null;
  for (const ev of log) {
    if (ev.t !== 'minChase' || winner) continue;
    let r = rounds[rounds.length - 1];
    if (!r || (r.A !== undefined && r.B !== undefined)) { r = {}; rounds.push(r); }
    if (r[ev.side] !== undefined) continue;          // one chase per side per round
    r[ev.side] = ev.ms;
    if (r.A !== undefined && r.B !== undefined) {
      const a = asTime(r.A);
      const b = asTime(r.B);
      if (a !== b) winner = a < b ? 'A' : 'B';
    }
  }
  const last = rounds[rounds.length - 1];
  const open = last && (last.A === undefined || last.B === undefined) ? last : null;
  const next: Side = open ? (open[first] === undefined ? first : other(first)) : first;
  const beat = open ? open[other(next)] : undefined;
  return {
    rounds,
    next,
    limitMs: beat != null ? beat + MIN_CHASE_GRACE_MS : null,
    winner,
  };
}

/** The terminal events. The score stays level for a minimum chase, as for a shoot-out. */
export const minChaseEnd = (winner: Side): RallyEvent => ({ t: 'end', outcome: 'win', winner, reason: 'minimum_chase' });
/** Kabaddi: both golden raids empty, the toss winner takes the match. */
export const goldenTossEnd = (winner: Side): RallyEvent => ({ t: 'end', outcome: 'win', winner, reason: 'toss' });

/** A match settled other than on the score: kho kho's minimum chase or innings, kabaddi's golden raid or toss. */
export type Settlement = 'minimum_chase' | 'innings' | 'golden_raid' | 'toss';
export const inningsEnd = (winner: Side): RallyEvent => ({ t: 'end', outcome: 'win', winner, reason: 'innings' });

/** How a result line says it. */
export const KHO_END_LABEL: Record<Settlement, string> = {
  minimum_chase: 'won on minimum chase',
  innings: 'won by an innings',
  golden_raid: 'won on golden raid',
  toss: 'won on a toss after golden raids',
};

/** 83400 -> "1:23.4". */
export function formatChaseTime(ms: number | null | undefined): string {
  if (ms == null) return 'no out';
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** Short marks for a results row, beside the score. */
export const KHO_END_SHORT: Record<Settlement, string> = {
  minimum_chase: 'min. chase',
  innings: 'by an innings',
  golden_raid: 'golden raid',
  toss: 'toss',
};

/** After a player's own "Won"/"Lost": "Won on minimum chase", "Lost by an innings". */
export const KHO_RESULT_WORDS: Record<Settlement, string> = {
  minimum_chase: 'on minimum chase',
  innings: 'by an innings',
  golden_raid: 'on golden raid',
  toss: 'on a toss after golden raids',
};

/** How a finished kho kho match was settled, read from its saved log; null for a plain win. */
export function khoSettlementOf(liveState: unknown): { reason: Settlement; winner: Side } | null {
  const raw = (liveState as { rally?: unknown } | null)?.rally;
  if (!Array.isArray(raw)) return null;
  // A golden raid ends on its first point, with no end event: the point after the toss decides.
  let scored: Side | null = null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const ev = raw[i] as RallyEvent | null;
    if (!ev) continue;
    if (ev.t === 'point' && (ev.pts ?? 1) > 0) scored = ev.side;
    if (ev.t === 'goldenRaid') return scored ? { reason: 'golden_raid', winner: scored } : null;
    if (ev.t !== 'end') continue;
    return (ev.reason === 'minimum_chase' || ev.reason === 'innings' || ev.reason === 'toss') && ev.winner
      ? { reason: ev.reason, winner: ev.winner } : null;
  }
  return null;
}

/** "1:23.4", "83.4", "1:23" -> ms. null when it does not read as a time. */
export function parseChaseTime(text: string): number | null {
  const m = text.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const ms = Math.round(((Number(m[1] ?? 0) * 60) + Number(m[2])) * 1000);
  return Number.isFinite(ms) ? ms : null;
}

// ---- the turn record --------------------------------------------------------

export interface KhoTurnLine {
  turn: number;
  chaser: Side | null;
  /** Points the chaser scored in it. */
  points: number;
  /** Clock time used, when the clock was run. */
  ms: number | null;
}

/**
 * One line per finished turn: who chased, what they scored, how long it ran. The
 * raw material for anything an organiser works out on paper (average difference
 * time and the like) - this console records, it does not rank.
 */
export function khoTurnLines(format: ScoringFormat, log: RallyLog, state: KernelState): KhoTurnLine[] {
  const status = khoStatus(format, log, state);
  const times: Array<number | null> = [];
  for (const ev of log) if (ev.t === 'endPeriod') times.push(ev.clockMs ?? null);
  return state.finished.filter((u) => u.level === 0).map((u, i) => {
    const chaser = status.firstChaser ? chaserOfTurn(i, status.firstChaser, status.followOnBy) : null;
    return {
      turn: i + 1,
      chaser,
      points: chaser ? u.score[chaser === 'A' ? 0 : 1] : u.score[0] + u.score[1],
      ms: times[i] ?? null,
    };
  });
}

// ---- average difference time (ADT) -------------------------------------------

/**
 * One side's ADT inputs: time spent defending and the players it lost doing so, time
 * spent chasing and the opponents it got out. Seconds-per-out from these give
 * ADT = defending time per out conceded - chasing time per out made (higher is better).
 */
export interface AdtTally { defendMs: number; defendOuts: number; attackMs: number; attackOuts: number; estimated: boolean }

export const emptyAdt = (): AdtTally => ({ defendMs: 0, defendOuts: 0, attackMs: 0, attackOuts: 0, estimated: false });

/**
 * Both sides' ADT inputs from one match: the regulation turns only, so extra turns and
 * the minimum chase are left out (IIMK). A turn whose clock was not run counts at its
 * full length, and the tally says so. Null when there is no toss or no turn finished.
 */
export function khoMatchAdt(format: ScoringFormat, log: RallyLog): Record<Side, AdtTally> | null {
  const state = foldRally(format, log, 'A').state;
  const regulation = format.levels[format.levels.length - 1]?.target ?? 0;
  const perOut = Number(format.rulesSheet?.pointsPerOut) || 1;
  const lines = khoTurnLines(format, log, state).filter((l) => l.turn <= regulation && l.chaser);
  if (!lines.length) return null;
  const out: Record<Side, AdtTally> = { A: emptyAdt(), B: emptyAdt() };
  for (const l of lines) {
    const chaser = l.chaser!;
    const defender = other(chaser);
    // A turn ended late (7:30 of a 7-minute turn) counts as its set length: play stops on time.
    const full = periodLengthMs(format, l.turn - 1);
    const ms = l.ms == null ? full : full > 0 ? Math.min(l.ms, full) : l.ms;
    const outs = l.points / perOut;
    out[chaser].attackMs += ms; out[chaser].attackOuts += outs;
    out[defender].defendMs += ms; out[defender].defendOuts += outs;
    if (l.ms == null) { out.A.estimated = true; out.B.estimated = true; }
  }
  return out;
}

/** Add one match's inputs to a running total. */
export function addAdt(into: AdtTally, t: AdtTally): AdtTally {
  return {
    defendMs: into.defendMs + t.defendMs, defendOuts: into.defendOuts + t.defendOuts,
    attackMs: into.attackMs + t.attackMs, attackOuts: into.attackOuts + t.attackOuts,
    estimated: into.estimated || t.estimated,
  };
}

/** ADT in seconds, to 3 decimals. No outs on a side counts as one, so a clean turn is not a division by zero. */
export function adtOf(t: AdtTally): number {
  const v = t.defendMs / 1000 / Math.max(1, t.defendOuts) - t.attackMs / 1000 / Math.max(1, t.attackOuts);
  return Math.round(v * 1000) / 1000;
}
