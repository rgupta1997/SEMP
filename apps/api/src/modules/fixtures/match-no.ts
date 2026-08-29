import type { Prisma } from '../../infra/prisma.js';

/**
 * Match numbers, allocated per championship.
 *
 * "Match 14" is how a person refers to a fixture out loud - to an official on a
 * pitch, in a message to a captain, in a complaint about a scoreline. Two sides'
 * names are not enough: in a round robin the same pair meets twice, and a 224-match
 * championship has several pairs playing on the same afternoon.
 *
 * PER CHAMPIONSHIP. The number means something inside one event and nothing across
 * the platform, and a global sequence would give a school's own league a five-digit
 * first match.
 *
 * ALLOCATED, NOT COMPUTED. It could be derived at read time from a row_number() over
 * scheduled_at - but then it would CHANGE when somebody reschedules, and a number
 * that moves is worse than no number: an official told to score match 14 would find a
 * different match there. Once given, it stays.
 */

/** Every fixture in the championship this discipline belongs to. */
const championshipWhere = (championshipId: string) => ({
  tournament_disciplines: {
    tournament_sports: { tournaments: { championship_id: championshipId } },
  },
});

/** The championship a discipline draw sits in. */
export async function championshipOfDiscipline(
  prisma: Prisma,
  tournamentDisciplineId: string,
): Promise<string | null> {
  const row = await prisma.tournament_disciplines.findUnique({
    where: { id: tournamentDisciplineId },
    select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } },
  });
  return row?.tournament_sports?.tournaments?.championship_id ?? null;
}

/**
 * The next `count` numbers for a championship.
 *
 * Reads the highest allocated and counts on from it, rather than counting rows: a
 * deleted fixture must not hand its number to a new one, because somebody may have
 * written "match 12" on a sheet of paper.
 *
 * Not collision-proof against two organisers generating draws in the same instant -
 * that is what the caller's transaction is for. Worth stating plainly rather than
 * implying a guarantee this does not make: the failure mode is two fixtures sharing
 * a number, which is a display oddity, not corruption, and the numbers can be
 * re-sequenced.
 */
export async function nextMatchNos(
  prisma: Prisma,
  championshipId: string,
  count: number,
): Promise<number[]> {
  if (count <= 0) return [];
  const top = await prisma.fixtures.aggregate({
    where: { ...championshipWhere(championshipId), match_no: { not: null } },
    _max: { match_no: true },
  });
  const start = (top._max.match_no ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Number any fixture in this championship that has none, in playing order.
 *
 * Called after a generator writes a draw. Generators insert in bracket/pool order
 * and several of them do a second pass (bye propagation, stage advancement), so
 * numbering afterwards - once, over everything unnumbered - is both simpler and more
 * correct than threading numbers through each insert.
 *
 * Ordered by `scheduled_at` so the numbers run the way the day runs, with unscheduled
 * fixtures last: an undated match is not "match 1", it is unplaced.
 */
export async function assignMatchNos(prisma: Prisma, championshipId: string): Promise<number> {
  const unnumbered = await prisma.fixtures.findMany({
    where: { ...championshipWhere(championshipId), match_no: null },
    select: { id: true },
    orderBy: [
      { scheduled_at: { sort: 'asc', nulls: 'last' } },
      { created_at: 'asc' },
      { id: 'asc' },
    ],
  });
  if (!unnumbered.length) return 0;

  const numbers = await nextMatchNos(prisma, championshipId, unnumbered.length);
  // One statement per fixture, in one transaction. A CASE-based bulk update would be
  // fewer round trips; at the size of a draw (tens to low hundreds) the clarity is
  // worth more than the milliseconds, and this runs once per generation.
  await prisma.$transaction(
    unnumbered.map((f, i) => prisma.fixtures.update({ where: { id: f.id }, data: { match_no: numbers[i] } })),
  );
  return unnumbered.length;
}
