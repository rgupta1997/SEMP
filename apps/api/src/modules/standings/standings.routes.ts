import { Router } from 'express';
import { DEFAULT_STANDINGS_RULE, STANDINGS_AGG_SCOPE, upsertStandingsRuleSchema, type StandingsAggScope } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError } from '../../shared/errors.js';
import { readStandings, readStandingsBreakdown, recomputeStandings, countCompletedMatches } from './standings.service.js';

// Standings = materialized org-level tables (read) + editable scoring rules (write).
// Mounted under /championships alongside the events router.
export function makeStandingsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const ownChampionship = guards.championshipManager(async (req) => req.params.id);

  // Read a standings table for a scope. Default scope = championship; tournament and
  // sport require a scopeId (the tournament_id / sport_id). Rows are pre-ranked.
  router.get('/:id/standings', asyncHandler(async (req, res) => {
    const scope = (req.query.scope as StandingsAggScope) || 'championship';
    if (!STANDINGS_AGG_SCOPE.includes(scope)) throw new NotFoundError('Scope');
    const scopeId = scope === 'championship' ? null : (req.query.scopeId as string | undefined) ?? null;
    if (scope !== 'championship' && !scopeId) {
      return res.json({ scope, scope_id: null, standings: [] });
    }
    const standings = await readStandings(prisma, req.params.id, scope, scopeId);
    const completed_matches = await countCompletedMatches(prisma, req.params.id, scope, scopeId);
    res.json({ scope, scope_id: scopeId, standings, completed_matches });
  }));

  // Per-event breakdown for one org in a scope: which draws contributed how many points
  // (and the matches behind them). Drives the expandable standings row.
  router.get('/:id/standings/breakdown', asyncHandler(async (req, res) => {
    const scope = (req.query.scope as StandingsAggScope) || 'championship';
    if (!STANDINGS_AGG_SCOPE.includes(scope)) throw new NotFoundError('Scope');
    const scopeId = scope === 'championship' ? null : (req.query.scopeId as string | undefined) ?? null;
    const orgId = req.query.orgId as string | undefined;
    if (!orgId) throw new NotFoundError('Organization');
    if (scope !== 'championship' && !scopeId) return res.json({ events: [] });
    const events = await readStandingsBreakdown(prisma, req.params.id, scope, scopeId, orgId);
    res.json({ events });
  }));

  // The championship's scoring rules + the format/discipline options the organiser
  // can override, so the editor can render the full matrix in one round-trip.
  router.get('/:id/standings-rules', ownChampionship, asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const [rules, draws] = await Promise.all([
      prisma.standings_rules.findMany({ where: { championship_id: championshipId } }),
      prisma.tournament_disciplines.findMany({
        where: { tournament_sports: { tournaments: { championship_id: championshipId } } },
        select: {
          format_id: true,
          entry_type: true,
          disciplines: { select: { id: true, name: true, entry_type: true, sports: { select: { name: true } } } },
          tournament_formats: { select: { id: true, name: true } },
          tournament_sports: { select: { format_id: true, tournament_formats: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    // Distinct formats + disciplines actually used in this championship. Disciplines carry
    // their sport + entry type + format so the editor rows are distinguishable (several
    // sports each have a "Men"/"Mixed" discipline that would otherwise look identical).
    const formats = new Map<string, string>();
    const disciplines = new Map<string, { name: string; sport: string | null; entry_type: string | null; format: string | null }>();
    for (const d of draws) {
      const fmt = d.tournament_formats ?? d.tournament_sports.tournament_formats;
      if (fmt) formats.set(fmt.id, fmt.name);
      if (d.disciplines && !disciplines.has(d.disciplines.id)) {
        disciplines.set(d.disciplines.id, {
          name: d.disciplines.name,
          sport: d.disciplines.sports?.name ?? null,
          entry_type: d.entry_type ?? d.disciplines.entry_type ?? null,
          format: fmt?.name ?? null,
        });
      }
    }

    res.json({
      default: DEFAULT_STANDINGS_RULE,
      rules: rules.map((r) => ({ id: r.id, scope_type: r.scope_type, scope_id: r.scope_id, config: r.config })),
      formats: [...formats].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      disciplines: [...disciplines].map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => (a.sport ?? '').localeCompare(b.sport ?? '') || a.name.localeCompare(b.name)),
    });
  }));

  // Upsert one scoping rule, then recompute the championship's standings.
  router.put('/:id/standings-rules', ownChampionship, validateBody(upsertStandingsRuleSchema), asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const { scope_type, config } = req.body;
    const scope_id = scope_type === 'championship' ? null : req.body.scope_id;

    const existing = await prisma.standings_rules.findFirst({
      where: { championship_id: championshipId, scope_type, scope_id: scope_id ?? null },
      select: { id: true },
    });
    const row = existing
      ? await prisma.standings_rules.update({ where: { id: existing.id }, data: { config, updated_at: new Date() } })
      : await prisma.standings_rules.create({ data: { championship_id: championshipId, scope_type, scope_id, config } });

    await recomputeStandings(prisma, championshipId);
    res.json({ id: row.id, scope_type: row.scope_type, scope_id: row.scope_id, config: row.config });
  }));

  // Remove an override (reverts that scope to its inherited rule), then recompute.
  router.delete('/:id/standings-rules/:ruleId', ownChampionship, asyncHandler(async (req, res) => {
    const rule = await prisma.standings_rules.findUnique({ where: { id: req.params.ruleId }, select: { championship_id: true } });
    if (!rule || rule.championship_id !== req.params.id) throw new NotFoundError('Standings rule');
    await prisma.standings_rules.delete({ where: { id: req.params.ruleId } });
    await recomputeStandings(prisma, req.params.id);
    res.json({ ok: true });
  }));

  return router;
}
