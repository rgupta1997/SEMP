import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { writeCategoryLine, writeCategoryLines } from './category-lines.service.js';
import type { Db } from '../../infra/prisma.js';

// The mapping itself is tested in @semp/shared, where it is pure. What is worth
// testing HERE is the SQL this file builds, and one property above all: that every
// value is a bound parameter rather than interpolated text. A stat writer that
// concatenates its own SQL is one bad metric key away from being an injection point,
// and the values arriving here have passed through a scoring console.

interface Captured { sql: string; params: unknown[] }

function fakeDb() {
  const seen: Captured[] = [];
  const db = {
    $executeRaw: async (q: Prisma.Sql) => {
      seen.push({ sql: q.sql, params: q.values });
      return 1;
    },
  } as unknown as Db;
  return { db, seen };
}

const inserts = (seen: Captured[]) => seen.filter((s) => s.sql.includes('insert into'));
const deletes = (seen: Captured[]) => seen.filter((s) => s.sql.includes('delete from'));

describe('writing a detail row', () => {
  it('replaces rather than accumulates, so a re-lock is idempotent', async () => {
    const { db, seen } = fakeDb();
    const r = await writeCategoryLine(db, {
      lineId: 'line-1', sport: 'football', stats: { goals: 2, assists: 1, minutes: 90 },
    });
    expect(r.written).toBe(1);
    expect(deletes(seen)).toHaveLength(1);
    expect(deletes(seen)[0].sql).toContain('invasion_match_lines');
    expect(inserts(seen)).toHaveLength(1);
  });

  it('binds every value as a parameter, interpolating none of them', async () => {
    const { db, seen } = fakeDb();
    await writeCategoryLine(db, {
      lineId: 'line-1', sport: 'football', stats: { goals: 2, assists: 1 },
    });
    const ins = inserts(seen)[0];
    // The numbers appear in the parameter list, never in the statement text.
    expect(ins.params).toContain(2);
    expect(ins.params).toContain('line-1');
    expect(ins.sql).not.toMatch(/values\s*\([^)]*\b2\b/);
    // One placeholder per value: line_id plus the two metrics.
    expect((ins.sql.match(/\$\d+|\?/g) ?? []).length).toBe(ins.params.length);
  });

  it('names only the columns it actually has values for', async () => {
    const { db, seen } = fakeDb();
    await writeCategoryLine(db, { lineId: 'l', sport: 'football', stats: { goals: 1 } });
    const sql = inserts(seen)[0].sql;
    expect(sql).toContain('goals');
    // The other twenty columns keep their defaults rather than being written as 0.
    expect(sql).not.toContain('rebounds');
  });

  it('routes each sport to its own table', async () => {
    for (const [sport, table] of [
      ['table tennis', 'racquet_match_lines'],
      ['kabaddi', 'raid_match_lines'],
      ['volleyball', 'net_match_lines'],
      ['chess', 'board_match_lines'],
      ['boxing', 'combat_match_lines'],
      ['basketball', 'invasion_match_lines'],
    ] as const) {
      const { db, seen } = fakeDb();
      await writeCategoryLine(db, { lineId: 'l', sport, stats: { minutes: 10 } });
      expect(inserts(seen)[0].sql, sport).toContain(table);
    }
  });

  it('writes nothing at all for a sport with no detail table', async () => {
    const { db, seen } = fakeDb();
    // Cricket keeps three tables of its own; an unknown sport keeps none.
    expect((await writeCategoryLine(db, { lineId: 'l', sport: 'cricket', stats: { runs: 40 } })).written).toBe(0);
    expect((await writeCategoryLine(db, { lineId: 'l', sport: 'quidditch', stats: {} })).written).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('casts a uuid column, which Postgres will not infer from a text parameter', async () => {
    const { db, seen } = fakeDb();
    await writeCategoryLine(db, {
      lineId: 'l', sport: 'tennis', stats: { points_won: 40 },
      extra: { partner_user_id: 'u-9' },
    });
    expect(inserts(seen)[0].sql).toMatch(/::uuid/);
    expect(inserts(seen)[0].params).toContain('u-9');
  });

  it('reports a metric with no column instead of dropping it silently', async () => {
    const { db } = fakeDb();
    const r = await writeCategoryLine(db, {
      lineId: 'l', sport: 'football', stats: { goals: 1, hat_tricks: 1 },
    });
    // Written, but the gap is surfaced - which is the whole point of typed columns.
    expect(r.written).toBe(1);
    expect(r.unmapped).toEqual(['hat_tricks']);
  });
});

describe('writing a whole fixture', () => {
  it('writes one row per person and collects the gaps once', async () => {
    const { db, seen } = fakeDb();
    const r = await writeCategoryLines(db, [
      { lineId: 'l1', sport: 'football', stats: { goals: 1, hat_tricks: 1 } },
      { lineId: 'l2', sport: 'football', stats: { saves: 3, hat_tricks: 2 } },
      { lineId: 'l3', sport: 'cricket', stats: { runs: 10 } },
    ]);
    expect(r.written).toBe(2);
    // Both football rows, ONE statement. Cricket has no table here - its three live
    // in cricket-lines.service - so it contributes nothing, which is not an error.
    expect(inserts(seen)).toHaveLength(1);
    expect(inserts(seen)[0].params).toContain('l1');
    expect(inserts(seen)[0].params).toContain('l2');
    // Deduplicated: one warning per unknown metric, not one per player.
    expect(r.unmapped).toEqual(['hat_tricks']);
  });

  /**
   * THE REASON THIS IS BATCHED AT ALL.
   *
   * One delete and one insert per player, inside the lock's transaction, is two
   * round trips each. At eleven a side that is forty-four on top of everything else
   * a lock does, and it blew Prisma's transaction budget - so the lock rolled back
   * and the official was told the result was not saved.
   */
  it('costs TWO STATEMENTS for a whole eleven-a-side team sheet, not forty-four', async () => {
    const { db, seen } = fakeDb();
    const squad = Array.from({ length: 22 }, (_, i) => ({
      lineId: `l${i}`, sport: 'football', stats: { goals: i % 3, minutes: 90 },
    }));
    const r = await writeCategoryLines(db, squad);
    expect(r.written).toBe(22);
    expect(deletes(seen)).toHaveLength(1);
    expect(inserts(seen)).toHaveLength(1);
  });

  it('still binds every value, however many rows share the statement', async () => {
    const { db, seen } = fakeDb();
    await writeCategoryLines(db, [
      { lineId: 'l1', sport: 'football', stats: { goals: 1 } },
      { lineId: 'l2', sport: 'football', stats: { goals: 2 } },
    ]);
    const ins = inserts(seen)[0];
    expect(ins.sql).not.toMatch(/l1|l2/);
    expect(ins.params).toEqual(expect.arrayContaining(['l1', 'l2']));
  });

  /**
   * A ragged column set is the normal case, not an edge case: one player has saves
   * and no goals, the next has goals and no saves. Sharing a statement means saying
   * something for the columns a row did not produce, and NULL is the wrong thing to
   * say - most of these columns are NOT NULL with a zero default, so the insert is
   * rejected, the caller swallows it, and the statistics silently never appear.
   */
  it('a column only one player has takes the DB DEFAULT for the others, never NULL', async () => {
    const { db, seen } = fakeDb();
    const r = await writeCategoryLines(db, [
      { lineId: 'l1', sport: 'football', stats: { goals: 1 } },
      { lineId: 'l2', sport: 'football', stats: { saves: 4 } },
    ]);
    expect(r.written).toBe(2);
    expect(inserts(seen)).toHaveLength(1);
    const ins = inserts(seen)[0];
    expect(ins.sql).toContain('goals');
    expect(ins.sql).toContain('saves');
    expect(ins.sql).toContain('DEFAULT');
    expect(ins.params, 'a missing column was bound as NULL instead of DEFAULT')
      .not.toContain(null);
  });

  it('writes nothing, and no statement, for an empty team sheet', async () => {
    const { db, seen } = fakeDb();
    const r = await writeCategoryLines(db, []);
    expect(r.written).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('keeps two different sports in their own tables', async () => {
    const { db, seen } = fakeDb();
    await writeCategoryLines(db, [
      { lineId: 'l1', sport: 'football', stats: { goals: 1 } },
      { lineId: 'l2', sport: 'tennis', stats: { points_won: 30 } },
    ]);
    expect(inserts(seen)).toHaveLength(2);
    const tables = inserts(seen).map((s) => s.sql.match(/insert into (\w+)/)?.[1]);
    expect(new Set(tables).size).toBe(2);
  });
});
