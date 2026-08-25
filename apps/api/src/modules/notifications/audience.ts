import type { NotificationAudience, NotificationType } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import type { JsonValue } from '@prisma/client/runtime/library';
import type { AudienceRule } from '@semp/notifications/core/rules.js';
import { matches } from '@semp/notifications/server/matches.js';
import { ROLE_CODES, roleWhereByCode } from '@semp/shared';


// Resolves a user's relationship to every championship so the notification feed and the
// poster guard share one definition of "who belongs to / can post to a championship".
// Built on the same tables the rest of the app uses:
// user_championship_roles,
// championship_officials,
// team_members -> teams,
// championship_organizations,
// organization_members.
export interface AuthLike {
  id: string;
  isSuperAdmin: boolean;
  organizationId: string | null;
}

export interface EventScopes {
  isSuper: boolean;
  userId: string; // the user these scopes were built for (direct notifications)

  // Organizations the user owns/administers.
  // Used for the 'org_admins' audience.
  adminOrgIds: Set<string>;

  organiserEventIds: Set<string>;
  officialEventIds: Set<string>;
  captainEventIds: Set<string>;
  participantEventIds: Set<string>;

  // Championships where the user's organization is enrolled and
  // the user is the organization's owner (the application's POC).
  pocEventIds: Set<string>;

  teamIds: Set<string>;

  // Derived unions:
  // Anyone related to the championship.
  allRelatedEventIds: Set<string>;

  // POCs + captains.
  instCaptEventIds: Set<string>;

  // Users who can post to a championship.
  postableEventIds: Set<string>;
}

const union = (...sets: Set<string>[]) => {
  const out = new Set<string>();

  for (const s of sets) {
    for (const v of s) {
      out.add(v);
    }
  }

  return out;
};

export async function getUserEventScopes(
  prisma: Prisma,
  user: AuthLike,
): Promise<EventScopes> {
  // Super admins relate to and can post to every championship.
  // Callers special-case isSuper rather than enumerating championship IDs.
  if (user.isSuperAdmin) {
    const empty = new Set<string>();

    return {
      isSuper: true,
      userId: user.id,
      adminOrgIds: empty,

      organiserEventIds: empty,
      officialEventIds: empty,
      captainEventIds: empty,
      participantEventIds: empty,
      pocEventIds: empty,
      teamIds: empty,

      allRelatedEventIds: empty,
      instCaptEventIds: empty,
      postableEventIds: empty,
    };
  }

  const [orgRole, offRole] = await Promise.all([
    prisma.roles.findFirst({
      where: roleWhereByCode(ROLE_CODES.organiser),
      select: {
        id: true,
      },
    }),

    prisma.roles.findFirst({
      where: roleWhereByCode(ROLE_CODES.official),
      select: {
        id: true,
      },
    }),
  ]);

  const roleIds = [orgRole?.id, offRole?.id].filter(Boolean) as string[];

  const [
    eventRoleRows,
    officialRows,
    memberRows,
    pocChampionshipRows,
    adminOrgRows,
  ] = await Promise.all([
    // Championship roles explicitly assigned to the user.
    roleIds.length
      ? prisma.user_championship_roles.findMany({
          where: {
            user_id: user.id,
            role_id: {
              in: roleIds,
            },
          },
          select: {
            championship_id: true,
            role_id: true,
          },
        })
      : Promise.resolve(
          [] as {
            championship_id: string;
            role_id: string;
          }[],
        ),

    // Users explicitly assigned as championship officials.
    prisma.championship_officials.findMany({
      where: {
        user_id: user.id,
        is_active: true,
      },
      select: {
        championship_id: true,
      },
    }),

    // Teams the user belongs to and the championships those teams entered.
    prisma.team_members.findMany({
      where: {
        user_id: user.id,
        is_active: true,
      },
      select: {
        team_id: true,
        role: true,
        teams: {
          select: {
            team_entries: {
              select: {
                championship_id: true,
              },
            },
          },
        },
      },
    }),

    // POC championships.
    //
    // In the real application, the POC is represented by the organization owner.
    // When an organization is enrolled in a championship, its owner is therefore
    // the POC for that championship.
    prisma.championship_organizations.findMany({
      where: {
        organizations: {
          organization_members: {
            some: {
              user_id: user.id,
              role: 'owner',
              status: 'active',
            },
          },
        },
      },
      select: {
        championship_id: true,
      },
    }),

    // Organizations the user owns/administers.
    //
    // This is intentionally owner OR admin because the 'org_admins'
    // audience is for organization administrators, not specifically POCs.
    prisma.organization_members.findMany({
      where: {
        user_id: user.id,
        role: {
          in: ['owner', 'admin'],
        },
        status: 'active',
      },
      select: {
        organization_id: true,
      },
    }),
  ]);

  const organiserEventIds = new Set<string>();
  const officialEventIds = new Set<string>();

  for (const r of eventRoleRows) {
    if (orgRole && r.role_id === orgRole.id) {
      organiserEventIds.add(r.championship_id);
    }

    if (offRole && r.role_id === offRole.id) {
      officialEventIds.add(r.championship_id);
    }
  }

  // Some officials are represented through championship_officials
  // rather than user_championship_roles.
  for (const o of officialRows) {
    officialEventIds.add(o.championship_id);
  }

  const captainEventIds = new Set<string>();
  const participantEventIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const m of memberRows) {
    teamIds.add(m.team_id);

    for (const entry of m.teams?.team_entries ?? []) {
      participantEventIds.add(entry.championship_id);

      if (
        m.role === 'captain' ||
        m.role === 'vice_captain'
      ) {
        captainEventIds.add(entry.championship_id);
      }
    }
  }

  const pocEventIds = new Set<string>(
    pocChampionshipRows.map(
      (r) => r.championship_id,
    ),
  );

  const adminOrgIds = new Set<string>(
    adminOrgRows.map(
      (r) => r.organization_id,
    ),
  );

  return {
    isSuper: false,
    userId: user.id,
    adminOrgIds,

    organiserEventIds,
    officialEventIds,
    captainEventIds,
    participantEventIds,
    pocEventIds,
    teamIds,

    allRelatedEventIds: union(
      organiserEventIds,
      officialEventIds,
      captainEventIds,
      participantEventIds,
      pocEventIds,
    ),

    instCaptEventIds: union(
      pocEventIds,
      captainEventIds,
    ),

    postableEventIds: union(
      organiserEventIds,
      officialEventIds,
      captainEventIds,
      pocEventIds,
    ),
  };
}

export function parseAudienceRule(
  value: JsonValue,
): AudienceRule | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const rule = value as Record<string, JsonValue>;

  if (
    rule.kind === 'direct_user' &&
    typeof rule.userId === 'string'
  ) {
    return {
      kind: 'direct_user',
      userId: rule.userId,
    };
  }

  if (
    rule.kind === 'everyone' &&
    typeof rule.championshipId === 'string'
  ) {
    return {
      kind: 'everyone',
      championshipId: rule.championshipId,
    };
  }

  if (
    rule.kind === 'org_admins' &&
    typeof rule.organizationId === 'string'
  ) {
    return {
      kind: 'org_admins',
      organizationId: rule.organizationId,
    };
  }

  if (
    rule.kind === 'team_members' &&
    typeof rule.teamId === 'string'
  ) {
    return {
      kind: 'team_members',
      teamId: rule.teamId,
    };
  }

  if (
    rule.kind === 'role' &&
    typeof rule.role === 'string' &&
    typeof rule.championshipId === 'string' &&
    [
      'organiser',
      'official',
      'captain',
      'poc',
    ].includes(rule.role)
  ) {
    return {
      kind: 'role',
      role: rule.role as
        | 'organiser'
        | 'official'
        | 'captain'
        | 'poc',
      championshipId: rule.championshipId,
    };
  }

  if (
    rule.kind === 'compose' &&
    Array.isArray(rule.rules)
  ) {
    const rules: AudienceRule[] = [];

    for (const child of rule.rules) {
      const parsed = parseAudienceRule(child);

      if (!parsed) {
        return null;
      }

      rules.push(parsed);
    }

    return {
      kind: 'compose',
      rules,
    };
  }

  return null;
}

// Can this user see a given notification?
// Mirrors the targeting rules.
export function canSeeNotification(
  scopes: EventScopes,
  n: {
    championship_id: string | null;
    audience: JsonValue;
    organization_id?: string | null;
    target_user_id?: string | null;
  },
): boolean {
  const rule = parseAudienceRule(n.audience);

  if (!rule) {
    return false;
  }

  return matches(scopes, rule);
}

// Can this user push a notification into a given championship?
export function canPostToEvent(
  scopes: EventScopes,
  eventId: string,
): boolean {
  return (
    scopes.isSuper ||
    scopes.postableEventIds.has(eventId)
  );
}

// Prisma `where` that selects only notifications this user may see.
// Used by the feed and unread-count.
// Super admins see everything (`{}`).
export function visibilityWhere(
  scopes: EventScopes,
): Record<string, unknown> {
  if (scopes.isSuper) {
    return {};
  }

  const or: Record<string, unknown>[] = [];

  // Add visibility for a normal audience rule AND for the same
  // rule when it appears directly inside a compose audience.
  const addRule = (rule: Record<string, unknown>) => {
    // Direct audience:
    or.push({
      audience: {
        equals: rule,
      },
    });

    // Same audience rule inside compose:
    or.push({
      audience: {
        path: ['rules'],
        array_contains: [rule],
      },
    });
  };

  // Everyone in related championships.
  for (const championshipId of scopes.allRelatedEventIds) {
    addRule({
      kind: 'everyone',
      championshipId,
    });
  }

  // Championship organisers.
  for (const championshipId of scopes.organiserEventIds) {
    addRule({
      kind: 'role',
      role: 'organiser',
      championshipId,
    });
  }

  // Championship officials.
  for (const championshipId of scopes.officialEventIds) {
    addRule({
      kind: 'role',
      role: 'official',
      championshipId,
    });
  }

  // Championship captains.
  for (const championshipId of scopes.captainEventIds) {
    addRule({
      kind: 'role',
      role: 'captain',
      championshipId,
    });
  }

  // Points of contact.
  //
  // A POC is an owner of an organization participating
  // in the championship.
  for (const championshipId of scopes.pocEventIds) {
    addRule({
      kind: 'role',
      role: 'poc',
      championshipId,
    });
  }

  // Organization admins.
  for (const organizationId of scopes.adminOrgIds) {
    addRule({
      kind: 'org_admins',
      organizationId,
    });
  }

  // Team members.
  for (const teamId of scopes.teamIds) {
    addRule({
      kind: 'team_members',
      teamId,
    });
  }

  // Direct notifications.
  addRule({
    kind: 'direct_user',
    userId: scopes.userId,
  });

  return {
    OR: or,
  };
}

// Shared insert helper - used by the manual-post route and the
// lifecycle/approval hooks in championships/enrollment routers.
export function createNotification(
  prisma: Prisma,
  data: {
    championship_id?: string | null;
    organization_id?: string | null;
    target_user_id?: string | null;
    sender_id?: string | null;
    type: NotificationType;
    audience: NotificationAudience;
    title: string;
    body?: string | null;
  },
) {
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
