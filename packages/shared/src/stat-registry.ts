import type { EventTypeSpec } from './scoring.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import {
  atAdvantage, effectiveLevel, initKernel, isDecider, serveSpecFor, step,
  type KernelState, type RallyLog,
} from './rally-kernel.js';
import { formatForPairing, resolveServer, type Pairing, type ServeNomination } from './serve-resolvers.js';

// ============================================================================
// The stat registry.
//
// "Datapoints specific to each sport" has an obvious implementation - a table per
// sport - and it is the wrong one: 34 tables, 34 migrations, and every cross-sport
// question ("how many matches has this person played?") becomes a 34-way union.
//
// Instead the DEFINITIONS live here as data (the same way this codebase already
// ships variability in tie-templates.ts, event-templates.ts and role-model.ts) and
// the VALUES live in a narrow jsonb column. Adding a sport is a change to one file
// with no migration; adding a metric backfills across every match already played,
// because everything is recomputed from the event log rather than incremented.
//
// For the racquet family specifically, the metrics are DERIVED FROM THE RALLY LOG
// with no extra console UI at all. Nobody taps "who won that rally" on a badminton
// point - and nobody has to, because the kernel already knows who served, who won
// and which unit it belonged to.
// ============================================================================

export type MetricSource = 'event' | 'rally' | 'entry' | 'derived';
export type MetricAggregate = 'sum' | 'max' | 'min' | 'avg' | 'rate';

export interface StatMetric {
  key: string;
  label: string;
  /** Column header in a dense stat table: "Pts", "SW%", "G". */
  short: string;
  unit?: string;
  source: MetricSource;
  /** Read from the bag under THIS key instead of `key`, when one raw field
   *  folds two ways (a personal best and a career average). Defaults to `key`. */
  sourceKey?: string;
  /** `event` source: the event keys that feed this metric. */
  fromEvents?: string[];
  /** +1 per contributing event, or 'value' to sum the event's own magnitude. */
  per?: number | 'value';
  /** `derived` source: computed from other metrics at rollup time. */
  /** `per`: a plain average, x / y to one decimal (not a percentage). */
  formula?: { op: 'ratio' | 'sum' | 'diff' | 'per'; of: [string, string] };
  aggregate: MetricAggregate;
  /** `rate` aggregate: numerator and denominator metric keys. */
  rateOf?: [string, string];
  /** Shown on the profile card, not just in the full table. */
  headline?: boolean;
  /** false for runs_conceded, errors, points_lost. Drives sort direction and colour. */
  higherIsBetter?: boolean;
  /** Percentages render differently from counts. */
  percent?: boolean;
  /** Stored only to compute a rate; not shown as a tile of its own. */
  hidden?: boolean;
}

/**
 * A loggable action, extending the EventTypeSpec the console already understands so
 * existing event decks keep working untouched. `metrics` is what makes it a stat
 * rather than just a timeline entry.
 */
/**
 * WHAT COLOUR AN ACTION READS AS.
 *
 * A console where every button is the same blue makes the official read the label
 * before every tap, and a red card and a save are not things anyone should have to
 * read twice. The tone is declared here, with the action, rather than matched on key
 * inside the deck - a card is a card in football, hockey, handball and futsal, and
 * all four share this one event set.
 *
 * These are MEANINGS, not colours: the deck owns the palette, so a tenant's brand
 * ramp can move without this file knowing. The one place meaning and colour really
 * do coincide is the cards, because a yellow card that renders green is wrong in a
 * way no amount of consistency excuses.
 */
export type EventTone =
  | 'score'      // puts points on this side's board
  | 'ownGoal'    // puts points on the OTHER side's board
  | 'good'       // a positive act that scores nothing (a save, a dig, a rebound)
  | 'caution'    // a yellow card, a foul
  | 'dismissal'  // a red card, a send-off
  | 'error';     // a miss, a turnover, a service error

export interface StatEventSpec extends EventTypeSpec {
  /** How the button reads at a glance. Defaults to score/error on the points alone. */
  tone?: EventTone;
  /**
   * The second person, because most interesting events involve two - goal + assist,
   * wicket + fielder, block + set. Recorded on the SAME row as the primary: an assist
   * captured as a separate tap is an assist that never gets captured.
   */
  secondPlayer?: { key: string; label: string; optional: boolean };
  /** A magnitude, where the event carries one (a raid worth 3 points). */
  value?: { label: string; unit?: string; min?: number; max?: number };
  metrics: Record<string, number | 'value'>;
  secondPlayerMetrics?: Record<string, number>;
  /**
   * The POINT goes to the other side, the RECORD stays with this player.
   *
   * An own goal is the only action where those two come apart, and treating it as
   * an ordinary event left the scoreboard a goal short of the match that was
   * played: the player's own-goal tally went up and nobody's score moved.
   */
  forOpponent?: boolean;
}

export type StatFamily = 'racquet' | 'invasion' | 'raid' | 'net' | 'board' | 'measured' | 'combat' | 'cricket';

export interface SportStatSpec {
  sport: string;
  family: StatFamily;
  metrics: StatMetric[];
  events: StatEventSpec[];
  /** Lineup positions / roles offered on the team sheet. */
  positions?: string[];
}

// ---- metric helpers --------------------------------------------------------

const rally = (
  key: string, label: string, short: string,
  o: Partial<StatMetric> = {},
): StatMetric => ({
  key, label, short, source: 'rally', aggregate: 'sum', higherIsBetter: true, ...o,
});

const rate = (key: string, label: string, short: string, of: [string, string], headline = false): StatMetric => ({
  key, label, short, source: 'derived', aggregate: 'rate', rateOf: of,
  higherIsBetter: true, percent: true, headline,
});

// ============================================================================
// Racquet metrics: the dividend from the rally kernel.
// ============================================================================

const RACQUET_CORE: StatMetric[] = [
  rally('matches', 'Matches', 'M', { headline: true }),
  rally('wins', 'Wins', 'W', { headline: true }),
  rally('losses', 'Losses', 'L', { higherIsBetter: false }),
  rally('draws', 'Draws', 'D'),
  rate('win_pct', 'Win %', 'Win%', ['wins', 'matches'], true),

  rally('points_won', 'Points won', 'Pts', { headline: true }),
  rally('points_lost', 'Points lost', 'PtsL', { higherIsBetter: false }),
  rally('point_diff', 'Point difference', '+/-', { source: 'derived', formula: { op: 'diff', of: ['points_won', 'points_lost'] } }),

  // Yours in doubles: rallies YOU served, and rallies YOU had to return the serve in.
  rally('service_points_played', 'Points on your serve', 'SvP'),
  rally('service_points_won', 'Won on your serve', 'SvW'),
  rate('service_win_pct', 'Serve win %', 'Sv%', ['service_points_won', 'service_points_played'], true),

  rally('return_points_played', 'Points receiving', 'RtP'),
  rally('return_points_won', 'Won receiving', 'RtW'),
  rate('return_win_pct', 'Receive win %', 'Rt%', ['return_points_won', 'return_points_played']),

  // Doubles only: the pair's totals, beside the personal ones above.
  rally('pair_service_points_played', 'Points your pair served', 'PSv'),
  rally('pair_service_points_won', 'Won when your pair served', 'PSvW'),
  rate('pair_service_win_pct', 'Pair serve win %', 'PSv%', ['pair_service_points_won', 'pair_service_points_played']),
  rally('pair_return_points_played', 'Points your pair received', 'PRt'),
  rally('pair_return_points_won', 'Won when your pair received', 'PRtW'),
  rate('pair_return_win_pct', 'Pair receive win %', 'PRt%', ['pair_return_points_won', 'pair_return_points_played']),

  // Side-out scoring (traditional pickleball, English squash): only the server scores.
  rally('side_outs_won', 'Side-outs won', 'SO'),
  // The opponents' service turns you faced: side-out % is how many of them you ended.
  rally('service_turns_faced', 'Service turns faced', 'STF', { hidden: true }),
  rate('side_out_pct', 'Side-out %', 'SO%', ['side_outs_won', 'service_turns_faced']),
  rally('service_turns', 'Service turns', 'STn', { hidden: true }),
  rally('service_turn_points', 'Points in service turns', 'STP', { hidden: true }),
  rally('points_per_service_turn', 'Points per service turn', 'P/T',
    { source: 'derived', formula: { op: 'per', of: ['service_turn_points', 'service_turns'] } }),

  // Table tennis expedite system - present only for matches it came into.
  rally('expedite_matches', 'Expedite matches', 'ExM'),
  rally('expedite_wins', 'Expedite wins', 'ExW'),
  rally('expedite_points_played', 'Expedite points', 'ExP', { hidden: true }),
  rally('expedite_points_won', 'Expedite points won', 'ExPW', { hidden: true }),
  rate('expedite_point_win_pct', 'Expedite point win %', 'Ex%', ['expedite_points_won', 'expedite_points_played']),
  rally('expedite_return_wins', 'Won by 13 returns', '13W'),
  // Against the SERVER personally: their opponent survived 13 returns on their serve.
  rally('expedite_return_losses', 'Lost to 13 returns', '13L', { higherIsBetter: false }),

  rally('games_won', 'Games won', 'GW'),
  rally('games_lost', 'Games lost', 'GL', { higherIsBetter: false }),
  rally('deciders_won', 'Deciders won', 'DecW', { headline: true }),
  rally('deciders_lost', 'Deciders lost', 'DecL', { higherIsBetter: false }),
  rally('deuce_points_won', 'Deuce points won', 'DcW'),
  rally('deuce_points_played', 'Deuce points', 'DcP'),
  rate('deuce_win_pct', 'Deuce win %', 'Dc%', ['deuce_points_won', 'deuce_points_played']),

  // Pressure: a rally that would win the game (or match) for one side.
  rally('game_points_played', 'Game points', 'GPP', { hidden: true }),
  rally('game_points_won', 'Game points converted', 'GPW', { hidden: true }),
  rate('game_point_conversion_pct', 'Game point conversion %', 'GP%', ['game_points_won', 'game_points_played']),
  rally('game_points_faced', 'Game points faced', 'GPF', { hidden: true }),
  rally('game_points_saved', 'Game points saved', 'GPS', { hidden: true }),
  rate('game_point_save_pct', 'Game point save %', 'GS%', ['game_points_saved', 'game_points_faced']),
  rally('match_points_played', 'Match points', 'MPP', { hidden: true }),
  rally('match_points_won', 'Match points converted', 'MPW', { hidden: true }),
  rate('match_point_conversion_pct', 'Match point conversion %', 'MP%', ['match_points_won', 'match_points_played']),
  rally('match_points_faced', 'Match points faced', 'MPF', { hidden: true }),
  rally('match_points_saved', 'Match points saved', 'MPS'),
  // Won a game after trailing by COMEBACK_GAME_DEFICIT or more in it.
  rally('comeback_games', 'Games won from behind', 'GFB'),

  rally('longest_streak', 'Longest point streak', 'Strk', { aggregate: 'max', headline: true }),
  rally('comeback_wins', 'Comeback wins', 'CB', { headline: true }),
  rally('whitewashes', 'Straight-games wins', 'SGW'),
  rally('lets', 'Lets', 'Let', { higherIsBetter: false }),
  rally('retirements', 'Retirements', 'RET', { higherIsBetter: false }),
  rally('walkovers_received', 'Walkovers received', 'W/O'),

  // AN ACE IS A REAL THING IN ALL FIVE RACQUET SPORTS, not only tennis.
  //
  // `RACQUET_EVENTS` below offers the Ace and Double fault taps to every one of
  // them, but these two metrics used to live in TENNIS_EXTRA - so in table tennis,
  // badminton, pickleball and squash the console offered a button that credited a
  // metric which did not exist. The tap reached the timeline and the player's stat
  // line never showed it, silently and permanently.
  rally('aces', 'Aces', 'Ace', { source: 'event', fromEvents: ['ace'], per: 1, headline: true }),
  rally('double_faults', 'Double faults', 'DF', { source: 'event', fromEvents: ['double_fault'], per: 1, higherIsBetter: false }),
];

/** Tennis alone tracks serve outcomes as first-class events - it has two serves. */
const TENNIS_EXTRA: StatMetric[] = [
  // First and second serve - counted only in matches where the scorer recorded serves
  // (Fault / Ace), so `serve_points_tracked` is their own denominator, not every point served.
  rally('serve_points_tracked', 'Serve points recorded', 'SvR', { hidden: true }),
  rally('first_serves_in', 'First serves in', '1stIn', { hidden: true }),
  rate('first_serve_pct', '1st serve in %', '1st%', ['first_serves_in', 'serve_points_tracked'], true),
  rally('first_serve_points_won', '1st serve points won', '1stW', { hidden: true }),
  rate('first_serve_win_pct', '1st serve points won %', '1stW%', ['first_serve_points_won', 'first_serves_in']),
  rally('second_serve_points_played', '2nd serve points', '2ndP', { hidden: true }),
  rally('second_serve_points_won', '2nd serve points won', '2ndW', { hidden: true }),
  rate('second_serve_win_pct', '2nd serve points won %', '2ndW%', ['second_serve_points_won', 'second_serve_points_played']),
  // Service games: held when you win your own, broken when the receiver does.
  rally('service_games_played', 'Service games', 'SvG', { hidden: true }),
  rally('service_games_won', 'Service games held', 'Held', { hidden: true }),
  rate('service_games_held_pct', 'Service games held %', 'Hold%', ['service_games_won', 'service_games_played'], true),
  rally('return_games_played', 'Return games', 'RtG', { hidden: true }),
  rally('return_games_won', 'Breaks of serve', 'Brk'),
  rate('return_games_won_pct', 'Return games won %', 'Brk%', ['return_games_won', 'return_games_played']),
  rally('break_points_won', 'Break points won', 'BPW', { headline: true }),
  rally('break_points_played', 'Break points', 'BP'),
  rally('break_points_saved', 'Break points saved', 'BPS'),
  rate('break_point_pct', 'Break point conversion', 'BP%', ['break_points_won', 'break_points_played']),
  rally('tiebreaks_won', 'Tie-breaks won', 'TBW'),
  rally('tiebreaks_lost', 'Tie-breaks lost', 'TBL', { higherIsBetter: false }),
  rally('sets_won', 'Sets won', 'SW'),
  rally('sets_lost', 'Sets lost', 'SL', { higherIsBetter: false }),
];

/** A "pickle": a game won with the opponents still on 0 - pickleball's own word for it. */
const PICKLEBALL_EXTRA: StatMetric[] = [
  rally('pickles', 'Pickles (games won to 0)', 'Pkl'),
];

/** Explicit taps a keen official can add on top of the free derived set. */
const RACQUET_EVENTS: StatEventSpec[] = [
  { key: 'ace', label: 'Ace', perPlayer: true, metrics: { aces: 1 } },
  { key: 'double_fault', label: 'Double fault', perPlayer: true, metrics: { double_faults: 1 } },
  { key: 'winner', label: 'Winner', perPlayer: true, metrics: { winners: 1 } },
  { key: 'error', label: 'Unforced error', perPlayer: true, metrics: { unforced_errors: 1 } },
];

const OPTIONAL_SHOT_METRICS: StatMetric[] = [
  rally('winners', 'Winners', 'Wnr', { source: 'event', fromEvents: ['winner'], per: 1 }),
  rally('unforced_errors', 'Unforced errors', 'UE', { source: 'event', fromEvents: ['error'], per: 1, higherIsBetter: false }),
];

const racquetSpec = (sport: string, extra: StatMetric[] = [], positions?: string[]): SportStatSpec => ({
  sport,
  family: 'racquet',
  metrics: [...RACQUET_CORE, ...OPTIONAL_SHOT_METRICS, ...extra],
  events: RACQUET_EVENTS,
  positions: positions ?? ['singles', 'doubles', 'mixed doubles'],
});

export const RACQUET_STAT_SPECS: SportStatSpec[] = [
  racquetSpec('table tennis'),
  racquetSpec('badminton'),
  racquetSpec('tennis', TENNIS_EXTRA),
  racquetSpec('pickleball', PICKLEBALL_EXTRA),
  racquetSpec('squash'),
];

// ============================================================================
// The other families.
//
// Racquet metrics come free from the rally log. These do not: a goal belongs to a
// PERSON, and no amount of folding a score can say which. So each family declares
// `events` - the attributable actions - and their `metrics` mapping, and the
// console's existing event decks already know how to offer them.
//
// The one thing that was missing everywhere: `engine.ts` captured the picked player
// and the reducer dropped it before the log was written. Fixing that is what makes
// every metric below reachable.
// ============================================================================

const ev = (
  key: string, label: string, metrics: Record<string, number | 'value'>,
  o: Partial<StatEventSpec> = {},
): StatEventSpec => ({ key, label, perPlayer: true, metrics, ...o });

const count = (key: string, label: string, short: string, o: Partial<StatMetric> = {}): StatMetric => ({
  key, label, short, source: 'event', per: 1, aggregate: 'sum', higherIsBetter: true, ...o,
});

/** Appearances and the result - every family has these, however it is scored. */
const UNIVERSAL: StatMetric[] = [
  rally('matches', 'Matches', 'M', { headline: true }),
  rally('wins', 'Wins', 'W', { headline: true }),
  rally('losses', 'Losses', 'L', { higherIsBetter: false }),
  rally('draws', 'Draws', 'D'),
  rate('win_pct', 'Win %', 'Win%', ['wins', 'matches'], true),
  rally('minutes', 'Minutes played', 'Min', { source: 'entry' }),
];

// ---- invasion & goal -------------------------------------------------------

const GOAL_EVENTS: StatEventSpec[] = [
  ev('goal', 'Goal', { goals: 1 }, {
    points: 1,
    tone: 'score',
    // An assist recorded as a SEPARATE tap is an assist that never gets recorded.
    secondPlayer: { key: 'assist', label: 'Assisted by', optional: true },
    secondPlayerMetrics: { assists: 1 },
  }),
  // Worth a goal - to the OTHER side. `forOpponent` is what keeps the scoreboard
  // and the player's record pointing in opposite directions, which is exactly what
  // an own goal is.
  ev('own_goal', 'Own goal', { own_goals: 1 }, { points: 1, forOpponent: true, tone: 'ownGoal' }),
  ev('save', 'Save', { saves: 1 }, { tone: 'good' }),
  ev('yellow', 'Yellow card', { yellows: 1 }, { tone: 'caution' }),
  ev('red', 'Red card', { reds: 1 }, { tone: 'dismissal' }),
  ev('pen_scored', 'Penalty scored', { pens_scored: 1, goals: 1 }, { points: 1, tone: 'score' }),
  ev('pen_missed', 'Penalty missed', { pens_missed: 1 }, { tone: 'error' }),
];

const GOAL_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  count('goals', 'Goals', 'G', { fromEvents: ['goal', 'pen_scored'], headline: true }),
  count('assists', 'Assists', 'A', { fromEvents: ['goal'], headline: true }),
  count('own_goals', 'Own goals', 'OG', { fromEvents: ['own_goal'], higherIsBetter: false }),
  count('saves', 'Saves', 'Sv', { fromEvents: ['save'] }),
  count('yellows', 'Yellow cards', 'YC', { fromEvents: ['yellow'], higherIsBetter: false }),
  count('reds', 'Red cards', 'RC', { fromEvents: ['red'], higherIsBetter: false }),
  count('pens_scored', 'Penalties scored', 'PS', { fromEvents: ['pen_scored'] }),
  count('pens_missed', 'Penalties missed', 'PM', { fromEvents: ['pen_missed'], higherIsBetter: false }),
  rate('goals_per_match', 'Goals per match', 'G/M', ['goals', 'matches'], true),
];

// Basketball counts the same shape with a different vocabulary, and its baskets are
// worth one, two or three - which is what `value` on an event is for.
const BASKET_EVENTS: StatEventSpec[] = [
  ev('fg1', 'Free throw', { points_scored: 1, fg_1: 1 }, { points: 1 }),
  ev('fg2', 'Two-pointer', { points_scored: 2, fg_2: 1 }, { points: 2 }),
  ev('fg3', 'Three-pointer', { points_scored: 3, fg_3: 1 }, { points: 3 }),
  ev('rebound', 'Rebound', { rebounds: 1 }, { tone: 'good' }),
  ev('assist_bb', 'Assist', { assists: 1 }, { tone: 'good' }),
  ev('steal', 'Steal', { steals: 1 }, { tone: 'good' }),
  ev('block', 'Block', { blocks: 1 }, { tone: 'good' }),
  ev('turnover', 'Turnover', { turnovers: 1 }, { tone: 'error' }),
  ev('foul', 'Foul', { fouls: 1 }, { tone: 'caution' }),
];

const BASKET_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  count('points_scored', 'Points', 'Pts', { fromEvents: ['fg1', 'fg2', 'fg3'], per: 'value', headline: true }),
  count('fg_1', 'Free throws', 'FT', { fromEvents: ['fg1'] }),
  count('fg_2', 'Two-pointers', '2P', { fromEvents: ['fg2'] }),
  count('fg_3', 'Three-pointers', '3P', { fromEvents: ['fg3'], headline: true }),
  count('rebounds', 'Rebounds', 'Reb', { fromEvents: ['rebound'], headline: true }),
  count('assists', 'Assists', 'Ast', { fromEvents: ['assist_bb'], headline: true }),
  count('steals', 'Steals', 'Stl', { fromEvents: ['steal'] }),
  count('blocks', 'Blocks', 'Blk', { fromEvents: ['block'] }),
  count('turnovers', 'Turnovers', 'TO', { fromEvents: ['turnover'], higherIsBetter: false }),
  count('fouls', 'Fouls', 'PF', { fromEvents: ['foul'], higherIsBetter: false }),
  rate('points_per_match', 'Points per match', 'P/M', ['points_scored', 'matches'], true),
];

// ---- raid & tag ------------------------------------------------------------

const RAID_EVENTS: StatEventSpec[] = [
  ev('raid', 'Raid', { raid_points: 'value', raids: 1, successful_raids: 1 }, {
    value: { label: 'Points', min: 0, max: 7 },
  }),
  ev('empty_raid', 'Empty raid', { raids: 1 }, { tone: 'error' }),
  ev('tackle', 'Tackle', { tackle_points: 1, tackles: 1 }, { points: 1 }),
  ev('super_tackle', 'Super tackle', { tackle_points: 2, tackles: 1, super_tackles: 1 }, { points: 2 }),
  ev('bonus', 'Bonus point', { bonus_points: 1 }, { points: 1 }),
  ev('allout', 'All out', { all_outs: 1 }, { points: 2, perPlayer: false }),
];

const RAID_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  count('raid_points', 'Raid points', 'RP', { fromEvents: ['raid'], per: 'value', headline: true }),
  count('raids', 'Raids', 'Rd', { fromEvents: ['raid', 'empty_raid'] }),
  count('successful_raids', 'Successful raids', 'SR', { fromEvents: ['raid'] }),
  rate('raid_strike_rate', 'Raid strike rate', 'RSR', ['successful_raids', 'raids'], true),
  count('tackle_points', 'Tackle points', 'TP', { fromEvents: ['tackle', 'super_tackle'], per: 'value', headline: true }),
  count('tackles', 'Tackles', 'Tk', { fromEvents: ['tackle', 'super_tackle'] }),
  count('super_tackles', 'Super tackles', 'ST', { fromEvents: ['super_tackle'] }),
  count('bonus_points', 'Bonus points', 'BP', { fromEvents: ['bonus'] }),
  count('all_outs', 'All outs', 'AO', { fromEvents: ['allout'] }),
];

// ---- net (team) ------------------------------------------------------------

const NET_EVENTS: StatEventSpec[] = [
  ev('ace', 'Ace', { aces: 1, points_scored: 1 }, { points: 1 }),
  ev('kill', 'Attack kill', { kills: 1, points_scored: 1 }, { points: 1 }),
  ev('block_vb', 'Block', { blocks: 1, points_scored: 1 }, { points: 1 }),
  ev('serve_error', 'Service error', { service_errors: 1 }, { tone: 'error' }),
  ev('attack_error', 'Attack error', { attack_errors: 1 }, { tone: 'error' }),
  ev('dig', 'Dig', { digs: 1 }, { tone: 'good' }),
];

const NET_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  rally('points_won', 'Points won', 'Pts', { headline: true }),
  rally('sets_won', 'Sets won', 'SW'),
  rally('sets_lost', 'Sets lost', 'SL', { higherIsBetter: false }),
  // Declared, because ace/kill/block all credit it. Without it, three of the six
  // taps a volleyball official has scored nothing at all.
  count('points_scored', 'Points scored', 'PtsS', { fromEvents: ['ace', 'kill', 'block_vb'], headline: true }),
  count('aces', 'Aces', 'Ace', { fromEvents: ['ace'], headline: true }),
  count('kills', 'Attack kills', 'K', { fromEvents: ['kill'], headline: true }),
  count('blocks', 'Blocks', 'Blk', { fromEvents: ['block_vb'] }),
  count('digs', 'Digs', 'Dig', { fromEvents: ['dig'] }),
  count('service_errors', 'Service errors', 'SE', { fromEvents: ['serve_error'], higherIsBetter: false }),
  count('attack_errors', 'Attack errors', 'AE', { fromEvents: ['attack_error'], higherIsBetter: false }),
];

// ---- board & frame ---------------------------------------------------------

const BOARD_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  rally('boards_won', 'Boards won', 'BW', { headline: true }),
  rally('boards_lost', 'Boards lost', 'BL', { higherIsBetter: false }),
  count('queens', 'Queens pocketed', 'Q', { fromEvents: ['queen'], headline: true }),
  count('coins', 'Coins pocketed', 'C', { fromEvents: ['coin'] }),
];

const FRAME_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  rally('frames_won', 'Frames won', 'FW', { headline: true }),
  rally('frames_lost', 'Frames lost', 'FL', { higherIsBetter: false }),
  // A career best break is a MAX, not a sum - the single most-asked snooker stat.
  count('highest_break', 'Highest break', 'HB', { source: 'entry', aggregate: 'max', headline: true }),
  count('breaks_50', 'Breaks of 50+', '50+', { fromEvents: ['break50'] }),
  count('centuries', 'Centuries', '100+', { fromEvents: ['century'], headline: true }),
];

const CHESS_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  // Half points are why the result union had to allow a draw: a drawn board is the
  // normal case in chess, not an edge one. Stored doubled so it stays an integer.
  rally('result_points_x2', 'Result points (×2)', 'Pts2', { headline: true }),
  rally('as_white', 'Games as white', 'W'),
  rally('as_black', 'Games as black', 'B'),
  count('board_no', 'Board', 'Bd', { source: 'entry', aggregate: 'min' }),
];

// ---- combat & strength -----------------------------------------------------

const COMBAT_METRICS: StatMetric[] = [
  ...UNIVERSAL,
  rally('bouts', 'Bouts', 'Bt', { headline: true }),
  rally('rounds_won', 'Rounds won', 'RW', { headline: true }),
  rally('rounds_lost', 'Rounds lost', 'RL', { higherIsBetter: false }),
  count('touches_for', 'Touches for', 'TF', { fromEvents: ['touch'] }),
  count('touches_against', 'Touches against', 'TA', { fromEvents: ['touch_against'], higherIsBetter: false }),
  count('stoppages', 'Wins by stoppage', 'KO', { source: 'entry' }),
  count('penalties', 'Penalties', 'Pen', { source: 'entry', higherIsBetter: false }),
];

const spec = (
  sport: string, family: StatFamily, metrics: StatMetric[],
  events: StatEventSpec[] = [], positions?: string[],
): SportStatSpec => ({ sport, family, metrics, events, ...(positions ? { positions } : {}) });

export const TEAM_STAT_SPECS: SportStatSpec[] = [
  // invasion
  spec('football', 'invasion', GOAL_METRICS, GOAL_EVENTS, ['GK', 'DEF', 'MID', 'FWD']),
  spec('futsal', 'invasion', GOAL_METRICS, GOAL_EVENTS, ['GK', 'DEF', 'MID', 'FWD']),
  spec('hockey', 'invasion', GOAL_METRICS, GOAL_EVENTS, ['GK', 'DEF', 'MID', 'FWD']),
  spec('handball', 'invasion', GOAL_METRICS, GOAL_EVENTS, ['GK', 'BACK', 'WING', 'PIVOT']),
  spec('frisbee', 'invasion', GOAL_METRICS, GOAL_EVENTS, ['handler', 'cutter']),
  spec('basketball', 'invasion', BASKET_METRICS, BASKET_EVENTS, ['PG', 'SG', 'SF', 'PF', 'C']),
  // raid
  spec('kabaddi', 'raid', RAID_METRICS, RAID_EVENTS, ['raider', 'defender', 'all-rounder']),
  spec('kho-kho', 'raid', RAID_METRICS, RAID_EVENTS, ['attacker', 'defender']),
  // net
  spec('volleyball', 'net', NET_METRICS, NET_EVENTS, ['setter', 'outside', 'middle', 'opposite', 'libero']),
  spec('throwball', 'net', NET_METRICS, NET_EVENTS),
  // board & frame
  spec('carrom', 'board', BOARD_METRICS, [
    ev('queen', 'Queen pocketed', { queens: 1 }),
    ev('coin', 'Coin pocketed', { coins: 1 }),
  ], ['singles', 'doubles']),
  spec('pool/snooker', 'board', FRAME_METRICS, [
    ev('break50', 'Break of 50+', { breaks_50: 1 }),
    ev('century', 'Century break', { centuries: 1, breaks_50: 1 }),
  ]),
  spec('chess', 'board', CHESS_METRICS, [], ['board 1', 'board 2', 'board 3', 'board 4', 'reserve']),
  // combat & strength
  spec('tug of war', 'combat', COMBAT_METRICS),
  spec('arm wrestling', 'combat', COMBAT_METRICS, [], ['left', 'right']),
  spec('fencing', 'combat', COMBAT_METRICS, [
    ev('touch', 'Touch', { touches_for: 1 }, { points: 1 }),
    ev('touch_against', 'Touch against', { touches_against: 1 }),
  ], ['foil', 'epee', 'sabre']),
  spec('taekwondo', 'combat', COMBAT_METRICS),
  spec('judo', 'combat', COMBAT_METRICS),
  spec('wrestling', 'combat', COMBAT_METRICS),
  spec('boxing', 'combat', COMBAT_METRICS),
];

// ============================================================================
// Measured / ranking events (swimming, powerlifting, athletics). No attributable
// events, no rally log - a mark and a placement come from the console's
// detailed per-athlete entry (player-stats.service.ts writes `stats.mark`/`rank`).
// ============================================================================
// Placement is unit-free (1 = best regardless of sport), so unlike a raw mark
// it's never wrong to fold sport-wide - it never mixes seconds with kilograms.
const PLACEMENT_METRICS: StatMetric[] = [
  { key: 'best_placement', label: 'Best placement', short: 'Best #',
    source: 'entry', sourceKey: 'rank', aggregate: 'min', headline: true, higherIsBetter: false },
  { key: 'average_placement', label: 'Average placement', short: 'Avg #',
    source: 'entry', sourceKey: 'rank', aggregate: 'avg', higherIsBetter: false },
  // Counts, not marks - safe to fold sport-wide the same way placement is.
  // "Top 3", not "Podiums": the column headers are capped at six characters so a
  // dense table stays readable, and this was the only one of 456 metrics over it.
  // It is also the clearer of the two in a narrow column.
  { key: 'podium_finishes', label: 'Podium finishes', short: 'Top 3',
    source: 'entry', sourceKey: 'podium', aggregate: 'sum', headline: true },
  { key: 'measured_appearances', label: 'Measured appearances', short: 'Meas.',
    source: 'entry', sourceKey: 'measured', aggregate: 'sum' },
];

const measured = (sport: string, bestAgg: 'min' | 'max', markNoun: string, unit?: string): SportStatSpec => ({
  sport, family: 'measured', events: [],
  metrics: [
    { key: 'personal_best', label: `Personal best${unit ? ` (${unit})` : ''}`, short: 'PB', unit,
      source: 'entry', sourceKey: 'mark', aggregate: bestAgg, headline: true, higherIsBetter: bestAgg === 'max' },
    { key: 'average_mark', label: `Average ${markNoun}${unit ? ` (${unit})` : ''}`, short: 'Avg', unit,
      source: 'entry', sourceKey: 'mark', aggregate: 'avg', higherIsBetter: bestAgg === 'max' },
    ...PLACEMENT_METRICS,
  ],
});

export const MEASURED_STAT_SPECS: SportStatSpec[] = [
  measured('swimming', 'min', 'time', 'seconds'),
  measured('powerlifting', 'max', 'lift', 'kg'),
  // No personal-best/average mark - a sprint (seconds) and a throw (metres)
  // aren't comparable, so placement is the only career figure Athletics gets
  // until marks fold per discipline instead of per sport.
  { sport: 'athletics', family: 'measured', events: [], metrics: PLACEMENT_METRICS },
];

/** Every sport the stat registry knows, across every family. */
export const ALL_STAT_SPECS: SportStatSpec[] = [...RACQUET_STAT_SPECS, ...TEAM_STAT_SPECS, ...MEASURED_STAT_SPECS];

const BY_SPORT = new Map(ALL_STAT_SPECS.map((s) => [s.sport, s]));

export function statSpecFor(sport?: string | null): SportStatSpec | undefined {
  if (!sport) return undefined;
  return BY_SPORT.get(sport.trim().toLowerCase());
}

export function metricsFor(sport?: string | null): StatMetric[] {
  return statSpecFor(sport)?.metrics ?? [];
}

export function headlineMetricsFor(sport?: string | null): StatMetric[] {
  return metricsFor(sport).filter((m) => m.headline);
}

// ============================================================================
// Deriving a racquet match's stats from the rally log
// ============================================================================

export type StatBag = Record<string, number>;

export interface DerivedStatLine {
  side: Side;
  /** Player id, when a pairing was supplied. Null for an unattributed side. */
  userId: string | null;
  partnerUserId: string | null;
  stats: StatBag;
}

export interface DerivedMatchStats {
  /** Side-level totals. Always produced, pairing or not. */
  sides: Record<Side, StatBag>;
  /** Per-player lines, when a pairing was supplied. */
  players: DerivedStatLine[];
}

const bump = (bag: StatBag, key: string, by = 1) => { bag[key] = (bag[key] ?? 0) + by; };

interface DeriveOpts {
  pairing?: Pairing;
  nomination?: ServeNomination;
  firstServer?: Side;
}

/**
 * Fold a rally log into per-side and per-player statistics.
 *
 * Deliberately re-folds through the kernel rather than reading the trace: to credit a
 * service point to the right PERSON in doubles we need the serve resolver, and that
 * needs the state as it was BEFORE each rally. One pass, full fidelity.
 */
export function deriveRacquetStats(
  played: ScoringFormat,
  log: RallyLog,
  opts: DeriveOpts = {},
): DerivedMatchStats {
  // Folded exactly as the console scored it: singles has one server per turn.
  const format = formatForPairing(played, opts.pairing);
  const first = opts.firstServer ?? 'A';
  const sides: Record<Side, StatBag> = { A: {}, B: {} };
  // Per-person service tallies. Rally outcomes belong to the SIDE (a doubles point is
  // won by the pair), but who served is a fact about one person.
  const perPerson = new Map<string, StatBag>();
  const personBag = (id: string): StatBag => {
    let b = perPerson.get(id);
    if (!b) { b = {}; perPerson.set(id, b); }
    return b;
  };

  let state: KernelState = initKernel(format, first);
  let streak: Record<Side, number> = { A: 0, B: 0 };
  let firstUnitWinner: Side | null = null;
  let personalReturns = false;
  let expediteSeen = false;
  // Biggest deficit each side has faced in the game under way (for comeback games).
  let deficit: Record<Side, number> = { A: 0, B: 0 };
  const pickleball = (format.sport ?? '').toLowerCase() === 'pickleball';
  // Serves were recorded (a fault or an ace tapped) - only then are first/second-serve figures honest.
  const serveDetail = log.some((e) => e.t === 'fault' || (e.t === 'point' && e.kind === 'ace'));
  // The service turn under way (side-out scoring), to count each turn once.
  let turn: { side: Side | null; games: number } = { side: null, games: 0 };

  for (const ev of log) {
    const before = state;
    const lv = effectiveLevel(format, before, before.pointLevel);
    const spec = serveSpecFor(format, lv);
    const wasDeuce = atAdvantage(lv, before.score[before.pointLevel]);
    const wasDecider = isDecider(format, before, before.pointLevel);
    const isTiebreak = lv.key === 'tiebreak';
    const serverSide = spec.movement === 'none' ? null : before.serve.side;
    const resolved = opts.pairing ? resolveServer(format, before, opts.pairing, opts.nomination) : null;
    const server = resolved?.server ?? null;
    // Who had to return the serve - only where the sport's rules name them.
    const receiver = RECEIVER_RESOLVERS.has(spec.resolver) ? resolved?.receiver ?? null : null;
    if (receiver) personalReturns = true;

    // Break point: the RECEIVER is one point from taking a game the server is serving.
    // Only meaningful where the serve is locked to a unit, i.e. tennis.
    const bpSide = breakPointSide(format, before, lv, spec);

    // Game / match point, from the kernel itself: would winning this rally settle it?
    const onPoint = ev.t === 'point' && !before.ended ? pressureBefore(format, before) : null;

    const r = step(format, before, ev);
    state = r.state;
    const eff = r.effect;
    const underExpedite = before.expedite;
    if (state.expedite) expediteSeen = true;

    if (ev.t === 'let') { bump(sides.A, 'lets'); bump(sides.B, 'lets'); continue; }

    // A fault that the kernel turned into a point is a double fault: counted, then scored
    // below like any rally the receiver won. A first-serve fault is only counted.
    const doubleFault = ev.t === 'fault' && !!eff.scored;
    if (ev.t === 'fault' && serverSide) {
      bump(sides[serverSide], 'faults');
      if (server) bump(personBag(server), 'faults');
      if (!doubleFault) continue;
      bump(sides[serverSide], 'double_faults');
      if (server) bump(personBag(server), 'double_faults');
    }
    if (ev.t === 'point' && ev.kind === 'ace' && serverSide) {
      bump(sides[serverSide], 'aces');
      if (server) bump(personBag(server), 'aces');
    }

    // First and second serve. Only where the scorer recorded serves (faults or aces) -
    // a match tapped as plain rallies would otherwise read as "100% first serves in".
    if (serveDetail && serverSide && (ev.t === 'point' || doubleFault) && (ev.t !== 'point' || (ev.pts ?? 1) > 0)) {
      const won = ev.t === 'point' && ev.side === serverSide;
      const bags = server ? [sides[serverSide], personBag(server)] : [sides[serverSide]];
      for (const b of bags) {
        bump(b, 'serve_points_tracked');
        if (!before.serve.faults && !doubleFault) {
          bump(b, 'first_serves_in');
          if (won) bump(b, 'first_serve_points_won');
        } else {
          bump(b, 'second_serve_points_played');
          if (won) bump(b, 'second_serve_points_won');
        }
      }
    }

    if (ev.t === 'end') {
      // Only the side that retired - the winner is the other one.
      if (ev.reason === 'retired' && ev.winner) bump(sides[ev.winner === 'A' ? 'B' : 'A'], 'retirements');
      if (ev.reason === 'walkover' && ev.winner) bump(sides[ev.winner], 'walkovers_received');
      continue;
    }

    if (eff.scored) {
      const w = eff.scored;
      const l: Side = w === 'A' ? 'B' : 'A';
      bump(sides[w], 'points_won');
      bump(sides[l], 'points_lost');

      if (wasDeuce) {
        bump(sides.A, 'deuce_points_played');
        bump(sides.B, 'deuce_points_played');
        bump(sides[w], 'deuce_points_won');
      }

      // Deficits in the game under way, read after the point lands.
      const sc = state.score[state.pointLevel];
      if (!eff.unitsWon.length) {
        deficit = { A: Math.max(deficit.A, sc[1] - sc[0]), B: Math.max(deficit.B, sc[0] - sc[1]) };
      }

      if (underExpedite) {
        bump(sides.A, 'expedite_points_played');
        bump(sides.B, 'expedite_points_played');
        bump(sides[w], 'expedite_points_won');
      }
      // The receiver survived 13 returns: their point, and a loss on the server's serve.
      if (ev.t === 'point' && ev.kind === 'expedite_returns') {
        bump(sides[w], 'expedite_return_wins');
        if (serverSide && serverSide !== w) {
          bump(sides[serverSide], 'expedite_return_losses');
          if (server) bump(personBag(server), 'expedite_return_losses');
        }
      }

      if (bpSide) {
        bump(sides[bpSide], 'break_points_played');
        if (w === bpSide) bump(sides[bpSide], 'break_points_won');
        else if (serverSide) bump(sides[serverSide], 'break_points_saved');
      }

      streak[w] += 1;
      streak[l] = 0;
      if (streak[w] > (sides[w].longest_streak ?? 0)) sides[w].longest_streak = streak[w];
    }

    // Service / return split, per RALLY. Under side-out scoring a receiver's rally win
    // scores nothing but still wins the serve back, so counting only scored points made
    // serving 100% and receiving 0% by construction.
    const rallyWinner: Side | null = ev.t === 'point' ? ((ev.pts ?? 1) > 0 ? ev.side : null) : eff.scored;
    if (rallyWinner && serverSide) {
      const rec: Side = serverSide === 'A' ? 'B' : 'A';
      bump(sides[serverSide], 'service_points_played');
      bump(sides[rec], 'return_points_played');
      if (rallyWinner === serverSide) bump(sides[serverSide], 'service_points_won');
      else bump(sides[rec], 'return_points_won');
      if (server) {
        bump(personBag(server), 'service_points_played');
        if (rallyWinner === serverSide) bump(personBag(server), 'service_points_won');
      }
      if (receiver) {
        bump(personBag(receiver), 'return_points_played');
        if (rallyWinner !== serverSide) bump(personBag(receiver), 'return_points_won');
      }
    }

    // Side-out scoring only (only the server scores): service turns, the points scored
    // in them, and side-outs - winning the serve back. Team figures, like the score.
    if (rallyWinner && serverSide && spec.pointScoring === 'serverOnly') {
      const games = before.finished.filter((u) => u.level === 0).length;
      if (turn.side !== serverSide || turn.games !== games) {
        bump(sides[serverSide], 'service_turns');
        bump(sides[serverSide === 'A' ? 'B' : 'A'], 'service_turns_faced');
        turn = { side: serverSide, games };
      }
      if (eff.scored === serverSide) bump(sides[serverSide], 'service_turn_points');
      if (state.serve.side !== serverSide && !eff.unitsWon.length) bump(sides[state.serve.side], 'side_outs_won');
    }

    // Game and match points: counted on every rally they were on, scored or not (a
    // side-out under server-only scoring is a saved game point too).
    if (onPoint) {
      const settled = eff.unitsWon.length > 0;
      for (const s of ['A', 'B'] as Side[]) {
        const o: Side = s === 'A' ? 'B' : 'A';
        const kind = onPoint[s];
        if (!kind) continue;
        const converted = settled && eff.unitsWon[0].winner === s;
        bump(sides[s], 'game_points_played');
        bump(sides[o], 'game_points_faced');
        if (converted) bump(sides[s], 'game_points_won'); else bump(sides[o], 'game_points_saved');
        if (kind === 'match') {
          bump(sides[s], 'match_points_played');
          bump(sides[o], 'match_points_faced');
          if (converted && state.ended) bump(sides[s], 'match_points_won'); else bump(sides[o], 'match_points_saved');
        }
      }
    }

    // A DECIDER IS THE DECIDING UNIT OF THE MATCH, whatever that unit is called.
    //
    // In a two-level sport (table tennis, badminton, pickleball, squash) that is the
    // fifth game at two-all. In tennis it is the deciding SET at one set all - not,
    // as this used to count, any game played at five-all inside an ordinary set,
    // which put a "Deciders won" figure on a tennis profile that meant something
    // else entirely from the same column on every other racquet profile.
    const deciderLevel = format.levels.length - 2;
    for (const u of eff.unitsWon) {
      const w = u.winner;
      const l: Side = w === 'A' ? 'B' : 'A';
      const decidedTheMatch = u.level === deciderLevel && isDecider(format, before, u.level);
      if (decidedTheMatch) { bump(sides[w], 'deciders_won'); bump(sides[l], 'deciders_lost'); }
      if (u.level === 0) {
        if (isTiebreak) { bump(sides[w], 'tiebreaks_won'); bump(sides[l], 'tiebreaks_lost'); }
        // Tennis service games: one server for the whole game (not a tie-break). The server
        // holds by winning it; the receiver breaks. Awarded games were not played out.
        if (spec.movement === 'perUnit' && !isTiebreak && serverSide && !u.awarded) {
          const rec: Side = serverSide === 'A' ? 'B' : 'A';
          const held = w === serverSide;
          for (const b of server ? [sides[serverSide], personBag(server)] : [sides[serverSide]]) {
            bump(b, 'service_games_played');
            if (held) bump(b, 'service_games_won');
          }
          bump(sides[rec], 'return_games_played');
          if (!held) bump(sides[rec], 'return_games_won');
        }
        bump(sides[w], 'games_won');
        bump(sides[l], 'games_lost');
        if (firstUnitWinner === null) firstUnitWinner = w;
        streak = { A: 0, B: 0 };
        if (deficit[w] >= COMEBACK_GAME_DEFICIT) bump(sides[w], 'comeback_games');
        deficit = { A: 0, B: 0 };
        // Pickleball's "pickle": a played game won with the opponents on 0.
        if (pickleball && !u.awarded && u.score[l === 'A' ? 0 : 1] === 0) bump(sides[w], 'pickles');
      } else if (format.levels[u.level]?.key === 'set') {
        bump(sides[w], 'sets_won');
        bump(sides[l], 'sets_lost');
      }
    }
    void wasDecider;
  }

  // Match-level outcome.
  bump(sides.A, 'matches');
  bump(sides.B, 'matches');
  if (expediteSeen) {
    bump(sides.A, 'expedite_matches');
    bump(sides.B, 'expedite_matches');
    if (state.winner) bump(sides[state.winner], 'expedite_wins');
  }
  if (state.outcome === 'draw') { bump(sides.A, 'draws'); bump(sides.B, 'draws'); }
  else if (state.winner) {
    const w = state.winner;
    const l: Side = w === 'A' ? 'B' : 'A';
    bump(sides[w], 'wins');
    bump(sides[l], 'losses');
    // Won after dropping the opening game.
    if (firstUnitWinner && firstUnitWinner !== w) bump(sides[w], 'comeback_wins');
    if (firstUnitWinner === w && (sides[w].games_lost ?? 0) === 0) bump(sides[w], 'whitewashes');
  }

  // In doubles a player who never served (or never received) has 0 of their own,
  // not their pair's figure - which is what the side-level fallback would give them.
  for (const side of ['A', 'B'] as Side[]) {
    const people = opts.pairing?.[side] ?? [];
    if (people.length < 2) continue;
    // The pair's totals ride on the side bag, so each partner gets them unchanged.
    sides[side].pair_service_points_played = sides[side].service_points_played ?? 0;
    sides[side].pair_service_points_won = sides[side].service_points_won ?? 0;
    sides[side].pair_return_points_played = sides[side].return_points_played ?? 0;
    sides[side].pair_return_points_won = sides[side].return_points_won ?? 0;
    for (const id of people) {
      const b = personBag(id);
      b.service_points_played ??= 0;
      b.service_points_won ??= 0;
      // A partner who never served a tennis game has none held - not the pair's figure.
      if (sides[side].service_games_played !== undefined) { b.service_games_played ??= 0; b.service_games_won ??= 0; }
      if (personalReturns) { b.return_points_played ??= 0; b.return_points_won ??= 0; }
      if (expediteSeen) b.expedite_return_losses ??= 0;
    }
  }

  return { sides, players: attribute(sides, perPerson, opts.pairing) };
}

/** A game won after trailing by this many points in it counts as won from behind. */
export const COMEBACK_GAME_DEFICIT = 3;

/** For each side: would winning the next rally take the game ('game') or the match ('match')? */
function pressureBefore(format: ScoringFormat, before: KernelState): Record<Side, 'game' | 'match' | null> {
  const out: Record<Side, 'game' | 'match' | null> = { A: null, B: null };
  for (const s of ['A', 'B'] as Side[]) {
    const r = step(format, before, { t: 'point', side: s });
    if (!r.effect.unitsWon.length || r.effect.unitsWon[0].winner !== s) continue;
    out[s] = r.state.ended && r.state.winner === s ? 'match' : 'game';
  }
  return out;
}

/**
 * Serve resolvers that name the RECEIVER from the rules: the diagonal court, the fixed
 * TT rotation, and receivers holding a side (tennis for a set, squash for a game).
 */
const RECEIVER_RESOLVERS: ReadonlySet<string> = new Set(['bwfSingleServer', 'pickleballTwoServer', 'ttPairCycle', 'tennisGameLocked', 'squashHandOut']);

/**
 * A doubles point is won by the PAIR, so both partners receive the side's rally
 * stats; only the service tallies are person-specific. `partnerUserId` makes "your
 * record with each partner" a group-by rather than another table.
 */
function attribute(
  sides: Record<Side, StatBag>,
  perPerson: Map<string, StatBag>,
  pairing?: Pairing,
): DerivedStatLine[] {
  if (!pairing) return [];
  const out: DerivedStatLine[] = [];
  for (const side of ['A', 'B'] as Side[]) {
    const people = pairing[side] ?? [];
    for (const [i, id] of people.entries()) {
      if (!id) continue;
      const own = perPerson.get(id) ?? {};
      const stats: StatBag = { ...sides[side] };
      // Person-level tallies REPLACE the side figure where one exists - the side's
      // service count is the pair's, this person's is theirs.
      for (const [k, v] of Object.entries(own)) stats[k] = v;
      out.push({
        side,
        userId: id,
        partnerUserId: people.length > 1 ? (people[(i + 1) % people.length] ?? null) : null,
        stats,
      });
    }
  }
  return out;
}

/**
 * Which side, if any, is on a break point. Requires a serve locked to the unit
 * (tennis), because "breaking" is meaningless when the serve changes mid-game.
 */
function breakPointSide(
  format: ScoringFormat,
  state: KernelState,
  lv: ReturnType<typeof effectiveLevel>,
  spec: ReturnType<typeof serveSpecFor>,
): Side | null {
  if (spec.movement !== 'perUnit') return null;
  const srv = state.serve.side;
  const rec: Side = srv === 'A' ? 'B' : 'A';
  const score = state.score[state.pointLevel];
  const recScore = rec === 'A' ? score[0] : score[1];
  const srvScore = srv === 'A' ? score[0] : score[1];
  // The receiver wins the game with this point: at or past target, and one clear ahead.
  const wouldWin = recScore + 1 >= lv.target && (recScore + 1) - srvScore >= lv.winBy;
  return wouldWin ? rec : null;
}

// ---- career fold -----------------------------------------------------------

/**
 * Fold per-match stat lines into a career total. RECOMPUTE, NEVER INCREMENT - the
 * same discipline career-stats.service.ts already applies: a delta applied twice, or
 * applied to a result later corrected, is wrong permanently and silently.
 */
export function foldCareerStats(spec: SportStatSpec, lines: StatBag[]): StatBag {
  const out: StatBag = {};
  for (const m of spec.metrics) {
    if (m.source === 'derived' && m.aggregate === 'rate') continue; // computed last
    const vals = lines.map((l) => l[m.sourceKey ?? m.key]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) continue;
    switch (m.aggregate) {
      case 'max': out[m.key] = Math.max(...vals); break;
      case 'min': out[m.key] = Math.min(...vals); break;
      case 'avg': out[m.key] = vals.reduce((a, b) => a + b, 0) / vals.length; break;
      case 'sum':
      default: out[m.key] = vals.reduce((a, b) => a + b, 0); break;
    }
  }
  // Rates and differences are computed from the folded totals, never averaged from
  // per-match rates - averaging percentages across matches is simply wrong.
  for (const m of spec.metrics) {
    if (m.aggregate === 'rate' && m.rateOf) {
      const [n, d] = m.rateOf;
      const den = out[d] ?? 0;
      if (den > 0) out[m.key] = Math.round(((out[n] ?? 0) / den) * 1000) / 10;
    } else if (m.source === 'derived' && m.formula) {
      const [x, y] = m.formula.of;
      // Nothing to derive from means nothing to show. Computing 0 - 0 put a
      // "Point difference: 0" on the profile of somebody who has never played.
      if (out[x] === undefined && out[y] === undefined) continue;
      const a = out[x] ?? 0;
      const b = out[y] ?? 0;
      if (m.formula.op === 'diff') out[m.key] = a - b;
      else if (m.formula.op === 'sum') out[m.key] = a + b;
      else if (m.formula.op === 'ratio' && b > 0) out[m.key] = Math.round((a / b) * 1000) / 10;
      else if (m.formula.op === 'per' && b > 0) out[m.key] = Math.round((a / b) * 10) / 10;
    }
  }
  return out;
}
