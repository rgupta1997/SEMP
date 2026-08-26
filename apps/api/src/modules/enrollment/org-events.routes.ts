import { Router } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { ForbiddenError } from '../../shared/errors.js';

// Every event an organisation is associated with, in one table (F-068).
//
// Three relationships, deliberately in one list rather than three:
//
//   HOSTING        the org created it
//   PARTICIPATING  the org applied and was approved
//   APPLIED        the org applied and is waiting
//
// An organiser asking "what are we in?" does not think of those as separate
// questions, and three tabs would make them look like three systems.

export function makeOrgEventsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // Any active member may see what their organisation is entered in - it is the
  // organisation's own diary, not privileged information.
  router.get('/:id/events', asyncHandler(async (req, res) => {
    const orgId = req.params.id;
    const u = req.user!;
    const member = u.isSuperAdmin
      || await guards.orgRole(u.id, orgId, ['owner', 'admin', 'member', 'viewer']);
    if (!member) throw new ForbiddenError('You are not a member of this organisation');

    const select = {
      id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true,
      _count: { select: { championship_organizations: true } },
    } as const;

    const [hosted, entries] = await Promise.all([
      // Hosting is now a fact on the event itself rather than something inferred
      // from which organisation an organiser happens to belong to.
      prisma.championships.findMany({
        where: { host_organization_id: orgId },
        select,
        orderBy: { start_date: 'desc' },
      }),
      prisma.championship_organizations.findMany({
        where: { organization_id: orgId },
        select: { status: true, applied_at: true, championships: { select } },
        orderBy: { applied_at: 'desc' },
      }),
    ]);

    // Team entries tell us how much of the org is actually in each event, which is
    // the number an organiser wants before the participant count.
    const teamCounts = await prisma.team_entries.groupBy({
      by: ['championship_id'],
      where: { organization_id: orgId },
      _count: { _all: true },
    });
    const teamsByEvent = new Map(teamCounts.map((t) => [t.championship_id, t._count._all]));

    const shape = (c: (typeof hosted)[number], relationship: string, applied_at: Date | null) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      start_date: c.start_date,
      end_date: c.end_date,
      venue: c.venue,
      relationship,
      applied_at,
      our_teams: teamsByEvent.get(c.id) ?? 0,
      participant_count: c._count.championship_organizations,
    });

    // An organisation can host an event AND enter it, which is normal at an
    // inter-college fixture. Hosting is the stronger claim, so it wins the row -
    // one event, one line, rather than the same name twice with two verbs.
    const hostedIds = new Set(hosted.map((c) => c.id));
    const rows = [
      ...hosted.map((c) => shape(c, 'hosting', null)),
      ...entries
        .filter((e) => e.championships && !hostedIds.has(e.championships.id))
        .map((e) => shape(
          e.championships!,
          e.status === 'approved' ? 'participating' : e.status,
          e.applied_at,
        )),
    ];

    res.json({ rows, hosted_count: hosted.length });
  }));

  return router;
}
