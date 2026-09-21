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
 * layer does. `setNotificationMailPort` wires the real one at boot.
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

let mailPort: NotificationMailPort | null = null;

/**
 * Registered once at server boot.
 *
 * A module-level port rather than an argument on notify() on purpose: there are a
 * dozen call sites, none of which have any business knowing about email, and
 * threading a mailer through all of them to serve five notification types would put
 * the transport back in the places this package exists to keep it out of.
 */
export function setNotificationMailPort(port: NotificationMailPort | null): void {
  mailPort = port;
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

  await emailRecipients(prisma, input.type, notification.id, recipientIds, data, context);

  return notification;
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
  if (!definition?.email || !mailPort || recipientIds.size === 0) return;

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

    await mailPort.send({
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
