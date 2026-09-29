import type { RequestHandler } from 'express';
import { ORG_ARCHIVED_READ_ONLY_MESSAGE, type OrganizationRemovalMode } from '@semp/shared';
import type { Db, Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';

/** Refuse a change inside an archived organisation, naming the way out. */
export async function assertOrgNotArchived(db: Db, organizationId: string | null | undefined): Promise<void> {
  if (!organizationId) return;
  const org = await db.organizations.findUnique({ where: { id: organizationId }, select: { archived_at: true } });
  if (org?.archived_at) throw new BusinessRuleError(ORG_ARCHIVED_READ_ONLY_MESSAGE);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every write under /organizations/:id - campuses and units, placements, members,
 * join approvals, roles, settings, certificates - refused in one place while the
 * organisation is archived. Retrieving it (and archiving, deleting, withdrawing your
 * own join request) are the only changes that still reach their routes.
 */
export function blockOrgWritesWhenArchived(prisma: Prisma): RequestHandler {
  const allowed = /^\/(archive|retrieve|join)\/?$/;
  return (req, _res, next) => {
    const id = req.params.id;
    const deleteOrg = req.method === 'DELETE' && /^\/?$/.test(req.path);
    if (READS.has(req.method) || !id || !UUID.test(id) || deleteOrg || allowed.test(req.path)) return next();
    assertOrgNotArchived(prisma, id).then(() => next(), next);
  };
}

/** The same for a team: it belongs to an organisation without living under its URL. */
export function blockTeamWritesWhenArchived(prisma: Prisma): RequestHandler {
  return (req, _res, next) => {
    const id = req.params.id;
    if (READS.has(req.method) || !id || !UUID.test(id)) return next();
    prisma.teams.findUnique({ where: { id }, select: { organization_id: true } })
      .then((team) => assertOrgNotArchived(prisma, team?.organization_id))
      .then(() => next(), next);
  };
}

// Removing an organisation: delete it only while it has no footprint, archive it
// otherwise. Archiving is a freeze, not a countdown - see organization-archive.ts in
// @semp/shared for why there is no automatic purge.

// An event is over once it is completed, cancelled or archived; anything else is live.
const FINISHED = ['completed', 'cancelled'];
const HOSTING_LIVE = ['registration_open', 'ongoing'];

export interface OrgRemovalInfo {
  mode: OrganizationRemovalMode;
  /** Why it can only be archived, in words the settings screen can show. */
  reasons: string[];
  /** What must be dealt with before it can be archived at all - each names the event. */
  blockers: string[];
  archived_at: Date | null;
}

/** Events hosted by someone other than this organisation (an individual host counts). */
const hostedElsewhere = (orgId: string) => ({
  OR: [{ host_organization_id: null }, { host_organization_id: { not: orgId } }],
});

export async function orgRemovalInfo(prisma: Prisma, orgId: string): Promise<OrgRemovalInfo | null> {
  const org = await prisma.organizations.findUnique({ where: { id: orgId }, select: { archived_at: true } });
  if (!org) return null;

  const [hosted, entries, teamEntries, certificates, careerRows, hostingLive, playing] = await Promise.all([
    prisma.championships.count({ where: { host_organization_id: orgId } }),
    prisma.championship_organizations.count({ where: { organization_id: orgId } }),
    prisma.team_entries.count({ where: { organization_id: orgId } }),
    prisma.certificates.count({ where: { organization_id: orgId } }),
    prisma.career_stats.count({ where: { organization_id: orgId } }),
    // Its own event that is still running - finish or archive it first.
    prisma.championships.findMany({
      where: { host_organization_id: orgId, archived_at: null, status: { in: HOSTING_LIVE } },
      select: { name: true },
    }),
    // A team of its own in someone else's event that is not over - a squad in their
    // draw, which it can withdraw itself. Leaving it would vanish from their draw.
    prisma.team_entries.findMany({
      where: {
        organization_id: orgId,
        championships: { ...hostedElsewhere(orgId), archived_at: null, status: { notIn: FINISHED } },
      },
      select: { championships: { select: { name: true } } },
      distinct: ['championship_id'],
    }),
  ]);

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const reasons = [
    ...(hosted ? [`it has hosted ${plural(hosted, 'event', 'events')}`] : []),
    ...(entries || teamEntries ? ['it has taken part in events'] : []),
    ...(certificates ? [`it has issued ${plural(certificates, 'certificate', 'certificates')}`] : []),
    ...(careerRows ? ["its players have career stats recorded under it"] : []),
  ];
  const blockers = [
    ...hostingLive.map((c) => `“${c.name}” is still running — finish or archive it first.`),
    ...playing.map((e) => `You're entered in “${e.championships.name}” — withdraw your teams from it first, then archive.`),
  ];
  return { mode: reasons.length ? 'archive' : 'delete', reasons, blockers, archived_at: org.archived_at };
}

/**
 * Archive: hide the organisation, archive the events it hosts, and let go of anything
 * in other hosts' events that has no team behind it - a pending application, an
 * unanswered invitation, an entry nobody fielded a squad for.
 */
export async function archiveOrganization(prisma: Prisma, orgId: string, actorId: string) {
  const info = await orgRemovalInfo(prisma, orgId);
  if (!info) throw new NotFoundError('Organization');
  if (info.archived_at) throw new BusinessRuleError('This organisation is already archived.');
  if (info.blockers.length) throw new BusinessRuleError(`This organisation can't be archived yet. ${info.blockers.join(' ')}`);

  const now = new Date();
  const teamless = await prisma.championship_organizations.findMany({
    where: {
      organization_id: orgId,
      championships: { ...hostedElsewhere(orgId), archived_at: null, status: { notIn: FINISHED } },
      team_entries: { none: {} },
    },
    select: { id: true },
  });

  const [, events, invitations] = await prisma.$transaction([
    prisma.organizations.update({ where: { id: orgId }, data: { archived_at: now, archived_by: actorId } }),
    // Only events not already archived on their own - those keep their own clock.
    prisma.championships.updateMany({
      where: { host_organization_id: orgId, archived_at: null },
      data: { archived_at: now, archived_by: actorId, archived_with_org: true },
    }),
    prisma.championship_invitations.updateMany({
      where: { organization_id: orgId, org_unit_id: null, status: 'pending' },
      data: { status: 'cancelled', responded_at: now },
    }),
    prisma.championship_organizations.deleteMany({ where: { id: { in: teamless.map((e) => e.id) } } }),
  ]);
  return { archived_at: now, events_archived: events.count, invitations_cancelled: invitations.count, entries_withdrawn: teamless.length };
}

/** Retrieve: the organisation and exactly the events its archive took with it. */
export async function retrieveOrganization(prisma: Prisma, orgId: string) {
  const org = await prisma.organizations.findUnique({ where: { id: orgId }, select: { archived_at: true } });
  if (!org) throw new NotFoundError('Organization');
  if (!org.archived_at) throw new BusinessRuleError('This organisation is not archived.');
  const [, events] = await prisma.$transaction([
    prisma.organizations.update({ where: { id: orgId }, data: { archived_at: null, archived_by: null } }),
    prisma.championships.updateMany({
      where: { host_organization_id: orgId, archived_with_org: true },
      data: { archived_at: null, archived_by: null, archived_with_org: false },
    }),
  ]);
  return { events_restored: events.count };
}
