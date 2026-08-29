import { Prisma as PrismaNS } from '@prisma/client';
import { seasonOf, seasonStartMonthOf, type SeasonStartMonth } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { NotFoundError } from '../../shared/errors.js';

// Who counts as having taken part for an organisation, and in which season.
//
// This lives on its own because two very different surfaces need the same answer:
// the leadership report, which an institution takes to a board, and the
// organisation dashboard, which it looks at over coffee. If those two ever
// disagreed about how many people played last year, neither would be believed
// again - so there is one definition, here.

export interface OrgScope {
  org: { name: string; settings: unknown };
  startMonth: SeasonStartMonth;
  champs: Array<{ id: string; name: string; start_date: Date; status: string }>;
  bySeason: Map<number, string[]>;
  allIds: string[];
}

/** The championships this institution ran or entered, grouped into its seasons. */
export async function orgScope(db: Db, organizationId: string): Promise<OrgScope> {
  const org = await db.organizations.findUnique({
    where: { id: organizationId }, select: { settings: true, name: true },
  });
  if (!org) throw new NotFoundError('Organisation');
  const startMonth = seasonStartMonthOf(org.settings);

  const [hosted, entered] = await Promise.all([
    // Hosting is a column on the event now, so this no longer has to guess from
    // which organisation an organiser happens to belong to.
    db.championships.findMany({ where: { host_organization_id: organizationId }, select: { id: true } }),
    db.championship_organizations.findMany({
      where: { organization_id: organizationId, status: 'approved' }, select: { championship_id: true },
    }),
  ]);
  const ids = [...new Set([...hosted.map((h) => h.id), ...entered.map((e) => e.championship_id)])];
  const champs = ids.length
    ? await db.championships.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, start_date: true, status: true },
    })
    : [];

  const bySeason = new Map<number, string[]>();
  for (const c of champs) {
    const s = seasonOf(c.start_date, startMonth);
    bySeason.set(s, [...(bySeason.get(s) ?? []), c.id]);
  }
  return { org, startMonth, champs, bySeason, allIds: ids };
}

/** Season to report on: the one asked for, else the most recent with anything in it. */
export function pickSeason(asked: unknown, bySeason: Map<number, string[]>, startMonth: SeasonStartMonth): number {
  const n = Number(asked);
  if (Number.isInteger(n)) return n;
  const seasons = [...bySeason.keys()].sort((a, b) => b - a);
  return seasons[0] ?? seasonOf(new Date(), startMonth);
}

/**
 * Unique people who actually took part for this institution in a set of
 * championships. Counted once each however many sports they played (J5-E1-S3).
 */
export async function participantsIn(
  db: Db, organizationId: string, champIds: string[],
): Promise<Array<{ user_id: string; sport: string; org_unit_id: string | null }>> {
  if (!champIds.length) return [];
  // One row per (person, sport, UNIT they belong to).
  //
  // Somebody in a campus and a department appears twice, which is deliberate: units
  // are counted independently, so a person shows up in every unit they belong to.
  // Callers counting unique PEOPLE already dedupe through a Set, so the extra rows
  // cost them nothing; callers grouping by unit get the intended behaviour without
  // a second query.
  //
  // The left join keeps people with no placement at all - they are real
  // participants and dropping them would quietly shrink the headline number.
  return db.$queryRaw(PrismaNS.sql`
    select distinct tm.user_id, s.name as sport, oum.org_unit_id
      from team_entries te
      join tournament_disciplines td on td.id = te.tournament_discipline_id
      join tournament_sports ts on ts.id = td.tournament_sport_id
      join sports s on s.id = ts.sport_id
      join team_members tm on tm.team_id = te.team_id
      left join org_unit_members oum
             on oum.user_id = tm.user_id and oum.organization_id = ${organizationId}::uuid
     where te.organization_id = ${organizationId}::uuid
       and te.championship_id in (${PrismaNS.join(champIds.map((id) => PrismaNS.sql`${id}::uuid`))})`);
}
