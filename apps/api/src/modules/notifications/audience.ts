import type { NotificationAudience, NotificationType } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { ROLE_CODES, roleWhereByCode } from '../iam/role-codes.js';

// Resolves a user's relationship to every championship so the notification feed and the
// poster guard share one definition of "who belongs to / can post to an championship".
// Built on the same tables the rest of the app uses (user_championship_roles,
// championship_officials, team_members -> teams, championship_organizations).

export interface AuthLike {
  id: string;
  isSuperAdmin: boolean;
  organizationId: string | null;
}

export interface EventScopes {
  isSuper: boolean;
  userId: string;                  // the user these scopes were built for (direct notifications)
  adminOrgIds: Set<string>;        // orgs the user owns/administers (sees 'org_admins' audience)
  organiserEventIds: Set<string>;
  officialEventIds: Set<string>;
  captainEventIds: Set<string>;
  participantEventIds: Set<string>;
  pocEventIds: Set<string>;
  // Derived unions:
  allRelatedEventIds: Set<string>; // anyone related to the championship (sees 'all' audience)
  instCaptEventIds: Set<string>;   // POCs + captains (sees 'organizations_captains')
  postableEventIds: Set<string>;   // the four sender categories
}

const union = (...sets: Set<string>[]) => {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
};

export async function getUserEventScopes(prisma: Prisma, user: AuthLike): Promise<EventScopes> {
  // Super admins relate to (and can post to) every championship - callers special-case
  // `isSuper` rather than enumerating ids here.
  if (user.isSuperAdmin) {
    const empty = new Set<string>();
    return {
      isSuper: true, userId: user.id, adminOrgIds: empty,
      organiserEventIds: empty, officialEventIds: empty, captainEventIds: empty,
      participantEventIds: empty, pocEventIds: empty,
      allRelatedEventIds: empty, instCaptEventIds: empty, postableEventIds: empty,
    };
  }

  const [orgRole, offRole] = await Promise.all([
    prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.organiser), select: { id: true } }),
    prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.official), select: { id: true } }),
  ]);
  const roleIds = [orgRole?.id, offRole?.id].filter(Boolean) as string[];

  const [eventRoleRows, officialRows, memberRows, pocRows, adminOrgRows] = await Promise.all([
    roleIds.length
      ? prisma.user_championship_roles.findMany({
          where: { user_id: user.id, role_id: { in: roleIds } },
          select: { championship_id: true, role_id: true },
        })
      : Promise.resolve([] as { championship_id: string; role_id: string }[]),
    prisma.championship_officials.findMany({
      where: { user_id: user.id, is_active: true },
      select: { championship_id: true },
    }),
    prisma.team_members.findMany({
      where: { user_id: user.id, is_active: true },
      select: { role: true, teams: { select: { team_entries: { select: { championship_id: true } } } } },
    }),
    // Championships the user can post to as an org admin: those any org they
    // own/administer is enrolled in.
    prisma.championship_organizations.findMany({
      where: {
        organizations: {
          organization_members: {
            some: { user_id: user.id, role: { in: ['owner', 'admin'] }, status: 'active' },
          },
        },
      },
      select: { championship_id: true },
    }),
    // Orgs the user owns/administers - they see 'org_admins' notifications (e.g.
    // someone requesting to join). Pending memberships don't count (status active).
    prisma.organization_members.findMany({
      where: { user_id: user.id, role: { in: ['owner', 'admin'] }, status: 'active' },
      select: { organization_id: true },
    }),
  ]);

  const organiserEventIds = new Set<string>();
  const officialEventIds = new Set<string>();
  for (const r of eventRoleRows) {
    if (orgRole && r.role_id === orgRole.id) organiserEventIds.add(r.championship_id);
    if (offRole && r.role_id === offRole.id) officialEventIds.add(r.championship_id);
  }
  for (const o of officialRows) officialEventIds.add(o.championship_id);

  const captainEventIds = new Set<string>();
  const participantEventIds = new Set<string>();
  for (const m of memberRows) {
    for (const entry of m.teams?.team_entries ?? []) {
      participantEventIds.add(entry.championship_id);
      if (m.role === 'captain' || m.role === 'vice_captain') captainEventIds.add(entry.championship_id);
    }
  }

  const pocEventIds = new Set<string>(pocRows.map((r) => r.championship_id));
  const adminOrgIds = new Set<string>(adminOrgRows.map((r) => r.organization_id));

  return {
    isSuper: false, userId: user.id, adminOrgIds,
    organiserEventIds, officialEventIds, captainEventIds, participantEventIds, pocEventIds,
    allRelatedEventIds: union(organiserEventIds, officialEventIds, captainEventIds, participantEventIds, pocEventIds),
    instCaptEventIds: union(pocEventIds, captainEventIds),
    postableEventIds: union(organiserEventIds, officialEventIds, captainEventIds, pocEventIds),
  };
}

// Can this user see a given notification? Mirrors the targeting rules.
export function canSeeNotification(
  scopes: EventScopes,
  n: { championship_id: string | null; audience: string; organization_id?: string | null; target_user_id?: string | null },
): boolean {
  if (scopes.isSuper) return true;
  // Direct notification to a specific user (e.g. join request approved/declined).
  if (n.target_user_id) return n.target_user_id === scopes.userId;
  // Org-scoped notification (e.g. someone requested to join) → that org's admins.
  if (n.audience === 'org_admins') return !!n.organization_id && scopes.adminOrgIds.has(n.organization_id);
  // Championship-scoped notifications.
  if (!n.championship_id) return false;
  if (n.audience === 'organizations_captains') return scopes.instCaptEventIds.has(n.championship_id);
  return scopes.allRelatedEventIds.has(n.championship_id);
}

// Can this user push a notification into a given championship?
export function canPostToEvent(scopes: EventScopes, eventId: string): boolean {
  return scopes.isSuper || scopes.postableEventIds.has(eventId);
}

// Prisma `where` that selects only notifications this user may see. Used by the
// feed and unread-count. Super admins see everything (`{}`).
export function visibilityWhere(scopes: EventScopes): Record<string, unknown> {
  if (scopes.isSuper) return {};
  const all = [...scopes.allRelatedEventIds];
  const ic = [...scopes.instCaptEventIds];
  const adminOrgs = [...scopes.adminOrgIds];
  const or: Record<string, unknown>[] = [];
  if (all.length) or.push({ audience: 'all', championship_id: { in: all } });
  if (ic.length) or.push({ audience: 'organizations_captains', championship_id: { in: ic } });
  if (adminOrgs.length) or.push({ audience: 'org_admins', organization_id: { in: adminOrgs } });
  // Direct notifications addressed to this user (always applicable).
  or.push({ target_user_id: scopes.userId });
  return { OR: or };
}

// Shared insert helper - used by the manual-post route and the lifecycle/approval
// hooks in championships/enrollment routers.
export function createNotification(prisma: Prisma, data: {
  championship_id?: string | null;
  organization_id?: string | null;
  target_user_id?: string | null;
  sender_id?: string | null;
  type: NotificationType;
  audience: NotificationAudience;
  title: string;
  body?: string | null;
}) {
  return prisma.notifications.create({
    data: {
      championship_id: data.championship_id ?? null,
      organization_id: data.organization_id ?? null,
      target_user_id: data.target_user_id ?? null,
      sender_id: data.sender_id ?? null,
      type: data.type,
      audience: data.audience,
      title: data.title,
      body: data.body ?? null,
    },
  });
}
