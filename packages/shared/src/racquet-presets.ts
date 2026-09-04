import type {
  ClockSpec, EndStatePolicy, LevelSpec, OfficiatingMode, ScoringFormat, ServeSpec,
} from './scoring-rules.js';
import { canonicalTeamSport, teamPresetsFor, TEAM_PRESETS } from './team-presets.js';

// ============================================================================
// The shelf. Every named format a customer picks off it, as data.
//
// Two kinds sit here side by side and both matter:
//   - the governing-body formats (BWF, ITTF, ITF, WSF, USA Pickleball), and
//   - the formats Indian corporate and college events ACTUALLY run - single games
//     to 15 or 21, best-of-3 to 11, 20-minute time caps, sudden death at the target.
//
// `officiatingMode` is declared per preset because it flips seven console behaviours
// together (see scoring-rules.ts). The governing-body presets are `officiated`;
// anything whose audience is corporate / college / box-league is `selfScored`,
// which is the honest ratio for this market.
// ============================================================================

// ---- shared building blocks ------------------------------------------------

const STRICT: EndStatePolicy = {
  walkoverScoreline: 'targetToZero',
  retirementScore: 'freezeThenAwardRemaining',
  drawsAllowed: false,
  noShowGraceMinutes: 15,
  countWalkoverInDifference: false,
};

// Corporate group stages want a level match to stand as a draw rather than forcing a
// sudden-death point nobody asked for. Standings already handles draws end to end.
const CASUAL: EndStatePolicy = {
  walkoverScoreline: 'targetToZero',
  retirementScore: 'freezeAsPlayed',
  drawsAllowed: true,
  noShowGraceMinutes: 10,
  countWalkoverInDifference: false,
};

const cap = (minutes: number, action: ClockSpec['action'] = 'finishPointThenLeader',
  tieRule: ClockSpec['tieRule'] = 'suddenDeathPoint'): ClockSpec => ({
  scope: 'match', minutes, action, tieRule, warningSeconds: 120,
  // The constraint in Indian corporate play is the hall booking, not playing time,
  // so the clock runs through intervals by default.
  pauseOnStoppage: false,
});

/** `match` level: first to `units`. Never has its own serve or cap. */
const match = (units: number, label = 'Match'): LevelSpec =>
  ({ key: 'match', label, target: units, winBy: 1, cap: null });

// ---- serve specs -----------------------------------------------------------

const ttServe = (every: number, collapseAt: number): ServeSpec => ({
  pointScoring: 'rally',
  movement: 'everyN',
  every,
  collapseAt,
  collapseEvery: 1,
  resolver: 'ttPairCycle',
  // Table tennis serves right-half to right-half: the diagonal is a constant, not a
  // counter. This is why courtModel is an enum and not a boolean.
  courtModel: 'fixed',
  firstServer: 'toss',
  nextUnitServer: 'alternate',
});

const bwfServe: ServeSpec = {
  pointScoring: 'rally',
  movement: 'rallyWinner',
  resolver: 'bwfSingleServer',
  courtModel: 'parity',
  firstServer: 'toss',
  nextUnitServer: 'previousWinner',
};

// Classic 15 (pre-2006). Two hands per side, the first turn of a game getting one
// ("one hand down"), and only the server scores.
const bwfClassicServe: ServeSpec = {
  pointScoring: 'serverOnly',
  movement: 'handOut',
  serversPerSide: 2,
  firstTurnSingle: true,
  resolver: 'classicTwoServer',
  courtModel: 'parity',
  firstServer: 'toss',
  nextUnitServer: 'previousWinner',
};

const tennisServe: ServeSpec = {
  pointScoring: 'rally',
  movement: 'perUnit',
  resolver: 'tennisGameLocked',
  courtModel: 'parity',
  firstServer: 'toss',
  nextUnitServer: 'alternate',
};

// Inside a tie-break the serve runs on POINTS, not games: one serve, then twos.
const tennisTiebreakServe: ServeSpec = {
  pointScoring: 'rally',
  movement: 'everyN',
  every: 2,
  firstTurnEvery: 1,
  resolver: 'tennisGameLocked',
  courtModel: 'parity',
  firstServer: 'organiser',
  nextUnitServer: 'subUnitFirstServerReceives',
};

const pickleRallyServe: ServeSpec = {
  pointScoring: 'rally',
  movement: 'rallyWinner',
  serversPerSide: 1,
  resolver: 'pickleballTwoServer',
  courtModel: 'parity',
  firstServer: 'toss',
  nextUnitServer: 'alternate',
};

const pickleSideOutServe: ServeSpec = {
  pointScoring: 'serverOnly',
  movement: 'handOut',
  serversPerSide: 2,
  firstTurnSingle: true,
  resolver: 'pickleballTwoServer',
  courtModel: 'parity',
  firstServer: 'toss',
  nextUnitServer: 'alternate',
};

const squashParsServe: ServeSpec = {
  pointScoring: 'rally',
  movement: 'rallyWinner',
  resolver: 'squashHandOut',
  courtModel: 'handAlternate',
  firstServer: 'toss',
  nextUnitServer: 'previousWinner',
};

// English / hand-in-hand-out: the serve still moves to the rally winner, but ONLY the
// server can score. Two orthogonal rules that a single 'sideOut' mode would fuse.
const squashEnglishServe: ServeSpec = {
  pointScoring: 'serverOnly',
  movement: 'rallyWinner',
  resolver: 'squashHandOut',
  courtModel: 'handAlternate',
  firstServer: 'toss',
  nextUnitServer: 'previousWinner',
};

// ---- format constructor ----------------------------------------------------

interface FormatOpts {
  sport: string;
  key: string;
  name: string;
  levels: LevelSpec[];
  serve: ServeSpec;
  mode: OfficiatingMode;
  clock?: ClockSpec | null;
  changeEnds?: ScoringFormat['changeEnds'];
  changeEndsAt?: number;
  endStates?: EndStatePolicy;
  penalties?: ScoringFormat['penaltyEvents'];
  doubles?: boolean;
  rulesSheet?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
}

function fmt(o: FormatOpts): ScoringFormat {
  const selfScored = o.mode === 'selfScored';
  return {
    sport: o.sport,
    presetKey: o.key,
    name: o.name,
    levels: o.levels,
    serve: o.serve,
    officiatingMode: o.mode,
    // Self-scored play is recorded at the desk far more often than tapped live, so
    // summary entry is the DEFAULT there rather than the fallback.
    entryMode: selfScored ? 'unitScoresOnly' : 'pointByPoint',
    changeEnds: o.changeEnds ?? 'atDeciderMidpoint',
    ...(o.changeEndsAt !== undefined ? { changeEndsAt: o.changeEndsAt } : {}),
    // A player cannot card their opponent.
    penaltyEvents: o.penalties ?? (selfScored ? 'off' : 'pointGameMatch'),
    letsEnabled: true,
    ...(o.doubles !== undefined ? { doubles: o.doubles } : {}),
    clock: o.clock ?? null,
    endStates: o.endStates ?? (selfScored ? CASUAL : STRICT),
    ...(o.plugins ? { plugins: o.plugins } : {}),
    ...(o.rulesSheet ? { rulesSheet: o.rulesSheet } : {}),
  };
}

// ============================================================================
// TABLE TENNIS
// ============================================================================

const ttGame = (target: number, winBy = 2, capAt: number | null = null,
  switchEndsAt: number | null = null): LevelSpec =>
  ({ key: 'game', label: 'Game', target, winBy, cap: capAt, switchEndsAt });

const TABLE_TENNIS: ScoringFormat[] = [
  fmt({
    sport: 'table tennis', key: 'ittf_bo5_11', name: 'ITTF Standard — best of 5 games to 11',
    levels: [ttGame(11, 2, null, 5), match(3)], serve: ttServe(2, 10), mode: 'officiated',
  }),
  fmt({
    sport: 'table tennis', key: 'ittf_bo7_11', name: 'ITTF Championship — best of 7 games to 11',
    levels: [ttGame(11, 2, null, 5), match(4)], serve: ttServe(2, 10), mode: 'officiated',
    plugins: {
      // The expedite system is a table-tennis-only module: the point is awarded by a
      // WITHIN-rally counter (the receiver's 13th return) and the trigger is elapsed
      // PLAYING time, neither of which the kernel's event alphabet can express. Ships
      // off in every umpireless preset; the returns are counted by a human, never inferred.
      expedite: { enabled: true, afterMinutes: 10, exemptAtScore: 9, returnsToWinPoint: 13, serveEvery: 1, stickyForMatch: true },
    },
    rulesSheet: { ballDiameterMm: 40, netHeightCm: 15.25, towelBreakEveryPoints: 6, timeoutsPerSidePerMatch: 1 },
  }),
  fmt({
    sport: 'table tennis', key: 'legacy_21_bo3', name: 'Classic 21-point — best of 3 games to 21',
    levels: [ttGame(21, 2, null, 10), match(2)], serve: ttServe(5, 20), mode: 'officiated',
  }),
  fmt({
    sport: 'table tennis', key: 'corp_single_21_capped', name: 'Corporate single game to 21 (cap 25)',
    levels: [ttGame(21, 2, 25), match(1)], serve: ttServe(5, 20), mode: 'selfScored',
    changeEnds: 'never',
  }),
  fmt({
    sport: 'table tennis', key: 'corp_single_15_suddendeath', name: 'Fast knockout — single game to 15, no deuce',
    levels: [ttGame(15, 1), match(1)], serve: ttServe(2, 14), mode: 'selfScored',
    changeEnds: 'never', endStates: STRICT,
  }),
  fmt({
    sport: 'table tennis', key: 'corp_bo3_11_timecap', name: 'Corporate best of 3 to 11, cap 15, 20-minute slot',
    levels: [ttGame(11, 2, 15), match(2)], serve: ttServe(2, 10), mode: 'selfScored',
    clock: cap(20), changeEnds: 'never',
  }),
  // The user's own custom format, expressible with zero new code: the server is a pure
  // function of the point index, so undo and correction fall out for free.
  fmt({
    sport: 'table tennis', key: 'sprint_9_serve3', name: 'Sportagon Sprint — best of 3 to 9, serve every 3rd',
    levels: [ttGame(9, 2, 11), match(2)], serve: ttServe(3, 8), mode: 'selfScored',
    changeEnds: 'never',
  }),
  fmt({
    sport: 'table tennis', key: 'blitz_7', name: 'Blitz — best of 3 games to 7, serve every point',
    levels: [ttGame(7, 2, 9), match(2)], serve: ttServe(1, 6), mode: 'selfScored',
    changeEnds: 'never',
  }),
];

// ============================================================================
// BADMINTON
// ============================================================================

const bwfGame = (target: number, capAt: number | null, switchEndsAt: number | null, winBy = 2): LevelSpec =>
  ({ key: 'game', label: 'Game', target, winBy, cap: capAt, switchEndsAt });

const BADMINTON: ScoringFormat[] = [
  fmt({
    sport: 'badminton', key: 'bwf_official_3x21', name: 'BWF Official — best of 3 games to 21',
    // 21, win by 2, unbounded deuce up to the 30-point cap: 30-29 ends it, margin ignored.
    // Switch ends at 11 in the decider only.
    levels: [bwfGame(21, 30, 11), match(2)], serve: bwfServe, mode: 'officiated',
    rulesSheet: { serviceHeightM: 1.15, intervalAt: 11, intervalSeconds: 60, betweenGamesSeconds: 120, shuttleType: 'feather' },
  }),
  fmt({
    sport: 'badminton', key: 'bwf_bo5_11', name: 'BWF experimental — best of 5 games to 11',
    levels: [bwfGame(11, 15, 6), match(3)], serve: bwfServe, mode: 'officiated',
  }),
  fmt({
    sport: 'badminton', key: 'classic_15_sideout', name: 'Classic 15 — side-out (service) scoring',
    // Heritage, and BUILT rather than stubbed. `setting` (the 13-all election to extend
    // the game by 5) is a documented non-goal: if the players set, the score is recorded
    // manually. Stated on the draw sheet rather than approximated.
    levels: [bwfGame(15, null, 8, 1)], serve: bwfClassicServe, mode: 'officiated',
    changeEnds: 'betweenUnits',
    rulesSheet: { setting: 'not scored by the console — record the final score manually' },
  }),
  fmt({
    sport: 'badminton', key: 'corporate_single_21', name: 'Corporate single game to 21',
    levels: [bwfGame(21, 30, null), match(1)], serve: bwfServe, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'badminton', key: 'corporate_single_15_timecapped', name: 'Corporate single game to 15, 20-minute cap',
    levels: [bwfGame(15, 21, null), match(1)], serve: bwfServe, mode: 'selfScored',
    clock: cap(20), changeEnds: 'never',
  }),
  fmt({
    sport: 'badminton', key: 'college_bo3_to_11', name: 'College fest — best of 3 games to 11',
    levels: [bwfGame(11, 15, 6), match(2)], serve: bwfServe, mode: 'selfScored',
  }),
  fmt({
    sport: 'badminton', key: 'corporate_single_21_doubles', name: 'Corporate mixed doubles — single game to 21',
    levels: [bwfGame(21, 30, null), match(1)], serve: bwfServe, mode: 'selfScored',
    changeEnds: 'never', doubles: true,
  }),
  fmt({
    sport: 'badminton', key: 'box_sprint_11', name: 'Box-league sprint — single game to 11, sudden death',
    levels: [bwfGame(11, null, null, 1), match(1)], serve: bwfServe, mode: 'selfScored',
    changeEnds: 'never', endStates: STRICT,
  }),
];

// ============================================================================
// TENNIS
//
// The sport that dictated the architecture. 15/30/40/deuce/advantage is a LEVEL with
// target 4 and a display map - not a different kind of scoring - and a tie-break is a
// differently-configured unit spliced in at 6-6. All configuration, no tennis module.
// ============================================================================

const AD_LABELS = ['0', '15', '30', '40', 'AD'];

const tennisGame = (noAd = false): LevelSpec => ({
  key: 'game', label: 'Game', target: 4, winBy: noAd ? 1 : 2, cap: null,
  pointLabels: AD_LABELS, serve: tennisServe,
});

const tiebreakUnit = (to: number, winBy = 2): LevelSpec => ({
  key: 'tiebreak', label: 'Tie-break', target: to, winBy, cap: null, serve: tennisTiebreakServe,
});

const tennisSet = (games: number, tbAt: number | null, tbTo = 7, tbWinBy = 2, winByGames = 2): LevelSpec => ({
  key: 'set', label: 'Set', target: games, winBy: winByGames,
  // A tie-break winner takes the set 7-6 - a ONE-game margin, which win-by-2 rejects.
  // The cap expresses it exactly: you cannot reach tbAt+1 games except by winning by
  // two earlier (6-4, 7-5) or by winning the tie-break.
  cap: tbAt !== null ? tbAt + 1 : null,
  ...(tbAt !== null ? { substitute: { atUnits: tbAt, spec: tiebreakUnit(tbTo, tbWinBy) } } : {}),
});

/** A final set replaced by a championship tie-break: the set collapses to raw points. */
const matchTiebreakDecider = (to: number, winBy = 2) => ({
  collapsed: true, target: to, winBy, cap: null, pointLabels: null, serve: tennisTiebreakServe,
});

const TENNIS: ScoringFormat[] = [
  fmt({
    sport: 'tennis', key: 'itf_standard_bo3', name: 'ITF / AITA Standard — best of 3 sets, tie-break at 6-6',
    levels: [tennisGame(), tennisSet(6, 6), match(2)], serve: tennisServe, mode: 'officiated',
    changeEnds: 'oddCumulativeUnits',
    rulesSheet: { ballChangeAfterGames: [9, 11], changeoverSeconds: 90, setBreakSeconds: 120 },
  }),
  fmt({
    sport: 'tennis', key: 'grand_slam_bo5', name: "Grand Slam men's — best of 5, 10-point tie-break in the fifth",
    levels: [tennisGame(), { ...tennisSet(6, 6), deciderOverride: matchTiebreakDecider(10) }, match(3)],
    serve: tennisServe, mode: 'officiated', changeEnds: 'oddCumulativeUnits',
  }),
  fmt({
    sport: 'tennis', key: 'no_ad_match_tb_bo3', name: 'League standard — no-ad, best of 3 with a 10-point match tie-break',
    levels: [tennisGame(true), { ...tennisSet(6, 6), deciderOverride: matchTiebreakDecider(10) }, match(2)],
    serve: tennisServe, mode: 'selfScored', changeEnds: 'oddCumulativeUnits', doubles: true,
  }),
  fmt({
    sport: 'tennis', key: 'fast4_bo3', name: 'Fast4 — 4-game sets, no-ad, tie-break at 3-3',
    levels: [tennisGame(true), tennisSet(4, 3, 5, 1, 1), match(2)],
    serve: tennisServe, mode: 'selfScored', changeEnds: 'oddCumulativeUnits',
  }),
  fmt({
    sport: 'tennis', key: 'itf_short_sets_bo3', name: 'ITF short sets — best of 3 sets to 4, match tie-break third',
    levels: [tennisGame(), { ...tennisSet(4, 4), deciderOverride: matchTiebreakDecider(10) }, match(2)],
    serve: tennisServe, mode: 'officiated', changeEnds: 'oddCumulativeUnits',
  }),
  fmt({
    sport: 'tennis', key: 'pro_set_8', name: '8-game pro set — first to 8 games by 2, tie-break at 8-8',
    levels: [tennisGame(), tennisSet(8, 8), match(1)],
    serve: tennisServe, mode: 'selfScored', changeEnds: 'oddCumulativeUnits', doubles: true,
  }),
  fmt({
    sport: 'tennis', key: 'single_set_6_noad', name: 'One set to 6 — no-ad, tie-break at 5-5',
    levels: [tennisGame(true), tennisSet(6, 5, 7, 2, 1), match(1)],
    serve: tennisServe, mode: 'selfScored', changeEnds: 'oddCumulativeUnits', doubles: true,
  }),
  fmt({
    sport: 'tennis', key: 'match_tb_10_shootout', name: '10-point shootout — one championship tie-break',
    // Flat: the tie-break IS the match. No games, no sets - the level array collapses
    // to one unit, which is the same recursion the other formats use.
    levels: [tiebreakUnit(10), match(1)], serve: tennisTiebreakServe, mode: 'selfScored',
    changeEnds: 'everyNPoints', changeEndsAt: 6, doubles: true,
  }),
  fmt({
    sport: 'tennis', key: 'flat_single_game_21', name: 'Single game to 21 — flat points, cap 25, serve every 5',
    levels: [{ key: 'game', label: 'Game', target: 21, winBy: 2, cap: 25, switchEndsAt: 11 }, match(1)],
    serve: { ...tennisTiebreakServe, every: 5, firstTurnEvery: undefined }, mode: 'selfScored',
  }),
  fmt({
    sport: 'tennis', key: 'flat_bo3_to_11', name: 'Best of 3 games to 11 — flat points, cap 15',
    levels: [{ key: 'game', label: 'Game', target: 11, winBy: 2, cap: 15 }, match(2)],
    serve: { ...tennisTiebreakServe, every: 2, firstTurnEvery: undefined }, mode: 'selfScored',
    changeEnds: 'betweenUnits', doubles: true,
  }),
  fmt({
    sport: 'tennis', key: 'timed_rubber_20', name: 'Timed rubber — 20-minute buzzer, most games leads',
    levels: [tennisGame(true), { key: 'set', label: 'Set', target: 99, winBy: 1, cap: null }, match(1)],
    serve: tennisServe, mode: 'selfScored', clock: cap(20, 'leaderWins', 'suddenDeathPoint'),
    changeEnds: 'oddCumulativeUnits', doubles: true,
  }),
];

// ============================================================================
// PICKLEBALL
//
// The only sport whose FORMAT changes the serve model, not just the numbers. Also the
// only P0 sport with no presence in the codebase before this change.
// ============================================================================

const pbGame = (target: number, winBy = 2, capAt: number | null = null, switchEndsAt: number | null = null): LevelSpec =>
  ({ key: 'game', label: 'Game', target, winBy, cap: capAt, switchEndsAt });

const PICKLEBALL: ScoringFormat[] = [
  fmt({
    sport: 'pickleball', key: 'usap_tournament_bo3_11', name: 'USA Pickleball Standard — best 2 of 3 games to 11',
    levels: [pbGame(11, 2, null, 6), match(2)], serve: pickleSideOutServe, mode: 'officiated',
    doubles: true,
    rulesSheet: { nonVolleyZone: 'not adjudicated by the console', twoBounceRule: 'not adjudicated', serveClockSeconds: 10 },
  }),
  fmt({
    sport: 'pickleball', key: 'usap_single_game_15', name: 'Single game to 15, win by 2 (side-out)',
    levels: [pbGame(15, 2, null, 8), match(1)], serve: pickleSideOutServe, mode: 'officiated', doubles: true,
  }),
  fmt({
    sport: 'pickleball', key: 'usap_single_game_21', name: 'Single game to 21, win by 2 (side-out)',
    levels: [pbGame(21, 2, null, 11), match(1)], serve: pickleSideOutServe, mode: 'officiated', doubles: true,
  }),
  fmt({
    sport: 'pickleball', key: 'mlp_rally_21', name: 'MLP-style rally scoring — game to 21',
    levels: [pbGame(21, 2, null, 11), match(1)], serve: pickleRallyServe, mode: 'officiated', doubles: true,
  }),
  fmt({
    sport: 'pickleball', key: 'corp_rally_15_cap_17', name: 'Corporate rally — single game to 15, hard cap 17',
    levels: [pbGame(15, 2, 17), match(1)], serve: pickleRallyServe, mode: 'selfScored',
    changeEnds: 'never', doubles: true,
  }),
  fmt({
    sport: 'pickleball', key: 'pool_11_straight', name: 'Pool play — single game to 11, sudden death at 10-10',
    levels: [pbGame(11, 1), match(1)], serve: pickleRallyServe, mode: 'selfScored',
    changeEnds: 'never', endStates: STRICT, doubles: true,
  }),
  fmt({
    sport: 'pickleball', key: 'timecap_10min_game', name: 'Time-capped game — 10 minutes, highest score wins',
    levels: [pbGame(21, 1), match(1)], serve: pickleRallyServe, mode: 'selfScored',
    clock: cap(10, 'finishPointThenLeader', 'draw'), changeEnds: 'never', doubles: true,
  }),
  fmt({
    sport: 'pickleball', key: 'college_bo3_rally_11_cap15', name: 'Best of 3 rally games to 11, cap 15 — 45-minute slot',
    levels: [pbGame(11, 2, 15), match(2)], serve: pickleRallyServe, mode: 'selfScored',
    clock: cap(45), doubles: true,
  }),
];

// ============================================================================
// SQUASH
// ============================================================================

const sqGame = (target: number, winBy = 2, capAt: number | null = null): LevelSpec =>
  ({ key: 'game', label: 'Game', target, winBy, cap: capAt });

const SQUASH: ScoringFormat[] = [
  fmt({
    sport: 'squash', key: 'wsf_pars11_bo5', name: 'WSF / PSA Standard — PARS 11, best of 5',
    levels: [sqGame(11), match(3)], serve: squashParsServe, mode: 'officiated',
    changeEnds: 'never',
    rulesSheet: { letStrokeNoLet: 'outcome recorded, reasoning never inferred', betweenGamesSeconds: 90 },
  }),
  fmt({
    sport: 'squash', key: 'pars11_bo3', name: 'Club / league — PARS 11, best of 3',
    levels: [sqGame(11), match(2)], serve: squashParsServe, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'squash', key: 'english9_bo5', name: 'English / hand-in-hand-out — 9 points, best of 5',
    // Only the server scores; the serve still moves to the rally winner. Expressible
    // ONLY because pointScoring and movement are separate params.
    // The 8-8 "set one / set two" election is a documented non-goal: the target is
    // hard-set to 10, and the draw sheet says "set two always played".
    levels: [sqGame(9, 1)], serve: squashEnglishServe, mode: 'officiated', changeEnds: 'never',
    rulesSheet: { setChoiceAt8All: 'set two always played — the receiver election is not offered' },
  }),
  fmt({
    sport: 'squash', key: 'english9_bo3', name: 'English 9 — best of 3',
    levels: [sqGame(9, 1), match(2)], serve: squashEnglishServe, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'squash', key: 'single_game_15_pars', name: 'Corporate single game to 15 (PARS)',
    levels: [sqGame(15, 2, 18), match(1)], serve: squashParsServe, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'squash', key: 'single_game_21_pars', name: 'Corporate single game to 21 (PARS)',
    levels: [sqGame(21, 2, 25), match(1)], serve: squashParsServe, mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'squash', key: 'timecap_10min_game_sq', name: 'Time-capped game — 10 minutes, highest score wins',
    levels: [sqGame(11), match(1)], serve: squashParsServe, mode: 'selfScored',
    clock: cap(10, 'finishPointThenLeader', 'draw'), changeEnds: 'never',
  }),
  fmt({
    sport: 'squash', key: 'flash_bo3_to_7', name: 'Flash format — best of 3 games to 7 (play all)',
    levels: [{ ...sqGame(7, 2, 9), playAll: true }, match(2)], serve: squashParsServe,
    mode: 'selfScored', changeEnds: 'never',
  }),
  fmt({
    sport: 'squash', key: 'doubles_pars11_bo3', name: 'Doubles / mixed doubles — PARS 11, best of 3',
    levels: [sqGame(11, 2, 15), match(2)], serve: squashParsServe, mode: 'selfScored',
    changeEnds: 'never', doubles: true,
  }),
  fmt({
    sport: 'squash', key: 'handicap_pars11', name: 'Handicap — PARS 11 with a 5-0 start, best of 3',
    // Handicap start is a level param, used heavily in Indian corporate box leagues.
    levels: [{ ...sqGame(11, 2, 15), startingScore: [5, 0] }, match(2)],
    serve: squashParsServe, mode: 'selfScored', changeEnds: 'never',
  }),
];

// ============================================================================
// registry
// ============================================================================

export const RACQUET_PRESETS: ScoringFormat[] = [
  ...TABLE_TENNIS, ...BADMINTON, ...TENNIS, ...PICKLEBALL, ...SQUASH,
];

/** Every sport this kernel scores natively. Aliases included so lookups by the
 *  catalogue's spelling work either way. */
const SPORT_ALIASES: Record<string, string> = {
  'table tennis': 'table tennis',
  'table-tennis': 'table tennis',
  tt: 'table tennis',
  badminton: 'badminton',
  tennis: 'tennis',
  pickleball: 'pickleball',
  pickelball: 'pickleball', // the spelling used in the sports brief
  squash: 'squash',
};

export function canonicalRacquetSport(name?: string | null): string | null {
  if (!name) return null;
  return SPORT_ALIASES[name.trim().toLowerCase()] ?? null;
}

export function isRacquetSport(name?: string | null): boolean {
  return canonicalRacquetSport(name) !== null;
}

/**
 * Is this sport scored by the kernel at all?
 *
 * Racquet, net, invasion, raid, board and combat families are. Cricket and the ten
 * measured sports deliberately are NOT - they keep their own models, and a caller
 * that treats "not here" as "broken" would be wrong about them.
 */
export function isKernelSport(name?: string | null): boolean {
  return isRacquetSport(name) || canonicalTeamSport(name) !== null;
}

/**
 * The presets on the shelf for one sport, in the order they should be offered.
 *
 * ONE function for every family. Whether a sport is scored by rallies, by a clock
 * or by boards is a property of its presets, not of the call site - so the ladder,
 * the format picker and the console all stayed unchanged when the other 27 sports
 * arrived.
 */
export function presetsFor(sport?: string | null): ScoringFormat[] {
  const racquet = canonicalRacquetSport(sport);
  if (racquet) return RACQUET_PRESETS.filter((p) => p.sport === racquet).map(deepCopy);
  return teamPresetsFor(sport);
}

export function presetByKey(key: string): ScoringFormat | undefined {
  const p = RACQUET_PRESETS.find((x) => x.presetKey === key)
    ?? TEAM_PRESETS.find((x) => x.presetKey === key);
  return p ? deepCopy(p) : undefined;
}

/** Every preset the kernel ships, across every family. */
export function allPresets(): ScoringFormat[] {
  return [...RACQUET_PRESETS, ...TEAM_PRESETS].map(deepCopy);
}

/**
 * The format a draw gets when nobody has chosen one. It must be a REAL, correct
 * format rather than a generic counter - which is what the sport fell back to before
 * this kernel existed.
 *
 * This is the FIRST preset for the sport, so declaration order above is the default.
 * Each list therefore leads with the format that sport is normally played under
 * rather than its longest: table tennis best of 5, not the best of 7 reserved for
 * championship finals.
 */
export function defaultFormatFor(sport?: string | null): ScoringFormat | undefined {
  const list = presetsFor(sport);
  return list[0];
}

/** Presets are templates: hand out copies so a caller can persist or edit freely. */
function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
