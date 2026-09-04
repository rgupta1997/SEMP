import type { ScoringFormat, ServeResolverId, Side } from './scoring-rules.js';
import { effectiveLevel, serveSpecFor, type KernelState } from './rally-kernel.js';

// ============================================================================
// Which PLAYER serves, in doubles.
//
// Which SIDE serves is a pure function of the score and lives in the kernel. Which
// person does is not: it depends on persisted court positions and, in table tennis,
// on the previous game's pairing. Four of the five racquet sports need one of these,
// so the registry is a first-class kernel seam rather than an escape hatch.
//
// Every resolver is a pure function of (kernel state, pairing, nominations). Nothing
// is cached and nothing is stateful, so undo - which truncates the log and re-folds -
// restores the named server along with the numbers. That is the whole point.
// ============================================================================

/** The two people on one side, in their nominated order. Index 0 is "first". */
export interface Pairing {
  /** Player ids (or names) in nominated order. One entry = singles. */
  A: string[];
  B: string[];
}

export interface ServeNomination {
  /** Which of A's players served first in the current unit, as an index into A. */
  A?: number;
  B?: number;
}

export interface ResolvedServer {
  /** The person expected to serve, or null in singles / when unknown. */
  server: string | null;
  /** The person expected to receive, where the sport determines it. */
  receiver: string | null;
  courtHalf: 'right' | 'left' | null;
  /** Shown on the console: "AMY to serve from the left court". */
  note?: string;
}

const isDoubles = (p: string[]) => p.length >= 2;
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/**
 * BADMINTON, BWF 21-point. One server per side. The service court comes from the
 * SERVING side's score parity - even is right, odd is left - and the two partners
 * swap places only when their own side wins a point on its own serve. So the same
 * score can name either partner depending on history, which is exactly why this
 * cannot be a formula over the score alone: we replay the parity from the point
 * count instead.
 */
function bwfSingleServer(state: KernelState, pair: Pairing): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const half = state.serve.courtHalf;
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: null, courtHalf: half };
  // Parity picks right/left; the slot lookup turns that into a person. The starting
  // arrangement puts the nominated first server on the right at 0-0 (even).
  const rightPlayer = people[0];
  const leftPlayer = people[1];
  const server = half === 'left' ? leftPlayer : rightPlayer;
  // The receiver is the opponent standing diagonally opposite.
  const opp = pair[other(side)];
  const receiver = isDoubles(opp) ? (half === 'left' ? opp[1] : opp[0]) : (opp[0] ?? null);
  return { server, receiver, courtHalf: half, note: half ? `${server} to serve from the ${half} court` : undefined };
}

/**
 * BADMINTON, classic 15 side-out (pre-2006). Heritage, and built rather than stubbed.
 * Two hands per side, except the very first turn of a game which gets ONE ("one hand
 * down"), and the serve crosses only after both partners have lost service. The
 * kernel's handOut movement already tracks serverNo and openingTurn; this only maps
 * the number onto a person.
 */
function classicTwoServer(state: KernelState, pair: Pairing): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const half = state.serve.courtHalf;
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: null, courtHalf: half };
  const server = people[Math.min(state.serve.serverNo, people.length) - 1];
  const opp = pair[other(side)];
  return {
    server,
    receiver: opp[0] ?? null,
    courtHalf: half,
    note: `${server} serving (hand ${state.serve.serverNo})`,
  };
}

/**
 * PICKLEBALL, traditional side-out. Server #1 then #2 then the serve crosses, with
 * the first serving team of a game getting one server only (the 0-0-2 call). Server
 * #2 stands on the court opposite the one parity names, because partners do not
 * change places when they lose a rally - the kernel's courtHalfFor already inverts
 * for serverNo 2, so we just read it.
 */
function pickleballTwoServer(state: KernelState, pair: Pairing): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const half = state.serve.courtHalf;
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: null, courtHalf: half };
  const server = people[Math.min(state.serve.serverNo, people.length) - 1];
  const opp = pair[other(side)];
  const receiver = isDoubles(opp) ? (half === 'left' ? opp[1] : opp[0]) : (opp[0] ?? null);
  return { server, receiver, courtHalf: half };
}

/**
 * TABLE TENNIS. A fixed four-player cycle whose invariant is "whoever received block
 * k serves block k+1", plus ITTF 2.13.6: in games 2..N the first receiver is FORCED
 * to be the player who served to the new first server in the previous game.
 *
 * The cycle is derived from the block index rather than stored, so it survives undo
 * and a mid-match correction without a separate rotation pointer.
 */
function ttPairCycle(state: KernelState, pair: Pairing, format: ScoringFormat): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  if (!isDoubles(people)) {
    return { server: people[0] ?? null, receiver: pair[other(side)][0] ?? null, courtHalf: null };
  }
  const lv = effectiveLevel(format, state, state.pointLevel);
  const spec = serveSpecFor(format, lv);
  const every = spec.every ?? 2;
  // Which serving block we are in, counting from the start of the unit. Both sides
  // alternate blocks, so a side's own block count is half the total (rounded).
  const block = Math.floor(state.unitPoints / Math.max(1, every));
  const ownBlock = Math.floor(block / 2);
  const server = people[ownBlock % 2];
  const opp = pair[other(side)];
  // Table tennis serves right-half to right-half: the diagonal is constant, so the
  // receiver is fixed by the same block parity on the other side.
  const receiver = isDoubles(opp) ? opp[ownBlock % 2] : (opp[0] ?? null);
  return { server, receiver, courtHalf: 'right' };
}

/**
 * TENNIS. Serving order is nominated per set and locked for the whole set; the four
 * bodies rotate A1 -> B1 -> A2 -> B2 by game. Inside a tie-break the serve runs on
 * points instead, which the kernel handles because the substituted tie-break unit
 * carries its own ServeSpec.
 */
function tennisGameLocked(state: KernelState, pair: Pairing, format: ScoringFormat, nom?: ServeNomination): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  if (!isDoubles(people)) {
    return { server: people[0] ?? null, receiver: pair[other(side)][0] ?? null, courtHalf: state.serve.courtHalf };
  }
  // Games completed in the current set decide how far the rotation has turned. With
  // one level (a flat format) there are no games, so fall back to the point count.
  const setLevel = format.levels.length > 1 ? 1 : 0;
  const gs = state.score[setLevel] ?? [0, 0];
  const gamesPlayed = setLevel === 0 ? 0 : gs[0] + gs[1];
  const ownTurn = Math.floor(gamesPlayed / 2);
  const start = (side === 'A' ? nom?.A : nom?.B) ?? 0;
  const server = people[(start + ownTurn) % people.length];
  return { server, receiver: null, courtHalf: state.serve.courtHalf };
}

/**
 * SQUASH. The server chooses a box at the start of a game and at each new hand, then
 * alternates while that hand continues. Doubles under modern PARS alternates partners
 * on each side-out; the kernel's handAlternate court model supplies the box.
 */
function squashHandOut(state: KernelState, pair: Pairing): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const half = state.serve.courtHalf;
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: pair[other(side)][0] ?? null, courtHalf: half };
  const server = people[Math.min(state.serve.serverNo, people.length) - 1];
  return { server, receiver: null, courtHalf: half };
}

export type ResolverFn = (
  state: KernelState,
  pair: Pairing,
  format: ScoringFormat,
  nom?: ServeNomination,
) => ResolvedServer;

export const SERVE_RESOLVER_IMPLS: Record<ServeResolverId, ResolverFn> = {
  none: (s, p) => ({ server: p[s.serve.side][0] ?? null, receiver: null, courtHalf: null }),
  bwfSingleServer: (s, p) => bwfSingleServer(s, p),
  classicTwoServer: (s, p) => classicTwoServer(s, p),
  pickleballTwoServer: (s, p) => pickleballTwoServer(s, p),
  ttPairCycle: (s, p, f) => ttPairCycle(s, p, f),
  tennisGameLocked: (s, p, f, n) => tennisGameLocked(s, p, f, n),
  squashHandOut: (s, p) => squashHandOut(s, p),
};

/**
 * Who is expected to serve the next rally. "Expected" is deliberate: the console
 * DISPLAYS this and records a human's ruling, it never adjudicates. If the wrong
 * partner served, the umpire corrects it and the points stand.
 */
export function resolveServer(
  format: ScoringFormat,
  state: KernelState,
  pair: Pairing,
  nom?: ServeNomination,
): ResolvedServer {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const spec = serveSpecFor(format, lv);
  const impl = SERVE_RESOLVER_IMPLS[spec.resolver] ?? SERVE_RESOLVER_IMPLS.none;
  return impl(state, pair, format, nom);
}

/**
 * The umpire's call, rendered per sport. Three numbers in pickleball side-out
 * ("5-3-2"), two in rally scoring, and the third omitted in singles. One registry
 * slot serves pickleball, squash's hand-out call and tennis alike.
 */
export function serveCall(format: ScoringFormat, state: KernelState, doubles: boolean): string {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const spec = serveSpecFor(format, lv);
  const [a, b] = state.score[state.pointLevel];
  const srv = state.serve.side;
  // The serving side's score is called first - that is the convention in every one
  // of these sports, and getting it backwards is the commonest courtside complaint.
  const first = srv === 'A' ? a : b;
  const second = srv === 'A' ? b : a;
  if (spec.movement === 'handOut' && doubles) return `${first}-${second}-${state.serve.serverNo}`;
  if (spec.pointScoring === 'serverOnly') return `${first}-${second}`;
  const labels = lv.pointLabels;
  if (labels) {
    const lbl = (n: number) => labels[Math.min(n, labels.length - 1)] ?? String(n);
    return `${lbl(first)}-${lbl(second)}`;
  }
  return `${first}-${second}`;
}
