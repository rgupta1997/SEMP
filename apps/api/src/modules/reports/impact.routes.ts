import { Router } from 'express';
import { z } from 'zod';
import { seasonLabel, seasonOf, seasonStartMonthOf } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';

// The Annual Sports Impact Report (J5-E5).
//
// A job, not a request. Lambda gives a synchronous call 15 seconds and this reads a
// whole season across three report families - so the endpoint returns an id and the
// client polls. That is the constraint making the job model mandatory rather than
// tidy, and it is the same seam J4-E7's batch will move onto when the worker lands.
//
// Everything in the output comes from the report endpoints that already exist. The
// report is a COMPOSITION, not a fourth derivation: a board pack whose numbers differ
// from the screen they were promised on is worse than no board pack.

const generateSchema = z.object({ season: z.number().int().min(2000).max(2100).optional() });

export function makeImpactRouter(prisma: Prisma, buildReport: (organizationId: string, season: number) => Promise<unknown>): Router {
  const router = Router();

  const gate = async (req: any, organizationId: string) => {
    const allowed = await can(prisma, 'report.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to produce reports for this institution.');
  };

  router.post('/organizations/:id/reports/impact', validateBody(generateSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    await gate(req, organizationId);
    const org = await prisma.organizations.findUnique({ where: { id: organizationId }, select: { settings: true } });
    if (!org) throw new NotFoundError('Organisation');
    const startMonth = seasonStartMonthOf(org.settings);
    const season = req.body.season ?? seasonOf(new Date(), startMonth);

    // One live job per season. Somebody clicking Generate three times because nothing
    // visibly happened should get the job they already have, not three of them.
    const running = await prisma.report_jobs.findFirst({
      where: { organization_id: organizationId, kind: 'impact', season, status: { in: ['queued', 'running'] } },
    });
    if (running) return void res.status(202).json(running);

    const job = await prisma.report_jobs.create({
      data: { organization_id: organizationId, kind: 'impact', season, requested_by: req.user!.id },
    });

    // Kicked off after the response. In production this is where the row is handed to
    // the worker; here the same function runs in-process, which is why the job's shape
    // - claim, progress, finish - is the queue's shape rather than a callback.
    void (async () => {
      try {
        await prisma.report_jobs.update({ where: { id: job.id }, data: { status: 'running', started_at: new Date(), progress: 10 } });
        const result = await buildReport(organizationId, season);
        await prisma.report_jobs.update({
          where: { id: job.id },
          data: { status: 'done', progress: 100, finished_at: new Date(), result: result as object },
        });
      } catch (e: any) {
        await prisma.report_jobs.update({
          where: { id: job.id },
          // The error is kept on the job. A report that silently never finishes is the
          // failure mode that wastes an afternoon.
          data: { status: 'failed', finished_at: new Date(), error: (e?.message ?? 'Report generation failed').slice(0, 500) },
        }).catch(() => {});
      }
    })();

    res.status(202).json(job);
  }));

  router.get('/report-jobs/:jobId', asyncHandler(async (req, res) => {
    const job = await prisma.report_jobs.findUnique({ where: { id: req.params.jobId } });
    if (!job) throw new NotFoundError('Report job');
    await gate(req, job.organization_id);
    res.set('Cache-Control', 'no-store');
    res.json(job);
  }));

  router.get('/organizations/:id/report-jobs', asyncHandler(async (req, res) => {
    await gate(req, req.params.id);
    const rows = await prisma.report_jobs.findMany({
      where: { organization_id: req.params.id }, orderBy: { created_at: 'desc' }, take: 20,
      select: { id: true, kind: true, season: true, status: true, progress: true, error: true, created_at: true, finished_at: true },
    });
    res.json({ rows });
  }));

  return router;
}

/** The report itself: the three families, composed, with the branding line J5-E5-S1 asks for. */
export function makeImpactBuilder(prisma: Prisma, fetchers: {
  participation: (orgId: string, season: number) => Promise<any>;
  performance: (orgId: string, season: number) => Promise<any>;
  inclusion: (orgId: string, season: number) => Promise<any>;
}) {
  return async (organizationId: string, season: number) => {
    const org = await prisma.organizations.findUnique({
      where: { id: organizationId }, select: { name: true, logo_url: true, settings: true, verified: true },
    });
    const startMonth = seasonStartMonthOf(org?.settings);
    const label = seasonLabel(season, startMonth);

    const [participation, performance, inclusion] = await Promise.all([
      fetchers.participation(organizationId, season),
      fetchers.performance(organizationId, season),
      fetchers.inclusion(organizationId, season),
    ]);

    return {
      // Exactly the wording J5-E5-S1 specifies, including "Verified data" - which is
      // only true because every figure below comes from locked results.
      title: `${(org?.name ?? '').toUpperCase()} — SPORTS IMPACT ${label}`,
      footer: 'Powered by Sportagon EOS · Verified data',
      organization: { name: org?.name ?? '', logo_url: org?.logo_url ?? null, verified: org?.verified ?? false },
      season, season_label: label,
      generated_at: new Date().toISOString(),
      headline: {
        participants: participation?.kpis?.participants?.value ?? 0,
        events: participation?.kpis?.events?.value ?? 0,
        matches_played: participation?.kpis?.matches_played?.value ?? 0,
        medals: performance?.kpis?.medals?.value ?? 0,
        win_rate_pct: performance?.kpis?.win_rate_pct?.value ?? null,
        first_time_athletes: inclusion?.first_time_athletes?.value ?? 0,
      },
      participation, performance, inclusion,
      basis: 'Every figure in this report derives from locked results only.',
    };
  };
}
