import { ROLE_CODES, roleWhereByCode } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { can } from '../../http/middleware/can.js';

// Who manages a championship.
//
// Two answers, and until now only the first one counted:
//
//   1. an Organiser role row on the event itself, and
//   2. the senior staff of the institution HOSTING it.
//
// The second is the normal case for an institution's own event. Somebody has to
// be named Organiser for the event to be manageable at all, which meant the
// owner of the institution putting the event on had no authority over it unless
// they had also remembered to add themselves to its organising team - and an
// Organiser who leaves takes the event with them.
//
// It is answered by the permission engine rather than by a list of role codes, so
// WHICH of an institution's roles carries it is decided on that institution's
// Roles & Permissions screen. `event.manage` is the switch; Owner, Org Admin and
// Sports Admin hold it by default, and an institution can grant it to a role it
// defined itself or take it away from one of those three.

/** Does this person manage the institution HOSTING this championship? */
export async function hostOrgManages(prisma: Prisma, userId: string, championshipId: string): Promise<boolean> {
  const champ = await prisma.championships.findUnique({
    where: { id: championshipId },
    select: { host_organization_id: true },
  });
  // An individual can host without an institution behind them. There is no host
  // org to inherit authority from, so the Organiser row is the only answer.
  if (!champ?.host_organization_id) return false;
  return can(prisma, 'event.manage', {
    user: { id: userId },
    scope: { organizationId: champ.host_organization_id },
  });
}

/**
 * Every championship this person manages, by either route.
 *
 * Assembled once and handed to the client on the auth context, because the client
 * was deciding this for itself - by role NAME, against a table with a rename
 * screen - and could only ever see the first of the two routes.
 */
export async function managedChampionshipIds(prisma: Prisma, userId: string): Promise<string[]> {
  const [organiserRows, memberships] = await Promise.all([
    prisma.user_championship_roles.findMany({
      // By code, with the same null-code name fallback every other organiser
      // lookup uses - matching the display name is how renaming a role revokes it.
      where: { user_id: userId, roles: roleWhereByCode(ROLE_CODES.organiser) },
      select: { championship_id: true },
    }),
    prisma.organization_members.findMany({
      where: { user_id: userId, status: 'active' },
      select: { organization_id: true },
    }),
  ]);

  const ids = new Set(organiserRows.map((r) => r.championship_id));

  // Which of this person's institutions they may run events for. Asked per
  // institution rather than in one query because the answer includes roles that
  // institution defined itself, which only the engine knows how to resolve.
  const managed = await Promise.all(
    memberships.map(async (m) =>
      (await can(prisma, 'event.manage', { user: { id: userId }, scope: { organizationId: m.organization_id } }))
        ? m.organization_id
        : null),
  );
  const orgIds = managed.filter(Boolean) as string[];

  if (orgIds.length) {
    const hosted = await prisma.championships.findMany({
      where: { host_organization_id: { in: orgIds } },
      select: { id: true },
    });
    for (const c of hosted) ids.add(c.id);
  }
  return [...ids];
}
