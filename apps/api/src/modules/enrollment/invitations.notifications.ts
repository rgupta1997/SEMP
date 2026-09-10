import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

// Fired when a host invites an organisation to compete in their championship -
// the "open championship" branch of POST /championships/:eventId/invitations.
// The internal "invite our own campus" branch fires contingent_added instead
// (see invitations.routes.ts), since there is nobody outside the host
// institution to tell in that case.
export async function notifyInvitationSent(
  prisma: Prisma, championshipId: string, invitedOrganizationId: string, actorId: string,
): Promise<void> {
  try {
    const championship = await prisma.championships.findUnique({
      where: { id: championshipId },
      select: { name: true, host_organization_id: true },
    });
    const host = championship?.host_organization_id
      ? await prisma.organizations.findUnique({
        where: { id: championship.host_organization_id },
        select: { name: true, short_name: true },
      })
      : null;

    await notify(prisma, {
      type: 'championship_invitation_sent',
      organizationId: invitedOrganizationId,
      championshipId,
      senderId: actorId,
      data: {
        championshipName: championship?.name,
        hostName: host?.short_name || host?.name,
      },
    });
  } catch (err) {
    console.error(`[invitations] championship_invitation_sent notification failed for org ${invitedOrganizationId}:`, err);
  }
}
