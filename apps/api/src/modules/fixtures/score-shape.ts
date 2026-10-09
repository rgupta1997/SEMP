import { isChessSport } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { BusinessRuleError } from '../../shared/errors.js';

// ============================================================================
// Halves are a chess score only. The score columns are decimal and the shared schema
// allows 0.5 steps (it cannot know the sport), but any other sport's 2.5 would fail
// its integer stat columns - so the sport is checked here, where it is known.
// ============================================================================

const isHalf = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v);

/** True when either score is fractional. Nulls and whole numbers never need a lookup. */
export function hasHalfScore(body: { home_score?: unknown; away_score?: unknown } | null | undefined): boolean {
  return !!body && (isHalf(body.home_score) || isHalf(body.away_score));
}

/** The sport of a fixture, or of the draw a new fixture is being created in. */
async function sportOf(db: Db, ref: { fixtureId?: string; tournamentDisciplineId?: string }): Promise<string | null> {
  const td = ref.fixtureId
    ? (await db.fixtures.findUnique({
      where: { id: ref.fixtureId },
      select: { tournament_disciplines: { select: { tournament_sports: { select: { sports: { select: { name: true } } } } } } },
    }))?.tournament_disciplines
    : ref.tournamentDisciplineId
      ? await db.tournament_disciplines.findUnique({
        where: { id: ref.tournamentDisciplineId },
        select: { tournament_sports: { select: { sports: { select: { name: true } } } } },
      })
      : null;
  return td?.tournament_sports?.sports?.name ?? null;
}

/** Refuse a half-point score outside chess. */
export async function assertScoreShape(
  db: Db,
  body: { home_score?: unknown; away_score?: unknown } | null | undefined,
  ref: { fixtureId?: string; tournamentDisciplineId?: string },
): Promise<void> {
  if (!hasHalfScore(body)) return;
  if (isChessSport(await sportOf(db, ref))) return;
  throw new BusinessRuleError('Half-point scores are only used in chess - enter whole numbers for this sport.');
}
