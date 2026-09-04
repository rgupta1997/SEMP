import { z } from 'zod';

// ============================================================================
// The rally kernel's configuration model.
//
// A match is an ordered array of nested scoring LEVELS. `levels[0]` is the
// innermost scoring unit - the thing raw points are counted toward - and each
// level after it counts the units won at the level below. The outermost level
// IS the match.
//
//   table tennis  [ game(11, by 2), match(3 games) ]
//   badminton     [ game(21, by 2, cap 30), match(2 games) ]
//   tennis        [ game(4, by 2, "0/15/30/40/AD"), set(6, by 2, TB at 6-6), match(2 sets) ]
//
// Tennis is why the structure is nested rather than flat: 15/30/40 is not a
// different KIND of scoring, it is a level with target 4 and a display map. The
// other four sports declare two levels and inherit everything else. See the
// "Racquet Scoring Kernel" plan for the full reasoning.
//
// Everything here is data. Adding a format is a row, not a code change.
// ============================================================================

export type Side = 'A' | 'B';

// ---- serving ---------------------------------------------------------------

// WHO MAY SCORE. Orthogonal to how the serve moves, and keeping them fused (as a
// single 'sideOut' mode) makes squash English-9 and classic badminton 15
// inexpressible: both move the serve to the rally winner, but only the server
// scores. Splitting them is a correction, not a squash special case.
export const POINT_SCORING = ['rally', 'serverOnly'] as const;
export type PointScoring = (typeof POINT_SCORING)[number];

// HOW THE SERVE MOVES.
//   rallyWinner - the rally winner serves next          (badminton, squash PARS, volleyball)
//   everyN      - changes after `every` points          (table tennis)
//   perUnit     - changes when the unit below completes (tennis: every game)
//   handOut     - server keeps serving until they lose  (pickleball traditional, squash English)
//   none        - no serve concept
export const SERVE_MOVEMENT = ['rallyWinner', 'everyN', 'perUnit', 'handOut', 'none'] as const;
export type ServeMovement = (typeof SERVE_MOVEMENT)[number];

// Which PLAYER serves, in doubles. A pure function of the score cannot answer this -
// it depends on persisted court positions and, in table tennis, on the previous
// game's pairing. Four of the five sports need one, so it is a first-class seam
// rather than an escape hatch. Implementations live in serve-resolvers.ts.
export const SERVE_RESOLVERS = [
  'none',
  'bwfSingleServer',      // badminton 21: one server, court from score parity
  'classicTwoServer',     // badminton 15 heritage: two hands, "one hand down" start
  'pickleballTwoServer',  // server #1 -> #2 -> side-out, with the 0-0-2 opening
  'ttPairCycle',          // fixed A>X>B>Y cycle, receiver forced by the previous game
  'tennisGameLocked',     // order nominated per set and locked
  'squashHandOut',        // server chooses the box at each new hand
] as const;
export type ServeResolverId = (typeof SERVE_RESOLVERS)[number];

// Right/left service court. A boolean cannot express this: table tennis's parity is
// a constant (always right-to-right), badminton's is driven by the server's score,
// pickleball's alternates per point, squash's is chosen by the server at each hand.
export const COURT_MODELS = ['none', 'parity', 'handAlternate', 'fixed'] as const;
export type CourtModel = (typeof COURT_MODELS)[number];

export const FIRST_SERVER_RULES = ['toss', 'appRandom', 'organiser', 'home', 'away'] as const;
export type FirstServerRule = (typeof FIRST_SERVER_RULES)[number];

// Who serves first in the NEXT unit. `subUnitFirstServerReceives` is the tennis rule:
// after a tie-break set, whoever served point 1 of the tie-break receives first next set.
export const NEXT_UNIT_SERVERS = [
  'alternate', 'previousWinner', 'previousLoser', 'continue', 'subUnitFirstServerReceives',
] as const;
export type NextUnitServer = (typeof NEXT_UNIT_SERVERS)[number];

export interface ServeSpec {
  pointScoring: PointScoring;
  movement: ServeMovement;
  /** `everyN` only: serves per turn. 2 = ITTF, 5 = legacy 21-point, 3 = the Sprint format. */
  every?: number;
  /**
   * Score at which `every` collapses to `collapseEvery` (one serve each). Both sides
   * must have reached it. Deliberately NOT called `deuceAt`: in table tennis the serve
   * rhythm and the win condition both change at 10, but in badminton the win condition
   * starts at 20 and the serve rhythm never changes at all. Fusing them makes
   * badminton's deuce undescribable.
   */
  collapseAt?: number | null;
  collapseEvery?: number;
  /**
   * `everyN` only: a different serve count for the FIRST turn of the unit. This is the
   * tennis tie-break - the opening server serves one point, then the serve runs in
   * twos. Without it the whole tie-break rotation is off by one point.
   */
  firstTurnEvery?: number;
  /** `handOut` only: servers per side before the serve crosses. Pickleball = 2. */
  serversPerSide?: number;
  /** Pickleball's 0-0-2: the first serving turn of a unit gets one server, not two. */
  firstTurnSingle?: boolean;
  resolver: ServeResolverId;
  courtModel: CourtModel;
  firstServer: FirstServerRule;
  nextUnitServer: NextUnitServer;
}

// ---- levels ----------------------------------------------------------------

/** Params a decider (or a substituted unit) may replace on its base level. */
export interface LevelOverride {
  target?: number;
  winBy?: number;
  cap?: number | null;
  switchEndsAt?: number | null;
  startingScore?: [number, number];
  serve?: ServeSpec;
  /**
   * The decider is scored directly in points, skipping the level below. This is the
   * 10-point match tie-break played in place of a final set.
   */
  collapsed?: boolean;
  pointLabels?: string[] | null;
}

/**
 * HOW A UNIT ENDS.
 *
 *   target - a score ends it. Every racquet and net sport.
 *   clock  - TIME ends it, and the score has no say. A football half is over when
 *            the whistle goes at 4-0 or at 0-0 alike.
 *
 * A clock unit never terminates itself: the kernel owns no clock (that is what
 * keeps it a pure fold), so the console signals the whistle with an `endPeriod`
 * event and the kernel tallies what was scored.
 */
export const TERMINATORS = ['target', 'clock'] as const;
export type Terminator = (typeof TERMINATORS)[number];

/**
 * HOW THE LEVEL ABOVE IS WON.
 *
 *   units     - by winning enough units below. Best of 5 games; three sets.
 *   aggregate - by TOTAL SCORE across the units below. Football is 2-1 on goals,
 *               not "one half each"; kabaddi and basketball are the same shape.
 *
 * This is the distinction that made the racquet kernel unable to describe an
 * invasion sport. Everything else about the level array carries over unchanged.
 */
export const DECIDERS = ['units', 'aggregate'] as const;
export type Decider = (typeof DECIDERS)[number];

export interface LevelSpec {
  /** Stable id: 'game' | 'set' | 'match' | 'tiebreak' | 'half' | 'quarter'. */
  key: string;
  /** The unit WON at this level - "Game", "Set", "Match". */
  label: string;
  /**
   * Score needed to win one of these.
   *
   * For `decide: 'aggregate'` it is instead HOW MANY units below are played - two
   * halves, four quarters - because an aggregate level is not "won" by a count.
   */
  target: number;
  winBy: number;
  /** How a unit at this level ends. Defaults to `target`. */
  terminator?: Terminator;
  /** How this level is decided from the units below. Defaults to `units`. */
  decide?: Decider;
  /** Hard ceiling - reaching it wins regardless of margin. null = unbounded deuce. */
  cap: number | null;
  /** Handicap start, applied at the beginning of every unit at this level. */
  startingScore?: [number, number];
  /** Display map for the score, e.g. ['0','15','30','40','AD']. Cosmetic only. */
  pointLabels?: string[];
  /** Change ends when either side first reaches this score inside the unit. */
  switchEndsAt?: number | null;
  /** Play dead units out (box leagues ranking on points difference). */
  playAll?: boolean;
  /** Serve rules for units at this level. Falls back to the format's `serve`. */
  serve?: ServeSpec;
  /** Applied when this level is the decider - i.e. the level above is one unit from over. */
  deciderOverride?: LevelOverride;
  /**
   * Substitute a differently-configured child unit once BOTH sides reach `atUnits`.
   * This is the tennis tie-break: at 6-6 the next "game" is played to 7 by 2, with
   * its own serve rhythm, and its winner takes the set 7-6.
   */
  substitute?: { atUnits: number; spec: LevelSpec };
}

// ---- clock, end states, officiating ----------------------------------------

export const CAP_SCOPES = ['match', 'unit', 'slot'] as const;
export type CapScope = (typeof CAP_SCOPES)[number];

// What happens when the buzzer goes. A bare `timeCap: number` selects none of these,
// and every Indian corporate format in all five sports is clocked.
export const CAP_ACTIONS = [
  'finishPointThenLeader',  // finish the rally in progress, highest score wins
  'leaderWins',             // stop dead, highest score wins
  'nextPointWins',          // play on, the next point ends it
  'finishUnit',             // play the current game out, then stop
  'stopImmediately',
] as const;
export type CapAction = (typeof CAP_ACTIONS)[number];

export const CAP_TIE_RULES = ['suddenDeathPoint', 'draw', 'organiserDecides'] as const;
export type CapTieRule = (typeof CAP_TIE_RULES)[number];

export interface ClockSpec {
  scope: CapScope;
  minutes: number;
  action: CapAction;
  tieRule: CapTieRule;
  warningSeconds?: number;
  /** Most Indian corporate caps run through intervals - the constraint is the hall booking. */
  pauseOnStoppage: boolean;
}

export const WALKOVER_SCORELINES = ['targetToZero', 'zeroZero', 'organiserEnters'] as const;
export type WalkoverScoreline = (typeof WALKOVER_SCORELINES)[number];

export const RETIREMENT_POLICIES = ['freezeAsPlayed', 'freezeThenAwardRemaining', 'targetToZero'] as const;
export type RetirementPolicy = (typeof RETIREMENT_POLICIES)[number];

export interface EndStatePolicy {
  walkoverScoreline: WalkoverScoreline;
  retirementScore: RetirementPolicy;
  /** A clocked unit may terminate level rather than forcing a sudden-death point. */
  drawsAllowed: boolean;
  noShowGraceMinutes: number;
  countWalkoverInDifference: boolean;
}

/**
 * WHO IS SCORING. A profile, not a flag: seven console behaviours move together, and
 * nobody wants challenge UI without an umpire or a two-level undo when the scorer is
 * also a player. Both ship; the mode is chosen per draw.
 */
export const OFFICIATING_MODES = ['officiated', 'selfScored'] as const;
export type OfficiatingMode = (typeof OFFICIATING_MODES)[number];

/** How a result reaches us. Summary entry is the PRIMARY path for self-scored play. */
export const ENTRY_MODES = ['pointByPoint', 'unitScoresOnly', 'resultOnly'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export const CHANGE_ENDS_RULES = [
  'never',
  'betweenUnits',
  'oddCumulativeUnits',   // tennis: whenever cumulative games in the set is odd
  'atDeciderMidpoint',    // badminton/volleyball: at switchEndsAt, decider only
  'everyNPoints',         // tie-breaks: every 6 points
] as const;
export type ChangeEndsRule = (typeof CHANGE_ENDS_RULES)[number];

export const PENALTY_MODES = ['off', 'point', 'pointGameMatch'] as const;
export type PenaltyMode = (typeof PENALTY_MODES)[number];

export interface ScoringFormat {
  /** Lowercased sport name, matching the sports catalogue. */
  sport: string;
  /** The shelf preset this was derived from, if any. */
  presetKey?: string;
  name: string;
  /** Ordered innermost -> outermost. The last entry is the match. */
  levels: LevelSpec[];
  /** Default serve rules; a level may override. */
  serve: ServeSpec;
  officiatingMode: OfficiatingMode;
  entryMode: EntryMode;
  changeEnds: ChangeEndsRule;
  changeEndsAt?: number;
  penaltyEvents: PenaltyMode;
  letsEnabled: boolean;
  doubles?: boolean;
  clock?: ClockSpec | null;
  endStates: EndStatePolicy;
  /** Sport-owned plugins (table tennis `expedite`). Namespaced, never flattened. */
  plugins?: Record<string, unknown>;
  /** Printed on the draw sheet, never read by the engine. */
  rulesSheet?: Record<string, unknown>;
}

// ---- outcomes --------------------------------------------------------------

// Widened from win|loss because a clocked group match may legitimately end level.
// Standings already handles this end-to-end (schemes.ts leagueTally takes win/draw/loss
// points, career_stats has a `drawn` column) - it has simply never been fed a draw.
export const OUTCOMES = ['win', 'draw', 'void'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const END_REASONS = [
  'normal', 'cap', 'retired', 'walkover', 'default', 'disqualified',
  'abandoned', 'conceded', 'override',
] as const;
export type EndReason = (typeof END_REASONS)[number];

// ---- zod -------------------------------------------------------------------

export const serveSpecSchema: z.ZodType<ServeSpec> = z.object({
  pointScoring: z.enum(POINT_SCORING),
  movement: z.enum(SERVE_MOVEMENT),
  every: z.number().int().positive().optional(),
  collapseAt: z.number().int().nonnegative().nullable().optional(),
  collapseEvery: z.number().int().positive().optional(),
  firstTurnEvery: z.number().int().positive().optional(),
  serversPerSide: z.number().int().min(1).max(2).optional(),
  firstTurnSingle: z.boolean().optional(),
  resolver: z.enum(SERVE_RESOLVERS),
  courtModel: z.enum(COURT_MODELS),
  firstServer: z.enum(FIRST_SERVER_RULES),
  nextUnitServer: z.enum(NEXT_UNIT_SERVERS),
});

const levelOverrideSchema: z.ZodType<LevelOverride> = z.object({
  target: z.number().int().positive().optional(),
  winBy: z.number().int().positive().optional(),
  cap: z.number().int().positive().nullable().optional(),
  switchEndsAt: z.number().int().positive().nullable().optional(),
  startingScore: z.tuple([z.number().int(), z.number().int()]).optional(),
  serve: serveSpecSchema.optional(),
  collapsed: z.boolean().optional(),
  pointLabels: z.array(z.string()).nullable().optional(),
});

// Recursive: a level's `substitute.spec` is itself a level. z.lazy defers evaluation
// until parse() runs, which is the standard shape for self-referential zod schemas.
export const levelSpecSchema: z.ZodType<LevelSpec, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  target: z.number().int().positive(),
  winBy: z.number().int().positive(),
  terminator: z.enum(TERMINATORS).optional(),
  decide: z.enum(DECIDERS).optional(),
  cap: z.number().int().positive().nullable(),
  startingScore: z.tuple([z.number().int(), z.number().int()]).optional(),
  pointLabels: z.array(z.string()).optional(),
  switchEndsAt: z.number().int().positive().nullable().optional(),
  playAll: z.boolean().optional(),
  serve: serveSpecSchema.optional(),
  deciderOverride: levelOverrideSchema.optional(),
  substitute: z.object({ atUnits: z.number().int().nonnegative(), spec: levelSpecSchema }).optional(),
}));

export const clockSpecSchema: z.ZodType<ClockSpec> = z.object({
  scope: z.enum(CAP_SCOPES),
  minutes: z.number().positive(),
  action: z.enum(CAP_ACTIONS),
  tieRule: z.enum(CAP_TIE_RULES),
  warningSeconds: z.number().int().nonnegative().optional(),
  pauseOnStoppage: z.boolean(),
});

export const endStatePolicySchema: z.ZodType<EndStatePolicy> = z.object({
  walkoverScoreline: z.enum(WALKOVER_SCORELINES),
  retirementScore: z.enum(RETIREMENT_POLICIES),
  drawsAllowed: z.boolean(),
  noShowGraceMinutes: z.number().int().nonnegative(),
  countWalkoverInDifference: z.boolean(),
});

export const scoringFormatSchema = z.object({
  sport: z.string().min(1),
  presetKey: z.string().optional(),
  name: z.string().min(1),
  levels: z.array(levelSpecSchema).min(1).max(4),
  serve: serveSpecSchema,
  officiatingMode: z.enum(OFFICIATING_MODES),
  entryMode: z.enum(ENTRY_MODES),
  changeEnds: z.enum(CHANGE_ENDS_RULES),
  changeEndsAt: z.number().int().positive().optional(),
  penaltyEvents: z.enum(PENALTY_MODES),
  letsEnabled: z.boolean(),
  doubles: z.boolean().optional(),
  clock: clockSpecSchema.nullable().optional(),
  endStates: endStatePolicySchema,
  plugins: z.record(z.unknown()).optional(),
  rulesSheet: z.record(z.unknown()).optional(),
}).superRefine((f, ctx) => {
  // A tie-break substitutes for the unit BELOW, so the innermost level has nothing
  // to substitute - catching this here beats a silently-ignored config.
  if (f.levels[0]?.substitute) {
    ctx.addIssue({ code: 'custom', path: ['levels', 0, 'substitute'],
      message: 'The innermost level has no child unit to substitute' });
  }
  for (const [i, lv] of f.levels.entries()) {
    if (lv.cap !== null && lv.cap < lv.target) {
      ctx.addIssue({ code: 'custom', path: ['levels', i, 'cap'],
        message: `cap (${lv.cap}) must be at least target (${lv.target})` });
    }
  }
});
