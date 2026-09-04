import { describe, expect, it, vi } from 'vitest';
import { assignMatchNos, nextMatchNos, resequenceMatchNos } from './match-no.js';

/**
 * A fake just wide enough for the allocator: findMany returns rows in the order the
 * caller asked for (the real ordering is Postgres's job and is asserted by the
 * orderBy clause being passed, not re-implemented here), groupBy reports the highest
 * number already allocated per draw, and $transaction records what was written.
 */
function fake(rows: Array<{ id: string; draw: string; match_no?: number | null }>) {
  const written: Array<{ id: string; match_no: number }> = [];
  const prisma = {
    fixtures: {
      findMany: vi.fn(async ({ where, select }: any) => {
        const onlyBlank = where?.match_no === null;
        return rows
          .filter((r) => (onlyBlank ? r.match_no == null : true))
          .map((r) => ({
            id: r.id,
            ...(select?.tournament_discipline_id ? { tournament_discipline_id: r.draw } : {}),
          }));
      }),
      aggregate: vi.fn(async ({ where }: any) => {
        const inDraw = rows.filter((r) => r.draw === where.tournament_discipline_id && r.match_no != null);
        return { _max: { match_no: inDraw.reduce((m, r) => Math.max(m, r.match_no!), 0) || null } };
      }),
      groupBy: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.tournament_discipline_id.in;
        return ids.map((d) => {
          const nums = rows.filter((r) => r.draw === d && r.match_no != null).map((r) => r.match_no!);
          return { tournament_discipline_id: d, _max: { match_no: nums.length ? Math.max(...nums) : null } };
        });
      }),
      update: vi.fn(({ where, data }: any) => ({ __id: where.id, __no: data.match_no })),
    },
    $transaction: vi.fn(async (ops: any[]) => {
      for (const o of ops) written.push({ id: o.__id, match_no: o.__no });
      return ops;
    }),
  };
  return { prisma: prisma as any, written };
}

const numbersFor = (written: Array<{ id: string; match_no: number }>, prefix: string) =>
  written.filter((w) => w.id.startsWith(prefix)).map((w) => w.match_no);

describe('match numbers restart per draw', () => {
  it('numbers each discipline from 1, not from a running championship total', () => {
    // The reported symptom: Men's Singles had one match numbered #1, and Men's
    // Doubles - generated after it - started at #8 because seven numbers had gone
    // to other draws in the same championship.
    const { prisma, written } = fake([
      { id: 'ms-1', draw: 'ms' },
      { id: 'md-1', draw: 'md' },
      { id: 'md-2', draw: 'md' },
      { id: 'bd-1', draw: 'bd' },
    ]);
    return assignMatchNos(prisma, 'champ').then((n) => {
      expect(n).toBe(4);
      expect(numbersFor(written, 'ms')).toEqual([1]);
      expect(numbersFor(written, 'md')).toEqual([1, 2]);
      expect(numbersFor(written, 'bd')).toEqual([1]);
    });
  });

  it('counts on from the highest number the draw already has', async () => {
    // A league that gains fixtures when new teams register must not reuse numbers.
    const { prisma, written } = fake([
      { id: 'ms-1', draw: 'ms', match_no: 1 },
      { id: 'ms-2', draw: 'ms', match_no: 2 },
      { id: 'ms-3', draw: 'ms' },
      { id: 'md-1', draw: 'md' },
    ]);
    await assignMatchNos(prisma, 'champ');
    expect(numbersFor(written, 'ms-3')).toEqual([3]);
    // A different draw is unaffected by that draw's count.
    expect(numbersFor(written, 'md')).toEqual([1]);
  });

  it('never renumbers a fixture that already has one', async () => {
    const { prisma, written } = fake([
      { id: 'ms-1', draw: 'ms', match_no: 5 },
      { id: 'ms-2', draw: 'ms' },
    ]);
    await assignMatchNos(prisma, 'champ');
    // Only the blank one is written - a number somebody wrote on a sheet stays put.
    expect(written.map((w) => w.id)).toEqual(['ms-2']);
    expect(written[0].match_no).toBe(6);
  });

  it('does nothing when every fixture is already numbered', async () => {
    const { prisma } = fake([{ id: 'ms-1', draw: 'ms', match_no: 1 }]);
    expect(await assignMatchNos(prisma, 'champ')).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allocates per draw through nextMatchNos too', async () => {
    const { prisma } = fake([
      { id: 'ms-1', draw: 'ms', match_no: 4 },
      { id: 'md-1', draw: 'md', match_no: 9 },
    ]);
    expect(await nextMatchNos(prisma, 'ms', 2)).toEqual([5, 6]);
    expect(await nextMatchNos(prisma, 'md', 1)).toEqual([10]);
    expect(await nextMatchNos(prisma, 'ms', 0)).toEqual([]);
  });
});

describe('resequencing an old per-championship numbering', () => {
  it('rewrites every fixture so each draw starts at 1', async () => {
    const { prisma, written } = fake([
      { id: 'ms-1', draw: 'ms', match_no: 1 },
      { id: 'md-1', draw: 'md', match_no: 8 },
      { id: 'md-2', draw: 'md', match_no: 9 },
    ]);
    expect(await resequenceMatchNos(prisma, 'champ')).toBe(3);
    expect(numbersFor(written, 'ms')).toEqual([1]);
    expect(numbersFor(written, 'md')).toEqual([1, 2]);
  });
});
