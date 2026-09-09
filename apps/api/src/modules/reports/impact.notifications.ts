import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

// Fired when an Annual Sports Impact Report job finishes successfully - the
// requester is told instead of having to keep polling GET /report-jobs/:jobId.
// Notifies on success only, not on a failed job (there is no call site for that).
export async function notifyReportGenerated(
  prisma: Prisma, jobId: string, requestedBy: string | null | undefined, seasonLabel: string, organizationId: string,
): Promise<void> {
  if (!requestedBy) return;
  try {
    await notify(prisma, {
      type: 'event_report_generated',
      organizationId,
      userId: requestedBy,
      senderId: null,
      data: { label: 'Sports Impact', seasonLabel },
    });
  } catch (err) {
    console.error(`[reports] event_report_generated notification failed for job ${jobId}:`, err);
  }
}
