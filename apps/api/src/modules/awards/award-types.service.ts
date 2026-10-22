import type { AwardLevel, AwardRecipientKind } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { ValidationError } from '../../shared/errors.js';

// The award catalogue: which award types exist, which sports they are offered for,
// at which levels, and whether they go to a player or a team.
//
//   - Global types (championship_id null) are the super admin's list.
//   - An organiser's extras carry their championship_id and exist only in that event.
//   - all_sports = true offers a type for every sport, including sports added later;
//     otherwise award_type_sports lists the sports it is mapped to.

export interface AwardTypeRow {
  id: string;
  code: string;
  label: string;
  description: string | null;
  levels: string[];
  recipient_kind: string;
  all_sports: boolean;
  is_active: boolean;
  sort_order: number;
  championship_id: string | null;
  award_type_sports: Array<{ sport_id: string; sports?: { name: string } | null }>;
}

/** Where an award is being given. sportId is null for a tournament or championship
 *  award that is not tied to one sport. */
export interface AwardContext {
  level?: AwardLevel;
  sportId?: string | null;
  /** For a tournament or event award: the sports in that scope. A type is offered
   *  when it is all-sports or mapped to at least one of them. */
  sportIds?: string[];
  championshipId?: string | null;
}

export const awardTypeInclude = {
  award_type_sports: { select: { sport_id: true, sports: { select: { name: true } } } },
} as const;

export function awardTypeView(t: AwardTypeRow) {
  return {
    id: t.id,
    code: t.code,
    label: t.label,
    description: t.description,
    levels: t.levels as AwardLevel[],
    recipient_kind: t.recipient_kind as AwardRecipientKind,
    all_sports: t.all_sports,
    is_active: t.is_active,
    sort_order: t.sort_order,
    championship_id: t.championship_id,
    sport_ids: t.award_type_sports.map((s) => s.sport_id),
    sports: t.award_type_sports
      .map((s) => ({ id: s.sport_id, name: s.sports?.name ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
export type AwardTypeView = ReturnType<typeof awardTypeView>;

/** Why a type can't be given in this context, or null when it can. Pure, so the
 *  rule is tested without a database. */
export function whyNotOffered(t: Pick<AwardTypeRow, 'is_active' | 'levels' | 'all_sports' | 'championship_id'> & { sport_ids: string[] }, ctx: AwardContext): string | null {
  if (!t.is_active) return 'is no longer offered';
  if (ctx.level && !t.levels.includes(ctx.level)) return `is not given at ${ctx.level.replace('_', ' ')} level`;
  if (t.championship_id && t.championship_id !== ctx.championshipId) return 'belongs to another event';
  if (ctx.sportId && !t.all_sports && !t.sport_ids.includes(ctx.sportId)) return 'is not offered for this sport';
  if (ctx.sportIds && !t.all_sports && !t.sport_ids.some((id) => ctx.sportIds!.includes(id))) return 'is not offered for any sport here';
  return null;
}

/** The types an official or organiser can pick from in this context. */
export async function allowedAwardTypes(db: Db, ctx: AwardContext): Promise<AwardTypeView[]> {
  const rows = await db.award_types.findMany({
    where: {
      is_active: true,
      ...(ctx.level ? { levels: { has: ctx.level } } : {}),
      OR: [{ championship_id: null }, ...(ctx.championshipId ? [{ championship_id: ctx.championshipId }] : [])],
      ...(ctx.sportId || ctx.sportIds
        ? { AND: [{ OR: [{ all_sports: true }, { award_type_sports: { some: { sport_id: ctx.sportId ? ctx.sportId : { in: ctx.sportIds } } } }] }] }
        : {}),
    },
    include: awardTypeInclude,
    orderBy: [{ sort_order: 'asc' }, { label: 'asc' }],
  });
  return rows.map(awardTypeView);
}

/** Loads a type and throws a 422 when it can't be given in this context. */
export async function assertAwardTypeAllowed(db: Db, typeId: string, ctx: AwardContext): Promise<AwardTypeView> {
  const row = await db.award_types.findUnique({ where: { id: typeId }, include: awardTypeInclude });
  if (!row) throw new ValidationError('Unknown award type');
  const view = awardTypeView(row);
  const why = whyNotOffered(view, ctx);
  if (why) throw new ValidationError(`"${view.label}" ${why}`);
  return view;
}

/** Replace a type's sport mapping. all_sports clears the explicit list. */
export async function setAwardTypeSports(db: Db, typeId: string, allSports: boolean, sportIds: string[]): Promise<void> {
  const ids = allSports ? [] : [...new Set(sportIds)];
  if (ids.length) {
    const found = await db.sports.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new ValidationError('One or more sports do not exist');
  }
  await db.award_types.update({ where: { id: typeId }, data: { all_sports: allSports, updated_at: new Date() } });
  await db.award_type_sports.deleteMany({ where: { award_type_id: typeId, ...(ids.length ? { sport_id: { notIn: ids } } : {}) } });
  if (ids.length) {
    await db.award_type_sports.createMany({
      data: ids.map((sport_id) => ({ award_type_id: typeId, sport_id })),
      skipDuplicates: true,
    });
  }
}

/** How many awards have been given with this type (match + higher levels). */
export async function awardTypeUsage(db: Db, typeId: string): Promise<number> {
  const [m, c] = await Promise.all([
    db.fixture_awards.count({ where: { award_type_id: typeId } }),
    db.championship_awards.count({ where: { award_type_id: typeId } }),
  ]);
  return m + c;
}

/** Global catalogue ids by code, for code that gives awards itself (seeders). */
export async function catalogAwardTypeIds(db: Db, codes: string[]): Promise<Map<string, string>> {
  const rows = await db.award_types.findMany({ where: { code: { in: codes }, championship_id: null }, select: { id: true, code: true } });
  return new Map(rows.map((r) => [r.code, r.id]));
}
