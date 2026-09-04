import type {
  CapAction, CapTieRule, ChangeEndsRule, LevelSpec, OfficiatingMode,
  ScoringFormat, ServeMovement, PointScoring,
} from './scoring-rules.js';

// ============================================================================
// The EDITING model for a scoring format.
//
// `ScoringFormat` is the storage model: a nested array of levels, which is what
// makes tennis expressible and what the kernel folds against. It is a poor thing to
// put in front of a person - "levels[0].deciderOverride.target" is not a question
// anybody can answer.
//
// So this is the flat one. Read a format into ~20 named knobs, let somebody change
// them, write them back. Pure and tested, so the UI is only rendering: no screen
// needs to know that a cap lives on a level or that the decider is an override.
//
// A knob that would break the format is not offered - `knobsFor` returns only those
// that apply to the format in hand, because "serve every N" is meaningless when the
// serve follows the rally winner, and offering it invites a config that cannot happen.
// ============================================================================

export interface FormatKnobs {
  // ---- match shape
  /** Units needed to win the match: 1 = single game, 2 = best of 3, 3 = best of 5. */
  unitsToWin: number;
  /** Points to win one game / set. */
  target: number;
  /** Required margin. 1 = sudden death at the target, 2 = deuce. */
  winBy: number;
  capEnabled: boolean;
  /** Hard ceiling - reaching it wins regardless of margin. */
  cap: number;
  /** A different target in the deciding game (badminton 11, volleyball 15). */
  deciderEnabled: boolean;
  deciderTarget: number;
  /** Handicap: the weaker side starts each game on this score. */
  handicapEnabled: boolean;
  handicapHome: number;
  handicapAway: number;

  // ---- serving
  pointScoring: PointScoring;
  movement: ServeMovement;
  /** `everyN` only: serves per turn. 2 = ITTF, 5 = legacy 21, 3 = the Sprint format. */
  serveEvery: number;
  /** Score at which the serve collapses to one each. 0 = never. */
  collapseAt: number;
  /** `handOut` only: servers per side before the serve crosses. */
  serversPerSide: number;
  /** Pickleball's 0-0-2 / squash's single first hand. */
  firstTurnSingle: boolean;

  // ---- ends, breaks, conduct
  changeEnds: ChangeEndsRule;
  /** Score that triggers the mid-game change of ends (decider only). */
  switchEndsAt: number;
  letsEnabled: boolean;
  penaltiesEnabled: boolean;

  // ---- the clock
  clockEnabled: boolean;
  clockMinutes: number;
  clockAction: CapAction;
  clockTieRule: CapTieRule;

  // ---- how it is run
  officiatingMode: OfficiatingMode;
  drawsAllowed: boolean;
}

/** UI metadata for one knob. Rendering is generic; this is what makes it legible. */
export interface KnobSpec {
  key: keyof FormatKnobs;
  label: string;
  hint?: string;
  group: 'shape' | 'serve' | 'ends' | 'clock' | 'run';
  type: 'int' | 'bool' | 'enum';
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  /** Only offered when this returns true for the format being edited. */
  applies?: (k: FormatKnobs) => boolean;
}

const MOVEMENTS: Array<{ value: ServeMovement; label: string }> = [
  { value: 'rallyWinner', label: 'To the rally winner (badminton, squash)' },
  { value: 'everyN', label: 'Every N points (table tennis)' },
  { value: 'perUnit', label: 'Once per game (tennis)' },
  { value: 'handOut', label: 'Server keeps it until they lose (pickleball)' },
  { value: 'none', label: 'No serve' },
];

export const KNOB_SPECS: KnobSpec[] = [
  // ---- shape
  { key: 'target', label: 'Points to win a game', group: 'shape', type: 'int', min: 1, max: 99,
    hint: 'The score a side plays to. 11, 21, 15 — or anything you like.' },
  { key: 'winBy', label: 'Winning margin', group: 'shape', type: 'int', min: 1, max: 5,
    hint: '2 means deuce continues until somebody leads by two. 1 means the target wins outright.' },
  { key: 'capEnabled', label: 'Hard ceiling', group: 'shape', type: 'bool',
    hint: 'Ends the game at a fixed score no matter the margin, so deuce cannot run forever.' },
  { key: 'cap', label: 'Ceiling score', group: 'shape', type: 'int', min: 1, max: 199,
    applies: (k) => k.capEnabled },
  { key: 'unitsToWin', label: 'Games to win the match', group: 'shape', type: 'int', min: 1, max: 7,
    hint: '1 = a single game. 2 = best of 3. 3 = best of 5. 4 = best of 7.' },
  { key: 'deciderEnabled', label: 'Deciding game plays to a different score', group: 'shape', type: 'bool',
    hint: 'Badminton to 11 in the decider, volleyball to 15.',
    applies: (k) => k.unitsToWin > 1 },
  { key: 'deciderTarget', label: 'Deciding game target', group: 'shape', type: 'int', min: 1, max: 99,
    applies: (k) => k.unitsToWin > 1 && k.deciderEnabled },
  { key: 'handicapEnabled', label: 'Handicap start', group: 'shape', type: 'bool',
    hint: 'One side begins every game on a head start.' },
  { key: 'handicapHome', label: 'Home starts on', group: 'shape', type: 'int', min: 0, max: 98,
    applies: (k) => k.handicapEnabled },
  { key: 'handicapAway', label: 'Away starts on', group: 'shape', type: 'int', min: 0, max: 98,
    applies: (k) => k.handicapEnabled },

  // ---- serve
  { key: 'pointScoring', label: 'Who can score', group: 'serve', type: 'enum',
    hint: 'Rally scoring gives every rally a point. Server-only is the old side-out game: winning as receiver takes the serve, not a point.',
    options: [
      { value: 'rally', label: 'Every rally scores' },
      { value: 'serverOnly', label: 'Only the server scores' },
    ] },
  { key: 'movement', label: 'How the serve moves', group: 'serve', type: 'enum',
    options: MOVEMENTS as Array<{ value: string; label: string }> },
  { key: 'serveEvery', label: 'Serves per turn', group: 'serve', type: 'int', min: 1, max: 10,
    hint: 'Table tennis is 2. The old 21-point game was 5.',
    applies: (k) => k.movement === 'everyN' },
  { key: 'collapseAt', label: 'One serve each from', group: 'serve', type: 'int', min: 0, max: 98,
    hint: 'Both sides at this score and the serve changes every point. 0 to never.',
    applies: (k) => k.movement === 'everyN' },
  { key: 'serversPerSide', label: 'Servers per side', group: 'serve', type: 'int', min: 1, max: 2,
    hint: 'Two means the serve only crosses after both partners have lost it.',
    applies: (k) => k.movement === 'handOut' },
  { key: 'firstTurnSingle', label: 'First turn gets one server', group: 'serve', type: 'bool',
    hint: "Pickleball's 0-0-2 opening. Without it the first side serves twice over.",
    applies: (k) => k.movement === 'handOut' && k.serversPerSide > 1 },

  // ---- ends
  { key: 'changeEnds', label: 'Change ends', group: 'ends', type: 'enum',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'betweenUnits', label: 'Between games' },
      { value: 'atDeciderMidpoint', label: 'Midway through the decider' },
      { value: 'oddCumulativeUnits', label: 'Every odd game (tennis)' },
      { value: 'everyNPoints', label: 'Every N points (tie-breaks)' },
    ] },
  { key: 'switchEndsAt', label: 'Change ends at', group: 'ends', type: 'int', min: 1, max: 98,
    hint: 'Badminton swaps at 11 in the decider.',
    applies: (k) => k.changeEnds === 'atDeciderMidpoint' || k.changeEnds === 'everyNPoints' },
  { key: 'letsEnabled', label: 'Allow lets', group: 'ends', type: 'bool',
    hint: 'A replayed rally: no point, no change of serve.' },
  { key: 'penaltiesEnabled', label: 'Allow conduct points', group: 'ends', type: 'bool',
    hint: 'An official can award a point for misconduct. Off for self-scored play — a player cannot card their opponent.' },

  // ---- clock
  { key: 'clockEnabled', label: 'Time cap', group: 'clock', type: 'bool',
    hint: 'Ends the match on the clock when the hall booking, not the score, decides.' },
  { key: 'clockMinutes', label: 'Minutes', group: 'clock', type: 'int', min: 1, max: 240,
    applies: (k) => k.clockEnabled },
  { key: 'clockAction', label: 'At the buzzer', group: 'clock', type: 'enum',
    applies: (k) => k.clockEnabled,
    options: [
      { value: 'finishPointThenLeader', label: 'Finish the rally, highest score wins' },
      { value: 'leaderWins', label: 'Stop at once, highest score wins' },
      { value: 'nextPointWins', label: 'Next point wins' },
      { value: 'finishUnit', label: 'Play the current game out' },
      { value: 'stopImmediately', label: 'Stop immediately' },
    ] },
  { key: 'clockTieRule', label: 'If the scores are level', group: 'clock', type: 'enum',
    applies: (k) => k.clockEnabled,
    options: [
      { value: 'suddenDeathPoint', label: 'Play a sudden-death point' },
      { value: 'draw', label: 'Record a draw' },
      { value: 'organiserDecides', label: 'Leave it to the organiser' },
    ] },

  // ---- run
  { key: 'officiatingMode', label: 'Who scores', group: 'run', type: 'enum',
    hint: 'Self-scored changes the console: unlimited undo, no challenge UI, conduct points off, and both sides confirm the result.',
    options: [
      { value: 'officiated', label: 'An official' },
      { value: 'selfScored', label: 'The players themselves' },
    ] },
  { key: 'drawsAllowed', label: 'Allow a draw', group: 'run', type: 'bool',
    hint: 'A clocked match that ends level stands as a draw instead of forcing an extra point.' },
];

export const KNOB_GROUPS: Array<{ key: KnobSpec['group']; label: string }> = [
  { key: 'shape', label: 'Match shape' },
  { key: 'serve', label: 'Serving' },
  { key: 'ends', label: 'Ends & conduct' },
  { key: 'clock', label: 'Time cap' },
  { key: 'run', label: 'How it is run' },
];

/** The knobs that apply to this particular set of values, in display order. */
export function knobsFor(k: FormatKnobs): KnobSpec[] {
  return KNOB_SPECS.filter((s) => !s.applies || s.applies(k));
}

// ---- read ------------------------------------------------------------------

/**
 * Flatten a format into knobs.
 *
 * Reads the INNERMOST level (where points are counted) and the outermost (the
 * match). A tennis-shaped format has a set level between them that these knobs do
 * not describe - see `isEditable` below, which is why the editor refuses it rather
 * than silently flattening a set away.
 */
export function readKnobs(f: ScoringFormat): FormatKnobs {
  const inner = f.levels[0];
  const top = f.levels[f.levels.length - 1];
  const unitsToWin = f.levels.length > 1 ? top.target : 1;
  /**
   * A SINGLE-UNIT match has no decider to override - the one game IS the whole
   * match. Volleyball's single-set format nonetheless carries a deciderOverride, so
   * reading it as "decider enabled" reported a knob the editor deliberately hides
   * (it applies only when unitsToWin > 1) and that applyKnobs then dropped: opening
   * that format and pressing Save silently moved the mid-set change of ends from 8
   * to 12. The override IS the format here, so it is folded into the base knobs.
   */
  const dec = unitsToWin > 1 ? inner.deciderOverride : undefined;
  const soleOverride = unitsToWin > 1 ? undefined : inner.deciderOverride;
  const serve = inner.serve ?? f.serve;
  const start = inner.startingScore;
  return {
    unitsToWin,
    target: soleOverride?.target ?? inner.target,
    winBy: soleOverride?.winBy ?? inner.winBy,
    capEnabled: (soleOverride?.cap ?? inner.cap) != null,
    cap: soleOverride?.cap ?? inner.cap ?? inner.target + 4,
    deciderEnabled: dec?.target != null,
    deciderTarget: dec?.target ?? inner.target,
    handicapEnabled: !!start && (start[0] !== 0 || start[1] !== 0),
    handicapHome: start?.[0] ?? 0,
    handicapAway: start?.[1] ?? 0,

    pointScoring: serve.pointScoring,
    movement: serve.movement,
    serveEvery: serve.every ?? 2,
    collapseAt: serve.collapseAt ?? 0,
    serversPerSide: serve.serversPerSide ?? 1,
    firstTurnSingle: !!serve.firstTurnSingle,

    changeEnds: f.changeEnds,
    switchEndsAt: soleOverride?.switchEndsAt ?? inner.switchEndsAt ?? dec?.switchEndsAt
      ?? f.changeEndsAt ?? Math.floor(inner.target / 2),
    letsEnabled: f.letsEnabled,
    penaltiesEnabled: f.penaltyEvents !== 'off',

    clockEnabled: !!f.clock,
    clockMinutes: f.clock?.minutes ?? 20,
    clockAction: f.clock?.action ?? 'finishPointThenLeader',
    clockTieRule: f.clock?.tieRule ?? 'suddenDeathPoint',

    officiatingMode: f.officiatingMode,
    drawsAllowed: f.endStates.drawsAllowed,
  };
}

/**
 * Can these knobs describe this format without losing anything?
 *
 * A tennis format has three levels (game inside set inside match) and may splice a
 * tie-break in at 6-6. Flattening that to "points to win a game" would quietly throw
 * the set away, so the editor shows the knobs read-only and says why instead of
 * offering an edit that corrupts the format.
 */
export function isEditable(f: ScoringFormat): boolean {
  return f.levels.length <= 2 && !f.levels.some((l) => l.substitute) && !f.levels[0].pointLabels;
}

// ---- write -----------------------------------------------------------------

/**
 * Apply knobs back onto a format, returning a new one. Never mutates the input.
 *
 * Only the fields the knobs cover are touched; everything else - the serve resolver,
 * the court model, the rules sheet, any sport plugin - is carried through, because a
 * custom format is a VARIANT of a real one, not a blank slate. That is what keeps a
 * hand-built badminton format still naming the right partner to serve.
 */
export function applyKnobs(f: ScoringFormat, k: FormatKnobs, name?: string): ScoringFormat {
  const baseInner = f.levels[0];
  const baseServe = baseInner.serve ?? f.serve;

  const serve = {
    ...baseServe,
    pointScoring: k.pointScoring,
    movement: k.movement,
    ...(k.movement === 'everyN'
      ? { every: Math.max(1, k.serveEvery), collapseAt: k.collapseAt > 0 ? k.collapseAt : null, collapseEvery: 1 }
      : { every: undefined, collapseAt: null }),
    ...(k.movement === 'handOut'
      ? { serversPerSide: k.serversPerSide, firstTurnSingle: k.serversPerSide > 1 && k.firstTurnSingle }
      : { serversPerSide: undefined, firstTurnSingle: undefined }),
  };

  const inner: LevelSpec = {
    ...baseInner,
    target: Math.max(1, k.target),
    winBy: Math.max(1, k.winBy),
    // A ceiling below the target can never be reached by the target rule, so it is
    // clamped rather than saved as a format that cannot finish normally.
    cap: k.capEnabled ? Math.max(k.target, k.cap) : null,
    startingScore: k.handicapEnabled ? [Math.max(0, k.handicapHome), Math.max(0, k.handicapAway)] : undefined,
    switchEndsAt: k.changeEnds === 'atDeciderMidpoint' ? Math.max(1, k.switchEndsAt) : baseInner.switchEndsAt ?? null,
    serve,
    deciderOverride: k.unitsToWin > 1
      ? (k.deciderEnabled
        ? {
          ...(baseInner.deciderOverride ?? {}),
          target: Math.max(1, k.deciderTarget),
          // A shorter decider keeps its own ceiling proportionate rather than
          // inheriting a 30-point cap onto a game to 11.
          cap: k.capEnabled ? Math.max(k.deciderTarget, k.cap - (k.target - k.deciderTarget)) : null,
        }
        : undefined)
      // A SINGLE-UNIT match: the decider knobs are hidden (they apply only when
      // unitsToWin > 1), so this function has no business deleting an override it
      // never offered to edit. Dropping it lost volleyball's single-set change of
      // ends at 8 - carried through instead, exactly as the serve resolver and the
      // rules sheet are.
      : baseInner.deciderOverride,
  };

  const levels: LevelSpec[] = k.unitsToWin > 1
    ? [inner, { key: 'match', label: 'Match', target: k.unitsToWin, winBy: 1, cap: null }]
    : [inner, { key: 'match', label: 'Match', target: 1, winBy: 1, cap: null }];

  return {
    ...f,
    ...(name ? { name } : {}),
    levels,
    serve,
    officiatingMode: k.officiatingMode,
    // Self-scored play is recorded at the desk far more often than tapped live.
    entryMode: k.officiatingMode === 'selfScored' ? 'unitScoresOnly' : 'pointByPoint',
    changeEnds: k.changeEnds,
    ...(k.changeEnds === 'everyNPoints' ? { changeEndsAt: Math.max(1, k.switchEndsAt) } : {}),
    letsEnabled: k.letsEnabled,
    // A player cannot card their opponent, whatever the knob says.
    penaltyEvents: k.penaltiesEnabled && k.officiatingMode === 'officiated' ? 'pointGameMatch' : 'off',
    clock: k.clockEnabled
      ? {
        scope: f.clock?.scope ?? 'match',
        minutes: Math.max(1, k.clockMinutes),
        action: k.clockAction,
        tieRule: k.clockTieRule,
        warningSeconds: f.clock?.warningSeconds ?? 120,
        pauseOnStoppage: f.clock?.pauseOnStoppage ?? false,
      }
      : null,
    endStates: { ...f.endStates, drawsAllowed: k.drawsAllowed },
  };
}

/** One line describing what a format does, for a list row. */
export function describeKnobs(k: FormatKnobs): string {
  const bits: string[] = [];
  bits.push(k.unitsToWin > 1 ? `best of ${k.unitsToWin * 2 - 1} to ${k.target}` : `single game to ${k.target}`);
  bits.push(k.winBy > 1 ? `win by ${k.winBy}` : 'sudden death');
  if (k.capEnabled) bits.push(`cap ${k.cap}`);
  if (k.deciderEnabled && k.unitsToWin > 1) bits.push(`decider to ${k.deciderTarget}`);
  if (k.movement === 'everyN') bits.push(`serve every ${k.serveEvery}`);
  if (k.pointScoring === 'serverOnly') bits.push('server scores only');
  if (k.handicapEnabled) bits.push(`handicap ${k.handicapHome}–${k.handicapAway}`);
  if (k.clockEnabled) bits.push(`${k.clockMinutes} min cap`);
  return bits.join(' · ');
}
