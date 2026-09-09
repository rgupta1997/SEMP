import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

export interface UnitLike {
  id: string;
  name: string;
  // A plain string, not a 'campus' | 'department' union - org_units.type is an
  // untyped column at the Prisma level, and the caller already knows which one
  // this is by the time it gets here.
  type: string;
}

// Fired when a new CAMPUS (not a department) is created - the top-level unit an
// organisation runs. A department beneath one is not this trigger; there is
// nothing distinct to announce about it (see the registry's own note on why
// this is worded as an announcement, not an approval).
export async function notifyUnitCreated(
  prisma: Prisma, organizationId: string, unit: UnitLike, orgName: string | undefined, unitLabel: string, senderId: string,
): Promise<void> {
  if (unit.type !== 'campus') return;
  try {
    await notify(prisma, {
      type: 'campus_created',
      organizationId,
      senderId,
      data: { unitLabel, unitName: unit.name, organizationName: orgName ?? 'your organization' },
    });
  } catch (err) {
    console.error(`[org-units] campus_created notification failed for unit ${unit.id}:`, err);
  }
}

// Fired only when a NEW admin is actually being set - not on a creation with no
// admin named, and not on a PATCH that clears one or leaves it unchanged (no PDF
// trigger for a removal yet, and "assigned" would be the wrong word for either).
export async function notifyUnitAdminAssigned(
  prisma: Prisma,
  unit: UnitLike,
  newAdminUserId: string | null | undefined,
  previousAdminUserId: string | null | undefined,
  orgName: string | undefined,
  unitLabel: string,
  senderId: string,
): Promise<void> {
  if (!newAdminUserId || newAdminUserId === previousAdminUserId) return;
  try {
    await notify(prisma, {
      type: 'campus_admin_assigned',
      userId: newAdminUserId,
      senderId,
      data: { unitLabel, unitName: unit.name, organizationName: orgName ?? 'your organization' },
    });
  } catch (err) {
    console.error(`[org-units] campus_admin_assigned notification failed for unit ${unit.id}:`, err);
  }
}
