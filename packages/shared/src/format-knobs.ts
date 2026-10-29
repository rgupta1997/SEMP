import { isPeriodShaped, pluralizePeriodLabel } from './match-format.js';
import { expediteConfig, ITTF_EXPEDITE } from './rally-kernel.js';
import { isChessSport } from './chess.js';
import { carromRulesOf, isCarromSport } from './carrom.js';
import { followOnCompulsoryAbove, followOnLead, isKhoKhoFormat } from './kho-kho.js';
import { isKabaddiFormat } from './kabaddi.js';
import { canonicalTeamSport } from './team-presets.js';
import { cardMinutesFor, cardSportOf, escalationOn, type CardSport } from './suspensions.js';
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
  /** Table tennis expedite system: one serve each and 13 returns wins, after a time limit. */
  expediteEnabled: boolean;
  /** Playing minutes in a game before expedite comes in. */
  expediteMinutes: number;

  // ---- the clock
  clockEnabled: boolean;
  clockMinutes: number;
  clockAction: CapAction;
  clockTieRule: CapTieRule;

  // ---- settling a match that cannot be drawn
  //
  // Only ever consulted when draws are off: a level match that IS allowed to be a
  // draw is closed as one and never reaches any of this.
  extraTimeEnabled: boolean;
  /** How many periods of extra time. Both are played out; there is no golden goal. */
  extraTimePeriods: number;
  /** Minutes in EACH period of extra time, not the total. */
  extraTimeMinutes: number;
  /** Ultimate: reaching the win score (`firstTo`) still ends the match during extra time. */
  extraTimeFirstTo: boolean;
  shootoutEnabled: boolean;
  /** Kicks each in the opening round. Level after that goes to sudden death. */
  shootoutKicks: number;
  /** Kho kho: still level, the faster first out in one more chase each wins. */
  minimumChaseEnabled: boolean;
  /** Ultimate: still level, the next point wins. */
  universalPointEnabled: boolean;
  /** Timed match that also ends when a side reaches this total. 0 = no target. */
  firstTo: number;
  /** Read-only. Kho kho offers the minimum chase instead of a shoot-out. */
  khoKho: boolean;
  /** Kho kho: the first-innings lead from which a follow-on may be given. */
  followOnLead: number;
  /** Kho kho: a bigger lead makes the follow-on compulsory. Off = always the leader's choice. */
  followOnCompulsoryEnabled: boolean;
  followOnCompulsoryAbove: number;
  /** Read-only. Kabaddi settles a level knockout with extra time (then golden raid), never kicks. */
  kabaddi: boolean;
  /** Read-only. Hockey's shoot-out is shooters, not kicks. */
  hockey: boolean;
  /** Read-only. The sport with card rules (hockey, futsal timers; football escalation); null for none. */
  cardSport: CardSport | null;
  /** Cards sit players out for a time, counted down on the console. Off: cards are only recorded. */
  cardSuspensionsEnabled: boolean;
  /** Hockey: green and yellow minutes. */
  greenSuspensionMinutes: number;
  yellowSuspensionMinutes: number;
  /** Futsal: red card minutes (over early if the other side scores). */
  redSuspensionMinutes: number;
  /** A repeat card steps up: football/futsal second yellow is a red, hockey green -> yellow -> red. */
  cardEscalationEnabled: boolean;
  /** Kabaddi: still level after extra time, a golden raid each, then a toss. */
  goldenRaidEnabled: boolean;

  // ---- how it is run
  officiatingMode: OfficiatingMode;
  drawsAllowed: boolean;

  /**
   * Read-only. True for an invasion-shaped format (kho-kho, kabaddi, football,
   * hockey, basketball...) - see `isPeriodShaped`. Never written back by
   * `applyKnobs`; it exists purely so `applies()` predicates below can hide the
   * racquet-only knobs (serve, game target, deuce, ends) for a sport that has
   * none of those things, instead of asking a kho-kho organiser to configure
   * "how the serve moves".
   */
  periodShaped: boolean;
  /**
   * Read-only, only meaningful when `periodShaped`. What the format itself
   * calls one period - "Turn", "Innings", "Half", "Quarter" - so the "Number
   * of periods" knob and its summary line can say "4 turns" rather than a
   * generic "4 periods" that means nothing extra to whoever set this up.
   */
  periodLabel: string;

  /**
   * Read-only. A chess format: nothing is counted in a game, so the editor offers the
   * games in the match, the time control and how it is run - not targets or serves.
   */
  chess: boolean;
  /** Chess: minutes each on the clock, and seconds added per move (FIDE "90+30"). */
  timeBaseMinutes: number;
  timeIncrementSeconds: number;

  /** Read-only. A carrom format: games built board by board (carrom.ts), so no serve, deuce or clock. */
  carrom: boolean;
  /** Carrom: a game also ends after this many boards (ICF 8, IIMK 4). */
  carromMaxBoardsEnabled: boolean;
  carromMaxBoards: number;
  carromQueenPoints: number;
  /** Carrom: from this game score on the queen is worth 0 (ICF 22, IIMK 14). */
  carromQueenCutoffEnabled: boolean;
  carromQueenCutoff: number;
  carromQueenMustBeCovered: boolean;
  /** Carrom: level on points at the board limit, more boards won takes the game. */
  carromBoardsWonDecides: boolean;
  /** Carrom: tie-break boards totalled on their own. 1 = the next board decides (ICF). */
  carromTieBreakBoards: number;
}

/** The only knobs a chess format has; everything else describes a game it does not play. */
const CHESS_KNOBS = new Set<keyof FormatKnobs>(['unitsToWin', 'timeBaseMinutes', 'timeIncrementSeconds', 'officiatingMode', 'drawsAllowed']);
/** Carrom's knobs: the game, the board limit and the queen. A carrom game cannot be drawn. */
const CARROM_KNOBS = new Set<keyof FormatKnobs>([
  'unitsToWin', 'target', 'carromMaxBoardsEnabled', 'carromMaxBoards', 'carromQueenPoints',
  'carromQueenCutoffEnabled', 'carromQueenCutoff', 'carromQueenMustBeCovered', 'carromBoardsWonDecides',
  'carromTieBreakBoards', 'officiatingMode',
]);

/** UI metadata for one knob. Rendering is generic; this is what makes it legible. */
export interface KnobSpec {
  key: keyof FormatKnobs;
  label: string;
  hint?: string;
  group: 'shape' | 'carrom' | 'serve' | 'ends' | 'clock' | 'tieBreak' | 'cards' | 'run';
  type: 'int' | 'bool' | 'enum';
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  /** Only offered when this returns true for the format being edited. */
  applies?: (k: FormatKnobs) => boolean;
  /**
   * `type: 'int'` only. Lets a knob show a different number from the one it
   * writes - the stored value stays the source of truth, this is purely how
   * it is read and typed back. Used for a period-shaped match's clock: the
   * format stores one whole-match total, but asking an organiser to type that
   * and divide it by the period count in their head is how a 4-period match
   * quietly ends up with a 1-minute period nobody meant to set.
   */
  toDisplay?: (raw: number, k: FormatKnobs) => number;
  fromDisplay?: (display: number, k: FormatKnobs) => number;
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
  //
  // Every knob in this group (bar the two `periodShaped` ones right after it)
  // describes a GAME: a target score, a winning margin, a hard ceiling, a
  // different decider target, a handicap start. None of that exists in an
  // invasion-shaped format (kho-kho, kabaddi, football...) - a period there
  // ends on the clock, not at a score, so these are hidden rather than left to
  // configure a "game" the format doesn't have.
  { key: 'target', label: 'Points to win a game', group: 'shape', type: 'int', min: 1, max: 99,
    hint: 'The score a side plays to. 11, 21, 15 - or anything you like.',
    applies: (k) => !k.periodShaped && !k.carrom },
  { key: 'target', label: 'Points to win a game', group: 'shape', type: 'int', min: 1, max: 99,
    hint: 'ICF 25, IIMK 16. Set 1 to count boards only: each board won is a point.',
    applies: (k) => k.carrom },
  { key: 'winBy', label: 'Winning margin', group: 'shape', type: 'int', min: 1, max: 5,
    hint: '2 means deuce continues until somebody leads by two. 1 means the target wins outright.',
    applies: (k) => !k.periodShaped },
  { key: 'capEnabled', label: 'Hard ceiling', group: 'shape', type: 'bool',
    hint: 'Ends the game at a fixed score no matter the margin, so deuce cannot run forever.',
    applies: (k) => !k.periodShaped },
  { key: 'cap', label: 'Ceiling score', group: 'shape', type: 'int', min: 1, max: 199,
    applies: (k) => !k.periodShaped && k.capEnabled },
  { key: 'unitsToWin', label: 'Games to win the match', group: 'shape', type: 'int', min: 1, max: 7,
    hint: '1 = a single game. 2 = best of 3. 3 = best of 5. 4 = best of 7.',
    applies: (k) => !k.periodShaped },
  // Same underlying number (`unitsToWin` is literally how many periods the
  // match plays), a different question: kho-kho's four turns are all played,
  // never "best of" - the match is decided on total score, not on turns won.
  { key: 'unitsToWin', label: 'Number of periods', group: 'shape', type: 'int', min: 1, max: 12,
    hint: 'How many periods make up the whole match - two innings, four turns, two halves.',
    applies: (k) => k.periodShaped },
  { key: 'deciderEnabled', label: 'Deciding game plays to a different score', group: 'shape', type: 'bool',
    hint: 'Badminton to 11 in the decider, volleyball to 15.',
    applies: (k) => !k.periodShaped && k.unitsToWin > 1 },
  { key: 'deciderTarget', label: 'Deciding game target', group: 'shape', type: 'int', min: 1, max: 99,
    applies: (k) => !k.periodShaped && k.unitsToWin > 1 && k.deciderEnabled },
  { key: 'timeBaseMinutes', label: 'Minutes each', group: 'shape', type: 'int', min: 1, max: 300,
    hint: 'Each player\'s time on the clock. Classical 90, rapid 15, blitz 3.',
    applies: (k) => k.chess },
  { key: 'timeIncrementSeconds', label: 'Seconds added per move', group: 'shape', type: 'int', min: 0, max: 120,
    hint: 'The increment: 30 for classical, 10 for rapid, 2 for blitz. 0 for none.',
    applies: (k) => k.chess },
  // ---- carrom: only for a points game (target above 1); boards-only has no queen or limit
  { key: 'carromMaxBoardsEnabled', label: 'Board limit per game', group: 'carrom', type: 'bool',
    hint: 'The game also ends after a set number of boards, and the higher score wins it.',
    applies: (k) => k.carrom && k.target > 1 },
  { key: 'carromMaxBoards', label: 'Boards in a game', group: 'carrom', type: 'int', min: 1, max: 30,
    hint: 'ICF 8, IIMK 4.',
    applies: (k) => k.carrom && k.target > 1 && k.carromMaxBoardsEnabled },
  { key: 'carromQueenPoints', label: 'Queen is worth', group: 'carrom', type: 'int', min: 0, max: 10,
    hint: 'Points to the board winner when they covered the queen. Usually 3.',
    applies: (k) => k.carrom && k.target > 1 },
  { key: 'carromQueenCutoffEnabled', label: 'Queen stops counting near the end', group: 'carrom', type: 'bool',
    hint: 'Past a set score the queen adds nothing, so it cannot carry a side over the line.',
    applies: (k) => k.carrom && k.target > 1 && k.carromQueenPoints > 0 },
  { key: 'carromQueenCutoff', label: 'Queen is worth 0 from', group: 'carrom', type: 'int', min: 1, max: 99,
    hint: "The board winner's game score. ICF 22, IIMK 14 (3 points up to and including 13).",
    applies: (k) => k.carrom && k.target > 1 && k.carromQueenPoints > 0 && k.carromQueenCutoffEnabled },
  { key: 'carromQueenMustBeCovered', label: 'Queen must be covered', group: 'carrom', type: 'bool',
    hint: 'ICF and AICF: a board cannot end with the queen left on. Off lets the official record it as uncovered.',
    applies: (k) => k.carrom && k.target > 1 },
  // Carrom, level on points at the board limit (only with a board limit).
  { key: 'carromBoardsWonDecides', label: 'More boards won takes a level game', group: 'tieBreak', type: 'bool',
    hint: 'Level on points after the last board: the side that won more boards wins the game (Inter-IIM). Off goes straight to tie-break boards (ICF).',
    applies: (k) => k.carrom && k.target > 1 && k.carromMaxBoardsEnabled },
  { key: 'carromTieBreakBoards', label: 'Tie-break boards', group: 'tieBreak', type: 'int', min: 1, max: 5,
    hint: '1 = the next board decides (ICF). 2 or more = play them all and the higher total over them wins (Inter-IIM 2).',
    applies: (k) => k.carrom && k.target > 1 && k.carromMaxBoardsEnabled },
  { key: 'handicapEnabled', label: 'Handicap start', group: 'shape', type: 'bool',
    hint: 'One side begins every game on a head start.',
    applies: (k) => !k.periodShaped },
  { key: 'handicapHome', label: 'Home starts on', group: 'shape', type: 'int', min: 0, max: 98,
    applies: (k) => !k.periodShaped && k.handicapEnabled },
  { key: 'handicapAway', label: 'Away starts on', group: 'shape', type: 'int', min: 0, max: 98,
    applies: (k) => !k.periodShaped && k.handicapEnabled },

  // ---- serve
  //
  // The whole group is racquet-only: kho-kho, kabaddi and the other invasion
  // sports have no serve at all (fixed to `NO_SERVE` at the preset level), so
  // asking "how the serve moves" for one has no real answer - it was only ever
  // showing "No serve" as an option among four that do not apply either.
  { key: 'pointScoring', label: 'Who can score', group: 'serve', type: 'enum',
    hint: 'Rally scoring gives every rally a point. Server-only is the old side-out game: winning as receiver takes the serve, not a point.',
    options: [
      { value: 'rally', label: 'Every rally scores' },
      { value: 'serverOnly', label: 'Only the server scores' },
    ],
    applies: (k) => !k.periodShaped },
  { key: 'movement', label: 'How the serve moves', group: 'serve', type: 'enum',
    options: MOVEMENTS as Array<{ value: string; label: string }>,
    applies: (k) => !k.periodShaped },
  { key: 'serveEvery', label: 'Serves per turn', group: 'serve', type: 'int', min: 1, max: 10,
    hint: 'Table tennis is 2. The old 21-point game was 5.',
    applies: (k) => !k.periodShaped && k.movement === 'everyN' },
  { key: 'collapseAt', label: 'One serve each from', group: 'serve', type: 'int', min: 0, max: 98,
    hint: 'Both sides at this score and the serve changes every point. 0 to never.',
    applies: (k) => !k.periodShaped && k.movement === 'everyN' },
  { key: 'serversPerSide', label: 'Servers per side', group: 'serve', type: 'int', min: 1, max: 2,
    hint: 'Two means the serve only crosses after both partners have lost it.',
    applies: (k) => !k.periodShaped && k.movement === 'handOut' },
  { key: 'firstTurnSingle', label: 'First turn gets one server', group: 'serve', type: 'bool',
    hint: "Pickleball's 0-0-2 opening. Without it the first side serves twice over.",
    applies: (k) => !k.periodShaped && k.movement === 'handOut' && k.serversPerSide > 1 },

  // ---- ends
  //
  // Also racquet-only: a court-side swap, a let, an official's conduct point
  // against a named opponent - none of it is modelled for an invasion sport
  // here (its own discipline/end-of-game rules, where they exist, live in the
  // format's rulesSheet instead - see team-presets.ts).
  { key: 'changeEnds', label: 'Change ends', group: 'ends', type: 'enum',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'betweenUnits', label: 'Between games' },
      { value: 'atDeciderMidpoint', label: 'Midway through the decider' },
      { value: 'oddCumulativeUnits', label: 'Every odd game (tennis)' },
      { value: 'everyNPoints', label: 'Every N points (tie-breaks)' },
    ],
    applies: (k) => !k.periodShaped },
  { key: 'switchEndsAt', label: 'Change ends at', group: 'ends', type: 'int', min: 1, max: 98,
    hint: 'Badminton swaps at 11 in the decider.',
    applies: (k) => !k.periodShaped && (k.changeEnds === 'atDeciderMidpoint' || k.changeEnds === 'everyNPoints') },
  { key: 'letsEnabled', label: 'Allow lets', group: 'ends', type: 'bool',
    hint: 'A replayed rally: no point, no change of serve.',
    applies: (k) => !k.periodShaped },
  { key: 'penaltiesEnabled', label: 'Allow conduct points', group: 'ends', type: 'bool',
    hint: 'An official can award a point for misconduct. Off for self-scored play - a player cannot card their opponent.',
    applies: (k) => !k.periodShaped },
  // Needs an umpire to count returns, so it is not offered for self-scored play.
  { key: 'expediteEnabled', label: 'Expedite system', group: 'ends', type: 'bool',
    hint: 'Table tennis: a game unfinished after the time limit switches to one serve each, and 13 good returns by the receiver win the point.',
    applies: (k) => !k.periodShaped && k.movement === 'everyN' && k.officiatingMode === 'officiated' },
  { key: 'expediteMinutes', label: 'Minutes before expedite', group: 'ends', type: 'int', min: 1, max: 60,
    hint: 'Playing time in one game. ITTF: 10.',
    applies: (k) => !k.periodShaped && k.movement === 'everyN' && k.officiatingMode === 'officiated' && k.expediteEnabled },

  // ---- clock
  { key: 'clockEnabled', label: 'Time cap', group: 'clock', type: 'bool',
    hint: 'Ends the match on the clock when the hall booking, not the score, decides.' },
  { key: 'clockMinutes', label: 'Minutes', group: 'clock', type: 'int', min: 1, max: 240,
    applies: (k) => k.clockEnabled && !k.periodShaped },
  // Same stored number as above (the format only ever keeps ONE whole-match
  // total - see the "whole-match time cap" comment in rally-kernel.ts), a
  // different question for a period-shaped sport: "how long is one period"
  // is what an organiser actually has in mind, not the match total. Typed and
  // shown per period; multiplied back out to the total on write, and divided
  // back down live if the period count changes - so the number on screen
  // always reflects the pace that's actually configured, not a stale one.
  { key: 'clockMinutes', label: 'Minutes per period', group: 'clock', type: 'int', min: 1, max: 240,
    hint: 'The whole match shares one clock. Set per period so changing the period count does not silently change how long each one runs.',
    applies: (k) => k.clockEnabled && k.periodShaped,
    toDisplay: (raw, k) => Math.max(1, Math.round(raw / Math.max(1, k.unitsToWin))),
    fromDisplay: (display, k) => Math.max(1, display) * Math.max(1, k.unitsToWin),
  },
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

  // ---- if it is still level
  //
  // Hidden while draws are allowed, because then none of it can ever run: the
  // kernel closes a level match as a draw and never asks. Turning draws off is what
  // makes a knockout a knockout, and these are the questions that follow from it.
  { key: 'extraTimeEnabled', label: 'Play extra time', group: 'tieBreak', type: 'bool',
    hint: 'Extra periods when the scores are level at full time.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && !k.khoKho },
  { key: 'extraTimePeriods', label: 'Periods of extra time', group: 'tieBreak', type: 'int', min: 1, max: 4,
    hint: 'Both are always played out - a side that goes ahead in the first still has to survive the second.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && k.extraTimeEnabled && !k.khoKho },
  { key: 'extraTimeMinutes', label: 'Minutes per extra period', group: 'tieBreak', type: 'int', min: 1, max: 60,
    hint: 'Each period, not the total. Two periods of 5 adds ten minutes.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && k.extraTimeEnabled && !k.khoKho },
  // Kho kho: one more inning (a turn each) before the minimum chase, if the rules ask for it.
  { key: 'extraTimeEnabled', label: 'Extra inning before minimum chase', group: 'tieBreak', type: 'bool',
    hint: 'Level at the end: one more inning is played, a turn each. Still level, the minimum chase decides. Off: straight to minimum chase.',
    applies: (k) => k.khoKho && !k.drawsAllowed },
  { key: 'extraTimePeriods', label: 'Extra turns', group: 'tieBreak', type: 'int', min: 1, max: 4,
    hint: '2 = one inning, a turn each side.',
    applies: (k) => k.khoKho && !k.drawsAllowed && k.extraTimeEnabled },
  { key: 'extraTimeMinutes', label: 'Minutes per extra turn', group: 'tieBreak', type: 'int', min: 1, max: 60,
    hint: 'Usually the same as a regular turn: IIMK 7 in groups, 9 in the eliminator and final.',
    applies: (k) => k.khoKho && !k.drawsAllowed && k.extraTimeEnabled },
  { key: 'extraTimeFirstTo', label: 'Win score still ends it in extra time', group: 'tieBreak', type: 'bool',
    hint: 'On: the first side to the win score wins at once, even in extra time (level 12-12, the next goal wins). Off: extra time is played in full and the leader at the end wins.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && k.extraTimeEnabled && k.firstTo > 0 && !k.khoKho },
  { key: 'goldenRaidEnabled', label: 'Golden raid', group: 'tieBreak', type: 'bool',
    hint: 'Still level after extra time: a fresh toss, then a golden raid each; the first point wins. Still level after both, a toss decides.',
    applies: (k) => k.kabaddi && !k.drawsAllowed },
  { key: 'shootoutEnabled', label: 'Penalty shoot-out', group: 'tieBreak', type: 'bool',
    hint: 'Settles it when the scores are still level after extra time. The scoreline is not changed - a 1-1 won on kicks is recorded 1-1.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && !k.khoKho && !k.kabaddi && !k.hockey },
  { key: 'shootoutEnabled', label: 'Shoot-out', group: 'tieBreak', type: 'bool',
    hint: 'Settles it when the scores are still level after any extra time: one-on-one shots. The scoreline is not changed.',
    applies: (k) => k.hockey && !k.drawsAllowed },
  { key: 'shootoutKicks', label: 'Shooters each', group: 'tieBreak', type: 'int', min: 1, max: 20,
    hint: 'The opening round (FIH 5). Still level after that goes to sudden death, one each.',
    applies: (k) => k.hockey && !k.drawsAllowed && k.shootoutEnabled },
  { key: 'shootoutKicks', label: 'Kicks each', group: 'tieBreak', type: 'int', min: 1, max: 20,
    hint: 'The opening round. Still level after that goes to sudden death, a pair at a time.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && k.shootoutEnabled && !k.khoKho && !k.kabaddi && !k.hockey },
  // Kho kho's follow-on (two-innings formats only).
  { key: 'followOnLead', label: 'Follow-on from a lead of', group: 'shape', type: 'int', min: 1, max: 99,
    hint: 'After the first innings, a side this far ahead may make the other chase again. KKFI and IIMK: 9.',
    applies: (k) => k.khoKho && k.unitsToWin >= 4 },
  { key: 'followOnCompulsoryEnabled', label: 'Follow-on compulsory for a bigger lead', group: 'shape', type: 'bool',
    hint: 'Off: always the leading side\'s choice. On: past the lead below, the console only offers the follow-on (IIMK: compulsory above 9).',
    applies: (k) => k.khoKho && k.unitsToWin >= 4 },
  { key: 'followOnCompulsoryAbove', label: 'Compulsory when the lead is more than', group: 'shape', type: 'int', min: 0, max: 99,
    applies: (k) => k.khoKho && k.unitsToWin >= 4 && k.followOnCompulsoryEnabled },
  { key: 'minimumChaseEnabled', label: 'Minimum chase', group: 'tieBreak', type: 'bool',
    hint: 'Still level: each side chases once more and the faster first out wins. The score stays level.',
    applies: (k) => k.khoKho && !k.drawsAllowed },
  { key: 'universalPointEnabled', label: 'Universal point', group: 'tieBreak', type: 'bool',
    hint: 'Still level after the last period (and any extra time): the next point wins.',
    applies: (k) => k.periodShaped && !k.drawsAllowed && !k.khoKho && !k.kabaddi },
  { key: 'firstTo', label: 'Win at this score', group: 'shape', type: 'int', min: 0, max: 99,
    hint: 'The first side to this total wins straight away, even before time is up (ultimate: 13). 0 = off.',
    applies: (k) => k.periodShaped && !k.khoKho && !k.kabaddi },

  // ---- run
  // ---- cards (hockey, futsal)
  { key: 'cardSuspensionsEnabled', label: 'Time card suspensions', group: 'cards', type: 'bool',
    hint: 'On: a carded player sits out for a set time and the console counts it down, in match time. Off: cards are only recorded.',
    applies: (k) => k.cardSport === 'hockey' || k.cardSport === 'futsal' },
  { key: 'greenSuspensionMinutes', label: 'Green card minutes', group: 'cards', type: 'int', min: 1, max: 20,
    hint: 'FIH and IIMK: 2.',
    applies: (k) => k.cardSport === 'hockey' && k.cardSuspensionsEnabled },
  { key: 'yellowSuspensionMinutes', label: 'Yellow card minutes', group: 'cards', type: 'int', min: 1, max: 20,
    hint: 'FIH: at least 5 (10 for a serious offence). IIMK: 5.',
    applies: (k) => k.cardSport === 'hockey' && k.cardSuspensionsEnabled },
  { key: 'cardEscalationEnabled', label: 'Repeat cards step up', group: 'cards', type: 'bool',
    hint: 'A second green becomes a yellow and a second yellow a red. The console asks before recording it. IIMK: on.',
    applies: (k) => k.cardSport === 'hockey' },
  { key: 'cardEscalationEnabled', label: 'Second yellow is a red', group: 'cards', type: 'bool',
    hint: 'The Laws of the Game: a second yellow sends the player off. The console asks, and records it as a second-yellow red.',
    applies: (k) => k.cardSport === 'football' || k.cardSport === 'futsal' },
  { key: 'redSuspensionMinutes', label: 'Red card minutes', group: 'cards', type: 'int', min: 1, max: 20,
    hint: 'The side plays short for this long, or until the other side scores. Futsal and IIMK: 2.',
    applies: (k) => k.cardSport === 'futsal' && k.cardSuspensionsEnabled },

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
  { key: 'carrom', label: 'Boards & queen' },
  { key: 'serve', label: 'Serving' },
  { key: 'ends', label: 'Ends & conduct' },
  { key: 'clock', label: 'Time cap' },
  { key: 'tieBreak', label: 'If it is still level' },
  { key: 'cards', label: 'Cards' },
  { key: 'run', label: 'How it is run' },
];

/** The knobs that apply to this particular set of values, in display order. */
export function knobsFor(k: FormatKnobs): KnobSpec[] {
  return KNOB_SPECS.filter((s) => (!k.chess || CHESS_KNOBS.has(s.key)) && (!k.carrom || CARROM_KNOBS.has(s.key))
    && (!s.applies || s.applies(k)));
}

/** "90+30" -> [90, 30]; anything else -> the classical default. */
function readTimeControl(tc: unknown): [number, number] {
  const m = typeof tc === 'string' ? /^\s*(\d+)\s*\+\s*(\d+)\s*$/.exec(tc) : null;
  return m ? [Number(m[1]), Number(m[2])] : [90, 30];
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
    expediteEnabled: !!expediteConfig(f),
    expediteMinutes: expediteConfig(f)?.afterMinutes ?? ITTF_EXPEDITE.afterMinutes,

    clockEnabled: !!f.clock,
    clockMinutes: f.clock?.minutes ?? 20,
    clockAction: f.clock?.action ?? 'finishPointThenLeader',
    clockTieRule: f.clock?.tieRule ?? 'suddenDeathPoint',

    // The defaults a fest actually wants: two halves of five, then five kicks each.
    // They are what the knob shows before anyone touches it, so turning extra time
    // on does not also require deciding how long it is.
    extraTimeEnabled: !!f.tieBreak?.extraTime,
    extraTimePeriods: f.tieBreak?.extraTime?.periods ?? 2,
    extraTimeMinutes: f.tieBreak?.extraTime?.minutes ?? 5,
    extraTimeFirstTo: !f.tieBreak?.extraTime?.fullTime,
    shootoutEnabled: !!f.tieBreak?.penalties,
    shootoutKicks: f.tieBreak?.penalties?.kicks ?? 5,
    minimumChaseEnabled: !!f.tieBreak?.minimumChase,
    universalPointEnabled: !!f.tieBreak?.universalPoint,
    firstTo: top.firstTo ?? 0,
    khoKho: isKhoKhoFormat(f),
    followOnLead: followOnLead(f),
    followOnCompulsoryEnabled: followOnCompulsoryAbove(f) != null,
    followOnCompulsoryAbove: followOnCompulsoryAbove(f) ?? followOnLead(f),
    kabaddi: isKabaddiFormat(f),
    hockey: canonicalTeamSport(f.sport) === 'hockey',
    ...cardKnobs(f),
    goldenRaidEnabled: !!f.tieBreak?.goldenRaid,

    officiatingMode: f.officiatingMode,
    drawsAllowed: f.endStates.drawsAllowed,

    periodShaped: isPeriodShaped(f),
    periodLabel: inner.label || 'period',

    chess: isChessSport(f.sport),
    timeBaseMinutes: readTimeControl(f.rulesSheet?.timeControl)[0],
    timeIncrementSeconds: readTimeControl(f.rulesSheet?.timeControl)[1],

    ...carromKnobs(f),
  };
}

/** Card suspensions, read off the rules sheet; defaults are the sport's. */
function cardKnobs(f: ScoringFormat) {
  const m = cardMinutesFor(f) ?? {};
  return {
    cardSport: cardSportOf(f.sport),
    cardSuspensionsEnabled: !!cardMinutesFor(f) && f.rulesSheet?.cardSuspensions !== false,
    greenSuspensionMinutes: m.green ?? 2,
    yellowSuspensionMinutes: m.yellow ?? 5,
    redSuspensionMinutes: m.red ?? 2,
    cardEscalationEnabled: escalationOn(f),
  };
}

/** Carrom's board limit and queen, read off the rules sheet; defaults are the ICF ones. */
function carromKnobs(f: ScoringFormat) {
  const r = carromRulesOf(f);
  return {
    carrom: isCarromSport(f.sport),
    carromMaxBoardsEnabled: r.maxBoards != null,
    carromMaxBoards: r.maxBoards ?? 8,
    carromQueenPoints: r.queenPoints,
    carromQueenCutoffEnabled: r.queenCutoff != null,
    carromQueenCutoff: r.queenCutoff ?? 22,
    carromQueenMustBeCovered: r.queenMustBeCovered,
    carromBoardsWonDecides: r.boardsWonDecides,
    carromTieBreakBoards: r.tieBreakBoards,
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
  const baseTop = f.levels[f.levels.length - 1];
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

  // Other sport plugins ride through untouched; only `expedite` is the knobs' to set.
  const { expedite: priorExpedite, ...otherPlugins } = f.plugins ?? {};
  const expediteOn = k.expediteEnabled && k.movement === 'everyN' && k.officiatingMode === 'officiated';
  const pluginMap = expediteOn
    ? { ...otherPlugins, expedite: { ...ITTF_EXPEDITE, ...((priorExpedite as object) ?? {}), enabled: true, afterMinutes: Math.max(1, k.expediteMinutes) } }
    : otherPlugins;
  const plugins = Object.keys(pluginMap).length ? pluginMap : undefined;

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

  // Spread `baseTop` rather than writing a bare `{ key: 'match', label: 'Match',
  // ... }` literal - a period-shaped match level also carries `decide:
  // 'aggregate'`, which is what tells the kernel this match is won on TOTAL
  // score, not units won. Rebuilding it from scratch silently dropped that flag
  // on every save, turning a kho-kho format's four-turns-decided-by-aggregate
  // into a nonsensical best-of-seven the moment anyone touched its rules.
  // `firstTo` only means something on an aggregate match; dropped when set to 0.
  const topRest: LevelSpec = { ...baseTop };
  delete topRest.firstTo;
  const firstTo = k.periodShaped && k.firstTo > 0 ? { firstTo: k.firstTo } : {};
  const levels: LevelSpec[] = k.unitsToWin > 1
    ? [inner, { ...topRest, ...firstTo, target: k.unitsToWin, winBy: 1, cap: null }]
    : [inner, { ...topRest, ...firstTo, target: 1, winBy: 1, cap: null }];

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
    plugins,
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
    tieBreak: k.extraTimeEnabled || k.shootoutEnabled || k.minimumChaseEnabled || k.universalPointEnabled || (k.goldenRaidEnabled && k.kabaddi)
      ? {
        ...(k.goldenRaidEnabled && k.kabaddi ? { goldenRaid: true } : {}),
        ...(k.universalPointEnabled && !k.khoKho ? { universalPoint: true } : {}),
        extraTime: k.extraTimeEnabled
          ? {
            // Keep basketball's repeat-while-level and its "Overtime" name; the editor has no knob for them.
            ...(f.tieBreak?.extraTime?.repeat ? { repeat: true } : {}),
            ...(f.tieBreak?.extraTime?.label ? { label: f.tieBreak.extraTime.label } : k.khoKho ? { label: 'Extra turn' } : {}),
            ...(k.firstTo > 0 && !k.extraTimeFirstTo ? { fullTime: true } : {}),
            periods: Math.max(1, k.extraTimePeriods),
            minutes: Math.max(1, k.extraTimeMinutes),
          }
          : null,
        penalties: k.shootoutEnabled && !k.khoKho ? { kicks: Math.max(1, k.shootoutKicks) } : null,
        // Carried through, or saving a kho kho format from the editor would drop it.
        ...(k.minimumChaseEnabled && k.khoKho ? { minimumChase: true } : {}),
      }
      : null,
    endStates: { ...f.endStates, drawsAllowed: k.drawsAllowed },
    // Chess keeps its time control on the rules sheet - shown to the arbiter, not enforced.
    ...(k.chess
      ? { rulesSheet: { ...(f.rulesSheet ?? {}), timeControl: `${Math.max(1, k.timeBaseMinutes)}+${Math.max(0, k.timeIncrementSeconds)}` } }
      : {}),
    // Kho kho's follow-on lives on the rules sheet, which kho-kho.ts reads.
    ...(k.khoKho
      ? {
        rulesSheet: {
          ...(f.rulesSheet ?? {}),
          followOnLead: Math.max(1, k.followOnLead),
          followOnCompulsoryAbove: k.followOnCompulsoryEnabled ? Math.max(0, k.followOnCompulsoryAbove) : null,
        },
      }
      : {}),
    // Card suspensions live on the rules sheet, which suspensions.ts reads.
    ...(k.cardSport
      ? {
        rulesSheet: {
          ...(f.rulesSheet ?? {}),
          ...(k.cardSport === 'hockey' || k.cardSport === 'futsal' ? {
            cardSuspensions: k.cardSuspensionsEnabled,
            cardSuspensionMinutes: k.cardSport === 'hockey'
              ? { green: Math.max(1, k.greenSuspensionMinutes), yellow: Math.max(1, k.yellowSuspensionMinutes) }
              : { red: Math.max(1, k.redSuspensionMinutes), red2y: Math.max(1, k.redSuspensionMinutes) },
          } : {}),
          cardEscalation: k.cardEscalationEnabled,
        },
      }
      : {}),
    // Carrom keeps its board limit and queen on the rules sheet, which carrom.ts reads.
    ...(k.carrom && k.target > 1
      ? {
        rulesSheet: {
          ...(f.rulesSheet ?? {}),
          maxBoards: k.carromMaxBoardsEnabled ? Math.max(1, k.carromMaxBoards) : null,
          queenPoints: Math.max(0, k.carromQueenPoints),
          queenCutoff: k.carromQueenPoints > 0 && k.carromQueenCutoffEnabled ? Math.max(1, k.carromQueenCutoff) : null,
          queenMustBeCovered: k.carromQueenMustBeCovered,
          boardsWonDecides: k.carromMaxBoardsEnabled && k.carromBoardsWonDecides,
          tieBreakBoards: Math.max(1, k.carromTieBreakBoards),
        },
      }
      : {}),
  };
}

/** One line describing what a format does, for a list row. */
export function describeKnobs(k: FormatKnobs): string {
  const bits: string[] = [];
  // Chess: how many games, and the clock - there is no target score to describe.
  if (k.chess) {
    const games = k.unitsToWin * 2 - 1;
    return [games === 1 ? 'single game' : `${games}-game match`, `${k.timeBaseMinutes}+${k.timeIncrementSeconds}`].join(' · ');
  }
  if (k.carrom) {
    if (k.target <= 1) return k.unitsToWin > 1 ? `best of ${k.unitsToWin * 2 - 1} boards` : 'single board';
    bits.push(k.unitsToWin > 1 ? `best of ${k.unitsToWin * 2 - 1} games to ${k.target}` : `single game to ${k.target}`);
    if (k.carromMaxBoardsEnabled) bits.push(`${k.carromMaxBoards} boards a game`);
    if (k.carromMaxBoardsEnabled && k.carromBoardsWonDecides) bits.push('level: more boards won');
    if (k.carromMaxBoardsEnabled && k.carromTieBreakBoards > 1) bits.push(`${k.carromTieBreakBoards} tie-break boards`);
    if (k.carromQueenPoints > 0) bits.push(k.carromQueenCutoffEnabled ? `queen ${k.carromQueenPoints} below ${k.carromQueenCutoff}` : `queen ${k.carromQueenPoints}`);
    return bits.join(' · ');
  }
  // Period-shaped (kho-kho, kabaddi...): there is no game to win and no
  // decider, just a fixed number of periods and a clock - "best of 7 to 1"
  // for a format that plays a fixed 4 turns decided on total score was
  // meaningless, not merely unclear.
  if (k.periodShaped) {
    const label = pluralizePeriodLabel(k.periodLabel || 'period', k.unitsToWin).toLowerCase();
    bits.push(`${k.unitsToWin} ${label}`);
    if (k.firstTo > 0 && !k.khoKho) bits.push(`first to ${k.firstTo}`);
  } else {
    bits.push(k.unitsToWin > 1 ? `best of ${k.unitsToWin * 2 - 1} to ${k.target}` : `single game to ${k.target}`);
    bits.push(k.winBy > 1 ? `win by ${k.winBy}` : 'sudden death');
    if (k.capEnabled) bits.push(`cap ${k.cap}`);
    if (k.deciderEnabled && k.unitsToWin > 1) bits.push(`decider to ${k.deciderTarget}`);
    if (k.movement === 'everyN') bits.push(`serve every ${k.serveEvery}`);
    if (k.pointScoring === 'serverOnly') bits.push('server scores only');
    if (k.handicapEnabled) bits.push(`handicap ${k.handicapHome}–${k.handicapAway}`);
  }
  if (k.cardSport === 'hockey') {
    bits.push(k.cardSuspensionsEnabled ? `green ${k.greenSuspensionMinutes} / yellow ${k.yellowSuspensionMinutes} min off` : 'cards not timed');
    if (k.cardEscalationEnabled) bits.push('repeat cards step up');
  }
  if (k.cardSport === 'futsal') bits.push(k.cardSuspensionsEnabled ? `red card ${k.redSuspensionMinutes} min off` : 'red card not timed');
  if ((k.cardSport === 'football' || k.cardSport === 'futsal') && !k.cardEscalationEnabled) bits.push('second yellow not a red');
  if (k.clockEnabled) {
    bits.push(k.periodShaped
      ? `${k.clockMinutes} min cap (${Math.round(k.clockMinutes / Math.max(1, k.unitsToWin))}/period)`
      : `${k.clockMinutes} min cap`);
  }
  // What settles it, on the row itself - so an organiser scanning a shelf of
  // formats can see which one goes to kicks without opening it.
  const minChase = k.khoKho && k.minimumChaseEnabled;
  const kicks = k.shootoutEnabled && !k.khoKho;
  const universal = k.universalPointEnabled && !k.khoKho;
  const golden = k.kabaddi && k.goldenRaidEnabled;
  if (!k.drawsAllowed && (k.extraTimeEnabled || kicks || minChase || universal || golden)) {
    const chain: string[] = [];
    if (k.extraTimeEnabled) {
      chain.push(k.khoKho ? `extra inning (${k.extraTimePeriods} x ${k.extraTimeMinutes} min turns)`
        : `ET ${k.extraTimePeriods}x${k.extraTimeMinutes} min${k.firstTo > 0 && !k.extraTimeFirstTo ? ' played in full' : ''}`);
    }
    if (kicks) chain.push(k.hockey ? `shoot-out (${k.shootoutKicks} each)` : `${k.shootoutKicks} kicks`);
    if (minChase) chain.push('minimum chase');
    if (universal) chain.push('universal point');
    if (golden) chain.push('golden raid');
    bits.push(chain.join(' then '));
  }
  return bits.join(' · ');
}
