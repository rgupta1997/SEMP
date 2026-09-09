import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules } from '@semp/notifications/core/rules.js';

// A lifecycle status transition (registration_open/ongoing/completed) - uses
// event_lifecycle's default audience (POC + captains of already-approved orgs).
export async function notifyStatusChanged(
  prisma: Prisma, championshipId: string, status: string, senderId: string,
): Promise<void> {
  try {
    await notify(prisma, {
      type: 'event_lifecycle',
      championshipId,
      senderId,
      data: { status },
    });
  } catch (err) {
    console.error(`[championships] event_lifecycle notify failed for ${championshipId}:`, err);
  }
}

// Fired only on a private -> public flip. Explicit audience, NOT event_lifecycle's
// default (poc/captain of already-approved orgs) - per the PDF, "Event
// published"'s recipient is the organiser, not the participants. Scoped to just
// this one trigger; status transitions above keep the default audience.
export async function notifyChampionshipPublished(
  prisma: Prisma, championshipId: string, senderId: string,
): Promise<void> {
  try {
    await notify(prisma, {
      type: 'event_lifecycle',
      championshipId,
      audience: Rules.role('organiser', championshipId),
      senderId,
      data: { visibility: 'public' },
    });
  } catch (err) {
    console.error(`[championships] event_lifecycle (visibility) notify failed for ${championshipId}:`, err);
  }
}
