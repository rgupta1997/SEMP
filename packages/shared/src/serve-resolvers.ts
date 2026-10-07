import type { LevelSpec, ScoringFormat, ServeResolverId, ServeSpec, Side } from './scoring-rules.js';
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

/**
 * The format as it applies to who is actually on court. Side-out formats are written
 * for doubles (server 1, server 2, the 0-0-2 opening); in singles there is one server,
 * so the serve crosses on the first lost rally. Unchanged for doubles or no pairing.
 */
export function formatForPairing(format: ScoringFormat, pairing?: Pairing | null): ScoringFormat {
  if (!pairing || pairing.A.length > 1 || pairing.B.length > 1) return format;
  const one = (s?: ServeSpec): ServeSpec | undefined =>
    s && s.movement === 'handOut' && (s.serversPerSide ?? 2) > 1 ? { ...s, serversPerSide: 1, firstTurnSingle: false } : s;
  const level = (l: LevelSpec): LevelSpec => ({
    ...l,
    ...(l.serve ? { serve: one(l.serve) } : {}),
    ...(l.substitute ? { substitute: { ...l.substitute, spec: level(l.substitute.spec) } } : {}),
    ...(l.deciderOverride?.serve ? { deciderOverride: { ...l.deciderOverride, serve: one(l.deciderOverride.serve) } } : {}),
  });
  const touched = [format.serve, ...format.levels.flatMap((l) => [l.serve, l.substitute?.spec.serve, l.deciderOverride?.serve])]
    .some((s) => s && one(s) !== s);
  return touched ? { ...format, serve: one(format.serve)!, levels: format.levels.map(level) } : format;
}
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/**
 * BADMINTON, BWF 21-point. One server per side. The service court comes from the
 * SERVING side's score parity - even is right, odd is left - and the two partners
 * swap places only when their own side wins a point on its own serve. So the same
 * score can name either partner depending on history: the kernel keeps each pair's
 * courts in `serve.pairFlip`, flipped on every point a pair wins on its own serve.
 */
function bwfSingleServer(state: KernelState, pair: Pairing): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const half = state.serve.courtHalf;
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: null, courtHalf: half };
  // At 0-0 the first-listed player of each pair stands in the right court.
  const inCourt = (s: Side, h: 'right' | 'left' | null) => {
    const flip = state.serve.pairFlip?.[s] ? 1 : 0;
    return pair[s][((h === 'left' ? 1 : 0) + flip) % 2] ?? null;
  };
  const server = inCourt(side, half);
  // The receiver is the opponent in the diagonally opposite court - the same-named one.
  const opp = pair[other(side)];
  const receiver = isDoubles(opp) ? inCourt(other(side), half) : (opp[0] ?? null);
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
 * PICKLEBALL. Partners swap courts only when their team scores on its own serve; the
 * kernel keeps each pair's courts in `serve.pairFlip`. At 0-0 the first-listed player
 * of each pair stands in the right court.
 *
 * Side-out: server 1 is whoever stood in the right court when the serve came over
 * (`serve.turnLead`), serving from wherever they now stand; server 2 is the partner,
 * from their own court. The 0-0-2 opening is the right-court player.
 * Rally scoring: one server per turn, from the court the score names - even right,
 * odd left - so the server is whoever stands there (the badminton model).
 */
function pickleballTwoServer(state: KernelState, pair: Pairing, format: ScoringFormat): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const opp = pair[other(side)];
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: null, courtHalf: state.serve.courtHalf };
  const flip = (s: Side) => (state.serve.pairFlip?.[s] ? 1 : 0);
  const courtOf = (s: Side, i: number): 'right' | 'left' => (i === flip(s) ? 'right' : 'left');
  const inCourt = (s: Side, h: 'right' | 'left') => pair[s][((h === 'left' ? 1 : 0) + flip(s)) % 2] ?? null;

  const spec = serveSpecFor(format, effectiveLevel(format, state, state.pointLevel));
  let serverIdx: number;
  if (spec.movement === 'handOut') {
    const lead = state.serve.turnLead ?? 0;
    // The opening "server 2" is the right-court player, i.e. the lead.
    serverIdx = state.serve.serverNo === 1 || state.serve.openingTurn ? lead : 1 - lead;
  } else {
    serverIdx = ((state.serve.courtHalf === 'left' ? 1 : 0) + flip(side)) % 2;
  }
  const half = courtOf(side, serverIdx);
  // The receiver stands diagonally opposite: the same-named court on the other side.
  const receiver = isDoubles(opp) ? inCourt(other(side), half) : (opp[0] ?? null);
  return { server: people[serverIdx] ?? null, receiver, courtHalf: half };
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
  // Which serving turn we are in, counted by the kernel as the serve changes hands -
  // so the one-serve-each phase (10-10, expedite) keeps the rotation, which dividing
  // points by the base `every` did not. Both sides alternate, so a side's own turn is half.
  // A flipped side starts from its second-listed partner (a new first server, or the
  // decider's switch at 5); the cycle and "receiver serves next" are unchanged.
  const flip = (s: Side) => (state.serve.pairFlip?.[s] ? 1 : 0);
  const ownBlock = Math.floor(state.serve.turns / 2);
  const server = people[(ownBlock + flip(side)) % 2];
  const opp = pair[other(side)];
  // The receiver is the NEXT turn's server (A1 > B1 > A2 > B2): the other side's
  // player at the next turn's block.
  const nextBlock = Math.floor((state.serve.turns + 1) / 2);
  const receiver = isDoubles(opp) ? opp[(nextBlock + flip(other(side))) % 2] : (opp[0] ?? null);
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
  // one level (a flat format) there are no games, so fall back to the point count. A
  // match tie-break played as the deciding set has no games either - its score IS points.
  const setLevel = format.levels.length > 1 ? 1 : 0;
  const gs = state.score[setLevel] ?? [0, 0];
  const gamesPlayed = setLevel === 0 || state.pointLevel > 0 ? 0 : gs[0] + gs[1];
  // Inside a tie-break the rotation carries on by serving TURN (one serve, then two):
  // a1, b1-b1, a2-a2, b2-b2... `turns` is 0 in an ordinary game, so this adds nothing there.
  const ownTurn = Math.floor(gamesPlayed / 2) + Math.floor(state.serve.turns / 2);
  const start = (side === 'A' ? nom?.A : nom?.B) ?? 0;
  const server = people[(start + ownTurn) % people.length];
  // Each receiving pair keeps one player in the deuce (right) court for the whole set,
  // so the receiver is whoever stands in the court this point is served to.
  const rec = other(side);
  const opp = pair[rec];
  const deuce = state.serve.receiveFlip?.[rec] ? 1 : 0;
  const receiver = isDoubles(opp)
    ? opp[state.serve.courtHalf === 'left' ? 1 - deuce : deuce] ?? null
    : (opp[0] ?? null);
  return { server, receiver, courtHalf: state.serve.courtHalf };
}

/**
 * SQUASH. The server chooses a box at the start of a game and at each new hand, then
 * alternates while that hand continues; the kernel's handAlternate court model supplies
 * the box.
 *
 * Doubles (WSF Doubles Rules 2022, 5.2-5.8): the serving order is fixed for the match
 * and rotates A1 -> B1 -> A2 -> B2, passing at every hand-out (`serve.turns`). Each game
 * opens with the team's nominated first server; `pairFlip` is the scorer's choice of the
 * other partner. Receivers keep a side: one partner receives on the right, the other on
 * the left (`receiveFlip`), and a serve from one box is received on the opposite side.
 */
function squashHandOut(state: KernelState, pair: Pairing): ResolvedServer {
  const side = state.serve.side;
  const people = pair[side];
  const half = state.serve.courtHalf;
  const rec = other(side);
  const opp = pair[rec];
  if (!isDoubles(people)) return { server: people[0] ?? null, receiver: opp[0] ?? null, courtHalf: half };
  // Hands this team has served in the game so far: the side that served first has the
  // even turns, the other the odd ones - each side's own count is half the total.
  const ownHand = Math.floor(state.serve.turns / 2);
  const lead = state.serve.pairFlip?.[side] ? 1 : 0;
  const server = people[(lead + ownHand) % 2] ?? null;
  // A serve from the right box goes to the left side, and from the left to the right.
  const rightReceiver = state.serve.receiveFlip?.[rec] ? 1 : 0;
  const receiver = isDoubles(opp)
    ? opp[half === 'right' ? 1 - rightReceiver : rightReceiver] ?? null
    : (opp[0] ?? null);
  return { server, receiver, courtHalf: half };
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
  pickleballTwoServer: (s, p, f) => pickleballTwoServer(s, p, f),
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
    // Tennis says the words at 40-40 and beyond: "Deuce", "Ad in" (server ahead), "Ad out".
    // No-ad scoring has no advantage - 40-40 is the deciding point.
    const fortyAt = labels.indexOf('40');
    if (fortyAt >= 0 && first >= fortyAt && second >= fortyAt) {
      if (first === second) return lv.winBy <= 1 ? 'Deciding point' : 'Deuce';
      return first > second ? 'Ad in' : 'Ad out';
    }
    const lbl = (n: number) => labels[Math.min(n, labels.length - 1)] ?? String(n);
    return `${lbl(first)}-${lbl(second)}`;
  }
  return `${first}-${second}`;
}
