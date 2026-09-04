import { lineFamilyFor, isCricketSport } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';

// ============================================================================
// A player's OWN statistics for ONE match.
//
// WHY THIS EXISTS. Everything needed was already being written - the spine row in
// `player_match_stats`, the typed detail in `racquet_match_lines`,
// `cricket_batting_lines` and the rest - and NOTHING READ IT BACK for the person it
// belonged to. `/me/matches/:id` returned the scoreline, the opponent and the
// teammates, and not one number the player had actually produced. A stat pipeline
// nobody can see is a stat pipeline nobody trusts.
//
// The shape is deliberately FLAT AND LABELLED rather than the raw column names: a
// profile screen should not have to know that a cricket appearance is three rows in
// three tables, or that a racquet line calls its service split
// `service_points_played`. What comes back is a list of {label, value} groups, in
// reading order, which any screen can render without a per-sport branch.
// ============================================================================

export interface StatItem { label: string; value: string | number }
export interface StatGroup { title: string; items: StatItem[] }

export interface MyMatchStats {
  /** True when this person was on the team sheet for this fixture. */
  played: boolean;
  outcome: 'won' | 'lost' | 'drew' | null;
  /** singles / doubles for a racquet rubber; a position for a team sport. */
  position: string | null;
  /** Whether the numbers below are final. An unlocked result can still change. */
  official: boolean;
  groups: StatGroup[];
  /** Nothing recorded - said out loud, so a screen can explain rather than show 0s. */
  note?: string;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pct = (won: number, played: number): string =>
  played > 0 ? `${Math.round((won / played) * 100)}%` : '—';
const overs = (balls: number, per = 6) => `${Math.floor(balls / per)}.${balls % per}`;

/**
 * Read one person's statistics for one fixture.
 *
 * Returns null when they have no spine row at all - they were not part of this
 * match, which is different from having played and scored nothing.
 */
export async function myMatchStats(
  db: Db, fixtureId: string, userId: string, sport: string | null,
): Promise<MyMatchStats | null> {
  const spine = await db.$queryRaw<Array<{
    id: string; played: boolean; outcome: string | null; position: string | null;
    lock_version: number | null; superseded_at: Date | null;
  }>>`
    select id, played, outcome, position, lock_version, superseded_at
    from player_match_stats
    where fixture_id = ${fixtureId}::uuid and user_id = ${userId}::uuid and superseded_at is null
    order by computed_at desc limit 1`;
  const row = spine[0];
  if (!row) return null;

  const base: MyMatchStats = {
    played: row.played,
    outcome: (row.outcome as MyMatchStats['outcome']) ?? null,
    position: row.position,
    // A stat line only becomes official when the result is locked, and saying so is
    // what stops a player treating a mid-match figure as their record.
    official: row.lock_version != null,
    groups: [],
  };

  if (!row.played) {
    base.note = 'You were named in the squad but did not take part in this match.';
    return base;
  }

  const cricket = isCricketSport(sport);
  if (cricket) {
    base.groups = await cricketGroups(db, row.id);
  } else {
    const family = lineFamilyFor(sport);
    base.groups = family ? await familyGroups(db, family, row.id) : [];
  }

  if (!base.groups.length) {
    // Phrased the way the sport phrases it. "No individual statistics were
    // recorded" reads as a broken screen; a cricketer who was in the XI and never
    // came on to bat or bowl has a real and ordinary answer, and a scorecard says
    // so plainly.
    base.note = cricket
      ? 'You were in the XI but did not bat or bowl in this match.'
      : lineFamilyFor(sport)
        ? 'No individual statistics were recorded for you in this match.'
        : 'This sport does not record individual statistics per match.';
  }
  return base;
}

/**
 * Cricket, which is three tables and a different grain.
 *
 * Per INNINGS, and summed across innings for the headline, because a Test appearance
 * is two innings of each and a player thinks of "my match" as both.
 */
async function cricketGroups(db: Db, lineId: string): Promise<StatGroup[]> {
  const groups: StatGroup[] = [];

  const bat = await db.$queryRaw<Array<{
    innings: number; runs: number; balls_faced: number; fours: number; sixes: number;
    dismissal: string; bat_position: number | null;
  }>>`
    select innings, runs, balls_faced, fours, sixes, dismissal, bat_position
    from cricket_batting_lines where line_id = ${lineId}::uuid order by innings asc`;

  for (const b of bat) {
    if (b.dismissal === 'did_not_bat') continue;
    const out = b.dismissal !== 'not_out' && b.dismissal !== 'retired';
    groups.push({
      title: bat.length > 1 ? `Batting (innings ${b.innings})` : 'Batting',
      items: [
        // The star is how a scorecard says "not out", and dropping it loses the
        // difference between 40 not out and 40 all out.
        { label: 'Runs', value: `${n(b.runs)}${out ? '' : '*'}` },
        { label: 'Balls faced', value: n(b.balls_faced) },
        { label: 'Fours', value: n(b.fours) },
        { label: 'Sixes', value: n(b.sixes) },
        { label: 'Strike rate', value: b.balls_faced ? Math.round((b.runs / b.balls_faced) * 100) : '—' },
        { label: 'How out', value: b.dismissal.replace(/_/g, ' ') },
      ],
    });
  }

  const bowl = await db.$queryRaw<Array<{
    innings: number; balls_bowled: number; maidens: number; runs_conceded: number;
    wickets: number; wides: number; no_balls: number; dots: number;
  }>>`
    select innings, balls_bowled, maidens, runs_conceded, wickets, wides, no_balls, dots
    from cricket_bowling_lines where line_id = ${lineId}::uuid order by innings asc`;

  for (const b of bowl) {
    groups.push({
      title: bowl.length > 1 ? `Bowling (innings ${b.innings})` : 'Bowling',
      items: [
        // Overs from BALLS. "3.4" is a display format, never a number to add.
        { label: 'Overs', value: overs(n(b.balls_bowled)) },
        { label: 'Runs conceded', value: n(b.runs_conceded) },
        { label: 'Wickets', value: n(b.wickets) },
        { label: 'Maidens', value: n(b.maidens) },
        { label: 'Economy', value: b.balls_bowled ? (b.runs_conceded / (b.balls_bowled / 6)).toFixed(2) : '—' },
        { label: 'Dot balls', value: n(b.dots) },
        { label: 'Wides / no-balls', value: `${n(b.wides)} / ${n(b.no_balls)}` },
      ],
    });
  }

  const field = await db.$queryRaw<Array<{
    catches: number; stumpings: number; run_outs: number;
  }>>`
    select coalesce(sum(catches), 0)::int as catches,
           coalesce(sum(stumpings), 0)::int as stumpings,
           coalesce(sum(run_outs), 0)::int as run_outs
    from cricket_fielding_lines where line_id = ${lineId}::uuid`;
  const f = field[0];
  if (f && (f.catches || f.stumpings || f.run_outs)) {
    groups.push({
      title: 'Fielding',
      items: [
        { label: 'Catches', value: n(f.catches) },
        { label: 'Stumpings', value: n(f.stumpings) },
        { label: 'Run-outs', value: n(f.run_outs) },
      ],
    });
  }
  return groups;
}

/** Column -> label, per family. Only the columns worth showing a player. */
const SHOW: Record<string, Array<[column: string, label: string]>> = {
  racquet: [
    ['points_won', 'Points won'], ['points_lost', 'Points lost'],
    ['service_points_won', 'Service points won'], ['service_points_played', 'Service points'],
    ['return_points_won', 'Return points won'], ['return_points_played', 'Return points'],
    ['games_won', 'Games won'], ['games_lost', 'Games lost'],
    ['sets_won', 'Sets won'], ['sets_lost', 'Sets lost'],
    ['aces', 'Aces'], ['double_faults', 'Double faults'],
    ['break_points_won', 'Break points won'], ['break_points_played', 'Break points'],
    ['longest_streak', 'Longest streak'],
  ],
  invasion: [
    ['minutes', 'Minutes'], ['goals', 'Goals'], ['assists', 'Assists'],
    ['shots', 'Shots'], ['saves', 'Saves'], ['yellows', 'Yellows'], ['reds', 'Reds'],
    ['points_scored', 'Points'], ['fg_1', 'Free throws'], ['fg_2', '2-pointers'], ['fg_3', '3-pointers'],
    ['rebounds', 'Rebounds'], ['steals', 'Steals'], ['blocks', 'Blocks'],
    ['turnovers', 'Turnovers'], ['fouls', 'Fouls'],
  ],
  raid: [
    ['minutes', 'Minutes'], ['raid_points', 'Raid points'], ['raids', 'Raids'],
    ['successful_raids', 'Successful raids'], ['tackle_points', 'Tackle points'],
    ['tackles', 'Tackles'], ['super_tackles', 'Super tackles'],
    ['bonus_points', 'Bonus points'], ['all_outs', 'All-outs'],
  ],
  net: [
    ['minutes', 'Minutes'], ['points_won', 'Points won'], ['points_scored', 'Points scored'],
    ['aces', 'Aces'], ['kills', 'Kills'], ['blocks', 'Blocks'], ['digs', 'Digs'],
    ['service_errors', 'Service errors'], ['attack_errors', 'Attack errors'],
    ['sets_won', 'Sets won'], ['sets_lost', 'Sets lost'],
  ],
  board: [
    ['units_won', 'Boards / frames won'], ['units_lost', 'Boards / frames lost'],
    ['points_scored', 'Points'], ['queens', 'Queens'], ['coins', 'Coins'],
    ['highest_break', 'Highest break'], ['breaks_50', '50+ breaks'], ['centuries', 'Centuries'],
    ['colour', 'Colour'], ['board_no', 'Board'],
  ],
  combat: [
    ['weight_class', 'Weight class'], ['bouts', 'Bouts'],
    ['rounds_won', 'Rounds won'], ['rounds_lost', 'Rounds lost'],
    ['touches_for', 'Touches for'], ['touches_against', 'Touches against'],
    ['win_by', 'Won by'], ['penalties', 'Penalties'], ['stoppages', 'Stoppages'],
  ],
};

const TABLE: Record<string, string> = {
  racquet: 'racquet_match_lines', invasion: 'invasion_match_lines',
  raid: 'raid_match_lines', net: 'net_match_lines',
  board: 'board_match_lines', combat: 'combat_match_lines',
};

const TITLE: Record<string, string> = {
  racquet: 'Your match', invasion: 'Your match', raid: 'Your match',
  net: 'Your match', board: 'Your match', combat: 'Your match',
};

/**
 * The single typed detail row for every family except cricket.
 *
 * A zero is DROPPED rather than shown. A profile listing "Aces 0, Double faults 0,
 * Break points 0" for a table-tennis match reads as a broken screen; showing only
 * what actually happened reads as a record. The one exception is a pair where the
 * other half is non-zero - "Points won 21, Points lost 0" is a real 21-0.
 */
async function familyGroups(db: Db, family: string, lineId: string): Promise<StatGroup[]> {
  const table = TABLE[family];
  const show = SHOW[family];
  if (!table || !show) return [];

  const columns = show.map(([c]) => c).join(', ');
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `select ${columns} from ${table} where line_id = $1::uuid limit 1`, lineId);
  const row = rows[0];
  if (!row) return [];

  const items: StatItem[] = [];
  for (const [column, label] of show) {
    const v = row[column];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' && v === 0) {
      // Keep a zero only when its partner is not zero - a 21-0 is worth printing.
      const partner = PAIRS[column];
      if (!partner || !n(row[partner])) continue;
    }
    if (typeof v === 'boolean' && !v) continue;
    items.push({ label, value: typeof v === 'boolean' ? 'yes' : (v as string | number) });
  }

  // Derived rates, added last so they read as conclusions rather than inputs.
  if (family === 'racquet' && n(row.service_points_played)) {
    items.push({ label: 'Service win %', value: pct(n(row.service_points_won), n(row.service_points_played)) });
  }
  if (family === 'raid' && n(row.raids)) {
    items.push({ label: 'Raid success', value: pct(n(row.successful_raids), n(row.raids)) });
  }

  return items.length ? [{ title: TITLE[family] ?? 'Your match', items }] : [];
}

/** Columns whose zero is meaningful when the other half is not zero. */
const PAIRS: Record<string, string> = {
  points_won: 'points_lost', points_lost: 'points_won',
  games_won: 'games_lost', games_lost: 'games_won',
  sets_won: 'sets_lost', sets_lost: 'sets_won',
  units_won: 'units_lost', units_lost: 'units_won',
  rounds_won: 'rounds_lost', rounds_lost: 'rounds_won',
  touches_for: 'touches_against', touches_against: 'touches_for',
  service_points_won: 'service_points_played',
  return_points_won: 'return_points_played',
};
