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

    const [hosted, entries] = await Promise.all([
      // Hosting: created by somebody in this organisation. `created_by` is the only
      // link a championship carries back to an org today - there is no host_org_id
      // yet, which the schema audit flagged as a column the event table still needs.
      prisma.championships.findMany({
        where: { championship_organizations: { some: { organization_id: orgId, status: 'approved' } } },
        select: {
          id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true,
          _count: { select: { championship_organizations: true } },
        },
        orderBy: { start_date: 'desc' },
      }),
      prisma.championship_organizations.findMany({
        where: { organization_id: orgId },
        select: {
          status: true, applied_at: true,
          championships: {
            select: {
              id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true,
              _count: { select: { championship_organizations: true } },
            },
          },
        },
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

    const rows = entries
      .filter((e) => e.championships)
      .map((e) => ({
        ...e.championships!,
        relationship: e.status === 'approved' ? 'participating' : e.status,
        applied_at: e.applied_at,
        our_teams: teamsByEvent.get(e.championships!.id) ?? 0,
        participant_count: e.championships!._count.championship_organizations,
      }));

    res.json({ rows, hosted_count: hosted.length });
  }));

  return router;
}
