import type { Prisma } from '../../infra/prisma.js';

// Assembles the full authentication context the web app needs to decide which
// role-shell to render and what the user can act on:
//   - the public user record (incl. account_type + institution link)
//   - the user's institution (if any)
//   - event-scoped role assignments (user_event_roles)
//   - team memberships (captain / player rows)
export async function buildAuthContext(prisma: Prisma, user: any) {
  const { password_hash, ...publicUser } = user;

  // These three reads are independent — run them together rather than serially,
  // since this context is assembled on every login and every /me hit.
  const [institution, eventRoleRows, memberships] = await Promise.all([
    user.institution_id
      ? prisma.institutions.findUnique({ where: { id: user.institution_id } })
      : Promise.resolve(null),
    prisma.user_event_roles.findMany({
      where: { user_id: user.id },
      include: {
        events: { select: { id: true, name: true, slug: true, status: true } },
        roles: { select: { id: true, name: true } },
      },
      orderBy: { assigned_at: 'desc' },
    }),
    prisma.team_members.findMany({
      where: { user_id: user.id, is_active: true },
      include: {
        teams: {
          include: {
            sports: { select: { id: true, name: true, icon: true } },
            events: { select: { id: true, name: true, slug: true, status: true } },
            institutions: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { joined_at: 'desc' },
    }),
  ]);

  return {
    user: publicUser,
    institution,
    event_roles: eventRoleRows.map((r) => ({
      id: r.id,
      event_id: r.event_id,
      event: r.events,
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
