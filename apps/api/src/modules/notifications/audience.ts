import type { NotificationAudience, NotificationType } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';

// Resolves a user's relationship to every event so the notification feed and the
// poster guard share one definition of "who belongs to / can post to an event".
// Built on the same tables the rest of the app uses (user_event_roles,
// event_officials, team_members -> teams, event_institutions).

export interface AuthLike {
  id: string;
  isSuperAdmin: boolean;
  accountType: string;
  institutionId: string | null;
}

export interface EventScopes {
  isSuper: boolean;
  organiserEventIds: Set<string>;
  officialEventIds: Set<string>;
  captainEventIds: Set<string>;
  participantEventIds: Set<string>;
  pocEventIds: Set<string>;
  // Derived unions:
  allRelatedEventIds: Set<string>; // anyone related to the event (sees 'all' audience)
  instCaptEventIds: Set<string>;   // POCs + captains (sees 'institutions_captains')
  postableEventIds: Set<string>;   // the four sender categories
}

const union = (...sets: Set<string>[]) => {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
};

export async function getUserEventScopes(prisma: Prisma, user: AuthLike): Promise<EventScopes> {
  // Super admins relate to (and can post to) every event — callers special-case
  // `isSuper` rather than enumerating ids here.
  if (user.isSuperAdmin) {
    const empty = new Set<string>();
    return {
      isSuper: true,
      organiserEventIds: empty, officialEventIds: empty, captainEventIds: empty,
      participantEventIds: empty, pocEventIds: empty,
      allRelatedEventIds: empty, instCaptEventIds: empty, postableEventIds: empty,
    };
  }

  const [orgRole, offRole] = await Promise.all([
    prisma.roles.findUnique({ where: { name: 'Organiser' }, select: { id: true } }),
    prisma.roles.findUnique({ where: { name: 'Official' }, select: { id: true } }),
  ]);
  const roleIds = [orgRole?.id, offRole?.id].filter(Boolean) as string[];

  const [eventRoleRows, officialRows, memberRows, pocRows] = await Promise.all([
    roleIds.length
      ? prisma.user_event_roles.findMany({
          where: { user_id: user.id, role_id: { in: roleIds } },
          select: { event_id: true, role_id: true },
        })
      : Promise.resolve([] as { event_id: string; role_id: string }[]),
    prisma.event_officials.findMany({
      where: { user_id: user.id, is_active: true },
      select: { event_id: true },
    }),
    prisma.team_members.findMany({
      where: { user_id: user.id, is_active: true },
      select: { role: true, teams: { select: { event_id: true } } },
    }),
    user.accountType === 'institution' && user.institutionId
      ? prisma.event_institutions.findMany({
          where: { institution_id: user.institutionId },
          select: { event_id: true },
        })
      : Promise.resolve([] as { event_id: string }[]),
  ]);

  const organiserEventIds = new Set<string>();
  const officialEventIds = new Set<string>();
  for (const r of eventRoleRows) {
    if (orgRole && r.role_id === orgRole.id) organiserEventIds.add(r.event_id);
    if (offRole && r.role_id === offRole.id) officialEventIds.add(r.event_id);
  }
  for (const o of officialRows) officialEventIds.add(o.event_id);

  const captainEventIds = new Set<string>();
  const participantEventIds = new Set<string>();
  for (const m of memberRows) {
    const evId = m.teams?.event_id;
    if (!evId) continue;
    participantEventIds.add(evId);
    if (m.role === 'captain' || m.role === 'vice_captain') captainEventIds.add(evId);
  }

  const pocEventIds = new Set<string>(pocRows.map((r) => r.event_id));

  return {
    isSuper: false,
    organiserEventIds, officialEventIds, captainEventIds, participantEventIds, pocEventIds,
    allRelatedEventIds: union(organiserEventIds, officialEventIds, captainEventIds, participantEventIds, pocEventIds),
    instCaptEventIds: union(pocEventIds, captainEventIds),
    postableEventIds: union(organiserEventIds, officialEventIds, captainEventIds, pocEventIds),
  };
}

// Can this user see a given notification? Mirrors the targeting rules.
export function canSeeNotification(
  scopes: EventScopes,
  n: { event_id: string; audience: string },
): boolean {
  if (scopes.isSuper) return true;
  if (n.audience === 'institutions_captains') return scopes.instCaptEventIds.has(n.event_id);
  return scopes.allRelatedEventIds.has(n.event_id);
}

// Can this user push a notification into a given event?
export function canPostToEvent(scopes: EventScopes, eventId: string): boolean {
  return scopes.isSuper || scopes.postableEventIds.has(eventId);
}

// Prisma `where` that selects only notifications this user may see. Used by the
// feed and unread-count. Super admins see everything (`{}`).
export function visibilityWhere(scopes: EventScopes): Record<string, unknown> {
  if (scopes.isSuper) return {};
  const all = [...scopes.allRelatedEventIds];
  const ic = [...scopes.instCaptEventIds];
  const or: Record<string, unknown>[] = [];
  if (all.length) or.push({ audience: 'all', event_id: { in: all } });
  if (ic.length) or.push({ audience: 'institutions_captains', event_id: { in: ic } });
  if (or.length === 0) return { id: { in: [] as string[] } }; // sees nothing
  return { OR: or };
}

// Shared insert helper — used by the manual-post route and the lifecycle/approval
// hooks in events/enrollment routers.
export function createNotification(prisma: Prisma, data: {
  event_id: string;
  sender_id?: string | null;
  type: NotificationType;
  audience: NotificationAudience;
  title: string;
  body?: string | null;
}) {
  return prisma.notifications.create({
    data: {
      event_id: data.event_id,
      sender_id: data.sender_id ?? null,
      type: data.type,
      audience: data.audience,
      title: data.title,
      body: data.body ?? null,
    },
  });
}
