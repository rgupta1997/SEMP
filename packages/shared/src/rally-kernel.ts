import type {
  EndReason, LevelSpec, Outcome, ScoringFormat, ServeSpec, Side,
} from './scoring-rules.js';

// ============================================================================
// The rally kernel.
//
// STATE IS A FOLD OVER AN APPEND-ONLY LOG. Not mutable counters. Every one of the
// five racquet sports demanded this independently, for the same three reasons:
//
//   1. undo has to restore the SERVE, the server number and the court positions -
//      not just the two numbers. Truncate the log and re-fold and it does.
//   2. a match resumes after a power cut / hall handover from an exact state.
//   3. a referee correction that contradicts the engine's own model is an entry
//      with an author and a reason, never a silent mutation.
//
// The kernel is also PURE and OWNS NO CLOCK. The console owns wall time and sends
// a `capFired` event; the kernel applies the configured resolution. A reducer that
// reads Date.now() cannot be re-folded, and re-folding is the whole design.
// ============================================================================

export type Pair = [number, number];
const idx = (s: Side) => (s === 'A' ? 0 : 1);
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

// ---- the log ---------------------------------------------------------------

export type RallyEvent =
  /**
   * A rally was won. NOT "this side scored" - under serverOnly scoring the receiver
   * winning a rally takes the serve and no point.
   *
   * `pts` carries a MAGNITUDE, because outside the racquet family one action is not
   * worth one point: a basket is 1, 2 or 3, and a super tackle is 2. Defaults to 1.
   *
   * The attribution fields are carried but never READ by the kernel - scoring does
   * not depend on who did it. They ride along so ONE log holds both the score and
   * the facts, which is what lets fixture_events be written from it.
   */
  | {
    t: 'point'; side: Side; pts?: number; at?: string;
    /** The acting person, as a real user id. */
    playerId?: string; playerName?: string;
    /** The second person, where the action has one (an assist, a fielder). */
    secondId?: string; secondName?: string;
    /** Which declared action this was - 'goal', 'raid', 'fg3'. */
    kind?: string; label?: string;
    /** A magnitude the metric sums, where it differs from the points scored. */
    value?: number;
  }
  /** Replayed rally: no score, no serve movement. */
  | { t: 'let'; at?: string }
  /** A service fault. Tennis needs it natively (two serves); elsewhere it is a stat. */
  | { t: 'fault'; side: Side; at?: string }
  /** Conduct point awarded from outside the rally stream. Advances the serve clock. */
  | { t: 'penalty'; side: Side; reason?: string; by?: string; at?: string }
  /** Award the serve without a rally (badminton red card). */
  | { t: 'awardServe'; side: Side; reason?: string; by?: string; at?: string }
  /** Force the current unit to a side regardless of the tally. */
  | { t: 'awardUnit'; side: Side; reason?: string; by?: string; at?: string }
  /** Minus-one and friends. `preserveServe` leaves the serve untouched (pickleball
   *  technical foul: a point that changes nothing else). */
  | { t: 'adjust'; side: Side; delta: number; preserveServe?: boolean; reason?: string; by?: string; at?: string }
  /** Hand the serve over / fix the server number after a mis-scored rally. */
  | { t: 'setServe'; side: Side; serverNo?: number; reason?: string; by?: string; at?: string }
  /** The console's buzzer. The kernel applies the format's cap resolution. */
  | { t: 'capFired'; at?: string }
  /**
   * THE WHISTLE. A clock-terminated period is over; tally what was scored.
   *
   * Separate from `capFired`, which is a whole-match time cap with a resolution
   * policy. This is the ordinary end of a half or a quarter, and the kernel cannot
   * infer it because it owns no clock.
   */
  | { t: 'endPeriod'; reason?: string; by?: string; at?: string }
  /** Terminal, out-of-band: retirement, walkover, override. */
  | { t: 'end'; outcome: Outcome; reason: EndReason; winner?: Side | null; by?: string; at?: string };

export type RallyLog = RallyEvent[];

// ---- state -----------------------------------------------------------------

export interface ServeState {
  side: Side;
  /** 1 or 2 under handOut movement; always 1 otherwise. */
  serverNo: number;
  /** Points served in the current turn (everyN movement). */
  turnCount: number;
  /** Which side served the first point of the current innermost unit. */
  unitFirstServer: Side;
  /** Right / left service court, or null where the sport has none. */
  courtHalf: 'right' | 'left' | null;
  /** True while this side's opening turn of the unit is the single-server one. */
  openingTurn: boolean;
}

export interface FinishedUnit {
  level: number;
  key: string;
  label: string;
  score: Pair;
  winner: Side;
  /** Awarded rather than played out (conduct, retirement completion, cap). */
  awarded?: boolean;
}

export interface KernelState {
  /** One entry per level, innermost first. score[0] is raw points in the current unit. */
  score: Pair[];
  /** Points played in the current innermost unit. Drives the everyN serve rhythm. */
  unitPoints: number;
  /** Points played in the whole match. */
  totalPoints: number;
  serve: ServeState;
  finished: FinishedUnit[];
  ended: boolean;
  outcome: Outcome | null;
  winner: Side | null;
  reason: EndReason | null;
  /** Set on the point that triggers a change of ends; the console shows it once. */
  switchEnds: boolean;
  capFired: boolean;
  /** The level raw points currently land on. >0 when a collapsed decider is running. */
  pointLevel: number;
}

/** What one event did, for the console timeline and the stat fold. */
export interface StepEffect {
  event: RallyEvent;
  /** Who served the rally this event describes (before the serve moved). */
  serverSide: Side | null;
  serverNo: number;
  /** Who the point went to. null when the rally scored nothing (serverOnly side-out). */
  scored: Side | null;
  /** Units completed by this event, innermost first. */
  unitsWon: FinishedUnit[];
  /** The rally was played at or past the effective level's advantage threshold. */
  atDeuce: boolean;
  /** The unit in progress was the decider of its parent. */
  inDecider: boolean;
  switchEnds: boolean;
  ended: boolean;
}

// ---- effective configuration ----------------------------------------------

/**
 * Resolve the level actually in force, applying (in order) the base spec, a
 * substituted unit, and the decider override. Recomputed per rally rather than
 * cached: it is cheap, and a cached copy is one more thing undo has to restore.
 */
export function effectiveLevel(format: ScoringFormat, state: KernelState, i: number): LevelSpec {
  const base = format.levels[i];
  if (!base) throw new Error(`No level at index ${i}`);
  const parent = format.levels[i + 1];
  const parentScore = state.score[i + 1];
  let spec: LevelSpec = base;

  // Substitution beats the base: at 6-6 the next "game" is a tie-break, with its own
  // target, margin and serve rhythm.
  if (parent?.substitute && parentScore) {
    const at = parent.substitute.atUnits;
    if (parentScore[0] >= at && parentScore[1] >= at) spec = parent.substitute.spec;
  }

  // Decider: the parent is one unit from over for BOTH sides.
  if (parent && parentScore && spec.deciderOverride) {
    const need = parent.target - 1;
    if (parentScore[0] === need && parentScore[1] === need) {
      const o = spec.deciderOverride;
      spec = {
        ...spec,
        target: o.target ?? spec.target,
        winBy: o.winBy ?? spec.winBy,
        cap: o.cap !== undefined ? o.cap : spec.cap,
        switchEndsAt: o.switchEndsAt !== undefined ? o.switchEndsAt : spec.switchEndsAt,
        startingScore: o.startingScore ?? spec.startingScore,
        serve: o.serve ?? spec.serve,
        pointLabels: o.pointLabels === null ? undefined : (o.pointLabels ?? spec.pointLabels),
      };
    }
  }
  return spec;
}

/** True when level i is currently running as a collapsed decider (a match tie-break). */
function isCollapsed(format: ScoringFormat, state: KernelState, i: number): boolean {
  const lv = format.levels[i];
  const parent = format.levels[i + 1];
  const parentScore = state.score[i + 1];
  if (!lv?.deciderOverride?.collapsed || !parent || !parentScore) return false;
  const need = parent.target - 1;
  return parentScore[0] === need && parentScore[1] === need;
}

/**
 * The level raw points land on. Normally 0; a collapsed decider (10-point match
 * tie-break played instead of a final set) pulls it up and makes the levels below inert.
 */
export function activePointLevel(format: ScoringFormat, state: KernelState): number {
  for (let i = format.levels.length - 1; i > 0; i--) {
    if (isCollapsed(format, state, i)) return i;
  }
  return 0;
}

export function serveSpecFor(format: ScoringFormat, level: LevelSpec): ServeSpec {
  return level.serve ?? format.serve;
}

// ---- unit resolution -------------------------------------------------------

/**
 * Cap first (margin irrelevant), then target plus margin.
 *
 * A CLOCK-terminated unit never returns a winner from the score: a football half
 * is not over at 4-0, it is over when the whistle goes. It ends on an `endPeriod`
 * event instead.
 */
export function unitWinner(spec: LevelSpec, score: Pair): Side | null {
  if (spec.terminator === 'clock') return null;
  const [a, b] = score;
  if (spec.cap !== null && spec.cap !== undefined) {
    if (a >= spec.cap) return 'A';
    if (b >= spec.cap) return 'B';
  }
  if (a >= spec.target && a - b >= spec.winBy) return 'A';
  if (b >= spec.target && b - a >= spec.winBy) return 'B';
  return null;
}

/**
 * Total score across every unit at the innermost level, plus the one in progress.
 *
 * This is the headline for an AGGREGATE sport. Football is 2-1 on goals; nobody
 * reports it as "one half each", which is what a units-decided level would say.
 */
export function aggregateScore(state: KernelState): Pair {
  const total: Pair = [0, 0];
  for (const u of state.finished) {
    if (u.level !== 0) continue;
    total[0] += u.score[0];
    total[1] += u.score[1];
  }
  total[0] += state.score[0][0];
  total[1] += state.score[0][1];
  return total;
}

/** True when the outermost level is decided by total score rather than units won. */
export function isAggregate(format: ScoringFormat): boolean {
  return format.levels[format.levels.length - 1]?.decide === 'aggregate';
}

/** Units at the innermost level that have been completed. */
export function periodsPlayed(state: KernelState): number {
  return state.finished.filter((u) => u.level === 0).length;
}

/** At or past the point where the margin rule bites - "deuce", by any sport's name. */
export function atAdvantage(spec: LevelSpec, score: Pair): boolean {
  if (spec.winBy <= 1) return false;
  const floor = spec.target - 1;
  return score[0] >= floor && score[1] >= floor;
}

// ---- init ------------------------------------------------------------------

export function initKernel(format: ScoringFormat, firstServer: Side = 'A'): KernelState {
  const score: Pair[] = format.levels.map((lv, i) =>
    (i === 0 && lv.startingScore ? [...lv.startingScore] as Pair : [0, 0] as Pair));
  const serve = serveSpecFor(format, format.levels[0]);
  return {
    score,
    unitPoints: 0,
    totalPoints: 0,
    serve: {
      side: firstServer,
      serverNo: serveOpeningServerNo(serve),
      turnCount: 0,
      unitFirstServer: firstServer,
      courtHalf: serve.courtModel === 'none' ? null : 'right',
      openingTurn: opensSpecially(serve),
    },
    finished: [],
    ended: false,
    outcome: null,
    winner: null,
    reason: null,
    switchEnds: false,
    capFired: false,
    pointLevel: 0,
  };
}

// Pickleball's 0-0-2: the first serving team of a game gets ONE server, so the call
// opens on server 2. Get this wrong and the opening side receives a free extra
// service turn in every single game.
function serveOpeningServerNo(spec: ServeSpec): number {
  if (spec.movement !== 'handOut') return 1;
  return spec.firstTurnSingle ? (spec.serversPerSide ?? 2) : 1;
}

// True when a unit's FIRST serving turn differs from every later one: pickleball's
// single opening server, or the tennis tie-break's single opening serve.
function opensSpecially(spec: ServeSpec): boolean {
  return !!(spec.firstTurnSingle || spec.firstTurnEvery);
}

const clone = (s: KernelState): KernelState => ({
  ...s,
  score: s.score.map((p) => [p[0], p[1]] as Pair),
  serve: { ...s.serve },
  finished: [...s.finished],
});

// ---- serve movement --------------------------------------------------------

/** `every` collapses to one-serve-each once BOTH sides reach `collapseAt`. */
function effectiveEvery(spec: ServeSpec, score: Pair): number {
  const at = spec.collapseAt;
  if (at != null && score[0] >= at && score[1] >= at) return spec.collapseEvery ?? 1;
  return spec.every ?? 2;
}

function courtHalfFor(spec: ServeSpec, state: KernelState, pointScore: Pair): 'right' | 'left' | null {
  switch (spec.courtModel) {
    case 'none': return null;
    case 'fixed': return 'right';
    case 'parity': {
      // The SERVING side's score decides: even -> right, odd -> left. Under handOut
      // the second server stands on the opposite court to the one parity names,
      // because partners do not change places when they lose a rally.
      const own = pointScore[idx(state.serve.side)];
      const right = own % 2 === 0;
      const flip = spec.movement === 'handOut' && state.serve.serverNo === 2;
      return (right !== flip) ? 'right' : 'left';
    }
    case 'handAlternate':
      // Squash: the server picks a box at each new hand, then alternates while the
      // hand continues. Modelled as alternating on points served in this turn.
      return state.serve.turnCount % 2 === 0 ? 'right' : 'left';
    default: return null;
  }
}

/** Move the serve after a rally. `rallyWinner` won it; `scored` says if a point landed. */
function moveServe(spec: ServeSpec, state: KernelState, rallyWinner: Side, scored: boolean): void {
  const sv = state.serve;
  switch (spec.movement) {
    case 'rallyWinner':
      if (sv.side !== rallyWinner) { sv.side = rallyWinner; sv.turnCount = 0; }
      else sv.turnCount += 1;
      break;
    case 'everyN': {
      sv.turnCount += 1;
      // The tennis tie-break opens with a single serve, then runs in twos. Tracked on
      // `openingTurn` so it survives undo rather than being inferred from the score.
      const every = sv.openingTurn && spec.firstTurnEvery
        ? spec.firstTurnEvery
        : effectiveEvery(spec, state.score[state.pointLevel]);
      if (sv.turnCount >= every) {
        sv.side = other(sv.side);
        sv.turnCount = 0;
        sv.openingTurn = false;
      }
      break;
    }
    case 'perUnit':
      // The serve is locked for the whole unit; it changes when the unit ends.
      sv.turnCount += 1;
      break;
    case 'handOut': {
      if (rallyWinner === sv.side) { sv.turnCount += 1; break; }
      // The serving side lost: advance to server #2, then hand over.
      const perSide = sv.openingTurn ? 1 : (spec.serversPerSide ?? 2);
      if (sv.serverNo < perSide) {
        sv.serverNo += 1;
      } else {
        sv.side = other(sv.side);
        sv.serverNo = 1;
        sv.openingTurn = false;
      }
      sv.turnCount = 0;
      break;
    }
    case 'none':
    default:
      break;
  }
  void scored;
}

/** Who serves the first point of the next unit. */
function serveForNextUnit(spec: ServeSpec, state: KernelState, unitWinnerSide: Side): Side {
  switch (spec.nextUnitServer) {
    case 'alternate': return other(state.serve.unitFirstServer);
    case 'previousWinner': return unitWinnerSide;
    case 'previousLoser': return other(unitWinnerSide);
    case 'subUnitFirstServerReceives': return other(state.serve.unitFirstServer);
    case 'continue':
    default: return state.serve.side;
  }
}

function resetForNewUnit(format: ScoringFormat, state: KernelState, unitWinnerSide: Side): void {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const spec = serveSpecFor(format, lv);
  const next = serveForNextUnit(spec, state, unitWinnerSide);
  state.serve = {
    side: next,
    serverNo: serveOpeningServerNo(spec),
    turnCount: 0,
    unitFirstServer: next,
    courtHalf: spec.courtModel === 'none' ? null : 'right',
    openingTurn: opensSpecially(spec),
  };
  state.unitPoints = 0;
}

// ---- the cascade -----------------------------------------------------------

/**
 * Settle completed units from `from` upward. Winning a unit increments the level
 * above and resets everything below it; the outermost level ending IS the match
 * ending. Returns the units settled, innermost first.
 */
function cascade(format: ScoringFormat, state: KernelState, from: number, forced?: Side): FinishedUnit[] {
  const won: FinishedUnit[] = [];
  let i = from;
  for (;;) {
    const spec = effectiveLevel(format, state, i);
    const w = (i === from && forced) ? forced : unitWinner(spec, state.score[i]);
    if (!w) break;

    const unit: FinishedUnit = {
      level: i, key: spec.key, label: spec.label,
      score: [state.score[i][0], state.score[i][1]],
      winner: w,
      ...(i === from && forced ? { awarded: true } : {}),
    };
    won.push(unit);
    state.finished.push(unit);

    const isOutermost = i === format.levels.length - 1;
    if (isOutermost) {
      state.ended = true;
      state.outcome = 'win';
      state.winner = w;
      state.reason = state.reason ?? 'normal';
      return won;
    }

    state.score[i + 1][idx(w)] += 1;
    // Reset this level and everything under it, honouring any handicap start.
    for (let j = 0; j <= i; j++) {
      const lj = format.levels[j];
      state.score[j] = (j === 0 && lj.startingScore ? [...lj.startingScore] as Pair : [0, 0]);
    }
    state.pointLevel = activePointLevel(format, state);
    // A collapsed decider resets its own score too - it is now the point level.
    if (state.pointLevel > 0) state.score[state.pointLevel] = [0, 0];
    resetForNewUnit(format, state, w);
    i += 1;
  }
  return won;
}

// ---- change of ends --------------------------------------------------------

function shouldSwitchEnds(
  format: ScoringFormat, state: KernelState, spec: LevelSpec, before: Pair, inDecider: boolean,
): boolean {
  const after = state.score[state.pointLevel];
  switch (format.changeEnds) {
    case 'never':
    case 'betweenUnits':
      return false;
    case 'everyNPoints': {
      const n = format.changeEndsAt ?? 6;
      const total = after[0] + after[1];
      return total > 0 && total % n === 0;
    }
    case 'oddCumulativeUnits':
      return false; // settled at unit boundaries, not mid-unit
    case 'atDeciderMidpoint': {
      // The rule is decider-only, in badminton and volleyball alike. Nothing happens
      // at 11-x in games 1 and 2 - which is exactly the drift the reference engine's
      // README got wrong, so it is asserted in the tests.
      if (!inDecider) return false;
      const at = spec.switchEndsAt ?? null;
      if (at == null) return false;
      // Fires once: the moment the leader first LANDS on `at` while the other side is
      // still below it. Comparing against the pre-point score is what makes it once.
      const hi = Math.max(after[0], after[1]);
      const lo = Math.min(after[0], after[1]);
      const hiBefore = Math.max(before[0], before[1]);
      return hi === at && lo < at && hiBefore < at;
    }
    default:
      return false;
  }
}

// ---- step ------------------------------------------------------------------

/** Apply one event. Pure: returns a new state and a description of what happened. */
export function step(format: ScoringFormat, prev: KernelState, ev: RallyEvent): { state: KernelState; effect: StepEffect } {
  const state = clone(prev);
  const serverSide = state.serve.side;
  const serverNo = state.serve.serverNo;
  const base: StepEffect = {
    event: ev, serverSide, serverNo, scored: null, unitsWon: [],
    atDeuce: false, inDecider: false, switchEnds: false, ended: state.ended,
  };
  state.switchEnds = false;

  // A finished match rejects everything except an explicit correction or re-end.
  if (state.ended && ev.t !== 'end' && ev.t !== 'adjust' && ev.t !== 'awardUnit') {
    return { state: prev, effect: base };
  }

  const lv = effectiveLevel(format, state, state.pointLevel);
  const spec = serveSpecFor(format, lv);
  const before: Pair = [...state.score[state.pointLevel]] as Pair;
  base.atDeuce = atAdvantage(lv, before);
  base.inDecider = isDecider(format, state, state.pointLevel);

  switch (ev.t) {
    case 'let':
    case 'fault':
      // Neither scores nor moves the serve. Recorded for the timeline and the stats.
      return { state, effect: base };

    case 'point': {
      const rallyWinner = ev.side;
      const scores = spec.pointScoring === 'rally' || rallyWinner === state.serve.side;
      if (scores) {
        // A magnitude, not always one: a three-pointer is one action worth three.
        state.score[state.pointLevel][idx(rallyWinner)] += Math.max(1, ev.pts ?? 1);
        state.unitPoints += 1;
        state.totalPoints += 1;
        base.scored = rallyWinner;
      }
      moveServe(spec, state, rallyWinner, scores);
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      if (scores) {
        base.switchEnds = shouldSwitchEnds(format, state, lv, before, base.inDecider);
        state.switchEnds = base.switchEnds;
        base.unitsWon = cascade(format, state, state.pointLevel);
      }
      break;
    }

    case 'penalty': {
      // A conduct point behaves exactly like a rallied point for the score and the
      // serve clock - it can trigger deuce, the change of ends and the unit end.
      if (format.penaltyEvents === 'off') return { state: prev, effect: base };
      state.score[state.pointLevel][idx(ev.side)] += 1;
      state.unitPoints += 1;
      state.totalPoints += 1;
      base.scored = ev.side;
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      base.switchEnds = shouldSwitchEnds(format, state, lv, before, base.inDecider);
      state.switchEnds = base.switchEnds;
      base.unitsWon = cascade(format, state, state.pointLevel);
      break;
    }

    case 'awardServe':
      state.serve.side = ev.side;
      state.serve.serverNo = 1;
      state.serve.turnCount = 0;
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      break;

    case 'setServe':
      state.serve.side = ev.side;
      state.serve.serverNo = ev.serverNo ?? 1;
      state.serve.turnCount = 0;
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      break;

    case 'adjust': {
      const i = idx(ev.side);
      const at = state.pointLevel;
      state.score[at][i] = Math.max(0, state.score[at][i] + ev.delta);
      if (!ev.preserveServe) {
        state.serve.courtHalf = courtHalfFor(spec, state, state.score[at]);
      }
      // A correction can complete a unit (or un-complete one, which the log's
      // truncate-and-refold handles - this path only settles forward).
      base.unitsWon = cascade(format, state, at);
      break;
    }

    case 'awardUnit':
      base.unitsWon = cascade(format, state, state.pointLevel, ev.side);
      break;

    case 'capFired': {
      state.capFired = true;
      const res = applyCap(format, state);
      base.unitsWon = res.unitsWon;
      break;
    }

    case 'endPeriod': {
      // The whistle. Bank the period and, for an aggregate match, decide the match
      // once the last one has been played.
      base.unitsWon = endPeriod(format, state);
      break;
    }

    case 'end':
      state.ended = true;
      state.outcome = ev.outcome;
      state.winner = ev.winner ?? null;
      state.reason = ev.reason;
      break;
  }

  base.ended = state.ended;
  return { state, effect: base };
}

/** Is the unit in progress at level i the decider of its parent? */
export function isDecider(format: ScoringFormat, state: KernelState, i: number): boolean {
  const parent = format.levels[i + 1];
  const ps = state.score[i + 1];
  if (!parent || !ps) return false;
  const need = parent.target - 1;
  return ps[0] === need && ps[1] === need;
}

/**
 * End a clock-terminated period.
 *
 * For a UNITS level this behaves like any other unit ending: whoever leads takes
 * it (a level period goes to nobody, which the cascade handles by not awarding).
 *
 * For an AGGREGATE level the period is banked WITHOUT a winner - halves are not
 * won - and the match ends when `target` periods have been played, decided on the
 * running total. A level total is a draw where the format allows one; otherwise the
 * match stays open so extra time or a shoot-out can settle it, which is the honest
 * behaviour rather than inventing a winner.
 */
function endPeriod(format: ScoringFormat, state: KernelState): FinishedUnit[] {
  const at = state.pointLevel;
  const spec = effectiveLevel(format, state, at);
  const top = format.levels.length - 1;
  const topSpec = format.levels[top];
  const aggregate = topSpec?.decide === 'aggregate';
  const [a, b] = state.score[at];

  if (!aggregate) {
    // A units-decided clock period: the leader takes it, exactly as a target would.
    if (a === b) return [];
    return cascade(format, state, at, a > b ? 'A' : 'B');
  }

  const unit: FinishedUnit = {
    level: at,
    key: spec.key,
    label: spec.label,
    score: [a, b],
    // Nobody "wins" a half. The winner field is required, so it records who was
    // ahead in it - useful for a period-by-period breakdown, and never counted
    // toward the match, which is decided on the aggregate below.
    winner: a >= b ? 'A' : 'B',
  };
  state.finished.push(unit);

  // Reset for the next period and hand the ball/serve over.
  const lv = format.levels[0];
  state.score[at] = (lv.startingScore ? [...lv.startingScore] as Pair : [0, 0]);
  resetForNewUnit(format, state, unit.winner);

  const played = state.finished.filter((u) => u.level === 0).length;
  if (played < topSpec.target) return [unit];

  // Last period done: decide on the total.
  const total = aggregateScore(state);
  state.ended = true;
  state.reason = state.reason ?? 'normal';
  if (total[0] === total[1]) {
    if (format.endStates.drawsAllowed) {
      state.outcome = 'draw';
      state.winner = null;
    } else {
      // Level and no draw allowed: leave it open. Extra time, a shoot-out or an
      // official's decision settles it - the kernel must not pick a winner.
      state.ended = false;
      state.outcome = null;
      state.reason = null;
    }
  } else {
    state.outcome = 'win';
    state.winner = total[0] > total[1] ? 'A' : 'B';
  }
  return [unit];
}

// ---- the buzzer ------------------------------------------------------------

/**
 * The console owns wall time and tells us the cap fired; we apply the policy. Only
 * the resolutions that terminate immediately are settled here - `nextPointWins` and
 * `finishUnit` change how the NEXT points resolve and are read back by the console.
 */
function applyCap(format: ScoringFormat, state: KernelState): { unitsWon: FinishedUnit[] } {
  const clock = format.clock;
  if (!clock) return { unitsWon: [] };
  const at = state.pointLevel;
  const [a, b] = state.score[at];

  const settle = (): { unitsWon: FinishedUnit[] } => {
    if (a === b) {
      if (clock.tieRule === 'draw' && format.endStates.drawsAllowed) {
        state.ended = true; state.outcome = 'draw'; state.winner = null; state.reason = 'cap';
        return { unitsWon: [] };
      }
      // suddenDeathPoint / organiserDecides: play on. The console keeps scoring and
      // the next point settles it - which is why this returns without ending.
      return { unitsWon: [] };
    }
    const lead: Side = a > b ? 'A' : 'B';
    const units = cascade(format, state, at, lead);
    if (!state.ended) { state.ended = true; state.outcome = 'win'; state.winner = lead; }
    state.reason = 'cap';
    return { unitsWon: units };
  };

  switch (clock.action) {
    case 'leaderWins':
    case 'stopImmediately':
    case 'finishPointThenLeader':
      return settle();
    case 'nextPointWins':
    case 'finishUnit':
    default:
      return { unitsWon: [] };
  }
}

// ---- fold ------------------------------------------------------------------

export interface FoldResult {
  state: KernelState;
  /** One entry per event, in order. The stat module folds this; the console renders it. */
  trace: StepEffect[];
}

export function foldRally(format: ScoringFormat, log: RallyLog, firstServer: Side = 'A'): FoldResult {
  let state = initKernel(format, firstServer);
  const trace: StepEffect[] = [];
  for (const ev of log) {
    const r = step(format, state, ev);
    state = r.state;
    trace.push(r.effect);
  }
  return { state, trace };
}

/** Undo is truncate-and-refold. Nothing else restores the serve as well as this. */
export function undo(format: ScoringFormat, log: RallyLog, firstServer: Side = 'A'): { log: RallyLog; state: KernelState } {
  const next = log.slice(0, -1);
  return { log: next, state: foldRally(format, next, firstServer).state };
}

// ---- headline --------------------------------------------------------------

/**
 * The two numbers persisted as home_score / away_score. Standings and records read
 * only these, so the kernel's contract to the rest of the platform is exactly this
 * pair plus the result envelope below.
 */
export function headline(format: ScoringFormat, state: KernelState): Pair {
  const top = format.levels.length - 1;
  // An AGGREGATE match reports the TOTAL. Football is 2-1 on goals; reporting units
  // won would say "1-1" for a match somebody clearly won, and standings read this
  // pair - so getting it wrong here would publish the wrong result.
  if (format.levels[top]?.decide === 'aggregate') return aggregateScore(state);
  // A single-unit match ("one game to 21") has no meaningful unit count - the points
  // ARE the headline. Anything longer reports units won.
  if (format.levels[top].target <= 1 && top > 0) return [...state.score[0]] as Pair;
  if (top === 0) return [...state.score[0]] as Pair;
  return [...state.score[top]] as Pair;
}

export interface ResultEnvelope {
  outcome: Outcome | null;
  winner: Side | null;
  reason: EndReason | null;
  headline: Pair;
  /** Per-unit scores at the innermost level, in order - "11-7, 9-11, 11-6". */
  unitScores: Pair[];
  unitsFor: Pair;
  pointsFor: Pair;
  ended: boolean;
}

export function resultEnvelope(format: ScoringFormat, state: KernelState): ResultEnvelope {
  const inner = state.finished.filter((u) => u.level === 0);
  const pointsFor: Pair = [0, 0];
  for (const u of inner) { pointsFor[0] += u.score[0]; pointsFor[1] += u.score[1]; }
  pointsFor[0] += state.score[0][0];
  pointsFor[1] += state.score[0][1];
  const top = format.levels.length - 1;
  return {
    outcome: state.outcome,
    winner: state.winner,
    reason: state.reason,
    headline: headline(format, state),
    unitScores: inner.map((u) => u.score),
    // An aggregate level counts periods played, not units won - nobody wins a half.
    unitsFor: format.levels[top]?.decide === 'aggregate'
      ? [periodsPlayed(state), periodsPlayed(state)]
      : top > 0 ? ([...state.score[top]] as Pair) : [0, 0],
    pointsFor,
    ended: state.ended,
  };
}
