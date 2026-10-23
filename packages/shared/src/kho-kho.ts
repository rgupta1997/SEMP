import { aggregateScore, type KernelState, type RallyEvent, type RallyLog } from './rally-kernel.js';
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

export interface KhoStatus {
  /** Who chases the first turn (the toss). null until it is recorded. */
  firstChaser: Side | null;
  /** The side enforcing a follow-on, if one was given. */
  followOnBy: Side | null;
  /** Who chases the turn in progress. null before the toss or once the match is over. */
  chaser: Side | null;
  /** Offered at the end of the first innings when the lead is big enough. */
  followOnOffer: { leader: Side; lead: number } | null;
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
    if (lead >= followOnLead(format)) followOnOffer = { leader: total[0] > total[1] ? 'A' : 'B', lead };
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
export const inningsEnd = (winner: Side): RallyEvent => ({ t: 'end', outcome: 'win', winner, reason: 'innings' });

/** How a result line says it. */
export const KHO_END_LABEL: Record<'minimum_chase' | 'innings', string> = {
  minimum_chase: 'won on minimum chase',
  innings: 'won by an innings',
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
export const KHO_END_SHORT: Record<'minimum_chase' | 'innings', string> = {
  minimum_chase: 'min. chase',
  innings: 'by an innings',
};

/** After a player's own "Won"/"Lost": "Won on minimum chase", "Lost by an innings". */
export const KHO_RESULT_WORDS: Record<'minimum_chase' | 'innings', string> = {
  minimum_chase: 'on minimum chase',
  innings: 'by an innings',
};

/** How a finished kho kho match was settled, read from its saved log; null for a plain win. */
export function khoSettlementOf(liveState: unknown): { reason: 'minimum_chase' | 'innings'; winner: Side } | null {
  const raw = (liveState as { rally?: unknown } | null)?.rally;
  if (!Array.isArray(raw)) return null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const ev = raw[i] as RallyEvent | null;
    if (!ev || ev.t !== 'end') continue;
    return (ev.reason === 'minimum_chase' || ev.reason === 'innings') && ev.winner ? { reason: ev.reason, winner: ev.winner } : null;
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
