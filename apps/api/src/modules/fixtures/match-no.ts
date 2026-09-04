import type { Prisma } from '../../infra/prisma.js';

/**
 * Match numbers, allocated per DISCIPLINE DRAW.
 *
 * "Match 14" is how a person refers to a fixture out loud - to an official on a
 * pitch, in a message to a captain, in a complaint about a scoreline. Two sides'
 * names are not enough: in a round robin the same pair meets twice, and a 224-match
 * championship has several pairs playing on the same afternoon.
 *
 * PER DRAW, NOT PER CHAMPIONSHIP. This was originally per championship, so one
 * event held a single running sequence. Read inside a draw - which is where every
 * screen actually shows it, grouped under "Table Tennis · Men's Doubles" - that
 * looked broken: a discipline's first two matches were "#8" and "#9" because seven
 * numbers had gone to other draws. Restarting at 1 in each draw makes the numbers
 * describe the thing they are listed under.
 *
 * THE COST, STATED: a number is no longer unique within a championship. "Match 3"
 * needs its discipline named to identify a fixture - "TT Men's Doubles, match 3".
 * Every screen that shows the number already shows the discipline heading beside it,
 * so this is a change in what must be SAID, not in what is displayed. A control desk
 * that wants one running order across a whole event wants `scheduled_at`, which is
 * what actually orders a day.
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
 * The next `count` numbers for one DRAW.
 *
 * Reads the highest allocated and counts on from it, rather than counting rows: a
 * deleted fixture must not hand its number to a new one, because somebody may have
 * written "match 12" on a sheet of paper.
 *
 * Not collision-proof against two organisers generating the same draw in the same
 * instant - that is what the caller's transaction is for. Worth stating plainly
 * rather than implying a guarantee this does not make: the failure mode is two
 * fixtures sharing a number, which is a display oddity, not corruption, and the
 * numbers can be re-sequenced.
 */
export async function nextMatchNos(
  prisma: Prisma,
  tournamentDisciplineId: string,
  count: number,
): Promise<number[]> {
  if (count <= 0) return [];
  const top = await prisma.fixtures.aggregate({
    where: { tournament_discipline_id: tournamentDisciplineId, match_no: { not: null } },
    _max: { match_no: true },
  });
  const start = (top._max.match_no ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Playing order within a draw.
 *
 * `scheduled_at` first, so the numbers run the way the day runs. The draw-shape
 * tiebreaks after it are what make an UNSCHEDULED draw number sensibly - and a
 * freshly generated draw is entirely unscheduled, which is exactly when numbers are
 * handed out. Without them a knockout fell back to insert order, which is close to
 * bracket order by luck rather than by rule.
 */
const PLAY_ORDER = [
  { scheduled_at: { sort: 'asc', nulls: 'last' } },
  { stage_sequence: 'asc' },
  { pool_number: { sort: 'asc', nulls: 'first' } },
  { bracket_position: { sort: 'asc', nulls: 'first' } },
  { created_at: 'asc' },
  { id: 'asc' },
] as const;

/**
 * Number any fixture in this championship that has none, restarting at 1 per draw.
 *
 * Called after a generator writes a draw. Generators insert in bracket/pool order
 * and several of them do a second pass (bye propagation, stage advancement), so
 * numbering afterwards - once, over everything unnumbered - is both simpler and more
 * correct than threading numbers through each insert.
 *
 * Takes the CHAMPIONSHIP because that is what the callers have and because a single
 * generate can touch several draws; the allocation inside is per draw.
 */
export async function assignMatchNos(prisma: Prisma, championshipId: string): Promise<number> {
  const unnumbered = await prisma.fixtures.findMany({
    where: { ...championshipWhere(championshipId), match_no: null },
    select: { id: true, tournament_discipline_id: true },
    orderBy: [...PLAY_ORDER],
  });
  if (!unnumbered.length) return 0;

  // Group by draw, preserving the play order within each.
  const byDraw = new Map<string, string[]>();
  for (const f of unnumbered) {
    const list = byDraw.get(f.tournament_discipline_id);
    if (list) list.push(f.id);
    else byDraw.set(f.tournament_discipline_id, [f.id]);
  }

  // One aggregate for every draw at once rather than one round trip each - a
  // multi-sport generate can touch a dozen draws and this runs on the request path.
  const tops = await prisma.fixtures.groupBy({
    by: ['tournament_discipline_id'],
    where: { tournament_discipline_id: { in: [...byDraw.keys()] }, match_no: { not: null } },
    _max: { match_no: true },
  });
  const startOf = new Map(tops.map((t) => [t.tournament_discipline_id, (t._max.match_no ?? 0) + 1]));

  const updates = [...byDraw.entries()].flatMap(([drawId, ids]) => {
    const start = startOf.get(drawId) ?? 1;
    return ids.map((id, i) => prisma.fixtures.update({ where: { id }, data: { match_no: start + i } }));
  });

  // One statement per fixture, in one transaction. A CASE-based bulk update would be
  // fewer round trips; at the size of a draw (tens to low hundreds) the clarity is
  // worth more than the milliseconds, and this runs once per generation.
  await prisma.$transaction(updates);
  return unnumbered.length;
}

/**
 * Renumber a championship from scratch, per draw.
 *
 * NOT called on the request path, and deliberately separate from `assignMatchNos`:
 * that one only ever fills in blanks, because a number somebody has written down
 * must not move. This exists for the one case where they must - a championship whose
 * numbers were allocated under the old per-championship scheme, whose draws
 * therefore start at 8 and 9 instead of 1.
 */
export async function resequenceMatchNos(prisma: Prisma, championshipId: string): Promise<number> {
  const all = await prisma.fixtures.findMany({
    where: championshipWhere(championshipId),
    select: { id: true, tournament_discipline_id: true },
    orderBy: [...PLAY_ORDER],
  });
  if (!all.length) return 0;

  const seen = new Map<string, number>();
  const updates = all.map((f) => {
    const n = (seen.get(f.tournament_discipline_id) ?? 0) + 1;
    seen.set(f.tournament_discipline_id, n);
    return prisma.fixtures.update({ where: { id: f.id }, data: { match_no: n } });
  });
  await prisma.$transaction(updates);
  return all.length;
}
