import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

// Fired when an organisation applies to a championship: a confirmation to the
// applicant, and a queue ping to the organiser. Both best-effort together - the
// application itself already committed by the time this runs.
export async function notifyApplicationReceived(
  prisma: Prisma, championshipId: string, championshipName: string | undefined, applicantUserId: string,
  applicantOrgLabel: string | undefined, actorId: string,
): Promise<void> {
  try {
    await notify(prisma, {
      type: 'registration_submitted',
      championshipId,
      userId: applicantUserId,
      senderId: actorId,
      data: { championshipName },
    });
    await notify(prisma, {
      type: 'participant_approval_pending',
      championshipId,
      senderId: actorId,
      data: { orgName: applicantOrgLabel, championshipName },
    });
  } catch (err) {
    console.error(`[enrollment] registration notifications failed for championship ${championshipId}:`, err);
  }
}

export interface ApprovedEnrollment {
  id: string;
  championship_id: string;
  organization_id: string;
  organizations?: { name: string | null; short_name: string | null } | null;
  championships?: { name: string | null } | null;
}

// An approval is announced to everyone in the championship (enrollment_approved -
// news for the room), AND separately confirmed directly to the applicant org
// (registration_approved - a decision notice for the org that was actually
// waiting on it). Each gets its own try/catch: the broadcast failing must not
// also take down the applicant's own confirmation, or vice versa.
export async function notifyEnrollmentApproved(prisma: Prisma, enrollment: ApprovedEnrollment, actorId: string): Promise<void> {
  const orgName = enrollment.organizations?.short_name || enrollment.organizations?.name || 'An organization';
  try {
    await notify(prisma, {
      type: 'enrollment_approved',
      championshipId: enrollment.championship_id,
      senderId: actorId,
      data: {
        orgName,
        bodyOrgName: enrollment.organizations?.name ?? orgName,
        championshipName: enrollment.championships?.name,
      },
    });
  } catch (err) {
    console.error(`[enrollment] enrollment_approved notification failed for ${enrollment.id}:`, err);
  }

  try {
    await notify(prisma, {
      type: 'registration_approved',
      organizationId: enrollment.organization_id,
      senderId: actorId,
      data: { championshipName: enrollment.championships?.name },
    });
  } catch (err) {
    console.error(`[enrollment] registration_approved notification failed for ${enrollment.id}:`, err);
  }
}

export async function notifyRegistrationRejected(
  prisma: Prisma, organizationId: string, championshipName: string | undefined, reason: string | null, enrollmentId: string, actorId: string,
): Promise<void> {
  try {
    await notify(prisma, {
      type: 'registration_rejected',
      organizationId,
      senderId: actorId,
      data: { reason, championshipName },
    });
  } catch (err) {
    console.error(`[enrollment] registration_rejected notification failed for ${enrollmentId}:`, err);
  }
}
