import { Router } from 'express';
import { seasonLabel } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { ForbiddenError } from '../../shared/errors.js';
import { orgScope, participantsIn } from '../reports/participation.service.js';

// The organisation dashboard (PG-20).
//
// The prototype's own note on this screen is the design constraint, and it is
// worth repeating because it decides what is NOT here:
//
//   "Approvals only. Scorecard locking, achievement validation and certificate
//    issuance belong to the event workspace, not to org admin."
//
// So the queue lists things an org administrator can settle from their own desk -
// entries to review, people waiting to be verified, a subscription about to
// renew - and stops at the boundary where the event workspace takes over.

/** Seasons shown on the trend. Six is what fits without the bars becoming stripes. */
const TREND_SEASONS = 6;

export function makeOrgDashboardRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  router.get('/:id/dashboard', asyncHandler(async (req, res) => {
    const orgId = req.params.id;
    const u = req.user!;
    if (!u.isSuperAdmin && !await guards.orgRole(u.id, orgId, ['owner', 'admin', 'member', 'viewer'])) {
      throw new ForbiddenError('You are not a member of this organisation');
    }
    const canApprove = u.isSuperAdmin || await guards.orgRole(u.id, orgId, ['owner', 'admin']);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      players, pendingPeople, teams, upcoming, live,
      pendingEntries, certsPending, achievements, scope,
    ] = await Promise.all([
      prisma.organization_members.count({ where: { organization_id: orgId, status: 'active' } }),
      prisma.organization_members.count({ where: { organization_id: orgId, status: 'pending' } }),
      prisma.teams.count({ where: { organization_id: orgId } }),

      prisma.championships.findMany({
        where: {
          AND: [
            {
              OR: [
                { host_organization_id: orgId },
                { championship_organizations: { some: { organization_id: orgId, status: 'approved' } } },
              ],
            },
            {
              // Not yet finished, OR still running. An event whose dates have passed
              // but which nobody has closed is exactly the one an organiser needs to
              // see - filtering it out by date would hide the thing that needs doing.
              OR: [
                { end_date: { gte: today } },
                { status: { in: ['ongoing', 'registration_open'] } },
              ],
            },
          ],
        },
        select: { id: true, name: true, status: true, start_date: true, end_date: true, venue: true },
        orderBy: { start_date: 'asc' },
        take: 6,
      }),

      // "Live now" means a match in progress, not an event whose dates cover today -
      // an organiser glancing at this wants to know whether anything needs watching.
      prisma.fixtures.count({
        where: {
          status: 'in_progress',
          tournament_disciplines: {
            tournament_sports: {
              tournaments: {
                championships: {
                  OR: [
                    { host_organization_id: orgId },
                    { championship_organizations: { some: { organization_id: orgId, status: 'approved' } } },
                  ],
                },
              },
            },
          },
        },
      }),

      // Entries this organisation has applied for and is still waiting on. Shown
      // because it is the org's own queue - somebody else has to act, but the
      // organisation is the one being kept waiting.
      prisma.championship_organizations.count({ where: { organization_id: orgId, status: 'pending' } }),

      // Certificates generated but not yet issued to anybody.
      prisma.certificates.count({ where: { organization_id: orgId, revoked_at: null, user_id: null } }),

      prisma.achievements.findMany({
        where: { organization_id: orgId, superseded_at: null },
        select: {
          id: true, title: true, medal: true, kind: true, occurred_on: true, team_id: true,
          users: { select: { name: true } },
        },
        orderBy: { occurred_on: 'desc' },
        take: 5,
      }),

      orgScope(prisma, orgId),
    ]);

    const teamIds = achievements.map((a) => a.team_id).filter((id): id is string => !!id);
    const teams_ = teamIds.length
      ? await prisma.teams.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [];
    const teamName = new Map(teams_.map((t) => [t.id, t.name]));

    // Participation per season, oldest first so the bars read left to right.
    const seasons = [...scope.bySeason.keys()].sort((a, b) => a - b).slice(-TREND_SEASONS);
    const trend = [] as Array<{ season: number; label: string; participants: number }>;
    for (const s of seasons) {
      const rows = await participantsIn(prisma, orgId, scope.bySeason.get(s) ?? []);
      trend.push({
        season: s,
        label: seasonLabel(s, scope.startMonth),
        participants: new Set(rows.map((r) => r.user_id)).size,
      });
    }
    // No fabricated comparison: one season has no predecessor, so it has no delta.
    const yoy = trend.length >= 2 && trend[trend.length - 2].participants > 0
      ? Math.round(((trend[trend.length - 1].participants - trend[trend.length - 2].participants)
        / trend[trend.length - 2].participants) * 100)
      : null;

    const queue = [
      pendingPeople > 0 && {
        key: 'people',
        text: `${pendingPeople} ${pendingPeople === 1 ? 'person is' : 'people are'} waiting to be verified`,
        sub: 'Joined by invitation or domain sign-up',
        cta: 'Review', to: `/organizations/${orgId}/students`, tone: 'amber' as const,
      },
      pendingEntries > 0 && {
        key: 'entries',
        text: `${pendingEntries} ${pendingEntries === 1 ? 'entry is' : 'entries are'} awaiting the organiser`,
        sub: 'Events you have applied to and not yet heard back from',
        cta: 'View', to: `/organizations/${orgId}/events`, tone: 'brand' as const,
      },
      certsPending > 0 && {
        key: 'certificates',
        text: `${certsPending} ${certsPending === 1 ? 'certificate is' : 'certificates are'} generated but unissued`,
        sub: 'Ready to send to their recipients',
        cta: 'Issue', to: `/organizations/${orgId}/certificates`, tone: 'brand' as const,
      },
    ].filter(Boolean);

    res.json({
      can_approve: canApprove,
      kpis: {
        players, teams,
        upcoming_events: upcoming.length,
        awaiting_approval: pendingPeople + pendingEntries,
        certificates_pending: certsPending,
        live_now: live,
      },
      queue,
      trend,
      yoy,
      upcoming,
      achievements: achievements.map((a) => ({
        id: a.id,
        // A team honour belongs to the team by name. "Team honour" is a category,
        // and a list of four rows all reading "Team honour" tells nobody anything.
        name: a.users?.name ?? (a.team_id ? teamName.get(a.team_id) ?? 'Team' : 'Team'),
        title: a.title,
        tag: a.medal ? a.medal.toUpperCase() : a.users ? a.kind.toUpperCase() : 'TEAM',
        occurred_on: a.occurred_on,
      })),
    });
  }));

  return router;
}
