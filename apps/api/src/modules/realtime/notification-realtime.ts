import type { NotificationRealtimePort } from '@semp/notifications/server/notify.js';
import { env } from '../../config/env.js';
import { buildFanoutMessages } from './message.js';
import { enqueueFanout, sqsSigner } from './enqueue.js';

/**
 * Carries a notification onto the realtime fan-out queue.
 *
 * The notifications package renders WHAT to say and resolves WHO should get it, then
 * stops; this is the piece that knows AppSync and SQS exist. Same division as
 * comms/notification-mail.ts, and the reason is the same: it keeps all ~60 notify()
 * call sites unaware that any of this happens.
 *
 * Registered once at boot by buildApp() - which is asserted by
 * http/server.ports.test.ts, because the mail port next door spent months imported
 * and never registered and nothing noticed.
 */
export const notificationRealtimePort: NotificationRealtimePort = {
  async publish({ notificationId, userIds, type }) {
    // Read at SEND time, not module load - the notification-mail.ts discipline. It
    // also means the transport can be off in development and in the test suite
    // without this module having to be absent.
    if (env.REALTIME_TRANSPORT !== 'appsync') return;

    const queueUrl = env.APPSYNC_NOTIFICATIONS_QUEUE_URL;
    if (!queueUrl) return; // env.schema.ts already refuses this combination in production

    const messages = buildFanoutMessages({ notificationId, type, recipientIds: userIds });
    if (messages.length === 0) return;

    const { failed } = await enqueueFanout(
      {
        signer: sqsSigner(process.env.AWS_REGION ?? 'ap-south-1'),
        fetchImpl: fetch,
        queueUrl,
        // Bounded, because this runs inside the HTTP request that triggered the
        // notification. An unbounded fetch would hold a user's response open behind
        // an SQS hiccup - and the notification row is already written, so there is
        // nothing to gain by waiting.
        timeoutMs: 2_000,
      },
      messages,
    );

    // SendMessageBatch answers 200 with a per-entry Failed list, so saying nothing
    // here would read as success. Exactly the concern notification-mail.ts records
    // about its own 202.
    if (failed.length > 0) {
      console.error(
        `[notifications] realtime enqueue rejected ${failed.length} of ${messages.length} ` +
          `batch entries for ${type} (${notificationId}):`,
        failed.slice(0, 3),
      );
    }
  },
};
