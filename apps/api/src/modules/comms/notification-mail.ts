import type { NotificationMailPort } from '@semp/notifications/server/notify.js';
import { env } from '../../config/env.js';
import { notificationMailData } from './email.js';
import { sendMailBatch, type MailRequest } from './mail-client.js';

// Carries a notification into the mail service.
//
// The notifications package renders WHAT to say and stops there; this is the piece
// that knows a mail service exists and where the web app lives. Registered once at
// boot (see server.ts), which is what keeps all twelve notify() call sites unaware
// that any of this happens.

export const notificationMailPort: NotificationMailPort = {
  async send({ recipients, content, idempotencyPrefix, priority, type }) {
    // One message per recipient, never one message with everybody in `to`. A
    // championship-wide notification would otherwise hand every recipient a list of
    // every other recipient's address.
    const messages: MailRequest[] = recipients.map((r) => ({
      to: r.email,
      template: 'generic-notification',
      data: notificationMailData({
        subject: content.subject,
        paragraphs: content.paragraphs,
        details: content.details,
        // The registry deals in app-relative paths; only this layer knows the origin.
        ctaUrl: content.ctaPath ? `${env.WEB_APP_URL}${content.ctaPath}` : null,
        ctaLabel: content.ctaLabel,
      }),
      priority,
      // Per-recipient, so one person's retry cannot suppress another's mail.
      idempotencyKey: `${idempotencyPrefix}-${r.userId}`,
      metadata: { kind: 'notification', notificationType: type, userId: r.userId },
    }));

    // Chunking past the 500-per-batch cap is handled inside sendMailBatch.
    const { rejected } = await sendMailBatch(messages);

    // A 202 does not mean every message was accepted - individual messages can be
    // rejected without failing the batch, and silence here would read as success.
    if (rejected.length > 0) {
      console.error(`[notifications] mail service rejected ${rejected.length} of ${messages.length} for ${type}:`, rejected.slice(0, 3));
    }
  },
};
