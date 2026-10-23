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
    /**
     * WHERE IN THE MATCH THIS HAPPENED - milliseconds elapsed on the match clock of
     * the period it was recorded in, stamped once at the moment of the tap.
     *
     * Stored rather than derived because the clock can be CORRECTED afterwards, and
     * a goal that went in on 23 minutes stays a 23rd-minute goal however the clock
     * is fixed later. Milliseconds rather than whole minutes so the console can
     * decide how to round; the log prints it as 23'.
     */
    clockMs?: number;
    /** The acting person, as a real user id. */
    playerId?: string; playerName?: string;
    /** The second person, where the action has one (an assist, a fielder). */
    secondId?: string; secondName?: string;
    /** Which declared action this was - 'goal', 'raid', 'fg3'. */
    kind?: string; label?: string;
    /** A magnitude the metric sums, where it differs from the points scored. */
    value?: number;
    /** Circumstances a metric can key on - kabaddi's 'dod' (a do-or-die raid). */
    flags?: string[];
  }
  /** Replayed rally: no score, no serve movement. */
  | { t: 'let'; at?: string }
  /** A service fault. Tennis needs it natively (two serves); elsewhere it is a stat. */
  | { t: 'fault'; side: Side; at?: string }
  /** Conduct point awarded from outside the rally stream. Advances the serve clock. */
  | { t: 'penalty'; side: Side; reason?: string; by?: string; at?: string; card?: 'red' }
  /**
   * A warning card (yellow). Changes nothing on the scoreboard - it is the record that
   * the warning was given. A red card is a `penalty` to the other side with `card: 'red'`;
   * a disqualification (badminton's black card) is an `end` with reason 'disqualified'.
   */
  | { t: 'card'; card: 'yellow'; against: Side; reason?: string; by?: string; at?: string }
  /** A timeout called by a side. Changes nothing on the scoreboard; counted against its allowance. */
  | { t: 'timeout'; side: Side; by?: string; at?: string }
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
   * Table tennis expedite system switched on: by the game's time limit or at both
   * players' request. `inRally`: the ball was in play, so that rally is replayed by
   * the same server; otherwise the previous rally's receiver serves next.
   */
  | { t: 'expedite'; reason?: 'time' | 'request'; inRally?: boolean; by?: string; at?: string }
  /**
   * Doubles, at 0-0 of a game: a pair's other partner starts. Table tennis (no `side`):
   * the serving pair picks and the first receiver follows (ITTF 2.13.5), so both flip.
   * Badminton (`side`): each pair picks its own - that pair's partners swap courts.
   */
  | { t: 'switchPairServer'; side?: Side; by?: string; at?: string }
  /** Tennis doubles, at the start of a set: the pair's other player receives in the deuce court. */
  | { t: 'switchReceiver'; side: Side; by?: string; at?: string }
  /**
   * English squash scoring, first at 8-8: the receiver elects to play to 9 ("set one") or
   * to 10 ("set two", what the format plays when no election is recorded).
   */
  | { t: 'setChoice'; choice: 'one' | 'two'; by?: string; at?: string }
  /** Squash: at the start of a hand, the server serves from the other box. */
  | { t: 'switchBox'; by?: string; at?: string }
  /**
   * THE WHISTLE. A clock-terminated period is over; tally what was scored.
   *
   * Separate from `capFired`, which is a whole-match time cap with a resolution
   * policy. This is the ordinary end of a half or a quarter, and the kernel cannot
   * infer it because it owns no clock.
   */
  | { t: 'endPeriod'; reason?: string; by?: string; at?: string; clockMs?: number }
  /** Terminal, out-of-band: retirement, walkover, override. */
  | { t: 'end'; outcome: Outcome; reason: EndReason; winner?: Side | null; by?: string; at?: string }
  /**
   * THE MATCH CLOCK, as events rather than as a field.
   *
   * The clock is DERIVED from these three, which is what makes it survive a reload,
   * agree between two officials on two devices, and stay auditable: an official who
   * pushes the clock back two minutes leaves a record of having done it. Nothing
   * here scores, so the kernel's switch has no case for them and steps straight
   * past - the same way the stat fold does, which only ever reads 'point'.
   */
  /**
   * ONE PENALTY IN A SHOOT-OUT.
   *
   * Deliberately NOT a `point`: a shoot-out does not change the scoreline. A 2-2
   * settled on penalties is recorded 2-2, won on penalties - so these carry no
   * `pts`, the kernel has no case for them, and the aggregate never moves. The
   * console tallies them and, when the shoot-out is decided, closes the match with
   * a single `end` carrying reason 'penalties'.
   */
  | { t: 'penaltyKick'; side: Side; scored: boolean; playerId?: string; playerName?: string; at?: string; by?: string }
  /**
   * KHO KHO, read by kho-kho.ts, never scored. `chaseFirst`: the toss, who chases turn 1.
   * `followOn`: the side `side` leads after the first innings and sends the other in to
   * chase again. `minChase`: one side's time to its first out in the minimum chase
   * (`ms` null = no out inside the limit).
   */
  | { t: 'chaseFirst'; side: Side; at?: string; by?: string }
  | { t: 'followOn'; side: Side; at?: string; by?: string }
  | { t: 'minChase'; side: Side; ms: number | null; at?: string; by?: string }
  /**
   * KABADDI, read by kabaddi.ts, never scored. `raidFirst`: the toss, who raids first.
   * `raidTurn`: an official's correction - `side` raids next.
   */
  | { t: 'raidFirst'; side: Side; at?: string; by?: string }
  | { t: 'raidTurn'; side: Side; at?: string; by?: string }
  | { t: 'clockStart'; at?: string; by?: string }
  | { t: 'clockPause'; at?: string; by?: string }
  /** An official's correction. `toMs` is the elapsed time the clock now reads. */
  | { t: 'clockAdjust'; toMs: number; fromMs?: number; reason?: string; by?: string; at?: string };

export type RallyLog = RallyEvent[];

// ---- state -----------------------------------------------------------------

export interface ServeState {
  side: Side;
  /** 1 or 2 under handOut movement; always 1 otherwise. */
  serverNo: number;
  /** Points served in the current turn (everyN movement). */
  turnCount: number;
  /** Serving turns completed in this unit. Drives the doubles rotation (table tennis). */
  turns: number;
  /** Which side served the first point of the current innermost unit. */
  unitFirstServer: Side;
  /** Right / left service court, or null where the sport has none. */
  courtHalf: 'right' | 'left' | null;
  /** True while this side's opening turn of the unit is the single-server one. */
  openingTurn: boolean;
  /**
   * Doubles: a side whose partner order is reversed from the pairing's.
   * Table tennis: carried across games; flipped by `switchPairServer` and the decider's switch at 5.
   * Badminton: the pair's courts - flipped each time it scores on its own serve; reset each game.
   */
  pairFlip?: Partial<Record<Side, boolean>>;
  /**
   * Pickleball side-out doubles: which of the pair (index into the pairing) is server 1
   * this turn - whoever stood in the right court when the serve came over.
   */
  turnLead?: number;
  /** Tennis: 1 while the server is on their second serve (a first-serve fault called). */
  faults?: number;
  /**
   * A side whose SECOND-listed player takes the first receiving position. Tennis doubles:
   * the deuce court, for the set. Squash doubles: the right side, kept game to game
   * unless changed at the start of one (WSF doubles rules 5.8, 5.10).
   */
  receiveFlip?: Partial<Record<Side, boolean>>;
  /** Squash: the server chose the left box to start this hand (the box then alternates). */
  boxFlip?: boolean;
}

/** Sports with a first and a second serve, where a second fault loses the point. */
const TWO_SERVES = new Set(['tennisGameLocked']);

/** Index in the pairing of the side's player in the right court. */
const rightIndex = (sv: ServeState, side: Side) => (sv.pairFlip?.[side] ? 1 : 0);

// Serving pairs whose partners swap courts on every point they win on their own serve.
const SWAPS_ON_SERVE = new Set(['bwfSingleServer', 'pickleballTwoServer']);

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
  /** Table tennis expedite system in force: one serve each until it is lifted. */
  expedite: boolean;
  /** English squash: the receiver's election at 8-8 for the game under way. */
  setChoice?: 'one' | 'two';
}

/**
 * The English squash "set" election applies: a game to N by two capped at N + 1 (set two
 * by default), in server-only scoring, with both sides on N - 1.
 */
export function setChoiceDue(format: ScoringFormat, state: KernelState): boolean {
  if (state.ended || state.setChoice) return false;
  const lv = format.levels[state.pointLevel];
  const spec = serveSpecFor(format, lv);
  const [a, b] = state.score[state.pointLevel];
  return spec.pointScoring === 'serverOnly' && lv.winBy === 2 && lv.cap === lv.target + 1
    && a === lv.target - 1 && b === lv.target - 1;
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
  // A deciding set can bring its own tie-break: the Grand Slam fifth goes to 10 at 6-6.
  const grand = format.levels[i + 2], grandScore = state.score[i + 2];
  const parentDecides = !!grand && !!grandScore && grandScore[0] === grand.target - 1 && grandScore[1] === grand.target - 1;
  const sub = (parentDecides ? parent?.deciderOverride?.substitute : undefined) ?? parent?.substitute;
  if (sub && parentScore) {
    if (parentScore[0] >= sub.atUnits && parentScore[1] >= sub.atUnits) spec = sub.spec;
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

  // English squash "set one": the receiver chose, at 8-8, to play to 9 - the next point wins.
  if (state.setChoice === 'one' && i === state.pointLevel) spec = { ...spec, winBy: 1, cap: null };
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

/** A play-all level ends only when all `2 x target - 1` units are played. */
function playAllWinner(spec: LevelSpec, [a, b]: Pair): Side | null {
  if (a + b < spec.target * 2 - 1) return null;
  return a > b ? 'A' : b > a ? 'B' : null;
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
      turns: 0,
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
    expedite: false,
  };
}

// ---- expedite (table tennis) ----------------------------------------------

/** The format's expedite plugin, as stored on `plugins.expedite`. */
export interface ExpediteConfig {
  enabled: boolean;
  /** Playing time in a game before the system comes in. ITTF: 10. */
  afterMinutes: number;
  /** Not introduced once this many points in total have been scored in the game. ITTF 2.15.2: 18. */
  exemptAtTotal: number;
  /** Good returns by the receiver that win them the point. ITTF: 13. */
  returnsToWinPoint: number;
  /** Serves per turn once it is in force. ITTF: 1. */
  serveEvery: number;
  /** Stays on for the rest of the match. ITTF: yes. */
  stickyForMatch: boolean;
}

export const ITTF_EXPEDITE: ExpediteConfig = {
  enabled: true, afterMinutes: 10, exemptAtTotal: 18, returnsToWinPoint: 13, serveEvery: 1, stickyForMatch: true,
};

/** The expedite rules in force for this format, or null when it has none. */
export function expediteConfig(format: ScoringFormat): ExpediteConfig | null {
  const raw = format.plugins?.expedite as (Partial<ExpediteConfig> & { exemptAtScore?: number }) | undefined;
  if (!raw?.enabled) return null;
  // Formats saved before 2026-10-04 carry a per-side `exemptAtScore` (9); the rule is a total.
  const { exemptAtScore: legacy, ...rest } = raw;
  return { ...ITTF_EXPEDITE, ...(legacy !== undefined ? { exemptAtTotal: legacy * 2 } : {}), ...rest };
}

// ---- misconduct wording ------------------------------------------------------

/**
 * What each sport calls the console's three misconduct steps (warning, penalty point,
 * removal - see the `card` event). Pickleball uses no cards.
 */
export function misconductTerms(sport?: string | null): { warning: string; foul: string; removal: string } {
  switch ((sport ?? '').toLowerCase()) {
    case 'pickleball': return { warning: 'Technical warning', foul: 'Technical foul', removal: 'Ejection' };
    // Squash's conduct penalties (a conduct game is the "Award game" correction).
    case 'squash': return { warning: 'Conduct warning', foul: 'Conduct stroke', removal: 'Conduct match' };
    case 'badminton': return { warning: 'Yellow card', foul: 'Red card', removal: 'Black card' };
    default: return { warning: 'Yellow card', foul: 'Red card', removal: 'Disqualification' };
  }
}

// ---- timeouts ----------------------------------------------------------------

/** How many timeouts each side may call, and how long one lasts. */
export interface TimeoutRules {
  /** Per side per game (pickleball); unused ones do not carry over. */
  perGame: number | null;
  /** Per side per match (table tennis). */
  perMatch: number | null;
  seconds: number;
}

/**
 * The format's timeout allowance: `rulesSheet.timeouts` when set (false turns them off),
 * else the sport's rule - pickleball 2 a game (3 in games to 21), table tennis 1 a match.
 */
export function timeoutRules(format: ScoringFormat): TimeoutRules | null {
  const own = (format.rulesSheet as { timeouts?: Partial<TimeoutRules> | false } | undefined)?.timeouts;
  if (own === false) return null;
  const sport = (format.sport ?? '').toLowerCase();
  const base: TimeoutRules | null = sport === 'pickleball'
    ? { perGame: format.levels[0].target >= 21 ? 3 : 2, perMatch: null, seconds: 60 }
    : sport === 'table tennis'
    ? { perGame: null, perMatch: 1, seconds: 60 }
    : null;
  if (!own) return base;
  return { perGame: null, perMatch: null, seconds: 60, ...base, ...own };
}

/** Timeouts each side has left now: per game, or per match. Never below 0. */
export function timeoutsLeft(format: ScoringFormat, log: RallyLog, firstServer: Side = 'A'): Record<Side, number> | null {
  const rules = timeoutRules(format);
  const allowed = rules?.perGame ?? rules?.perMatch;
  if (!rules || allowed == null) return null;
  const used: Record<Side, number> = { A: 0, B: 0 };
  let state = initKernel(format, firstServer);
  for (const ev of log) {
    const games = state.finished.filter((u) => u.level === 0).length;
    state = step(format, state, ev).state;
    if (ev.t === 'timeout') used[ev.side] += 1;
    // A new game starts a new allowance.
    if (rules.perGame != null && state.finished.filter((u) => u.level === 0).length > games) used.A = used.B = 0;
  }
  return { A: Math.max(0, allowed - used.A), B: Math.max(0, allowed - used.B) };
}

/** True when the expedite system may still be introduced in the game under way. */
export function expediteAllowed(format: ScoringFormat, state: KernelState): boolean {
  const cfg = expediteConfig(format);
  if (!cfg || state.expedite || state.ended) return false;
  const [a, b] = state.score[state.pointLevel];
  return a + b < cfg.exemptAtTotal;
}

/** Serves in the current turn: opening turn, the collapse at deuce, or expedite. */
export function serveEveryNow(format: ScoringFormat, spec: ServeSpec, state: KernelState): number {
  if (state.expedite) return expediteConfig(format)?.serveEvery ?? 1;
  return state.serve.openingTurn && spec.firstTurnEvery
    ? spec.firstTurnEvery
    : effectiveEvery(spec, state.score[state.pointLevel]);
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
  serve: {
    ...s.serve,
    ...(s.serve.pairFlip ? { pairFlip: { ...s.serve.pairFlip } } : {}),
    ...(s.serve.receiveFlip ? { receiveFlip: { ...s.serve.receiveFlip } } : {}),
  },
  finished: [...s.finished],
});

// ---- serve movement --------------------------------------------------------

/** `every` collapses to one-serve-each once BOTH sides reach `collapseAt`. */
export function effectiveEvery(spec: ServeSpec, score: Pair): number {
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
    case 'gameTotal':
      // Tennis: deuce (right) court on an even number of points played in the game, ad
      // (left) on odd - whoever won them. 0-15 is from the ad court, not the deuce.
      return (pointScore[0] + pointScore[1]) % 2 === 0 ? 'right' : 'left';
    case 'handAlternate':
      // Squash: the server picks a box at each new hand (right unless `boxFlip`), then
      // alternates while the hand continues - on points served in this turn.
      return (state.serve.turnCount + (state.serve.boxFlip ? 1 : 0)) % 2 === 0 ? 'right' : 'left';
    default: return null;
  }
}

/** Move the serve after a rally. `rallyWinner` won it; `scored` says if a point landed. */
function moveServe(format: ScoringFormat, spec: ServeSpec, state: KernelState, rallyWinner: Side, scored: boolean): void {
  const sv = state.serve;
  switch (spec.movement) {
    case 'rallyWinner':
      // A change of serving side is a hand-out: counted in `turns`, which squash doubles
      // rotates its four servers on.
      // A new server chooses their box afresh, so the last hand's choice is dropped.
      if (sv.side !== rallyWinner) { sv.side = rallyWinner; sv.turnCount = 0; sv.turns += 1; sv.boxFlip = false; }
      else sv.turnCount += 1;
      break;
    case 'everyN': {
      sv.turnCount += 1;
      // The tennis tie-break opens with a single serve, then runs in twos. Tracked on
      // `openingTurn` so it survives undo rather than being inferred from the score.
      if (sv.turnCount >= serveEveryNow(format, spec, state)) {
        sv.side = other(sv.side);
        sv.turnCount = 0;
        sv.turns += 1;
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
        sv.turnLead = rightIndex(sv, sv.side);
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

/**
 * `nextSide`: who serves next, already decided by the unit that just finished. When a
 * point ends a game AND the set, the set's reset must not decide (alternate) again.
 */
function resetForNewUnit(format: ScoringFormat, state: KernelState, unitWinnerSide: Side, nextSide?: Side): void {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const spec = serveSpecFor(format, lv);
  const next = nextSide ?? serveForNextUnit(spec, state, unitWinnerSide);
  state.serve = {
    side: next,
    serverNo: serveOpeningServerNo(spec),
    turnCount: 0,
    turns: 0,
    unitFirstServer: next,
    courtHalf: spec.courtModel === 'none' ? null : 'right',
    openingTurn: opensSpecially(spec),
    // Table tennis keeps it: with the same partner serving first, the receiver is the one
    // who served to them last game. Badminton starts each game from the listed order.
    // Tennis keeps it for the set: it is the pair's serving order, chosen at the set start.
    ...(state.serve.pairFlip && (spec.resolver === 'ttPairCycle' || spec.resolver === 'tennisGameLocked') ? { pairFlip: state.serve.pairFlip } : {}),
    // Tennis receivers hold their courts for the set; the cascade clears this at a new set.
    ...(state.serve.receiveFlip ? { receiveFlip: state.serve.receiveFlip } : {}),
  };
  state.unitPoints = 0;
  // An 8-8 election is for the game it was made in.
  delete state.setChoice;
  if (state.expedite && !expediteConfig(format)?.stickyForMatch) state.expedite = false;
}

// ---- the cascade -----------------------------------------------------------

/**
 * Settle completed units from `from` upward. Winning a unit increments the level
 * above and resets everything below it; the outermost level ending IS the match
 * ending. Returns the units settled, innermost first.
 */
function cascade(format: ScoringFormat, state: KernelState, from: number, forced?: Side): FinishedUnit[] {
  const won: FinishedUnit[] = [];
  // Who serves next is decided once, by the innermost unit to finish (a tie-break's
  // "first receiver serves next"); the levels it carries up only re-apply it.
  let nextServer: Side | undefined;
  let i = from;
  for (;;) {
    const spec = effectiveLevel(format, state, i);
    // Play-all (squash Flash): every unit below is played out, then the bigger tally wins.
    const w = (i === from && forced) ? forced
      : format.levels[i - 1]?.playAll ? playAllWinner(spec, state.score[i])
      : unitWinner(spec, state.score[i]);
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
    resetForNewUnit(format, state, w, nextServer);
    nextServer ??= state.serve.side;
    // A new set: each doubles pair chooses its receiving courts again - and in tennis its
    // serving order too (ITF rule 14), starting from the listed order.
    if (i >= 1) {
      delete state.serve.receiveFlip;
      if (serveSpecFor(format, effectiveLevel(format, state, state.pointLevel)).resolver === 'tennisGameLocked') delete state.serve.pairFlip;
    }
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
    case 'oddCumulativeUnits': {
      // Games change ends at unit boundaries. A tie-break (and a match tie-break played
      // as the deciding set) changes every 6 points inside it.
      const inTiebreak = spec.key === 'tiebreak' || state.pointLevel > 0;
      const total = after[0] + after[1];
      return inTiebreak && total > 0 && total % 6 === 0;
    }
    case 'atDeciderMidpoint': {
      // The rule is decider-only, in badminton and volleyball alike. Nothing happens
      // at 11-x in games 1 and 2 - which is exactly the drift the reference engine's
      // README got wrong, so it is asserted in the tests.
      if (!inDecider) return false;
      return leaderLandsOn(spec.switchEndsAt ?? null, before, after);
    }
    default:
      return false;
  }
}

// Fires once: the moment the leader first LANDS on `at` while the other side is
// still below it. Comparing against the pre-point score is what makes it once.
function leaderLandsOn(at: number | null, before: Pair, after: Pair): boolean {
  if (at == null) return false;
  const hi = Math.max(after[0], after[1]);
  const lo = Math.min(after[0], after[1]);
  const hiBefore = Math.max(before[0], before[1]);
  return hi === at && lo < at && hiBefore < at;
}

const flipPair = (sv: ServeState, side: Side) => {
  sv.pairFlip = { ...sv.pairFlip, [side]: !sv.pairFlip?.[side] };
};

/**
 * ITTF 2.13.6: in the last possible game of a doubles match, the pair due next to
 * receive changes its order when one pair first reaches 5 (the change-of-ends score).
 * Independent of the console's change-ends setting - it is a serving rule.
 */
function deciderReceiverSwitch(spec: ServeSpec, lv: LevelSpec, state: KernelState, before: Pair, inDecider: boolean): void {
  if (spec.resolver !== 'ttPairCycle' || !inDecider) return;
  if (leaderLandsOn(lv.switchEndsAt ?? null, before, state.score[state.pointLevel])) {
    flipPair(state.serve, other(state.serve.side));
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
    case 'fault': {
      // Tennis has two serves: the first fault sets up a second serve; a second fault is a
      // DOUBLE FAULT, and the receiver wins the point exactly as if they had won a rally.
      // Elsewhere a fault is only a stat (the scorer taps the point as well).
      if (!TWO_SERVES.has(spec.resolver)) return { state, effect: base };
      if (!state.serve.faults) {
        state.serve.faults = 1;
        return { state, effect: base };
      }
      const r = step(format, { ...state, serve: { ...state.serve, faults: 0 } }, { t: 'point', side: other(state.serve.side) });
      return { state: r.state, effect: { ...r.effect, event: ev } };
    }

    case 'switchReceiver': {
      // Tennis: only at the very start of a set. Squash doubles: at the start of any game
      // (WSF doubles rule 5.10 - partners may change receiving sides for a new game).
      const games = state.score[1] ?? [0, 0];
      // A match tie-break played as the deciding set is a set start too (ITF rule 14):
      // it runs one level up, so it is caught before its first point rather than at 0-0 games.
      const atSetStart = state.unitPoints === 0
        && (state.pointLevel === 0 ? games[0] + games[1] === 0 : state.serve.turns === 0 && state.serve.turnCount === 0);
      const atGameStart = state.unitPoints === 0 && state.serve.turns === 0 && state.serve.turnCount === 0;
      const allowed = (spec.resolver === 'tennisGameLocked' && atSetStart) || (spec.resolver === 'squashHandOut' && atGameStart);
      if (!allowed) return { state: prev, effect: base };
      state.serve.receiveFlip = { ...state.serve.receiveFlip, [ev.side]: !state.serve.receiveFlip?.[ev.side] };
      return { state, effect: base };
    }

    case 'setChoice':
      // Only at the moment it is due, and only once a game.
      if (!setChoiceDue(format, state)) return { state: prev, effect: base };
      state.setChoice = ev.choice;
      return { state, effect: base };

    case 'switchBox': {
      // Squash: the server picks the box at the start of each hand (WSF 5.7) - before
      // the hand's first serve, and never mid-hand, where the boxes must alternate.
      if (spec.courtModel !== 'handAlternate' || state.serve.turnCount !== 0) return { state: prev, effect: base };
      state.serve.boxFlip = !state.serve.boxFlip;
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      return { state, effect: base };
    }

    case 'let':
      // A let replays the serve it interrupted - a let on a second serve is a second serve.
    case 'card':
    case 'timeout':
      // Neither scores nor moves the serve. Recorded for the timeline and the stats.
      return { state, effect: base };

    case 'expedite': {
      if (state.expedite || !expediteConfig(format)) return { state: prev, effect: base };
      state.expedite = true;
      const sv = state.serve;
      // Ball in play: the rally is replayed and its server serves it. Between rallies:
      // the previous rally's receiver serves, i.e. a part-used turn passes over now.
      if (!ev.inRally && sv.turnCount > 0) {
        sv.side = other(sv.side);
        sv.turns += 1;
        sv.openingTurn = false;
      }
      sv.turnCount = 0;
      sv.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      return { state, effect: base };
    }

    case 'point': {
      const rallyWinner = ev.side;
      /**
       * A MAGNITUDE OF ZERO IS A REAL THING, and it is not one.
       *
       * Outside the racquet family a tap is an ACTION, and most actions score
       * nothing: a yellow card, a save, a missed penalty, an empty raid, a dig. The
       * console says so explicitly - it sends `pts: 0` and its own comment calls it
       * "a fact worth keeping that changes no score".
       *
       * Clamping to a minimum of one overruled that and turned every one of them
       * into a goal. A football match with five saves and three cards read 8-0, and
       * the scoreboard was wrong in the direction nobody checks - upwards, on the
       * screen the official is watching.
       *
       * Absent still means one, because that is what a plain point is.
       */
      const magnitude = Math.max(0, ev.pts ?? 1);
      // A rally played ends the serve in hand: the next point starts on a first serve.
      if (magnitude > 0) state.serve.faults = 0;
      const scores = magnitude > 0
        && (spec.pointScoring === 'rally' || rallyWinner === state.serve.side);
      if (scores) {
        state.score[state.pointLevel][idx(rallyWinner)] += magnitude;
        state.unitPoints += 1;
        state.totalPoints += 1;
        base.scored = rallyWinner;
      }
      // A nil-magnitude ACTION does not move the serve either. A dig, a block that
      // did not win the rally, a card - none of them ends a rally, so none of them
      // hands the serve over.
      // Badminton and pickleball doubles: a pair swaps courts only when it scores on its own serve.
      if (scores && SWAPS_ON_SERVE.has(spec.resolver) && rallyWinner === serverSide) {
        flipPair(state.serve, rallyWinner);
      }
      if (magnitude > 0) {
        moveServe(format, spec, state, rallyWinner, scores);
        state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      }
      if (scores) {
        base.switchEnds = shouldSwitchEnds(format, state, lv, before, base.inDecider);
        state.switchEnds = base.switchEnds;
        deciderReceiverSwitch(spec, lv, state, before, base.inDecider);
        base.unitsWon = cascade(format, state, state.pointLevel);
        base.unitsWon = [...base.unitsWon, ...afterBuzzer(format, state, base.unitsWon.length > 0)];
        if (!state.ended) aggregateFinish(format, state);
      }
      break;
    }

    case 'switchPairServer': {
      // Only before the first rally of a game.
      const sv = state.serve;
      if (state.unitPoints > 0 || sv.turns > 0 || sv.turnCount > 0) return { state: prev, effect: base };
      if (spec.resolver === 'ttPairCycle' && !ev.side) {
        flipPair(sv, 'A');
        flipPair(sv, 'B');
      } else if (SWAPS_ON_SERVE.has(spec.resolver) && ev.side) {
        flipPair(sv, ev.side);
        // The new right-court player of the serving pair opens the game.
        if (ev.side === sv.side) sv.turnLead = rightIndex(sv, sv.side);
      } else if (spec.resolver === 'tennisGameLocked' && ev.side && state.pointLevel > 0) {
        // A match tie-break as the deciding set: both pairs name their first server before
        // its first point (the guard above has already checked no point is played).
        flipPair(sv, ev.side);
      } else if (spec.resolver === 'tennisGameLocked' && ev.side && state.pointLevel === 0) {
        // Tennis doubles: a pair names its first server for the set before it first serves
        // in it - game 1 for the pair serving first, game 1 or 2 for the other.
        const games = state.score[1] ?? [0, 0];
        const played = games[0] + games[1];
        if (format.levels.length < 3 || !(played === 0 || (played === 1 && ev.side === sv.side))) return { state: prev, effect: base };
        flipPair(sv, ev.side);
      } else if (spec.resolver === 'squashHandOut' && ev.side) {
        // Squash doubles: a team's other partner serves first in this game (rule 5.6
        // names only the team, so the scorer can say which of them).
        flipPair(sv, ev.side);
      } else {
        return { state: prev, effect: base };
      }
      return { state, effect: base };
    }

    case 'penalty': {
      // A conduct point behaves exactly like a rallied point for the score and the
      // serve clock - it can trigger deuce, the change of ends and the unit end.
      if (format.penaltyEvents === 'off') return { state: prev, effect: base };
      state.serve.faults = 0;
      state.score[state.pointLevel][idx(ev.side)] += 1;
      state.unitPoints += 1;
      state.totalPoints += 1;
      base.scored = ev.side;
      // Under rally scoring the serve moves as if the awarded side won the rally: it
      // takes the serve in badminton, and the point counts in table tennis's 2-serve turn.
      // Side-out formats keep the serve where it was - only the score changes.
      if (spec.pointScoring === 'rally') {
        if (SWAPS_ON_SERVE.has(spec.resolver) && ev.side === serverSide) flipPair(state.serve, ev.side);
        moveServe(format, spec, state, ev.side, true);
      }
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      base.switchEnds = shouldSwitchEnds(format, state, lv, before, base.inDecider);
      state.switchEnds = base.switchEnds;
      deciderReceiverSwitch(spec, lv, state, before, base.inDecider);
      base.unitsWon = cascade(format, state, state.pointLevel);
      base.unitsWon = [...base.unitsWon, ...afterBuzzer(format, state, base.unitsWon.length > 0)];
      break;
    }

    case 'awardServe':
      if (state.serve.side !== ev.side) { state.serve.turns += 1; state.serve.turnLead = rightIndex(state.serve, ev.side); }
      state.serve.side = ev.side;
      state.serve.serverNo = 1;
      state.serve.turnCount = 0;
      state.serve.faults = 0;
      state.serve.courtHalf = courtHalfFor(spec, state, state.score[state.pointLevel]);
      break;

    case 'setServe':
      if (state.serve.side !== ev.side) { state.serve.turns += 1; state.serve.turnLead = rightIndex(state.serve, ev.side); }
      // Set before the unit's first point (a toss), it IS the unit's first server - so
      // an alternating next unit counts from the side that really started this one.
      if (state.score[0][0] === 0 && state.score[0][1] === 0) state.serve.unitFirstServer = ev.side;
      state.serve.side = ev.side;
      state.serve.serverNo = ev.serverNo ?? 1;
      state.serve.turnCount = 0;
      state.serve.faults = 0;
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
/**
 * Two ways an aggregate match ends on a point rather than a whistle (ultimate):
 * the first side to `firstTo` wins at once, and once every period - extra time
 * included - is played level, the next point wins (`universalPoint`).
 */
function aggregateFinish(format: ScoringFormat, state: KernelState): void {
  const top = format.levels[format.levels.length - 1];
  if (top?.decide !== 'aggregate') return;
  const [a, b] = aggregateScore(state);
  if (a === b) return;
  const lead: Side = a > b ? 'A' : 'B';
  const reachedTarget = !!top.firstTo && Math.max(a, b) >= top.firstTo;
  const played = state.finished.filter((u) => u.level === 0).length;
  const allPlayed = played >= top.target + (format.tieBreak?.extraTime?.periods ?? 0);
  const universal = !!format.tieBreak?.universalPoint && allPlayed;
  if (!reachedTarget && !universal) return;
  state.ended = true;
  state.outcome = 'win';
  state.winner = lead;
  state.reason = state.reason ?? 'normal';
}

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
  // Extra time is played out in full - a lead after its first half is not a win yet
  // (TieBreakSpec.extraTime). A repeating overtime (basketball) decides every period.
  const extra = format.tieBreak?.extraTime;
  if (extra && !extra.repeat && played > topSpec.target && played < topSpec.target + extra.periods) return [unit];

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
  switch (clock.action) {
    case 'leaderWins':
    case 'stopImmediately':
    case 'finishPointThenLeader':
      return settleOnTime(format, state);
    case 'nextPointWins':
    case 'finishUnit':
    default:
      return { unitsWon: [] };
  }
}

/**
 * After the buzzer, a point can end the match: the next point (nextPointWins), the
 * sudden-death point after a level buzzer, or the end of the game in play (finishUnit).
 * "Organiser decides" never ends it here.
 */
function afterBuzzer(format: ScoringFormat, state: KernelState, unitFinished: boolean): FinishedUnit[] {
  const clock = format.clock;
  if (!clock || !state.capFired || state.ended) return [];
  if (clock.tieRule === 'organiserDecides' && clock.action !== 'nextPointWins') return [];
  if (clock.action === 'finishUnit' && !unitFinished) return [];
  return settleOnTime(format, state).unitsWon;
}

/** Time is up: the leader takes the match; a level score is a draw only where allowed. */
function settleOnTime(format: ScoringFormat, state: KernelState): { unitsWon: FinishedUnit[] } {
  const clock = format.clock!;
  const at = state.pointLevel;
  // An AGGREGATE match (kho-kho, kabaddi, football...) is decided on the total
  // across every period played SO FAR, not the period in progress alone - a
  // team that banked 8-0 in period 1 is still ahead if period 3 is 0-2 when
  // the whole-match clock cuts in. Comparing `state.score[at]` alone ignored
  // every period already banked into `state.finished` and could hand the
  // match to whichever side happened to be scoring in the live period,
  // regardless of who actually led on real total.
  //
  // A units-decided format (racquet sports: sets, games) has no such banked
  // total to add in - the level in progress IS the whole comparison, exactly
  // as before.
  // A units-decided match compares from the top down: sets, then games, then points in
  // the game under way. A side a game up leads, whoever leads the live game.
  const [a, b] = isAggregate(format) ? aggregateScore(state) : leadingScore(state, at);
  const live = state.score[at];

  if (a === b) {
    if (clock.tieRule === 'draw' && format.endStates.drawsAllowed) {
      state.ended = true; state.outcome = 'draw'; state.winner = null; state.reason = 'cap';
      return { unitsWon: [] };
    }
    // suddenDeathPoint / organiserDecides: play on; the next point is settled by afterBuzzer.
    return { unitsWon: [] };
  }
  const lead: Side = a > b ? 'A' : 'B';
  // The game under way goes to the leader only if they lead it too; otherwise it
  // stays unfinished rather than being recorded as won from behind.
  const liveLead = live[0] === live[1] ? null : live[0] > live[1] ? 'A' : 'B';
  const units = isAggregate(format) || liveLead === lead ? cascade(format, state, at, lead) : [];
  if (!state.ended) { state.ended = true; state.outcome = 'win'; state.winner = lead; }
  state.reason = 'cap';
  return { unitsWon: units };
}

/** Who leads when time is called, by the same comparison the buzzer uses; null when level. */
export function capLeader(format: ScoringFormat, state: KernelState): Side | null {
  const [a, b] = isAggregate(format) ? aggregateScore(state) : leadingScore(state, state.pointLevel);
  return a === b ? null : a > b ? 'A' : 'B';
}

/** The first level, from the top, where the sides differ - or the live points if none do. */
function leadingScore(state: KernelState, at: number): Pair {
  for (let i = state.score.length - 1; i > at; i--) {
    const s = state.score[i];
    if (s[0] !== s[1]) return s;
  }
  return state.score[at];
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
  if (top === 0) return [...state.score[0]] as Pair;

  // A SINGLE-UNIT match ("one game to 21", a 10-point shootout, one judo bout) has
  // no meaningful unit count - the score of that one unit IS the headline.
  //
  // It has to be read from the BANKED unit, not from the live level. Winning the
  // only unit cascades, and the cascade resets every level below the one it just
  // filled - so by the time the match is over, the live score is 0-0. Reading it
  // there published `0-0` as home_score/away_score for a completed match, with a
  // winner beside it, across a third of the shelf: every corporate single-game
  // format and every one-bout combat and board sport.
  if (format.levels[top].target <= 1) {
    const lvl = top - 1;
    const banked = state.finished.filter((u) => u.level === lvl);
    const last = banked[banked.length - 1];
    if (last) return [last.score[0], last.score[1]] as Pair;
    return [...state.score[lvl]] as Pair;
  }

  return [...state.score[top]] as Pair;
}

/**
 * The scoreline a retirement, disqualification or walkover is recorded with, per the
 * format's end-state policy. "As played" keeps the live score; "award remaining" gives
 * the winner what they still needed (A a game up retires: B wins 2-1, not 0-1).
 */
function endPolicyHeadline(format: ScoringFormat, state: KernelState, h: Pair): Pair {
  const w = state.winner;
  const top = format.levels.length - 1;
  if (!state.ended || !w || format.levels[top]?.decide === 'aggregate') return h;
  const policy = format.endStates;
  const rule = state.reason === 'walkover' ? policy.walkoverScoreline
    : state.reason === 'retired' || state.reason === 'disqualified' ? policy.retirementScore
    : null;
  if (!rule || rule === 'freezeAsPlayed' || rule === 'organiserEnters') return h;
  if (rule === 'zeroZero') return [0, 0];
  // The headline's level: the match's units, or the points of a single-unit match.
  const lv = top > 0 && format.levels[top].target <= 1 ? format.levels[top - 1] : format.levels[top];
  const wi = w === 'A' ? 0 : 1;
  const out: Pair = rule === 'targetToZero' ? [0, 0] : [h[0], h[1]];
  const reached = Math.max(lv.target, out[1 - wi] + lv.winBy);
  out[wi] = Math.max(out[wi], lv.cap != null ? Math.min(lv.cap, reached) : reached);
  return out;
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

/**
 * Do the players change ends now that these units have finished? Separate from `switchEnds`
 * (a mid-unit change, persisted per rally); between-unit changes are only a console prompt.
 * Tennis changes when the games played in the set are odd; a finished set counts its own total.
 */
export function changesEndsAfterUnit(format: ScoringFormat, state: KernelState, won: FinishedUnit[]): boolean {
  if (state.ended || !won.length) return false;
  switch (format.changeEnds) {
    case 'betweenUnits':
    case 'atDeciderMidpoint':
      return true;
    case 'oddCumulativeUnits': {
      const setLevel = format.levels.findIndex((l) => l.key === 'set');
      if (setLevel < 0) return false;
      const setDone = won.find((u) => u.level === setLevel);
      const games = setDone ? setDone.score : state.score[setLevel];
      return (games[0] + games[1]) % 2 === 1;
    }
    default:
      return false;
  }
}

export interface RallyTiming {
  /** First to last rally, in ms. null when untimed or keyed in after the fact. */
  matchMs: number | null;
  /** Per finished innermost unit, first to last rally of that unit, in order. */
  unitMs: (number | null)[];
}

/** Under this average a point was not played live - the log was typed in afterwards. */
const MIN_LIVE_MS_PER_RALLY = 3000;

/**
 * Playing time from the tap timestamps. Breaks between units fall outside every
 * unit, so a game's time is its own rallies only.
 */
export function rallyTiming(format: ScoringFormat, log: RallyLog, firstServer: Side = 'A'): RallyTiming {
  let state = initKernel(format, firstServer);
  const unitMs: (number | null)[] = [];
  let first: number | null = null;
  let last: number | null = null;
  let unitStart: number | null = null;
  let rallies = 0;
  for (const ev of log) {
    const r = step(format, state, ev);
    state = r.state;
    if (ev.t !== 'point' && ev.t !== 'penalty') continue;
    const t = ev.at ? Date.parse(ev.at) : NaN;
    const timed = Number.isFinite(t);
    if (timed) {
      first ??= t;
      last = t;
      unitStart ??= t;
      rallies += 1;
    }
    if (r.effect.unitsWon.length) {
      unitMs.push(timed && unitStart !== null ? t - unitStart : null);
      unitStart = null;
    }
  }
  const matchMs = first !== null && last !== null ? last - first : null;
  if (matchMs === null || (rallies >= 10 && matchMs / rallies < MIN_LIVE_MS_PER_RALLY)) {
    return { matchMs: null, unitMs: unitMs.map(() => null) };
  }
  return { matchMs, unitMs };
}

export interface GameClock {
  /** Running time of the current unit, in ms, as at `nowMs`. */
  elapsedMs: number;
  paused: boolean;
}

/**
 * The clock for the unit in play (the table tennis expedite limit). It starts at the
 * unit's first rally, stops on clockPause and restarts on clockStart - or on the next
 * rally, since a rally means play is on. null before the unit's first rally.
 */
export function unitClock(format: ScoringFormat, log: RallyLog, firstServer: Side, nowMs: number): GameClock | null {
  const { trace } = foldRally(format, log, firstServer);
  let from = 0;
  trace.forEach((t, i) => { if (t.unitsWon.length) from = i + 1; });
  let banked = 0;
  let runFrom: number | null = null;
  let started = false;
  for (let i = from; i < log.length; i++) {
    const ev = log[i];
    const t = ev.at ? Date.parse(ev.at) : NaN;
    if (!Number.isFinite(t)) continue;
    if (ev.t === 'point' || ev.t === 'penalty') { started = true; runFrom ??= t; }
    else if (ev.t === 'clockPause' && runFrom !== null) { banked += t - runFrom; runFrom = null; }
    else if (ev.t === 'clockStart' && started && runFrom === null) runFrom = t;
  }
  if (!started) return null;
  return { elapsedMs: banked + (runFrom !== null ? Math.max(0, nowMs - runFrom) : 0), paused: runFrom === null };
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
    headline: endPolicyHeadline(format, state, headline(format, state)),
    unitScores: inner.map((u) => u.score),
    // An aggregate level counts periods played, not units won - nobody wins a half.
    unitsFor: format.levels[top]?.decide === 'aggregate'
      ? [periodsPlayed(state), periodsPlayed(state)]
      : top > 0 ? ([...state.score[top]] as Pair) : [0, 0],
    pointsFor,
    ended: state.ended,
  };
}
