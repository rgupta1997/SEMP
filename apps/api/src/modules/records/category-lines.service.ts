import { Prisma } from '@prisma/client';
import { toCategoryRow, type CategoryRow, type StatBag } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';

// ============================================================================
// Writing the per-category detail rows.
//
// The spine (`player_match_stats`) holds the appearance and the outcome; these
// tables hold what the person actually did, in TYPED COLUMNS. The mapping from a
// stat bag to those columns lives in @semp/shared (`category-lines.ts`) so it can
// be tested without a database and so the exhaustiveness check - no metric without
// a column - runs in the same suite as the registry it checks.
//
// This file is only the SQL. It is deliberately dull:
//
//   * the column list comes from the mapping, never from user input, and every
//     value is a bound parameter. Nothing is interpolated except identifiers that
//     the mapping itself produced.
//   * delete-then-insert per spine row, matching the spine's own strategy. After a
//     correction that drops a player, an upsert would leave their detail behind.
//   * a failure here is logged and swallowed by the caller, not fatal. A statistics
//     table that is briefly stale beats a scorecard that will not lock.
// ============================================================================

/** Column names the mapping may produce. Anything else is refused, loudly. */
const ALLOWED = new Set([
  // shared
  'minutes', 'position',
  // racquet
  'rubber_key', 'partner_user_id', 'points_won', 'points_lost',
  'service_points_played', 'service_points_won', 'return_points_played', 'return_points_won',
  'games_won', 'games_lost', 'sets_won', 'sets_lost', 'deciders_won', 'deciders_lost',
  'deuce_points_played', 'deuce_points_won', 'tiebreaks_won', 'tiebreaks_lost',
  'longest_streak', 'comeback_win', 'aces', 'double_faults', 'first_serves_in',
  'winners', 'unforced_errors', 'lets', 'break_points_played', 'break_points_won',
  'break_points_saved', 'retired', 'walkover_received', 'whitewash',
  // invasion
  'goals', 'assists', 'own_goals', 'shots', 'saves', 'clean_sheet', 'yellows', 'reds',
  'pens_scored', 'pens_missed', 'points_scored', 'fg_1', 'fg_2', 'fg_3', 'rebounds',
  'steals', 'blocks', 'turnovers', 'fouls', 'started',
  // raid
  'raid_points', 'raids', 'successful_raids', 'super_raids', 'do_or_die_won',
  'tackle_points', 'tackles', 'super_tackles', 'bonus_points', 'all_outs',
  'touch_points', 'dream_run_seconds',
  // net
  'kills', 'digs', 'service_errors', 'attack_errors', 'reception_errors', 'sets_played',
  // board
  'units_won', 'units_lost', 'queens', 'coins', 'highest_break', 'breaks_50',
  'centuries', 'result_points_x2', 'colour', 'board_no', 'opponent_user_id',
  // combat
  'weight_class', 'side_used', 'bouts', 'rounds_won', 'rounds_lost',
  'touches_for', 'touches_against', 'win_by', 'penalties', 'stoppages',
]);

/** Columns that hold a uuid and therefore need the cast Postgres will not infer. */
const UUID_COLUMNS = new Set(['partner_user_id', 'opponent_user_id']);

export interface CategoryLineInput {
  /** The spine row this detail hangs off. */
  lineId: string;
  sport: string | null;
  stats: StatBag;
  extra?: Parameters<typeof toCategoryRow>[2];
}

export interface CategoryWriteResult {
  written: number;
  /** Metric keys with no column. Always empty in a healthy build; logged if not. */
  unmapped: string[];
}

function insertSql(table: string, row: CategoryRow, lineId: string): Prisma.Sql {
  const columns = Object.keys(row).filter((c) => ALLOWED.has(c));
  const refused = Object.keys(row).filter((c) => !ALLOWED.has(c));
  if (refused.length) {
    // The mapping produced a column this file does not know. That is a code bug, not
    // a data problem, so it must be visible rather than written blindly.
    throw new Error(`category-lines: refusing unknown column(s) ${refused.join(', ')} for ${table}`);
  }

  const names = ['line_id', ...columns];
  const values: Prisma.Sql[] = [Prisma.sql`${lineId}::uuid`];
  for (const c of columns) {
    const v = row[c];
    values.push(UUID_COLUMNS.has(c) ? Prisma.sql`${v}::uuid` : Prisma.sql`${v}`);
  }

  return Prisma.sql`
    insert into ${Prisma.raw(table)} (${Prisma.raw(names.join(', '))})
    values (${Prisma.join(values)})`;
}

/**
 * Write the typed detail row for one spine line. Returns 0 for a sport with no
 * detail table, which is not an error - a measured sport records a performance, not
 * a match line, and cricket keeps three tables of its own.
 */
export async function writeCategoryLine(db: Db, input: CategoryLineInput): Promise<CategoryWriteResult> {
  const mapped = toCategoryRow(input.sport, input.stats, input.extra);
  if (!mapped) return { written: 0, unmapped: [] };

  await db.$executeRaw(Prisma.sql`
    delete from ${Prisma.raw(mapped.table)} where line_id = ${input.lineId}::uuid`);
  await db.$executeRaw(insertSql(mapped.table, mapped.row, input.lineId));
  return { written: 1, unmapped: mapped.unmapped };
}

/**
 * Write every detail row for a fixture, in ONE STATEMENT PER TABLE.
 *
 * It used to be one delete and one insert PER PERSON, sequentially, inside the lock
 * transaction. That transaction has a 5-second budget, and every statement is a
 * round trip to a pooled connection - so an eleven-a-side football match spent two
 * statements on each of twenty-two players on top of everything else the lock does,
 * blew the budget, and the whole lock rolled back with "That took too long and was
 * not saved". The official taps Lock, waits, and the result is not locked: no
 * standings, no statistics, nothing. It failed intermittently on the bigger squads,
 * which is the worst way for it to fail.
 *
 * Grouped by table and written as a single multi-row insert, twenty-two players cost
 * two statements instead of forty-four. Rows in one table are normalised to the
 * union of their columns so they share one statement; a column a given row has no
 * value for is written NULL, which is what "did not record that" means anyway.
 *
 * Still sequential across tables, and still inside the caller's transaction: a
 * transaction client is not safe to use from parallel promises.
 */
export async function writeCategoryLines(db: Db, inputs: CategoryLineInput[]): Promise<CategoryWriteResult> {
  const out: CategoryWriteResult = { written: 0, unmapped: [] };
  if (!inputs.length) return out;

  // table -> the rows going into it, with the spine row each belongs to.
  const byTable = new Map<string, Array<{ lineId: string; row: CategoryRow }>>();
  for (const input of inputs) {
    const mapped = toCategoryRow(input.sport, input.stats, input.extra);
    if (!mapped) continue;                 // a sport with no detail table is not an error
    for (const k of mapped.unmapped) if (!out.unmapped.includes(k)) out.unmapped.push(k);
    if (!byTable.has(mapped.table)) byTable.set(mapped.table, []);
    byTable.get(mapped.table)!.push({ lineId: input.lineId, row: mapped.row });
  }

  for (const [table, rows] of byTable) {
    // The union of every column any row in this table wants, so one statement
    // carries them all. Unknown columns are still refused loudly - that is a code
    // bug, and writing it blindly would be worse than failing.
    const columns: string[] = [];
    for (const { row } of rows) {
      for (const c of Object.keys(row)) {
        if (!ALLOWED.has(c)) {
          throw new Error(`category-lines: refusing unknown column ${c} for ${table}`);
        }
        if (!columns.includes(c)) columns.push(c);
      }
    }

    const lineIds = rows.map((r) => r.lineId);
    // Delete-then-insert, matching the spine's own strategy: after a correction that
    // drops a player, an upsert would leave their detail behind.
    await db.$executeRaw(Prisma.sql`
      delete from ${Prisma.raw(table)} where line_id = any(${lineIds}::uuid[])`);

    const tuples = rows.map(({ lineId, row }) => {
      const values: Prisma.Sql[] = [Prisma.sql`${lineId}::uuid`];
      for (const c of columns) {
        // DEFAULT, not NULL, for a column this row has no value for.
        //
        // One statement per table needs one column list, so a row that did not
        // produce every column has to say something for the rest. NULL is the wrong
        // thing to say: most of these columns are NOT NULL with a zero default, and
        // the per-row insert this replaced simply omitted them and let the default
        // apply. Writing NULL instead made every insert with a ragged column set
        // fail the not-null constraint - which the caller swallows, so the lock
        // still succeeded and the statistics silently did not appear.
        if (!(c in row) || row[c] === undefined) { values.push(Prisma.raw('DEFAULT')); continue; }
        const v = row[c];
        values.push(UUID_COLUMNS.has(c) ? Prisma.sql`${v}::uuid` : Prisma.sql`${v}`);
      }
      return Prisma.sql`(${Prisma.join(values)})`;
    });

    await db.$executeRaw(Prisma.sql`
      insert into ${Prisma.raw(table)} (${Prisma.raw(['line_id', ...columns].join(', '))})
      values ${Prisma.join(tuples)}`);
    out.written += rows.length;
  }

  if (out.unmapped.length) {
    console.warn('[category-lines] metrics with no column, not stored:', out.unmapped.join(', '));
  }
  return out;
}
