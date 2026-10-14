import type { NotificationAudience } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import type { JsonValue } from '@prisma/client/runtime/library';
import { Prisma as PrismaNS } from '@prisma/client';
import type { AudienceRule } from '@semp/notifications/core/rules.js';
import type { NotificationTypeKey } from '@semp/notifications/core/registry.js';
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

// Every audience rule this user matches, as plain objects. Must mirror the
// targeting rules matches() applies (see canSeeNotification).
function visibleRules(scopes: EventScopes): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = [];
  for (const championshipId of scopes.allRelatedEventIds) rules.push({ kind: 'everyone', championshipId });
  for (const championshipId of scopes.organiserEventIds) rules.push({ kind: 'role', role: 'organiser', championshipId });
  for (const championshipId of scopes.officialEventIds) rules.push({ kind: 'role', role: 'official', championshipId });
  for (const championshipId of scopes.captainEventIds) rules.push({ kind: 'role', role: 'captain', championshipId });
  for (const championshipId of scopes.pocEventIds) rules.push({ kind: 'role', role: 'poc', championshipId });
  for (const organizationId of scopes.adminOrgIds) rules.push({ kind: 'org_admins', organizationId });
  for (const teamId of scopes.teamIds) rules.push({ kind: 'team_members', teamId });
  rules.push({ kind: 'direct_user', userId: scopes.userId });
  return rules;
}

// Raw SQL predicate on `alias.id`: the notifications this user may see. Used by
// the feed, the unread count and read-all. Super admins see everything.
// Shaped so idx_notifications_audience_gin (jsonb_path_ops) can serve it.
//
// Prisma compiles `equals` to `audience = $x` and `path ['rules'] array_contains`
// to `(audience #> '{rules}') @> $x` - neither is a top-level `@>`, so the GIN index
// was never used and every feed load / badge poll seq-scanned the table, ORing two
// predicates (~360 bind params for a busy user) per scope the user holds. Here the
// rules go in as two jsonb arrays and each is probed on its own:
//   - direct rule:    audience @> r AND audience = r   (the `=` keeps it exact)
//   - inside compose: audience @> {"rules":[r]}        (same as array_contains)
// Verified row-for-row against the old Prisma filter on 60 real users; ~6x faster.
export function visibilitySql(scopes: EventScopes, alias = 'n'): PrismaNS.Sql {
  if (scopes.isSuper) return PrismaNS.sql`true`;
  const rules = visibleRules(scopes);
  const direct = JSON.stringify(rules);
  const inCompose = JSON.stringify(rules.map((rule) => ({ rules: [rule] })));
  return PrismaNS.sql`${PrismaNS.raw(alias)}.id in (
    select m.id from jsonb_array_elements(${direct}::jsonb) r(v)
      join notifications m on m.audience @> r.v and m.audience = r.v
    union all
    select m.id from jsonb_array_elements(${inCompose}::jsonb) r(v)
      join notifications m on m.audience @> r.v)`;
}

// Shared insert helper - used by the manual-post route and the
// lifecycle/approval hooks in championships/enrollment routers.
type NewNotification = {
  championship_id?: string | null;
  organization_id?: string | null;
  target_user_id?: string | null;
  sender_id?: string | null;
  // A registry key, not a bare string - see notify.ts's NotifyInput for why.
  type: NotificationTypeKey;
  audience: NotificationAudience;
  title: string;
  body?: string | null;
};

const notificationRow = (data: NewNotification) => ({
  championship_id: data.championship_id ?? null,
  organization_id: data.organization_id ?? null,
  target_user_id: data.target_user_id ?? null,
  sender_id: data.sender_id ?? null,
  type: data.type,
  audience: data.audience,
  title: data.title,
  body: data.body ?? null,
});

export function createNotification(prisma: Prisma, data: NewNotification) {
  return prisma.notifications.create({ data: notificationRow(data) });
}

// Many at once, in one statement - e.g. a "result verified" note to every player in
// a match, which was otherwise one insert per player.
export function createNotifications(prisma: Prisma, rows: NewNotification[]) {
  return prisma.notifications.createMany({ data: rows.map(notificationRow) });
}
