import { notificationChannelPath } from '@semp/notifications/core/channels.js';

/**
 * The SQS contract between the API and the publisher Lambda.
 *
 * ONE definition, imported by both sides. They are separately-deployed functions
 * built from the same repository, so nothing at runtime would notice if their idea
 * of this shape diverged - the publisher would simply read `undefined` and publish
 * nothing, successfully. A shared module makes that a compile error instead.
 */

/** Bumped when the shape changes incompatibly. See the poison-message note below. */
export const REALTIME_MESSAGE_VERSION = 1;

/**
 * What the browser receives. A PING, deliberately carrying no message content.
 *
 * This is the most consequential choice in the realtime design, and it is not about
 * the 240 KB event limit. The publisher has no database access and so cannot
 * re-check who may see a notification; whatever resolveUserIds() decided at write
 * time is what ships, with no second opinion. Meanwhile GET /notifications
 * re-evaluates visibility live on every fetch, and audience membership legitimately
 * changes after a notification is created.
 *
 * So with an id-only ping, a mis-resolved audience costs a spurious badge increment
 * that corrects itself on the next fetch. With title and body on the wire, the same
 * bug renders another championship's message in someone's drawer. One is a glitch,
 * the other is a disclosure. The feed stays the single authoritative renderer.
 */
export interface NotificationPing {
  v: typeof REALTIME_MESSAGE_VERSION;
  kind: 'notification';
  notificationId: string;
  /** The registry key, so a client could route on it without another fetch. */
  type: string;
}

/** One SQS message: a slice of one notification's recipients, plus the ping. */
export interface RealtimeFanoutMessage {
  v: typeof REALTIME_MESSAGE_VERSION;
  notificationId: string;
  userIds: string[];
  event: NotificationPing;
}

/**
 * Recipients per SQS message.
 *
 * Bounded by two limits pulling in opposite directions. SQS caps a message at 256 KB
 * and a SendMessageBatch at 256 KB in total; 200 UUIDs is roughly 7.4 KB, so ten of
 * them in one batch is ~74 KB - a comfortable 3x margin.
 *
 * The lower bound is retry blast radius. A message is the unit SQS redelivers, so if
 * 3 of these recipients fail, all 200 are published again. That is safe only because
 * the ping is idempotent (a duplicate causes a redundant refetch and nothing else),
 * and it is why this is 200 rather than 2000.
 */
export const RECIPIENTS_PER_MESSAGE = 200;

/** SendMessageBatch's own hard limit. */
export const SQS_BATCH_SIZE = 10;

export function buildFanoutMessages(input: {
  notificationId: string;
  type: string;
  recipientIds: readonly string[];
}): RealtimeFanoutMessage[] {
  const event: NotificationPing = {
    v: REALTIME_MESSAGE_VERSION,
    kind: 'notification',
    notificationId: input.notificationId,
    type: input.type,
  };

  const messages: RealtimeFanoutMessage[] = [];
  for (let i = 0; i < input.recipientIds.length; i += RECIPIENTS_PER_MESSAGE) {
    messages.push({
      v: REALTIME_MESSAGE_VERSION,
      notificationId: input.notificationId,
      userIds: input.recipientIds.slice(i, i + RECIPIENTS_PER_MESSAGE),
      event,
    });
  }
  return messages;
}

/**
 * Parses a message body the publisher received.
 *
 * Returns null for anything this code cannot handle, including a future version.
 * The caller treats that as a POISON message and succeeds rather than retrying: a
 * message no version of this function will ever understand gains nothing from five
 * more attempts, and cycling it to the DLQ only delays noticing.
 */
export function parseFanoutMessage(body: string): RealtimeFanoutMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const m = parsed as Partial<RealtimeFanoutMessage>;
  if (!m || m.v !== REALTIME_MESSAGE_VERSION) return null;
  if (typeof m.notificationId !== 'string' || !m.notificationId) return null;
  if (!Array.isArray(m.userIds)) return null;
  if (!m.event || m.event.kind !== 'notification') return null;

  return m as RealtimeFanoutMessage;
}

/**
 * The publish request body for one recipient.
 *
 * `events` is an array of JSON-encoded STRINGS, not objects - AppSync Events rejects
 * the latter, and the mistake reads as a generic 400.
 *
 * One channel per request: AppSync allows 5 events per publish but they must all go
 * to the SAME channel, and per-user channels mean one event each. So the 5-event
 * batch limit buys nothing here, and N recipients really is N HTTP requests. That is
 * the whole reason this path is asynchronous rather than inline in notify().
 */
export function buildPublishBody(userId: string, event: NotificationPing): string {
  return JSON.stringify({
    channel: notificationChannelPath(userId),
    events: [JSON.stringify(event)],
  });
}
