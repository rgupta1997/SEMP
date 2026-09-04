import { ALL_STAT_SPECS, statSpecFor, type StatBag, type StatFamily } from './stat-registry.js';

// ============================================================================
// The bag → typed column mapping.
//
// WHY THIS FILE EXISTS. The stat registry produces a `StatBag` - a flat
// Record<string, number> keyed by metric. The database now holds those numbers in
// typed per-category columns. Something has to say which key goes in which column,
// and that something must be:
//
//   * PURE, so it can be tested without a database, and
//   * EXHAUSTIVE, so a metric can never be silently dropped on the way to storage.
//
// The second property is the whole point. A jsonb bag accepted any key, which meant
// a typo stored a metric nobody would ever read. Typed columns reject the typo - but
// only if every metric HAS a column, and nothing enforces that except the test
// beside this file, which walks the registry and fails on any key with no home.
//
// MOSTLY THE MAPPING IS THE IDENTITY. `goals` → `goals`. It is spelled out anyway
// rather than inferred, because an implicit mapping would silently accept a renamed
// metric and write it to a column that no longer means the same thing.
//
// The interesting cases are the four where it is NOT the identity, and each is a
// deliberate modelling decision recorded here rather than in a migration comment:
//
//   1. per-match booleans vs career counts. `comeback_wins` is a career total; one
//      match either was or was not a comeback, so the column is boolean and the
//      career number is the count of true rows.
//   2. carrom boards and snooker frames are the same thing counted, so both land in
//      `units_won` / `units_lost`.
//   3. chess `as_white` / `as_black` are counts over a career, derived from the
//      `colour` fact this match records. The fact is stored; the counts are folded.
//   4. `matches` / `wins` / `losses` / `draws` are NOT here at all. They live on the
//      spine row (`played`, `outcome`), and a second copy in every detail table
//      would be a second source of truth for the one number every page shows.
// ============================================================================

/** Metrics the SPINE owns. Present in the registry, deliberately absent from detail. */
export const SPINE_METRICS: readonly string[] = ['matches', 'wins', 'losses', 'draws'];

/** A per-match boolean whose career form is a count of true rows. */
export interface BoolMapping { column: string; boolean: true }
type Mapping = string | BoolMapping;

const bool = (column: string): BoolMapping => ({ column, boolean: true });

/**
 * metric key → column, per family. Every non-derived registry metric appears here
 * or in SPINE_METRICS; the test enforces it.
 */
export const COLUMN_MAP: Record<Exclude<StatFamily, 'measured' | 'cricket'>, Record<string, Mapping>> = {
  racquet: {
    points_won: 'points_won', points_lost: 'points_lost',
    service_points_played: 'service_points_played', service_points_won: 'service_points_won',
    return_points_played: 'return_points_played', return_points_won: 'return_points_won',
    games_won: 'games_won', games_lost: 'games_lost',
    sets_won: 'sets_won', sets_lost: 'sets_lost',
    deciders_won: 'deciders_won', deciders_lost: 'deciders_lost',
    deuce_points_played: 'deuce_points_played', deuce_points_won: 'deuce_points_won',
    tiebreaks_won: 'tiebreaks_won', tiebreaks_lost: 'tiebreaks_lost',
    longest_streak: 'longest_streak',
    aces: 'aces', double_faults: 'double_faults', first_serves_in: 'first_serves_in',
    winners: 'winners', unforced_errors: 'unforced_errors', lets: 'lets',
    break_points_played: 'break_points_played', break_points_won: 'break_points_won',
    break_points_saved: 'break_points_saved',
    // Per-match facts; the career numbers are counts of these rows.
    comeback_wins: bool('comeback_win'),
    retirements: bool('retired'),
    walkovers_received: bool('walkover_received'),
    whitewashes: bool('whitewash'),
  },
  invasion: {
    minutes: 'minutes',
    goals: 'goals', assists: 'assists', own_goals: 'own_goals', saves: 'saves',
    yellows: 'yellows', reds: 'reds',
    pens_scored: 'pens_scored', pens_missed: 'pens_missed',
    points_scored: 'points_scored', fg_1: 'fg_1', fg_2: 'fg_2', fg_3: 'fg_3',
    rebounds: 'rebounds', steals: 'steals', blocks: 'blocks',
    turnovers: 'turnovers', fouls: 'fouls',
  },
  raid: {
    minutes: 'minutes',
    raid_points: 'raid_points', raids: 'raids', successful_raids: 'successful_raids',
    tackle_points: 'tackle_points', tackles: 'tackles', super_tackles: 'super_tackles',
    bonus_points: 'bonus_points', all_outs: 'all_outs',
  },
  net: {
    minutes: 'minutes',
    points_won: 'points_won', points_scored: 'points_scored',
    aces: 'aces', kills: 'kills', blocks: 'blocks', digs: 'digs',
    service_errors: 'service_errors', attack_errors: 'attack_errors',
    sets_won: 'sets_won', sets_lost: 'sets_lost',
  },
  board: {
    minutes: 'minutes',
    // Carrom boards and snooker frames are one concept counted, so one pair of
    // columns holds both rather than four columns half of them always zero.
    boards_won: 'units_won', boards_lost: 'units_lost',
    frames_won: 'units_won', frames_lost: 'units_lost',
    queens: 'queens', coins: 'coins',
    highest_break: 'highest_break', breaks_50: 'breaks_50', centuries: 'centuries',
    result_points_x2: 'result_points_x2', board_no: 'board_no',
    // as_white / as_black are career counts over the `colour` this match records.
    as_white: bool('colour_is_white'), as_black: bool('colour_is_black'),
  },
  combat: {
    minutes: 'minutes',
    bouts: 'bouts', rounds_won: 'rounds_won', rounds_lost: 'rounds_lost',
    touches_for: 'touches_for', touches_against: 'touches_against',
    penalties: 'penalties', stoppages: 'stoppages',
  },
};

/** Families whose detail table has a `position` column, and whose sport has the idea. */
const POSITIONAL = new Set<LineFamily>(['invasion', 'raid', 'net']);

/** The table each family's detail row lives in. Cricket is not one row, so it is out. */
export const FAMILY_TABLE: Record<Exclude<StatFamily, 'measured' | 'cricket'>, string> = {
  racquet: 'racquet_match_lines',
  invasion: 'invasion_match_lines',
  raid: 'raid_match_lines',
  net: 'net_match_lines',
  board: 'board_match_lines',
  combat: 'combat_match_lines',
};

export type LineFamily = keyof typeof FAMILY_TABLE;

/** Which detail table a sport writes to, or null if it has none (yet, or ever). */
export function lineFamilyFor(sport?: string | null): LineFamily | null {
  const family = statSpecFor(sport)?.family;
  if (!family) return null;
  return family in FAMILY_TABLE ? (family as LineFamily) : null;
}

/** A row ready to insert: column → value, with nothing sport-specific left in it. */
export type CategoryRow = Record<string, number | boolean | string | null>;

export interface ToRowResult {
  family: LineFamily;
  table: string;
  row: CategoryRow;
  /**
   * Keys in the bag with no column. Should always be empty in production - it is
   * returned rather than thrown so a single unknown metric cannot fail a lock, and
   * the caller can log it.
   */
  unmapped: string[];
}

/**
 * Project a stat bag onto its family's columns.
 *
 * `colour` is passed separately because it is a FACT about the match, not a metric:
 * the bag can only carry as_white/as_black as 1/0, and reconstructing the colour
 * from those is exactly the sort of inference that goes wrong.
 */
export function toCategoryRow(
  sport: string | null | undefined,
  bag: StatBag,
  extra: Partial<Record<'position' | 'rubber_key' | 'partner_user_id' | 'colour' | 'weight_class' | 'side_used' | 'win_by' | 'opponent_user_id', string | null>> = {},
): ToRowResult | null {
  const family = lineFamilyFor(sport);
  if (!family) return null;

  const map = COLUMN_MAP[family];
  const row: CategoryRow = {};
  const unmapped: string[] = [];

  for (const [key, value] of Object.entries(bag)) {
    if (SPINE_METRICS.includes(key)) continue;
    const target = map[key];
    if (!target) {
      // A rate is stored nowhere: it is recomputed from its two operands, so a
      // stored copy could disagree with them.
      if (!key.endsWith('_pct') && !key.endsWith('_diff') && key !== 'point_diff') unmapped.push(key);
      continue;
    }
    if (typeof target === 'string') {
      // The same column twice (boards_won and frames_won) sums rather than
      // overwrites, so a sport recording both does not lose one.
      row[target] = ((row[target] as number | undefined) ?? 0) + Math.max(0, Math.round(value));
    } else if (value > 0) {
      row[target.column] = true;
    }
  }

  // The two board booleans are a colour, and the column is the colour.
  const white = row.colour_is_white === true;
  const black = row.colour_is_black === true;
  delete row.colour_is_white;
  delete row.colour_is_black;
  if (family === 'board') {
    row.colour = extra.colour ?? (white ? 'white' : black ? 'black' : null);
    if (extra.opponent_user_id !== undefined) row.opponent_user_id = extra.opponent_user_id;
  }

  if (family === 'racquet') {
    if (extra.rubber_key !== undefined) row.rubber_key = extra.rubber_key;
    if (extra.partner_user_id !== undefined) row.partner_user_id = extra.partner_user_id;
  }
  if (family === 'combat') {
    if (extra.weight_class !== undefined) row.weight_class = extra.weight_class;
    if (extra.side_used !== undefined) row.side_used = extra.side_used;
    if (extra.win_by !== undefined) row.win_by = extra.win_by;
  }
  // POSITION exists only where the table has the column, and only where the concept
  // does. Three families field people in positions; a combat sport has a weight
  // class, not a position, and a board sport has a board number. Emitting it for
  // combat made every insert in that family fail with `column "position" does not
  // exist` - so boxing, judo, wrestling, taekwondo, arm wrestling, tug of war and
  // fencing all silently recorded nothing. The racquet table has no column either:
  // singles/doubles is the spine's `position`, and a copy here would be a second
  // place to disagree.
  if (POSITIONAL.has(family) && extra.position !== undefined) {
    row.position = extra.position;
  }

  return { family, table: FAMILY_TABLE[family], row, unmapped };
}

/**
 * Every non-derived metric the registry defines, by family. The exhaustiveness test
 * reads this rather than re-deriving it, so the two cannot disagree.
 */
export function registryMetricKeys(family: StatFamily): string[] {
  const keys = new Set<string>();
  for (const spec of ALL_STAT_SPECS) {
    if (spec.family !== family) continue;
    for (const m of spec.metrics) if (m.source !== 'derived') keys.add(m.key);
    for (const e of spec.events) {
      for (const k of Object.keys(e.metrics)) keys.add(k);
      for (const k of Object.keys(e.secondPlayerMetrics ?? {})) keys.add(k);
    }
  }
  return [...keys].sort();
}
