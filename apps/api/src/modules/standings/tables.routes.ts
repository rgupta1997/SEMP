import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { readTieResolutions, tieResolutionInputSchema, type TieResolution } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { AUDIT_ACTIONS, audit } from '../iam/audit.service.js';
import { resolveStageAdvancement } from '../fixtures/domain/stage-resolver.js';
import { recomputeStandingsAtomic } from './standings.service.js';
import { isCurrentTie, readDrawTables, sameResolution } from './tables.service.js';

// Group / league tables of a draw, and the organiser's hand-picked order for ties the
// tie-breakers can't split. A pick feeds both knockout advancement and placings.
export function makeStandingsTablesRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const drawOrganiser = guards.championshipManager(async (req) => guards.resolvers.championshipOfTournamentDiscipline(req.params.id));

  router.get('/tournament-disciplines/:id/standings-tables', asyncHandler(async (req, res) => {
    res.json(await readDrawTables(prisma, req.params.id));
  }));

  async function saveResolutions(drawId: string, list: TieResolution[]) {
    const td = await prisma.tournament_disciplines.findUnique({ where: { id: drawId }, select: { format_config: true } });
    await prisma.tournament_disciplines.update({
      where: { id: drawId },
      data: { format_config: { ...((td?.format_config as object | null) ?? {}), tieResolutions: list } as object },
    });
  }

  async function settle(drawId: string, championshipId: string) {
    await resolveStageAdvancement(prisma, drawId);
    await recomputeStandingsAtomic(prisma, championshipId);
  }

  router.post('/tournament-disciplines/:id/tie-resolutions', drawOrganiser, validateBody(tieResolutionInputSchema), asyncHandler(async (req, res) => {
    const { scope, stage, order, reason } = req.body as { scope: 'pool' | 'placing'; stage: number; pool: number | null; order: string[]; reason: string };
    const pool = scope === 'placing' ? null : req.body.pool;
    if (new Set(order).size !== order.length) throw new BusinessRuleError('Each team can appear only once.');
    const tables = await readDrawTables(prisma, req.params.id);
    if (!isCurrentTie(tables, scope, stage, pool, order)) throw new BusinessRuleError('These teams are not tied right now. Refresh the table and try again.');

    const by = req.user!.id;
    const user = await prisma.users.findUnique({ where: { id: by }, select: { name: true } });
    const entry: TieResolution = { id: randomUUID(), scope, stage, pool, order, reason, by, by_name: user?.name ?? null, at: new Date().toISOString() };
    const list = tables.resolutions.filter((r) => !sameResolution(r, scope, stage, pool, order));
    await saveResolutions(req.params.id, [...list, entry]);

    const names = order.map((id) => tables.names[id] ?? id).join(' > ');
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.standingsTieResolved,
      championshipId: tables.championship_id,
      target: { type: 'tournament_disciplines', id: req.params.id, label: [tables.sport, tables.discipline].filter(Boolean).join(' · ') },
      summary: `Resolved a tie: ${names}. Reason: ${reason}`,
    });
    await settle(req.params.id, tables.championship_id);
    res.json(await readDrawTables(prisma, req.params.id));
  }));

  router.delete('/tournament-disciplines/:id/tie-resolutions/:resolutionId', drawOrganiser, asyncHandler(async (req, res) => {
    const td = await prisma.tournament_disciplines.findUnique({ where: { id: req.params.id }, select: { format_config: true } });
    const list = readTieResolutions(td?.format_config);
    const gone = list.find((r) => r.id === req.params.resolutionId);
    if (!gone) throw new NotFoundError('Tie resolution');
    await saveResolutions(req.params.id, list.filter((r) => r !== gone));
    const tables = await readDrawTables(prisma, req.params.id);
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.standingsTieCleared,
      championshipId: tables.championship_id,
      target: { type: 'tournament_disciplines', id: req.params.id, label: [tables.sport, tables.discipline].filter(Boolean).join(' · ') },
      summary: `Cleared a tie order: ${gone.order.map((id) => tables.names[id] ?? id).join(' > ')}`,
    });
    await settle(req.params.id, tables.championship_id);
    res.json(await readDrawTables(prisma, req.params.id));
  }));

  return router;
}
