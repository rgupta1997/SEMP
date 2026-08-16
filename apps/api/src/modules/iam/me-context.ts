import { MODULE_KEYS, type ModuleKey } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { applyUserInvitations } from './user-invitations.service.js';
import { audienceOfRole, moduleEnabled, moduleSettingsOf } from './module-access.js';

// Assembles the full authentication context the web app needs to render the
// unified shell and decide what the user can act on:
//   - the public user record
//   - the user's home organization (optional) + every org they're a member of
//   - championship-scoped role assignments (user_championship_roles)
//   - team memberships (captain / player rows)
export async function buildAuthContext(prisma: Prisma, user: any) {
  const { password_hash, ...publicUser } = user;

  // Resolve any invitations addressed to this user's mobile before reading their
  // memberships/roles, so a freshly-applied invite shows up immediately. Never
  // throws (see the service) - sign-in must not depend on it succeeding.
  await applyUserInvitations(prisma, user);

  // These reads are independent - run them together rather than serially, since
  // this context is assembled on every login and every /me hit.
  const [orgFromUser, orgMemberships, championshipRoleRows, officialRows, memberships] = await Promise.all([
    user.organization_id
      ? prisma.organizations.findUnique({ where: { id: user.organization_id } })
      : Promise.resolve(null),
    prisma.organization_members.findMany({
      where: { user_id: user.id },
      include: { organizations: true },
      orderBy: { joined_at: 'asc' },
    }),
    prisma.user_championship_roles.findMany({
      where: { user_id: user.id },
      include: {
        championships: { select: { id: true, name: true, slug: true, status: true } },
        roles: { select: { id: true, name: true } },
      },
      orderBy: { assigned_at: 'desc' },
    }),
    prisma.championship_officials.findMany({
      where: { user_id: user.id, is_active: true },
      select: { championship_id: true },
    }),
    prisma.team_members.findMany({
      where: { user_id: user.id, is_active: true },
      include: {
        teams: {
          include: {
            sports: { select: { id: true, name: true, icon: true } },
            organizations: { select: { id: true, name: true } },
            team_entries: {
              include: { championships: { select: { id: true, name: true, slug: true, status: true } } },
              orderBy: { created_at: 'asc' },
            },
          },
        },
      },
      orderBy: { joined_at: 'desc' },
    }),
  ]);

  // A personal organisation is one hidden person wearing an organisation's clothes
  // so the entry machinery works (J3-E1). `GET /organizations` already refuses to
  // list them - but this context is a second way out of the database, and without
  // the same filter the hidden org surfaces under the person's OWN NAME in every
  // picker that reads `ctx.organizations`: "apply as", the org switcher, the
  // organisations list. The whole point of the epic is that a solo entrant never
  // meets the word "organisation".
  const realMemberships = orgMemberships.filter((m) => m.organizations?.kind !== 'personal');

  // If the user's primary org field is empty but they own/admin one, use the first
  // REAL one - a solo entrant's home institution must not silently become the
  // hidden workspace created for them.
  const organization = orgFromUser
    ?? realMemberships.find((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'))?.organizations
    ?? null;

  // Which modules this person can reach in each of their institutions (J6-E2-S2).
  // Computed here rather than fetched separately so navigation renders correctly
  // on the FIRST paint - a nav that shows a module and then removes it a moment
  // later is the flicker this story exists to avoid. The server-side `can()`
  // pre-check remains the boundary; this is only what gets drawn.
  const modules: Record<string, ModuleKey[]> = {};
  for (const m of realMemberships) {
    if (m.status !== 'active') continue;
    const settings = moduleSettingsOf(m.organizations?.settings);
    const audience = audienceOfRole(m.role);
    modules[m.organization_id] = user.is_super_admin
      ? [...MODULE_KEYS]
      : MODULE_KEYS.filter((key) => moduleEnabled(settings, key, audience));
  }

  return {
    user: publicUser,
    organization,
    modules,
    organizations: realMemberships.map((m) => ({
      id: m.id,
      organization_id: m.organization_id,
      organization: m.organizations,
      role: m.role,
      status: m.status,
      joined_at: m.joined_at,
    })),
    official_championship_ids: officialRows.map((o) => o.championship_id),
    championship_roles: championshipRoleRows.map((r) => ({
      id: r.id,
      championship_id: r.championship_id,
      championship: r.championships,
      role: r.roles,
    })),
    memberships: memberships.map((m) => ({
      id: m.id,
      team_id: m.team_id,
      role: m.role,
      jersey_number: m.jersey_number,
      team: m.teams,
    })),
  };
}
