import type { Prisma } from '../../infra/prisma.js';
import { applyUserInvitations } from './user-invitations.service.js';

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
  // throws (see the service) — sign-in must not depend on it succeeding.
  await applyUserInvitations(prisma, user);

  // These reads are independent — run them together rather than serially, since
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

  // If the user's primary org field is empty but they own/admin one, use the first.
  const organization = orgFromUser
    ?? orgMemberships.find((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'))?.organizations
    ?? null;

  return {
    user: publicUser,
    organization,
    organizations: orgMemberships.map((m) => ({
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
