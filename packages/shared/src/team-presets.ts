import type {
  ClockSpec, EndStatePolicy, LevelSpec, OfficiatingMode, ScoringFormat, ServeSpec,
} from './scoring-rules.js';

// ============================================================================
// Everything that is not a racquet sport.
//
// The same kernel, the same level array, the same event log. What the other
// families add is two ideas, both now in scoring-rules.ts:
//
//   terminator: 'clock'    a half ends on the whistle, not on a score
//   decide: 'aggregate'    the match is won on TOTAL score, not units won
//
// With those, an invasion sport is a two-level format like any other:
// [ half(clock), match(2 halves, aggregate) ]. Nothing about serving, deuce or
// caps applies, so those levels simply do not declare them.
//
// DELIBERATELY NOT HERE:
//   cricket / box cricket  - a different grain (per innings), and a dismissal
//                            references three people from one fact. Its own model.
//   the ten measured and judged sports (athletics, swimming, weightlifting,
//   powerlifting, gymnastics, yoga, shooting, archery, cycling, rowing) - not
//   head-to-head at all. The existing EventSpec layer is the right model and is
//   already live; forcing them through a two-sided kernel would be a downgrade.
// ============================================================================

const STRICT: EndStatePolicy = {
  walkoverScoreline: 'targetToZero',
  retirementScore: 'freezeAsPlayed',
  drawsAllowed: false,
  noShowGraceMinutes: 15,
  countWalkoverInDifference: false,
};

/** League play wants a draw to stand; a knockout must produce somebody. */
const LEAGUE: EndStatePolicy = { ...STRICT, drawsAllowed: true, noShowGraceMinutes: 10 };

/** No serve at all - invasion, raid and combat sports. */
const NO_SERVE: ServeSpec = {
  pointScoring: 'rally',
  movement: 'none',
  resolver: 'none',
  courtModel: 'none',
  firstServer: 'toss',
  nextUnitServer: 'alternate',
};

/** Volleyball-family serve: the rally winner serves next, one name per side. */
const RALLY_SERVE: ServeSpec = {
  pointScoring: 'rally',
  movement: 'rallyWinner',
  resolver: 'none',
  courtModel: 'none',
  firstServer: 'toss',
  nextUnitServer: 'previousWinner',
};

/** The serve passes with the unit - carrom boards, snooker frames. */
const PER_UNIT_SERVE: ServeSpec = { ...NO_SERVE, movement: 'perUnit' };

const cap = (minutes: number, action: ClockSpec['action'] = 'finishPointThenLeader',
  tieRule: ClockSpec['tieRule'] = 'draw'): ClockSpec => ({
  scope: 'match', minutes, action, tieRule, warningSeconds: 120, pauseOnStoppage: false,
});

/** A clock-terminated period: no target, no cap, ends on the whistle. */
const period = (label: string, key = label.toLowerCase()): LevelSpec =>
  ({ key, label, target: 1, winBy: 1, cap: null, terminator: 'clock' });

/** An aggregate match: `target` is how many periods are played. */
const aggregateMatch = (periods: number): LevelSpec =>
  ({ key: 'match', label: 'Match', target: periods, winBy: 1, cap: null, decide: 'aggregate' });

/** A units match: first to `units`. */
const unitsMatch = (units: number): LevelSpec =>
  ({ key: 'match', label: 'Match', target: units, winBy: 1, cap: null });

interface Opts {
  sport: string;
  key: string;
  name: string;
  levels: LevelSpec[];
  serve?: ServeSpec;
  mode?: OfficiatingMode;
  clock?: ClockSpec | null;
  changeEnds?: ScoringFormat['changeEnds'];
  endStates?: EndStatePolicy;
  rulesSheet?: Record<string, unknown>;
}

function fmt(o: Opts): ScoringFormat {
  const mode = o.mode ?? 'officiated';
  const selfScored = mode === 'selfScored';
  return {
    sport: o.sport,
    presetKey: o.key,
    name: o.name,
    levels: o.levels,
    serve: o.serve ?? NO_SERVE,
    officiatingMode: mode,
    entryMode: selfScored ? 'unitScoresOnly' : 'pointByPoint',
    changeEnds: o.changeEnds ?? 'betweenUnits',
    penaltyEvents: selfScored ? 'off' : 'pointGameMatch',
    letsEnabled: false,
    clock: o.clock ?? null,
    endStates: o.endStates ?? (selfScored ? LEAGUE : STRICT),
    ...(o.rulesSheet ? { rulesSheet: o.rulesSheet } : {}),
  };
}

// ============================================================================
// NET & RALLY - volleyball, throwball
//
// The easiest fit in the whole catalogue, and the platform had none of it: a
// volleyball set is 25 by 2 with the decider to 15, which is a target level with a
// decider override. Exactly the racquet shape.
// ============================================================================

const vSet = (target: number, decider: number, switchEndsAt: number | null = null): LevelSpec => ({
  key: 'set', label: 'Set', target, winBy: 2, cap: null, switchEndsAt,
  deciderOverride: { target: decider, switchEndsAt: 8 },
});

const NET: ScoringFormat[] = [
  fmt({
    sport: 'volleyball', key: 'fivb_25_bo5', name: 'FIVB — best of 5 sets to 25 (decider 15)',
    levels: [vSet(25, 15, 13), unitsMatch(3)], serve: RALLY_SERVE,
    changeEnds: 'atDeciderMidpoint',
    rulesSheet: { rotation: 'not tracked by the console', libero: 'not tracked', timeoutsPerSet: 2 },
  }),
  fmt({
    sport: 'volleyball', key: 'fivb_25_bo3', name: 'Best of 3 sets to 25 (decider 15)',
    levels: [vSet(25, 15, 13), unitsMatch(2)], serve: RALLY_SERVE, changeEnds: 'atDeciderMidpoint',
  }),
  fmt({
    sport: 'volleyball', key: 'corp_21_bo3', name: 'Corporate — best of 3 sets to 21 (decider 15)',
    levels: [vSet(21, 15), unitsMatch(2)], serve: RALLY_SERVE, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'volleyball', key: 'single_set_25', name: 'Single set to 25',
    levels: [vSet(25, 25), unitsMatch(1)], serve: RALLY_SERVE, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'volleyball', key: 'timecap_15min', name: 'Time-capped set — 15 minutes, highest score',
    levels: [{ key: 'set', label: 'Set', target: 25, winBy: 1, cap: null }, unitsMatch(1)],
    serve: RALLY_SERVE, mode: 'selfScored', clock: cap(15), changeEnds: 'never', endStates: LEAGUE,
  }),

  fmt({
    sport: 'throwball', key: 'tb_bo3_15', name: 'Best of 3 sets to 15',
    levels: [vSet(15, 15), unitsMatch(2)], serve: RALLY_SERVE, changeEnds: 'never',
  }),
  fmt({
    sport: 'throwball', key: 'tb_bo3_21', name: 'Best of 3 sets to 21',
    levels: [vSet(21, 21), unitsMatch(2)], serve: RALLY_SERVE, changeEnds: 'never',
  }),
  fmt({
    sport: 'throwball', key: 'tb_single_15', name: 'Single set to 15',
    levels: [vSet(15, 15), unitsMatch(1)], serve: RALLY_SERVE, mode: 'selfScored', changeEnds: 'never',
  }),
];

// ============================================================================
// INVASION & GOAL - football, futsal, hockey, handball, basketball, frisbee
//
// Clock-terminated periods, aggregate score. This is what the kernel could not
// express before: a football half does not end at a score, and a football match is
// not won by winning halves.
//
// A level total with no draw allowed leaves the match OPEN rather than inventing a
// winner - extra time or a shoot-out settles it, recorded through the same
// `end` event as a retirement.
// ============================================================================

const INVASION: ScoringFormat[] = [
  fmt({
    sport: 'football', key: 'fifa_2x45', name: 'Two halves of 45 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], clock: cap(90, 'leaderWins'),
    endStates: LEAGUE,
    rulesSheet: { offside: 'not adjudicated', substitutions: 5, addedTime: 'at the referee’s discretion' },
  }),
  fmt({
    sport: 'football', key: 'football_corp_2x20', name: 'Corporate — two halves of 20 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(40, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'football', key: 'knockout_2x45_no_draw', name: 'Knockout — two halves, no draw',
    levels: [period('Half', 'half'), aggregateMatch(2)], clock: cap(90, 'leaderWins', 'organiserDecides'),
    endStates: STRICT,
  }),

  fmt({
    sport: 'futsal', key: 'futsal_2x20', name: 'Two halves of 20 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], clock: cap(40, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'futsal', key: 'futsal_2x15', name: 'Two halves of 15 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(30, 'leaderWins'), endStates: LEAGUE,
  }),

  fmt({
    sport: 'basketball', key: 'fiba_4x10', name: 'FIBA — four quarters of 10 minutes',
    levels: [period('Quarter', 'quarter'), aggregateMatch(4)], clock: cap(40, 'leaderWins', 'organiserDecides'),
    endStates: STRICT,
    rulesSheet: { shotClockSeconds: 24, foulsToDisqualify: 5, timeoutsPerHalf: 2 },
  }),
  fmt({
    sport: 'basketball', key: 'basketball_corp_2x10', name: 'Corporate — two halves of 10 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(20, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'basketball', key: 'street_21', name: 'Streetball — first to 21',
    levels: [{ key: 'game', label: 'Game', target: 21, winBy: 2, cap: null }, unitsMatch(1)],
    mode: 'selfScored', changeEnds: 'never', endStates: STRICT,
  }),

  fmt({
    sport: 'hockey', key: 'fih_4x15', name: 'FIH — four quarters of 15 minutes',
    levels: [period('Quarter', 'quarter'), aggregateMatch(4)], clock: cap(60, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'hockey', key: 'hockey_corp_2x20', name: 'Corporate — two halves of 20 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(40, 'leaderWins'), endStates: LEAGUE,
  }),

  fmt({
    sport: 'handball', key: 'ihf_2x30', name: 'Two halves of 30 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], clock: cap(60, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'handball', key: 'corp_2x15', name: 'Corporate — two halves of 15 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(30, 'leaderWins'), endStates: LEAGUE,
  }),

  fmt({
    sport: 'frisbee', key: 'ultimate_to_15', name: 'Ultimate — first to 15',
    levels: [{ key: 'game', label: 'Game', target: 15, winBy: 1, cap: null }, unitsMatch(1)],
    mode: 'selfScored', changeEnds: 'never', endStates: STRICT,
    rulesSheet: { selfRefereed: true, spiritOfTheGame: 'scored separately, not by the console' },
  }),
  fmt({
    sport: 'frisbee', key: 'ultimate_2x20', name: 'Two halves of 20 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(40, 'leaderWins'), endStates: LEAGUE,
  }),
];

// ============================================================================
// RAID & TAG - kabaddi, kho kho
//
// The best-served family, because the console ALREADY has the event buttons
// (raid / tackle / bonus / all-out, each perPlayer) - they were simply throwing the
// picked player away before it reached the log.
// ============================================================================

const RAID: ScoringFormat[] = [
  fmt({
    sport: 'kabaddi', key: 'pkl_2x20', name: 'Two halves of 20 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], clock: cap(40, 'leaderWins'), endStates: LEAGUE,
    rulesSheet: { doOrDieRaid: 'every third empty raid', superTackle: 'defenders 3 or fewer', matSize: '13x10m' },
  }),
  fmt({
    sport: 'kabaddi', key: 'kabaddi_corp_2x10', name: 'Corporate — two halves of 10 minutes',
    levels: [period('Half', 'half'), aggregateMatch(2)], mode: 'selfScored',
    clock: cap(20, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'kho-kho', key: 'kho_2x9', name: 'Two innings of 9 minutes',
    levels: [period('Innings', 'innings'), aggregateMatch(2)], clock: cap(18, 'leaderWins'), endStates: LEAGUE,
  }),
  fmt({
    sport: 'kho-kho', key: 'kho_4turns', name: 'Four turns (two each)',
    levels: [period('Turn', 'turn'), aggregateMatch(4)], clock: cap(36, 'leaderWins'), endStates: LEAGUE,
  }),
];

// ============================================================================
// BOARD, FRAME & TABLE - carrom, pool/snooker, chess
// ============================================================================

const BOARD: ScoringFormat[] = [
  fmt({
    sport: 'carrom', key: 'icf_bo3_boards', name: 'ICF — best of 3 boards to 25',
    levels: [{ key: 'board', label: 'Board', target: 25, winBy: 1, cap: null }, unitsMatch(2)],
    serve: PER_UNIT_SERVE, changeEnds: 'betweenUnits',
    rulesSheet: { queenMustBeCovered: true, boardPointsCappedAt: 25 },
  }),
  fmt({
    sport: 'carrom', key: 'corp_bo3_21', name: 'Corporate — best of 3 boards to 21',
    levels: [{ key: 'board', label: 'Board', target: 21, winBy: 1, cap: null }, unitsMatch(2)],
    serve: PER_UNIT_SERVE, mode: 'selfScored',
  }),
  fmt({
    sport: 'carrom', key: 'boards_bo5', name: 'Best of 5 boards (board winner only)',
    levels: [{ key: 'board', label: 'Board', target: 1, winBy: 1, cap: null }, unitsMatch(3)],
    serve: PER_UNIT_SERVE, mode: 'selfScored',
  }),

  fmt({
    sport: 'pool/snooker', key: 'frames_bo5', name: 'Best of 5 frames',
    levels: [{ key: 'frame', label: 'Frame', target: 1, winBy: 1, cap: null }, unitsMatch(3)],
    serve: PER_UNIT_SERVE,
    rulesSheet: { frameScoring: 'the console records who won the frame, not the break' },
  }),
  fmt({
    sport: 'pool/snooker', key: 'frames_bo3', name: 'Best of 3 frames',
    levels: [{ key: 'frame', label: 'Frame', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    serve: PER_UNIT_SERVE, mode: 'selfScored',
  }),
  fmt({
    sport: 'pool/snooker', key: 'single_frame', name: 'Single frame',
    levels: [{ key: 'frame', label: 'Frame', target: 1, winBy: 1, cap: null }, unitsMatch(1)],
    serve: PER_UNIT_SERVE, mode: 'selfScored',
  }),

  // Chess is the reason `drawsAllowed` had to be real: a drawn board is the normal
  // case, not an edge one. A board is won, drawn or lost and recorded once.
  fmt({
    sport: 'chess', key: 'single_game', name: 'Single game (win / draw / loss)',
    levels: [{ key: 'game', label: 'Game', target: 1, winBy: 1, cap: null }, unitsMatch(1)],
    serve: PER_UNIT_SERVE, endStates: { ...LEAGUE, drawsAllowed: true },
    rulesSheet: { timeControl: 'recorded on the draw sheet, not enforced', drawByAgreement: true },
  }),
  fmt({
    sport: 'chess', key: 'bo3_games', name: 'Best of 3 games',
    levels: [{ key: 'game', label: 'Game', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    serve: PER_UNIT_SERVE, endStates: { ...LEAGUE, drawsAllowed: true },
  }),
  fmt({
    sport: 'chess', key: 'blitz_bo5', name: 'Blitz — best of 5 games',
    levels: [{ key: 'game', label: 'Game', target: 1, winBy: 1, cap: null }, unitsMatch(3)],
    serve: PER_UNIT_SERVE, mode: 'selfScored', endStates: { ...LEAGUE, drawsAllowed: true },
  }),
];

// ============================================================================
// COMBAT & STRENGTH - boxing, wrestling, judo, taekwondo, fencing, arm wrestling,
// tug of war
//
// Best-of-N bouts or rounds. What happens INSIDE a bout (ippon, touches, a
// standing count) is per-sport and judged by a human; the console records the
// outcome of each round, which is what a team competition needs from it.
// ============================================================================

const COMBAT: ScoringFormat[] = [
  fmt({
    sport: 'tug of war', key: 'tow_bo3', name: 'Best of 3 pulls',
    levels: [{ key: 'pull', label: 'Pull', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    mode: 'selfScored', endStates: STRICT,
  }),
  fmt({
    sport: 'tug of war', key: 'tow_bo5', name: 'Best of 5 pulls',
    levels: [{ key: 'pull', label: 'Pull', target: 1, winBy: 1, cap: null }, unitsMatch(3)],
    mode: 'selfScored', endStates: STRICT,
  }),
  fmt({
    sport: 'tug of war', key: 'tow_single', name: 'Single pull',
    levels: [{ key: 'pull', label: 'Pull', target: 1, winBy: 1, cap: null }, unitsMatch(1)],
    mode: 'selfScored', endStates: STRICT,
  }),

  fmt({
    sport: 'arm wrestling', key: 'aw_bo3', name: 'Best of 3 rounds',
    levels: [{ key: 'round', label: 'Round', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    mode: 'selfScored', endStates: STRICT,
  }),
  fmt({
    sport: 'arm wrestling', key: 'aw_single', name: 'Single round',
    levels: [{ key: 'round', label: 'Round', target: 1, winBy: 1, cap: null }, unitsMatch(1)],
    mode: 'selfScored', endStates: STRICT,
  }),

  fmt({
    sport: 'fencing', key: 'fie_to_15', name: 'FIE bout — first to 15 touches',
    levels: [{ key: 'bout', label: 'Bout', target: 15, winBy: 1, cap: null }, unitsMatch(1)],
    endStates: STRICT, rulesSheet: { periods: '3 x 3 minutes', priorityAtTie: 'drawn by lot' },
  }),
  fmt({
    sport: 'fencing', key: 'pool_to_5', name: 'Pool bout — first to 5 touches',
    levels: [{ key: 'bout', label: 'Bout', target: 5, winBy: 1, cap: null }, unitsMatch(1)],
    endStates: STRICT,
  }),

  fmt({
    sport: 'taekwondo', key: 'wt_bo3_rounds', name: 'Best of 3 rounds',
    levels: [{ key: 'round', label: 'Round', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    endStates: STRICT,
  }),
  fmt({
    sport: 'judo', key: 'ijf_single_bout', name: 'Single bout',
    levels: [{ key: 'bout', label: 'Bout', target: 1, winBy: 1, cap: null }, unitsMatch(1)],
    endStates: STRICT, rulesSheet: { winBy: 'ippon, waza-ari or penalties - recorded as the outcome' },
  }),
  fmt({
    sport: 'wrestling', key: 'uww_bo3_periods', name: 'Best of 3 periods',
    levels: [{ key: 'period', label: 'Period', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    endStates: STRICT,
  }),
  fmt({
    sport: 'boxing', key: 'bout_3_rounds', name: 'Three rounds, judged',
    levels: [{ key: 'round', label: 'Round', target: 1, winBy: 1, cap: null }, unitsMatch(2)],
    endStates: STRICT, rulesSheet: { stoppage: 'recorded as the outcome, not inferred' },
  }),
];

// ============================================================================
// registry
// ============================================================================

export const TEAM_PRESETS: ScoringFormat[] = [...NET, ...INVASION, ...RAID, ...BOARD, ...COMBAT];

/** Sport-name aliases, so a lookup by the catalogue's spelling works either way. */
const ALIASES: Record<string, string> = {
  volleyball: 'volleyball',
  throwball: 'throwball',
  football: 'football',
  soccer: 'football',
  futsal: 'futsal',
  basketball: 'basketball',
  netball: 'basketball',
  hockey: 'hockey',
  'field hockey': 'hockey',
  handball: 'handball',
  frisbee: 'frisbee',
  ultimate: 'frisbee',
  kabaddi: 'kabaddi',
  'kho-kho': 'kho-kho',
  'kho kho': 'kho-kho',
  carrom: 'carrom',
  'pool/snooker': 'pool/snooker',
  pool: 'pool/snooker',
  snooker: 'pool/snooker',
  chess: 'chess',
  'tug of war': 'tug of war',
  'tug-of-war': 'tug of war',
  'arm wrestling': 'arm wrestling',
  fencing: 'fencing',
  taekwondo: 'taekwondo',
  judo: 'judo',
  wrestling: 'wrestling',
  boxing: 'boxing',
};

export function canonicalTeamSport(name?: string | null): string | null {
  if (!name) return null;
  return ALIASES[name.trim().toLowerCase()] ?? null;
}

export function teamPresetsFor(sport?: string | null): ScoringFormat[] {
  const key = canonicalTeamSport(sport);
  if (!key) return [];
  return TEAM_PRESETS.filter((p) => p.sport === key).map((p) => JSON.parse(JSON.stringify(p)) as ScoringFormat);
}
