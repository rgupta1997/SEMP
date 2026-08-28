import type { Db } from '../../infra/prisma.js';

// Who runs a campus.
//
// The user chose `org_units.admin_user_id` as the answer: the "Administrator" named
// on the Edit Campus screen IS the campus administrator, and that column is what
// authorisation reads. Until now it was decorative - written by the admin screen,
// shown on the tile, and consulted by nothing - so the person named as running a
// campus could not even edit its own row.
//
// This is deliberately ONE function rather than a rule copied into each guard. A
// campus administrator's reach is narrow and specific, and the failure mode of
// getting it wrong is not an error message: it is somebody quietly able to pick
// players for a campus that is not theirs, which surfaces only as a result nobody
// can explain.
//
// Note what this is NOT: it is not `user_org_roles.scope_ref`. That column exists,
// is written by the role-assignment screen and is read by no authorisation code -
// a separate, real over-granting bug (a "Sports Admin, Bangalore only" grant
// currently reaches the whole organisation). Fixing that is a different change and
// must not be conflated with this one; a campus administrator here is exactly and
// only the person named on the campus.

/** Every campus and batch this person is named as administrator of, in one org. */
export async function administeredUnitIds(db: Db, userId: string, organizationId?: string): Promise<Set<string>> {
  const rows = await db.org_units.findMany({
    where: { admin_user_id: userId, ...(organizationId ? { organization_id: organizationId } : {}) },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Does this person administer this exact unit?
 *
 * Exact, not inherited. Administering a campus does NOT confer its batches and
 * administering a batch does not confer its campus. Inheritance would be a
 * defensible product decision, but it is not the one that was made, and quietly
 * adding it here would widen every guard below by a level.
 */
export async function isCampusAdmin(db: Db, userId: string, orgUnitId: string | null | undefined): Promise<boolean> {
  if (!orgUnitId) return false;
  const unit = await db.org_units.findFirst({
    where: { id: orgUnitId, admin_user_id: userId },
    select: { id: true },
  });
  return !!unit;
}

/**
 * Is this campus invited to this championship?
 *
 * The gate that makes "invited" mean something. An organiser names the campuses
 * taking part; without this check the invitation list would be a display of
 * intent that nothing enforced, and any campus of the host could enter itself.
 *
 * A declined or withdrawn invitation does not count. A pending one does: inside
 * one organisation there is nobody to negotiate with, so being asked IS being in,
 * and requiring an explicit accept would strand every campus whose administrator
 * has not logged in yet.
 */
export async function isUnitInvited(db: Db, championshipId: string, orgUnitId: string): Promise<boolean> {
  const inv = await db.championship_invitations.findFirst({
    where: {
      championship_id: championshipId,
      org_unit_id: orgUnitId,
      status: { in: ['pending', 'accepted'] },
    },
    select: { id: true },
  });
  return !!inv;
}
