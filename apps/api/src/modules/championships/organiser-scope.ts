import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, ForbiddenError } from '../../shared/errors.js';
import type { Guards } from '../../http/middleware/permissions.js';

// Who may hand out which sports on an organising team.
//
// An Organiser row carries `sport_ids` - empty is the overall organiser, a list
// limits the row to those sports. Two rules, both the user's:
//
//   * an overall organiser may give any scope, "all sports" included;
//   * a sport organiser may add, edit and remove organisers for THEIR sports only -
//     never "all sports", never a sport they do not run, and never somebody whose
//     current scope reaches beyond theirs.

/**
 * Any Organiser role - the platform row OR an institution's own copy of it.
 *
 * Not `roleWhereByCode`, which matches the platform row only. Roles are owned, and
 * an institution's override of "organiser" is what its events' organisers actually
 * hold (the QA bench is built that way), so a sport scope has to be read off it too.
 */
export const ANY_ORGANISER_ROLE = {
  OR: [{ code: 'organiser' }, { code: null, name: 'Organiser' }],
};

/** The catalogue sports this championship actually runs, across its tournaments. */
export async function championshipSportIds(prisma: Prisma, championshipId: string): Promise<Set<string>> {
  const rows = await prisma.tournament_sports.findMany({
    where: { tournaments: { championship_id: championshipId } },
    select: { sport_id: true },
  });
  return new Set(rows.map((r) => r.sport_id));
}

/** May this person hand out (or take back) an organiser scope of `sportIds`? Throws if not. */
export async function assertMayGrantSports(
  prisma: Prisma,
  guards: Guards,
  actor: { id: string; isSuperAdmin?: boolean },
  championshipId: string,
  sportIds: string[],
  // Off when judging a scope that already exists: a sport since dropped from the
  // event must not stop anybody removing or re-scoping the row that names it.
  opts: { newScope?: boolean } = {},
): Promise<void> {
  if ((opts.newScope ?? true) && sportIds.length > 0) {
    const offered = await championshipSportIds(prisma, championshipId);
    if (sportIds.some((id) => !offered.has(id))) {
      throw new BusinessRuleError('Pick sports that are part of this championship.');
    }
  }
  if (actor.isSuperAdmin) return;
  const scope = await guards.eventScope(actor.id, championshipId);
  if (scope === 'all') return;
  if (!scope) throw new ForbiddenError('You do not manage this championship');
  if (sportIds.length === 0) {
    throw new ForbiddenError('Only an overall organiser can add an organiser for all sports.');
  }
  if (sportIds.some((id) => !scope.includes(id))) {
    throw new ForbiddenError('You can only add organisers for the sports you organise.');
  }
}

/**
 * The scope an existing row ends up with when somebody is added again.
 *
 * Never narrows: an overall organiser re-added for Football stays overall, and a
 * Football organiser added for Cricket now runs both.
 */
export function mergeSportScope(existing: string[] | null | undefined, added: string[]): string[] {
  if (!existing) return added;
  if (existing.length === 0 || added.length === 0) return [];
  return [...new Set([...existing, ...added])];
}
