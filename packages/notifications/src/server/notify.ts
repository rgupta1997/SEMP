import {
  NOTIFICATION_TYPES,
  type NotificationTypeDef,
  type NotificationTypeKey,
  type NotificationEmailContent,
  type RuleContext,
} from '../core/registry.js';
import type { AudienceRule } from '../core/rules.js';
import {
  resolveUserIds,
  type NotificationPrisma as RecipientResolverPrisma,
} from './resolve-user-ids.js';

/**
 * How a notification reaches an inbox.
 *
 * An interface rather than a direct call, because this package must not know that a
 * mail service exists - it renders the message and hands it over, exactly as the API
 * layer does. `setNotificationPorts` wires the real one at boot.
 */
export interface NotificationMailPort {
  send(input: {
    /**
     * One entry per recipient, and the transport must send one MESSAGE per entry.
     * Putting them all on a single `to` would show every recipient the full list -
     * which for a championship-wide notification is a roster of email addresses
     * handed to everybody on it.
     */
    recipients: Array<{ userId: string; email: string }>;
    content: NotificationEmailContent;
    /** Per-recipient keys are derived from this and the user id. */
    idempotencyPrefix: string;
    priority: number;
    type: string;
  }): Promise<void>;
}


/**
 * How a notification reaches an already-open browser tab.
 *
 * The second transport, and an interface for the same reason as the mail port: this
 * package must not know whether live delivery is a database's replication stream, a
 * hosted pub/sub service or nothing at all. It hands over a set of user ids and
 * stops.
 *
 * The payload is deliberately nothing but the recipient list. Clients treat the
 * event as a PING and re-fetch, so the feed's own visibility check stays the single
 * place audience rules are enforced - putting notification content on the wire would
 * mean re-deriving that rule inside a transport that has no business knowing it.
 */
export interface NotificationRealtimePort {
  /**
   * Fan out one notification to its recipients.
   *
   * Must not throw - see the call site in notify() for why - and must not block on
   * the fan-out itself: a championship-wide notification can resolve to thousands of
   * recipients, which is a queue's problem, not a request's.
   */
  publish(input: {
    notificationId: string;
    userIds: string[];
    type: string;
  }): Promise<void>;
}

/**
 * Every channel a notification can travel down.
 *
 * ONE object with REQUIRED keys, rather than a setter per transport, and that is the
 * whole point. The mail port shipped unregistered for the entire life of the feature
 * - server.ts imported it and never called it - and nothing caught it because an
 * unregistered port is a deliberate silent no-op. Two independent optional setters
 * are a design that makes that mistake once per transport.
 *
 * With required keys, adding a third channel is a COMPILE ERROR at the single
 * registration site instead of an omission nobody notices for months. The values
 * stay nullable because "no live transport" is legitimate - local dev and the test
 * suite both run that way, and the bell falls back to its poll.
 */
export interface NotificationPorts {
  mail: NotificationMailPort | null;
  realtime: NotificationRealtimePort | null;
}

let ports: NotificationPorts = { mail: null, realtime: null };

/**
 * Registered once at server boot - see buildApp() in apps/api/src/http/server.ts,
 * the single composition root both the Render and Lambda entry points go through.
 *
 * Module-level rather than an argument on notify() on purpose: there are ~60 call
 * sites, none of which have any business knowing that email or a websocket exists,
 * and threading transports through all of them would put them back in exactly the
 * places this package exists to keep them out of.
 */
export function setNotificationPorts(next: NotificationPorts | null): void {
  ports = next ?? { mail: null, realtime: null };
}

/**
 * Reads back what boot registered.
 *
 * Exists so the registration is OBSERVABLE, which is the one property the mail-port
 * bug proved it needs: a port you cannot read back is a port no test can prove was
 * wired. server.ports.test.ts is the only consumer.
 */
export function getNotificationPorts(): Readonly<NotificationPorts> {
  return ports;
}

export interface NotificationPrisma extends RecipientResolverPrisma {
  users: {
    findMany(args: {
      where: { id: { in: string[] }; is_active?: boolean };
      select: { id: true; email: true; email_verified_at: true };
    }): Promise<Array<{ id: string; email: string | null; email_verified_at: Date | null }>>;
  };
  notifications: {
    create(args: {
      data: {
        championship_id?: string | null;
        organization_id?: string | null;
        target_user_id?: string | null;
        sender_id?: string | null;
        type: string;
        audience: AudienceRule;
        title: string;
        body?: string | null;
      };
    }): Promise<{ id: string }>;
  };
  notification_deliveries: {
    createMany(args: {
      data: Array<{
        notification_id: string;
        user_id: string;
      }>;
      skipDuplicates: boolean;
    }): Promise<unknown>;
  };
}

export interface NotifyInput {
  // A registry key, not a bare string - an unregistered type is now a compile
  // error at the call site instead of a runtime failure discovered by testing
  // (see the check-constraint migration this replaced for exactly that story).
  type: NotificationTypeKey;
  championshipId?: string;
  organizationId?: string;
  teamId?: string;
  userId?: string;
  audience?: AudienceRule;
  data?: Record<string, unknown>;
  senderId?: string | null;
}

export async function notify(
  prisma: NotificationPrisma,
  input: NotifyInput,
) {
  // Widened to the common interface: `NOTIFICATION_TYPES[input.type]`, indexed
  // by the full key union, otherwise infers a union of each entry's OWN
  // literal shape - and TypeScript won't let you read an optional property
  // (bodyTemplate) that's simply absent from some of those literals, even
  // behind a truthy check. `satisfies` already proved every entry fits
  // NotificationTypeDef, so this is a safe, not an unchecked, widening.
  const definition: NotificationTypeDef = NOTIFICATION_TYPES[input.type];

  if (!definition) {
    throw new Error(`Unknown notification type: ${input.type}`);
  }

  const context: RuleContext = {
    championshipId: input.championshipId,
    organizationId: input.organizationId,
    teamId: input.teamId,
    userId: input.userId,
  };

  const audience = input.audience ?? definition.defaultAudience(context);

  const data = input.data ?? {};

  const title = definition.titleTemplate(data);
  const body = definition.bodyTemplate
    ? definition.bodyTemplate(data)
    : null;

  const notification = await prisma.notifications.create({
    data: {
      championship_id: input.championshipId ?? null,
      organization_id: input.organizationId ?? null,
      target_user_id:
        audience.kind === 'direct_user' ? audience.userId : null,
      sender_id: input.senderId ?? null,
      type: definition.key,
      audience,
      title,
      body,
    },
  });

  // Realtime is delivered from per-user rows, never from the global
  // notifications table. The feed still performs its normal visibility check.
  const recipientIds = await resolveUserIds(prisma, audience);

  if (recipientIds.size > 0) {
    await prisma.notification_deliveries.createMany({
      data: [...recipientIds].map((user_id) => ({
        notification_id: notification.id,
        user_id,
      })),
      skipDuplicates: true,
    });
  }

  await publishRealtime(input.type, notification.id, recipientIds);

  await emailRecipients(prisma, input.type, notification.id, recipientIds, data, context);

  return notification;
}

/**
 * The live-delivery half.
 *
 * Never throws, for exactly the reason emailRecipients() never throws: the feed row
 * is already written and is the primary channel. A transport having a bad afternoon
 * must not turn "your fixture moved" into a failed request for the organiser who
 * moved it - they would see an error, retry, and produce a second notification.
 *
 * Reuses the recipient set notify() already resolved rather than re-deriving it. The
 * audience rule is evaluated once per notification, here and for the delivery rows,
 * so the two can never disagree about who was meant to receive this.
 */
async function publishRealtime(
  type: string,
  notificationId: string,
  recipientIds: Set<string>,
): Promise<void> {
  const port = ports.realtime;
  if (!port || recipientIds.size === 0) return;

  try {
    await port.publish({
      notificationId,
      userIds: [...recipientIds],
      type,
    });
  } catch (err) {
    console.error(`[notifications] realtime fan-out failed for ${type} (${notificationId}):`, err);
  }
}

/**
 * The email half, for the types that opt in.
 *
 * Never throws. The feed row is already written and is the primary channel; a mail
 * service having a bad afternoon must not turn "your plan changed" into a failed
 * request for whoever triggered it.
 */
async function emailRecipients(
  prisma: NotificationPrisma,
  // NotificationTypeKey, not string: NOTIFICATION_TYPES is a literal object, so a
  // bare string has no index signature to look it up by. Taking the key union also
  // makes an unregistered type a compile error here, matching notify() above.
  type: NotificationTypeKey,
  notificationId: string,
  recipientIds: Set<string>,
  data: Record<string, unknown>,
  context: RuleContext,
): Promise<void> {
  const definition: NotificationTypeDef = NOTIFICATION_TYPES[type];
  // Captured into a local: `ports` is a mutable module binding, so narrowing it with
  // the guard below would not survive the awaits further down.
  const mail = ports.mail;
  if (!definition?.email || !mail || recipientIds.size === 0) return;

  try {
    const content = definition.email.build(data, context);
    if (!content) return; // this instance is not worth an email

    const users = await prisma.users.findMany({
      where: { id: { in: [...recipientIds] }, is_active: true },
      select: { id: true, email: true, email_verified_at: true },
    });

    // Verified addresses only. None of these are transactional in the sense that the
    // recipient asked for this specific mail, so an unverified claim to an address
    // must not be enough to start sending things to it.
    const recipients = users
      .filter((u) => u.email && u.email_verified_at)
      .map((u) => ({ userId: u.id, email: u.email as string }));

    if (recipients.length === 0) return;

    await mail.send({
      recipients,
      content,
      // Keyed on the notification, so re-running the same notification cannot fan out
      // a second copy; the transport adds the user id per message.
      idempotencyPrefix: `notif-${notificationId}`,
      priority: definition.email.priority ?? 5,
      type,
    });
  } catch (err) {
    console.error(`[notifications] email fan-out failed for ${type} (${notificationId}):`, err);
  }
}
