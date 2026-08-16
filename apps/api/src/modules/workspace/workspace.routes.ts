import { Router } from 'express';
import { Prisma as PrismaNS } from '@prisma/client';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError } from '../../shared/errors.js';

// The institution home (J1-E7).
//
// One request, because this is the first screen of the workspace and six round trips
// would show six spinners. Everything here is derived live from small aggregates -
// there is no cached summary table, and a `synced across N records` strip that could
// drift from the truth would be exactly the fabricated trust signal J1-E7-S5 refuses.
//
// The pending-actions queue is deliberately capability-shaped: an item is emitted only
// when the thing it links to exists. An empty queue means "nothing needs you", never
// "this feature is missing", so the two can never be confused on screen.

export function makeWorkspaceRouter(prisma: Prisma): Router {
  const router = Router();

  /** Anyone active in the institution may see its home; the tiles respect module access. */
  const assertMember = async (req: any, organizationId: string) => {
    const allowed = await can(prisma, 'people.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active' },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You are not a member of this institution.');
  };

  router.get('/organizations/:id/dashboard', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await assertMember(req, organizationId);

    const org = await prisma.organizations.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, short_name: true, logo_url: true, kind: true, verified: true, city: true },
    });
    if (!org) throw new ForbiddenError('This institution is not available.');

    // Championships this institution hosts or has entered - the scope every
    // championship-shaped number below is counted within.
    const [hostedRoles, entered] = await Promise.all([
      prisma.user_championship_roles.findMany({
        where: { users_user_championship_roles_user_idTousers: { organization_members: { some: { organization_id: organizationId, status: 'active' } } },
                 roles: { code: 'organiser' } },
        select: { championship_id: true },
      }),
      prisma.championship_organizations.findMany({
        where: { organization_id: organizationId, status: 'approved' },
        select: { championship_id: true },
      }),
    ]);
    const champIds = [...new Set([...hostedRoles.map((r) => r.championship_id), ...entered.map((e) => e.championship_id)])];
    const inScope = { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: { in: champIds } } } } };

    const [
      people, pendingPeople, teams, championships, liveNow, awaitingApproval,
      readyToLock, unverifiedPeople, units, achievements,
    ] = await Promise.all([
      prisma.organization_members.count({ where: { organization_id: organizationId, status: 'active' } }),
      prisma.organization_members.count({ where: { organization_id: organizationId, status: 'active', verification: 'pending' } }),
      prisma.teams.count({ where: { organization_id: organizationId } }),
      champIds.length ? prisma.championships.count({ where: { id: { in: champIds } } }) : Promise.resolve(0),
      champIds.length ? prisma.fixtures.count({ where: { status: 'live', ...inScope } }) : Promise.resolve(0),
      champIds.length ? prisma.championship_organizations.count({ where: { championship_id: { in: champIds }, status: 'pending' } }) : Promise.resolve(0),
      champIds.length ? prisma.fixtures.count({ where: { scorecard_status: 'submitted', ...inScope } }) : Promise.resolve(0),
      prisma.organization_members.count({ where: { organization_id: organizationId, status: 'active', verification: 'pending' } }),
      prisma.org_units.count({ where: { organization_id: organizationId } }),
      prisma.achievements.count({ where: { organization_id: organizationId, superseded_at: null } }),
    ]);

    // Live and upcoming, in one list the home page can render as-is (J1-E7-S4).
    const events = champIds.length
      ? await prisma.championships.findMany({
        where: { id: { in: champIds } },
        orderBy: [{ start_date: 'desc' }],
        take: 6,
        select: { id: true, name: true, status: true, start_date: true, end_date: true, venue: true,
                  tournaments: { select: { tournament_sports: { select: { sports: { select: { name: true } } } } } } },
      })
      : [];

    // Unique participants per season, most recent six (J1-E7-S3). Season = the
    // calendar year the championship started in, which is what an institution means
    // by "last year" without configuring anything.
    // Parameterised with Prisma.join rather than an array bind: a JS array arrives as
    // text and `uuid = text` has no operator, so each id is cast individually - the
    // same pattern findUsersByPhones uses.
    const trendRows = champIds.length
      ? await prisma.$queryRaw<Array<{ season: number; participants: bigint }>>(
        PrismaNS.sql`
          select extract(year from c.start_date)::int as season,
                 count(distinct tm.user_id) as participants
            from championships c
            join tournaments tn on tn.championship_id = c.id
            join tournament_sports ts on ts.tournament_id = tn.id
            join tournament_disciplines td on td.tournament_sport_id = ts.id
            join team_entries te on te.tournament_discipline_id = td.id
            join team_members tm on tm.team_id = te.team_id
           where c.id in (${PrismaNS.join(champIds.map((id) => PrismaNS.sql`${id}::uuid`))})
             and te.organization_id = ${organizationId}::uuid
           group by 1 order by 1 desc limit 6`,
      )
      : [];
    const trend = trendRows.map((r) => ({ season: r.season, participants: Number(r.participants) })).reverse();
    const withDelta = trend.map((row, i) => {
      const prev = i > 0 ? trend[i - 1].participants : null;
      return {
        ...row,
        // "no comparison available" rather than a fabricated 0% or 100% (J1-E7-S3).
        delta_pct: prev && prev > 0 ? Math.round(((row.participants - prev) / prev) * 100) : null,
      };
    });

    // Only actionable items, each with somewhere to go. An item with a zero count is
    // dropped rather than rendered greyed out - a queue of noughts is not a queue.
    const actions = [
      { key: 'approve_entries', label: 'Applications awaiting your decision', count: awaitingApproval,
        cta: 'Review', href: champIds.length === 1 ? `/championships/${champIds[0]}/approvals` : '/championships' },
      { key: 'lock_scorecards', label: 'Scorecards submitted and ready to lock', count: readyToLock,
        cta: 'Lock results', href: champIds.length === 1 ? `/championships/${champIds[0]}/results` : '/championships' },
      { key: 'verify_people', label: 'People awaiting verification', count: unverifiedPeople,
        cta: 'Verify', href: `/organizations/${organizationId}/members?verification=pending` },
    ].filter((a) => a.count > 0);

    // The strip is a count of what the workspace actually holds. It is emitted only
    // when every part of it is real (J1-E7-S5).
    const records = people + teams + achievements + units;

    res.set('Cache-Control', 'no-store');
    res.json({
      organization: org,
      kpis: {
        people, teams, championships, matches_live_now: liveNow,
        awaiting_approval: awaitingApproval, pending_verification: pendingPeople,
        // Certificates are Wave 5. Reported as null, not 0, so the tile can say
        // "not yet available" instead of claiming a true zero.
        certificates_pending: null,
      },
      pending_actions: actions,
      events: events.map((e) => ({
        id: e.id, name: e.name, status: e.status, venue: e.venue,
        start_date: e.start_date, end_date: e.end_date,
        sports: [...new Set(e.tournaments.flatMap((t) => t.tournament_sports.map((s) => s.sports.name)))].slice(0, 5),
      })),
      participation_trend: withDelta,
      sync: { records, as_of: new Date().toISOString() },
    });
  }));

  return router;
}
