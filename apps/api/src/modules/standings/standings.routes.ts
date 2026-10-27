import { Router } from 'express';
import {
  DEFAULT_STANDINGS_RULE, DEFAULT_TITLE_PLACING, SPORT_TITLES_SCOPE, STANDINGS_AGG_SCOPE, contingentKey, defaultGroupRanking, sportTitlesSchema,
  standingsAdjustmentInputSchema, upsertStandingsRuleSchema, type StandingsAggScope,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { AUDIT_ACTIONS, audit } from '../iam/audit.service.js';
import { readStandings, readStandingsBreakdown, recomputeStandingsAtomic, countCompletedMatches } from './standings.service.js';

// Standings = materialized org-level tables (read) + editable scoring rules (write).
// Mounted under /championships alongside the events router.
export function makeStandingsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const ownChampionship = guards.championshipManager(async (req) => req.params.id);
  const organisingTeam = guards.championshipViewer(async (req) => req.params.id);

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
    // `entityId` is the contingent key - a unit id in an intra championship, an
    // organisation id in an inter one. `orgId` stays accepted as the old name so a
    // client mid-deploy keeps working; the two mean the same thing for every
    // inter-organisation event, which is all the old clients ever asked about.
    const entityId = (req.query.entityId ?? req.query.orgId) as string | undefined;
    if (!entityId) throw new NotFoundError('Competitor');
    if (scope !== 'championship' && !scopeId) return res.json({ events: [] });
    const events = await readStandingsBreakdown(prisma, req.params.id, scope, scopeId, entityId);
    res.json({ events });
  }));

  // The championship's scoring rules + the format/discipline options the organiser
  // can override, so the editor can render the full matrix in one round-trip.
  router.get('/:id/standings-rules', organisingTeam, asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const [rules, draws] = await Promise.all([
      prisma.standings_rules.findMany({ where: { championship_id: championshipId } }),
      prisma.tournament_disciplines.findMany({
        where: { tournament_sports: { tournaments: { championship_id: championshipId } } },
        select: {
          format_id: true,
          entry_type: true,
          disciplines: { select: { id: true, name: true, entry_type: true, sports: { select: { id: true, name: true } } } },
          tournament_formats: { select: { id: true, name: true } },
          tournament_sports: { select: { format_id: true, tournament_formats: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    // Distinct formats + disciplines actually used in this championship. Disciplines carry
    // their sport + entry type + format so the editor rows are distinguishable (several
    // sports each have a "Men"/"Mixed" discipline that would otherwise look identical).
    const formats = new Map<string, string>();
    const disciplines = new Map<string, { name: string; sport: string | null; sport_id: string | null; entry_type: string | null; format: string | null }>();
    const sports = new Map<string, string>();
    const disciplineDefaults = new Map<string, ReturnType<typeof defaultGroupRanking>>();
    for (const d of draws) {
      const fmt = d.tournament_formats ?? d.tournament_sports.tournament_formats;
      if (fmt) formats.set(fmt.id, fmt.name);
      if (d.disciplines && !disciplines.has(d.disciplines.id)) {
        disciplines.set(d.disciplines.id, {
          name: d.disciplines.name,
          sport: d.disciplines.sports?.name ?? null,
          sport_id: d.disciplines.sports?.id ?? null,
          entry_type: d.entry_type ?? d.disciplines.entry_type ?? null,
          format: fmt?.name ?? null,
        });
        disciplineDefaults.set(d.disciplines.id, defaultGroupRanking(d.disciplines.sports?.name));
      }
      if (d.disciplines?.sports) sports.set(d.disciplines.sports.id, d.disciplines.sports.name);
    }

    res.json({
      default: DEFAULT_STANDINGS_RULE,
      rules: rules.filter((r) => r.scope_type !== SPORT_TITLES_SCOPE)
        .map((r) => ({ id: r.id, scope_type: r.scope_type, scope_id: r.scope_id, config: r.config })),
      // Each sport's title setup (event sports), saved once per sport; null = never saved.
      sports: [...sports].map(([id, name]) => {
        const row = rules.find((r) => r.scope_type === SPORT_TITLES_SCOPE && r.scope_id === id);
        const parsed = row ? sportTitlesSchema.safeParse(row.config) : null;
        return { id, name, titles: parsed?.success ? parsed.data : null };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      default_title: DEFAULT_TITLE_PLACING,
      formats: [...formats].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      disciplines: [...disciplines].map(([id, v]) => ({ id, ...v, default_ranking: disciplineDefaults.get(id) }))
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

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.standingsRuleChanged,
      championshipId,
      target: { type: 'standings_rules', id: row.id, label: scope_type },
      summary: `Point system saved (${scope_type})`,
    });
    await recomputeStandingsAtomic(prisma, championshipId);
    res.json({ id: row.id, scope_type: row.scope_type, scope_id: row.scope_id, config: row.config });
  }));

  // Save one sport's title setup (on/off, each event's title, what each title pays), then recompute.
  router.put('/:id/sport-titles/:sportId', ownChampionship, validateBody(sportTitlesSchema), asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const sportId = req.params.sportId;
    const sport = await prisma.tournament_sports.findFirst({
      where: { sport_id: sportId, tournaments: { championship_id: championshipId } },
      select: { sports: { select: { name: true } } },
    });
    if (!sport) throw new NotFoundError('Sport in this championship');
    const existing = await prisma.standings_rules.findFirst({
      where: { championship_id: championshipId, scope_type: SPORT_TITLES_SCOPE, scope_id: sportId },
      select: { id: true },
    });
    const config = req.body;
    const row = existing
      ? await prisma.standings_rules.update({ where: { id: existing.id }, data: { config, updated_at: new Date() } })
      : await prisma.standings_rules.create({ data: { championship_id: championshipId, scope_type: SPORT_TITLES_SCOPE, scope_id: sportId, config } });
    const summary = !req.body.enabled ? 'off (raw event points)' : Object.entries(req.body.titles as Record<string, { places: number[]; participation: number }>)
      .map(([name, t]) => `${name} ${t.places.join('/')}, others ${t.participation}`).join('; ') || 'on, default points';
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.standingsRuleChanged,
      championshipId,
      target: { type: 'standings_rules', id: row.id, label: `${sport.sports?.name ?? 'Sport'} titles` },
      summary: `Sport titles saved for ${sport.sports?.name ?? 'sport'}: ${summary}`,
    });
    await recomputeStandingsAtomic(prisma, championshipId);
    res.json({ sport_id: sportId, titles: config });
  }));

  // Remove an override (reverts that scope to its inherited rule), then recompute.
  router.delete('/:id/standings-rules/:ruleId', ownChampionship, asyncHandler(async (req, res) => {
    const rule = await prisma.standings_rules.findUnique({ where: { id: req.params.ruleId }, select: { championship_id: true } });
    if (!rule || rule.championship_id !== req.params.id) throw new NotFoundError('Standings rule');
    await prisma.standings_rules.delete({ where: { id: req.params.ruleId } });
    await recomputeStandingsAtomic(prisma, req.params.id);
    res.json({ ok: true });
  }));

  // ---- Manual adjustments: +/- points per contingent with a reason ----

  router.get('/:id/standings-adjustments', ownChampionship, asyncHandler(async (req, res) => {
    const rows = await prisma.standings_adjustments.findMany({
      where: { championship_id: req.params.id },
      orderBy: { created_at: 'desc' },
      include: {
        organizations: { select: { name: true } },
        org_units: { select: { name: true } },
        users: { select: { name: true } },
        tournament_disciplines: { select: { disciplines: { select: { name: true } }, tournament_sports: { select: { sports: { select: { name: true } } } } } },
      },
    });
    res.json(rows.map((a) => ({
      id: a.id,
      entity_id: contingentKey({ orgId: a.organization_id, unitId: a.org_unit_id }),
      name: a.org_units?.name ?? a.organizations.name,
      points: a.points,
      reason: a.reason,
      discipline: a.tournament_disciplines
        ? [a.tournament_disciplines.tournament_sports.sports?.name, a.tournament_disciplines.disciplines?.name].filter(Boolean).join(' · ')
        : null,
      created_by: a.users?.name ?? null,
      created_at: a.created_at,
    })));
  }));

  router.post('/:id/standings-adjustments', ownChampionship, validateBody(standingsAdjustmentInputSchema), asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const { organization_id, org_unit_id, tournament_discipline_id, points, reason } = req.body;
    // Only a contingent with a team in this championship, and a draw that belongs to it.
    const team = await prisma.teams.findFirst({
      where: {
        organization_id, org_unit_id: org_unit_id ?? null,
        OR: [
          { fixtures_fixtures_home_team_idToteams: { some: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } } } } },
          { fixtures_fixtures_away_team_idToteams: { some: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } } } } },
        ],
      },
      select: { id: true },
    });
    if (!team) throw new BusinessRuleError('That institute has no team in this championship.');
    if (tournament_discipline_id) {
      const td = await prisma.tournament_disciplines.findFirst({ where: { id: tournament_discipline_id, tournament_sports: { tournaments: { championship_id: championshipId } } }, select: { id: true } });
      if (!td) throw new NotFoundError('Discipline');
    }
    const row = await prisma.standings_adjustments.create({
      data: {
        championship_id: championshipId, organization_id, org_unit_id: org_unit_id ?? null,
        tournament_discipline_id: tournament_discipline_id ?? null, points, reason, created_by: req.user!.id,
      },
      include: { organizations: { select: { name: true } }, org_units: { select: { name: true } } },
    });
    const name = row.org_units?.name ?? row.organizations.name;
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.standingsAdjusted,
      championshipId,
      organizationId: organization_id,
      target: { type: 'standings_adjustments', id: row.id, label: name },
      summary: `${points > 0 ? '+' : ''}${points} points to ${name}. Reason: ${reason}`,
    });
    await recomputeStandingsAtomic(prisma, championshipId);
    res.status(201).json({ id: row.id });
  }));

  router.delete('/:id/standings-adjustments/:adjustmentId', ownChampionship, asyncHandler(async (req, res) => {
    const row = await prisma.standings_adjustments.findUnique({
      where: { id: req.params.adjustmentId },
      include: { organizations: { select: { name: true } }, org_units: { select: { name: true } } },
    });
    if (!row || row.championship_id !== req.params.id) throw new NotFoundError('Adjustment');
    await prisma.standings_adjustments.delete({ where: { id: row.id } });
    const name = row.org_units?.name ?? row.organizations.name;
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.standingsAdjustmentRemoved,
      championshipId: req.params.id,
      organizationId: row.organization_id,
      target: { type: 'standings_adjustments', id: row.id, label: name },
      summary: `Removed ${row.points > 0 ? '+' : ''}${row.points} points from ${name} (${row.reason})`,
    });
    await recomputeStandingsAtomic(prisma, req.params.id);
    res.json({ ok: true });
  }));

  return router;
}
