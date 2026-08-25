import { Router } from 'express';
import { Prisma as PrismaNS } from '@prisma/client';
import { seasonLabel, seasonOf, seasonStartMonthOf, MIN_COHORT } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';

// Anonymised peer benchmark (J5-E4).
//
// The most dangerous report in the product. "How do we compare?" is a fair question,
// and the honest answer requires other institutions' numbers - which they did not give
// us for this. Four rules make it safe, and none of them is optional:
//
//   1. OPT IN. An institution that has not turned this on is neither shown the tab nor
//      served by the endpoint. Being compared without knowing is the harm.
//   2. NEVER NAMED. Medians and deciles only. No leaderboard, no "you are 4th", no
//      row anybody could match to a school.
//   3. SILENT ON THIN COHORTS. Below five peers, a median is one institution's numbers
//      wearing a disguise, so it reports "insufficient data" instead.
//   4. SELF EXCLUDED. You are not part of the cohort you are measured against, or a
//      small platform would mostly be comparing you to yourself.
//
// Personal organisations are excluded everywhere. A solo entrant counted as an
// institution would wreck "medals per 100 athletes" - one person, one medal, 100%.

interface Peer { organization_id: string; athletes: number; events: number; medals: number; women: number }

export function makeBenchmarkRouter(prisma: Prisma): Router {
  const router = Router();

  router.get('/organizations/:id/reports/benchmark', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;

    const allowed = await can(prisma, 'report.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to view reports for this institution.');

    const org = await prisma.organizations.findUnique({
      where: { id: organizationId }, select: { name: true, settings: true, kind: true },
    });
    if (!org) throw new NotFoundError('Organisation');

    // Rule 1. Refused outright, not merely hidden - a tab that is not rendered is not
    // a boundary, and the request is what actually reads other institutions' data.
    const settings = (org.settings ?? {}) as { benchmarking_enabled?: boolean };
    if (!settings.benchmarking_enabled) {
      throw new ForbiddenError('Peer benchmarking is switched off for this institution. An owner can enable it in Administration.');
    }

    const startMonth = seasonStartMonthOf(org.settings);
    const season = Number.isInteger(Number(req.query.season)) ? Number(req.query.season) : seasonOf(new Date(), startMonth);

    // One pass over every institution's season. Personal workspaces are excluded here
    // rather than filtered later, so they cannot reach any aggregate below.
    const rows = await prisma.$queryRaw<Peer[]>(PrismaNS.sql`
      with season_champs as (
        select c.id
          from championships c
         where extract(year from c.start_date)::int
               - case when extract(month from c.start_date)::int >= ${startMonth} then 0 else 1 end = ${season}
      ),
      participation as (
        select te.organization_id,
               count(distinct tm.user_id) as athletes,
               count(distinct te.championship_id) as events
          from team_entries te
          join team_members tm on tm.team_id = te.team_id
         where te.championship_id in (select id from season_champs)
         group by 1
      ),
      medals as (
        select a.organization_id, count(*) as medals
          from achievements a
         where a.medal is not null and a.superseded_at is null
           and a.championship_id in (select id from season_champs)
         group by 1
      ),
      women as (
        select te.organization_id, count(distinct tm.user_id) as women
          from team_entries te
          join team_members tm on tm.team_id = te.team_id
          join users u on u.id = tm.user_id
         where te.championship_id in (select id from season_champs) and u.gender = 'female'
         group by 1
      )
      select p.organization_id,
             p.athletes::int, p.events::int,
             coalesce(m.medals, 0)::int as medals,
             coalesce(w.women, 0)::int as women
        from participation p
        join organizations o on o.id = p.organization_id
        left join medals m on m.organization_id = p.organization_id
        left join women w on w.organization_id = p.organization_id
       where o.kind <> 'personal'`);

    const mine = rows.find((r) => r.organization_id === organizationId) ?? null;
    // Rule 4.
    const peers = rows.filter((r) => r.organization_id !== organizationId);

    const metrics = [
      { key: 'athletes', label: 'Athletes competing', of: (r: Peer) => r.athletes, unit: '' },
      { key: 'events', label: 'Events entered', of: (r: Peer) => r.events, unit: '' },
      { key: 'womens_share', label: "Women's participation", of: (r: Peer) => (r.athletes ? Math.round((r.women / r.athletes) * 100) : 0), unit: '%' },
      { key: 'medals_per_100', label: 'Medals per 100 athletes', of: (r: Peer) => (r.athletes ? Math.round((r.medals / r.athletes) * 100) : 0), unit: '' },
    ];

    const quantile = (sorted: number[], q: number) => {
      if (!sorted.length) return null;
      const i = (sorted.length - 1) * q;
      const lo = Math.floor(i); const hi = Math.ceil(i);
      return Math.round(lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
    };

    const results = metrics.map((m) => {
      const values = peers.map(m.of).sort((a, b) => a - b);
      // Rule 3.
      if (values.length < MIN_COHORT) {
        return { key: m.key, label: m.label, unit: m.unit, you: mine ? m.of(mine) : null, insufficient_data: true };
      }
      const you = mine ? m.of(mine) : null;
      const below = you === null ? 0 : values.filter((v) => v < you).length;
      return {
        key: m.key, label: m.label, unit: m.unit,
        you,
        median: quantile(values, 0.5),
        top_decile: quantile(values, 0.9),
        percentile: you === null ? null : Math.round((below / values.length) * 100),
        insufficient_data: false,
      };
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      organization: { id: organizationId, name: org.name },
      season, season_label: seasonLabel(season, startMonth),
      cohort_size: peers.length,
      min_cohort: MIN_COHORT,
      metrics: results,
      // Rule 2, said out loud on the page as well as enforced in the query.
      basis: `Compared against ${peers.length} other institution${peers.length === 1 ? '' : 's'} on the platform. No institution is named or ranked, your own figures are excluded from the comparison, and a cohort below ${MIN_COHORT} reports no figure at all.`,
    });
  }));

  return router;
}
