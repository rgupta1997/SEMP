import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

// Fired once a certificate is issued - only when it has a linked account
// (certificates.user_id is nullable: some are issued to a recipient_name with no
// platform account, and there is nobody to notify in that case).
export async function notifyCertificateGenerated(
  prisma: Prisma, certificateId: string, userId: string | null | undefined, title: string | null | undefined, senderId: string,
): Promise<void> {
  if (!userId) return;
  try {
    await notify(prisma, {
      type: 'certificate_generated',
      userId,
      senderId,
      data: { title },
    });
  } catch (err) {
    console.error(`[certificates] certificate_generated notification failed for ${certificateId}:`, err);
  }
}

// Fired on POST /certificates/:certId/revoke - a recipient holding a document that
// is no longer valid needs to know, same as the issuer's audit trail does. Only
// when the certificate has a linked account (same nullability as above).
export async function notifyCertificateRevoked(
  prisma: Prisma,
  certificateId: string,
  userId: string | null | undefined,
  championshipId: string | null | undefined,
  title: string | undefined,
  serial: string | undefined,
  reason: string,
  senderId: string,
): Promise<void> {
  if (!userId) return;
  try {
    await notify(prisma, {
      type: 'certificate_validation_issue',
      championshipId: championshipId ?? undefined,
      userId,
      senderId,
      data: { title, serial, reason },
    });
  } catch (err) {
    console.error(`[certificates] certificate_validation_issue notification failed for ${certificateId}:`, err);
  }
}
