import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules, type AudienceRule } from '@semp/notifications/core/rules.js';

// A lifecycle status transition other than registration_open (which has its own
// function below) - uses event_lifecycle's default audience (POC + captains of
// already-approved orgs).
export async function notifyStatusChanged(
  prisma: Prisma, championshipId: string, status: string, senderId: string,
): Promise<void> {
  if (status === 'registration_open') {
    await notifyRegistrationOpened(prisma, championshipId, senderId);
    return;
  }
  try {
    await notify(prisma, {
      type: 'event_lifecycle',
      championshipId,
      senderId,
      data: { status },
    });
  } catch (err) {
    console.error(`[championships] event_lifecycle notify failed for ${championshipId}:`, err);
  }
}

// Every person affiliated with an organisation in any way - plain membership,
// a spot on any of its teams (player or coach), or a fine-grained role grant
// (Sports Admin, Billing Admin, ...). No single Rule kind expresses "everyone
// in this org, regardless of role", so this composes direct-user rules from
// real ids, gathered at the moment of firing.
async function orgEveryoneRules(prisma: Prisma, organizationId: string): Promise<AudienceRule[]> {
  const [members, teams, grants] = await Promise.all([
    prisma.organization_members.findMany({ where: { organization_id: organizationId, status: 'active' }, select: { user_id: true } }),
    prisma.teams.findMany({ where: { organization_id: organizationId }, select: { id: true, coach_user_id: true } }),
    prisma.user_org_roles.findMany({ where: { organization_id: organizationId, status: 'ACTIVE' }, select: { user_id: true } }),
  ]);

  const ids = new Set<string>();
  for (const m of members) ids.add(m.user_id);
  for (const t of teams) if (t.coach_user_id) ids.add(t.coach_user_id);
  for (const g of grants) ids.add(g.user_id);

  const teamIds = teams.map((t) => t.id);
  if (teamIds.length > 0) {
    const teamMembers = await prisma.team_members.findMany({
      where: { team_id: { in: teamIds }, is_active: true },
      select: { user_id: true },
    });
    for (const tm of teamMembers) ids.add(tm.user_id);
  }

  return [...ids].map((id) => Rules.directUser(id));
}

// Registration opening only matters to whoever is ALREADY part of the event at
// that moment - event_lifecycle's default (poc/captain resolved live, at
// whatever point someone next opens their feed) would just as happily reach
// someone who joins next month, which is not "you were already in, and now
// registration has opened" - it's a different fact. So this snapshots real ids
// at the moment of firing instead of relying on a rule resolved later:
//
//   - the HOST organisation gets its entire roster told (orgEveryoneRules) -
//     teams, plain members, Sports/Billing Admins, anyone - since they're the
//     ones running the event, whether or not they are themselves a competitor.
//   - any OTHER organisation already invited-and-accepted, or already applied
//     (even still pending - see registration_open's own status gate on
//     enrolling, nobody outside the host can have a row here any earlier),
//     gets its admins told - matching who can act on that invitation/
//     application (see invitations.routes.ts's ORG_ADMIN accept guard).
//   - any team already entered gets its captains told, for the rarer case
//     where a squad was built before registration ever opened.
export async function notifyRegistrationOpened(
  prisma: Prisma, championshipId: string, senderId: string,
): Promise<void> {
  try {
    const championship = await prisma.championships.findUnique({
      where: { id: championshipId },
      select: { host_organization_id: true },
    });
    const hostOrgId = championship?.host_organization_id ?? null;

    const participatingOrgRows = await prisma.championship_organizations.findMany({
      where: { championship_id: championshipId },
      select: { organization_id: true },
    });
    const participatingOrgIds = [...new Set(participatingOrgRows.map((r) => r.organization_id))];

    const rules: AudienceRule[] = [];
    for (const orgId of participatingOrgIds) {
      if (orgId === hostOrgId) {
        rules.push(...(await orgEveryoneRules(prisma, orgId)));
      } else {
        rules.push(Rules.orgAdmins(orgId));
      }
    }
    // The host still gets told even with no participation row of its own (an
    // organisation-level event where it opted out of competing but still runs it).
    if (hostOrgId && !participatingOrgIds.includes(hostOrgId)) {
      rules.push(...(await orgEveryoneRules(prisma, hostOrgId)));
    }
    rules.push(Rules.role('captain', championshipId));

    await notify(prisma, {
      type: 'event_lifecycle',
      championshipId,
      audience: Rules.compose(rules),
      senderId,
      data: { status: 'registration_open' },
    });
  } catch (err) {
    console.error(`[championships] event_lifecycle (registration_open) notify failed for ${championshipId}:`, err);
  }
}

// Fired only on a private -> public flip. Explicit audience, NOT event_lifecycle's
// default (poc/captain of already-approved orgs) - per the PDF, "Event
// published"'s recipient is the organiser, not the participants. Scoped to just
// this one trigger; other status transitions keep their own audience above.
export async function notifyChampionshipPublished(
  prisma: Prisma, championshipId: string, senderId: string,
): Promise<void> {
  try {
    await notify(prisma, {
      type: 'event_lifecycle',
      championshipId,
      audience: Rules.role('organiser', championshipId),
      senderId,
      data: { visibility: 'public' },
    });
  } catch (err) {
    console.error(`[championships] event_lifecycle (visibility) notify failed for ${championshipId}:`, err);
  }
}
