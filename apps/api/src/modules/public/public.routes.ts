import { Router } from 'express';
import { STANDINGS_AGG_SCOPE, type StandingsAggScope } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { NotFoundError } from '../../shared/errors.js';
import { readStandings } from '../standings/standings.service.js';
import { listChampionshipFixtures } from '../championships/fixtures-list.js';
import { verifyShareToken } from './share-token.js';

// Unauthenticated, view-only championship pages reachable via a share token. Mounted
// BEFORE the global requireAuth. Only the read-only Overview + Standings are exposed,
// and only data a spectator would already see (no contact details).
export function makePublicRouter(prisma: Prisma): Router {
  const router = Router();

  // Resolve the token to a championship id, or 404 (never reveal whether the id exists).
  const resolve = (token: string): string => {
    const id = verifyShareToken(token);
    if (!id) throw new NotFoundError('Shared championship');
    return id;
  };

  // Overview: championship header + sports + headline counts.
  router.get('/championships/:token/overview', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const draw = { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: id } } } };
    const [champ, organizations, fixtures, completed_matches, sports] = await Promise.all([
      prisma.championships.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, description: true, venue: true, start_date: true, end_date: true, status: true },
      }),
      prisma.championship_organizations.count({ where: { championship_id: id, status: 'approved' } }),
      prisma.fixtures.count({ where: draw }),
      prisma.fixtures.count({ where: { ...draw, status: { in: ['completed', 'walkover', 'bye'] } } }),
      prisma.tournament_sports.findMany({
        where: { tournaments: { championship_id: id } },
        select: { sports: { select: { name: true, icon: true } } },
        orderBy: { display_order: 'asc' },
      }),
    ]);
    if (!champ) throw new NotFoundError('Shared championship');
    // Distinct sports in declared order.
    const sportList = [...new Map(sports.filter((s) => s.sports).map((s) => [s.sports!.name, s.sports])).values()];
    res.json({ championship: champ, sports: sportList, stats: { organizations, fixtures, completed_matches } });
  }));

  // Standings for a scope (same shape + ranking the spectator view uses).
  router.get('/championships/:token/standings', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const scope = (req.query.scope as StandingsAggScope) || 'championship';
    if (!STANDINGS_AGG_SCOPE.includes(scope)) throw new NotFoundError('Scope');
    const scopeId = scope === 'championship' ? null : (req.query.scopeId as string | undefined) ?? null;
    if (scope !== 'championship' && !scopeId) { res.json({ scope, scope_id: null, standings: [] }); return; }
    const standings = await readStandings(prisma, id, scope, scopeId);
    res.json({ scope, scope_id: scopeId, standings, completed_matches: standings.reduce((n, r) => n + r.played, 0) });
  }));

  // All fixtures (powers the Schedule + Results tabs - same shape the spectator gets).
  router.get('/championships/:token/fixtures', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    res.json(await listChampionshipFixtures(prisma, id));
  }));

  // Tournament/sport options so the public standings can offer the same filters.
  router.get('/championships/:token/draws', asyncHandler(async (req, res) => {
    const id = resolve(req.params.token);
    const draws = await prisma.tournament_disciplines.findMany({
      where: { tournament_sports: { tournaments: { championship_id: id } } },
      select: { tournament_sports: { select: { sports: { select: { id: true, name: true } }, tournaments: { select: { id: true, name: true } } } } },
    });
    res.json(draws);
  }));

  return router;
}
