import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

export async function notifyOrganizationCreated(
  prisma: Prisma, organizationId: string, organizationName: string, actorId: string,
): Promise<void> {
  try {
    await notify(prisma, { type: 'organization_created', userId: actorId, senderId: actorId, data: { organizationName } });
  } catch (err) {
    console.error(`[organizations] organization_created notification failed for ${organizationId}:`, err);
  }
}

export async function notifyJoinRequested(
  prisma: Prisma, organizationId: string, organizationName: string, requesterId: string, who: string,
): Promise<void> {
  try {
    await notify(prisma, {
      type: 'org_join_request',
      organizationId,
      senderId: requesterId,
      data: { who, organizationName },
    });
  } catch (err) {
    console.error(`[organizations] org_join_request notification failed for org ${organizationId}:`, err);
  }
}

export async function notifyJoinApproved(
  prisma: Prisma, userId: string, organizationName: string, actorId: string,
): Promise<void> {
  try {
    await notify(prisma, { type: 'org_join_approved', userId, senderId: actorId, data: { organizationName } });
  } catch (err) {
    console.error(`[organizations] org_join_approved notification failed for user ${userId}:`, err);
  }
}

export async function notifyJoinDeclined(
  prisma: Prisma, userId: string, organizationName: string, actorId: string,
): Promise<void> {
  try {
    await notify(prisma, { type: 'org_join_declined', userId, senderId: actorId, data: { organizationName } });
  } catch (err) {
    console.error(`[organizations] org_join_declined notification failed for user ${userId}:`, err);
  }
}

// Which of a bulk-add's ids are genuinely NEW members. Re-adding an existing
// active member (e.g. to refresh their role, which this same bulk endpoint also
// serves) is not a new add and must not claim to be one - MUST be called before
// the upsert that follows replaces their row.
export async function newlyAddedMembers(
  prisma: Prisma, organizationId: string, userIds: string[],
): Promise<string[]> {
  const alreadyActive = new Set(
    (await prisma.organization_members.findMany({
      where: { organization_id: organizationId, user_id: { in: userIds }, status: 'active' },
      select: { user_id: true },
    })).map((m) => m.user_id),
  );
  return userIds.filter((id) => !alreadyActive.has(id));
}

// Best-effort. This is a direct add, not an invite - org_invite_sent/accepted are
// reserved for someone who had no account yet and later signs themselves in;
// this is the notification for the case that actually happens through the
// member picker's checkbox+Add, where an existing account is added instantly
// with no consent step. Each recipient gets its own try/catch: one person's
// notify() failing must not skip everyone queued after them in the same batch.
export async function notifyNewOrgMembers(
  prisma: Prisma, organizationId: string, newlyAddedIds: string[], actorId: string,
): Promise<void> {
  if (newlyAddedIds.length === 0) return;
  try {
    const org = await prisma.organizations.findUnique({ where: { id: organizationId }, select: { name: true } });
    for (const userId of newlyAddedIds) {
      try {
        await notify(prisma, {
          type: 'org_member_added',
          userId,
          senderId: actorId,
          data: { organizationName: org?.name ?? 'an organization' },
        });
      } catch (err) {
        console.error(`[organizations] org_member_added notification failed for user ${userId} in org ${organizationId}:`, err);
      }
    }
  } catch (err) {
    console.error(`[organizations] org_member_added notifications setup failed for org ${organizationId}:`, err);
  }
}
