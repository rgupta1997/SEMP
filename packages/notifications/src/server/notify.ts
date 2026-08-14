import {
  NOTIFICATION_TYPES,
  type RuleContext,
} from '../core/registry.js';
import type { AudienceRule } from '../core/rules.js';
import {
  resolveUserIds,
  type NotificationPrisma as RecipientResolverPrisma,
} from './resolve-user-ids.js';

export interface NotificationPrisma extends RecipientResolverPrisma {
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
  type: string;
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
  const definition = NOTIFICATION_TYPES[input.type];

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

  return notification;
}
