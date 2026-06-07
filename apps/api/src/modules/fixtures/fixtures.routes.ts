import { Router } from 'express';
import { createFixtureSchema, fixtureResultSchema, generateFixturesSchema, updateFixtureSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { makeCrudRouter } from '../../http/crud.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { generateFixtures, type TeamRef } from './domain/generators/index.js';

export function makeFixturesRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // organiser of the event that owns this draw (from the :id tournament_discipline).
  const drawOrganiser = guards.eventManager(async (req) => guards.resolvers.eventOfTournamentDiscipline(req.params.id));

  // List fixtures for a discipline draw.
  router.get('/tournament-disciplines/:id/fixtures', asyncHandler(async (req, res) => {
    const rows = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: req.params.id },
      orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
    });
    res.json(rows);
  }));

  // Generate (regenerate) the draw using the format's algorithm.
  router.post('/tournament-disciplines/:id/fixtures/generate',
    drawOrganiser,
    validateBody(generateFixturesSchema),
    asyncHandler(async (req, res) => {
      const td = await prisma.tournament_disciplines.findUnique({
        where: { id: req.params.id },
        include: {
          tournament_formats: true,
          tournament_sports: { include: { tournament_formats: true } },
        },
      });
      if (!td) throw new NotFoundError('Tournament discipline');

      const formatName = td.tournament_formats?.name ?? td.tournament_sports.tournament_formats?.name;
      if (!formatName) throw new BusinessRuleError('No format configured for this draw');

      const params: Record<string, unknown> = {
        ...(td.tournament_sports.format_config as object),
        ...(td.format_config as object),
        ...(req.body.params as object),
      };

      // Teams: explicit seed order, else all teams registered to this draw.
      let teams: TeamRef[];
      if (req.body.team_ids?.length) {
        teams = req.body.team_ids.map((id: string) => ({ teamId: id }));
      } else {
        const registered = await prisma.teams.findMany({
          where: { tournament_discipline_id: td.id },
          orderBy: { created_at: 'asc' },
        });
        teams = registered.map((t) => ({ teamId: t.id }));
      }

      const generated = generateFixtures(formatName, teams, params);

      // Replace any existing fixtures for this draw atomically — a failed insert
      // must not leave the draw wiped, and concurrent regenerations can't interleave.
      await prisma.$transaction([
        prisma.fixtures.deleteMany({ where: { tournament_discipline_id: td.id } }),
        prisma.fixtures.createMany({
          data: generated.map((f) => ({
            tournament_discipline_id: td.id,
            home_team_id: f.homeTeamId,
            away_team_id: f.awayTeamId,
            round: f.round,
            pool_number: f.poolNumber,
            bracket_position: f.bracketPosition,
            status: f.status,
          })),
        }),
      ]);

      const rows = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
      });
      res.status(201).json(rows);
    }));

  // Record a result from the match console. Derives the winner from scores when
  // not given explicitly, and defaults the status to completed.
  // ---- Live scoring state (official console) ----
  // Read the persisted live snapshot. Degrades to empty if the column isn't
  // migrated yet so the console still loads in a fresh environment.
  router.get('/fixtures/:id/live', asyncHandler(async (req, res) => {
    try {
      const rows = await prisma.$queryRaw<Array<{ live_state: unknown; live_log: unknown }>>`
        select live_state, live_log from fixtures where id = ${req.params.id}::uuid`;
      const row = rows[0];
      res.json({ live_state: row?.live_state ?? {}, live_log: row?.live_log ?? [] });
    } catch {
      res.json({ live_state: {}, live_log: [] });
    }
  }));

  // Persist a live snapshot. Headline fields (score/status/winner) go through the
  // typed client so standings stay correct; the JSON blobs go via raw SQL (no
  // client regeneration needed). Only the assigned official / organiser / super.
  router.patch('/fixtures/:id/live', guards.fixtureScorer, asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    // Only touch fields that were actually sent, so a status-only change (e.g.
    // walkover/postpone/cancel) doesn't clobber the score or live snapshot.
    const data: Record<string, unknown> = {};
    if ('home_score' in b) data.home_score = b.home_score ?? null;
    if ('away_score' in b) data.away_score = b.away_score ?? null;
    if ('winner_team_id' in b) data.winner_team_id = b.winner_team_id ?? null;
    if (b.status) data.status = b.status;
    if (Object.keys(data).length > 0) {
      await prisma.fixtures.update({ where: { id: req.params.id }, data });
    }
    let persisted = true;
    if ('live_state' in b || 'live_log' in b) {
      try {
        await prisma.$executeRaw`
          update fixtures
          set live_state = ${JSON.stringify(b.live_state ?? {})}::jsonb,
              live_log = ${JSON.stringify(b.live_log ?? [])}::jsonb,
              updated_at = now()
          where id = ${req.params.id}::uuid`;
      } catch {
        persisted = false; // live_* columns not migrated yet — headline still saved
      }
    }
    res.json({ ok: true, persisted });
  }));

  router.patch('/fixtures/:id/result', guards.fixtureScorer, validateBody(fixtureResultSchema), asyncHandler(async (req, res) => {
    const fixture = await prisma.fixtures.findUnique({ where: { id: req.params.id } });
    if (!fixture) throw new NotFoundError('Fixture');

    const home = req.body.home_score ?? null;
    const away = req.body.away_score ?? null;

    let winner = req.body.winner_team_id ?? null;
    if (winner === null && home !== null && away !== null) {
      if (home > away) winner = fixture.home_team_id;
      else if (away > home) winner = fixture.away_team_id;
      else winner = null; // draw
    }

    const updated = await prisma.fixtures.update({
      where: { id: req.params.id },
      data: {
        home_score: home,
        away_score: away,
        winner_team_id: winner,
        status: req.body.status ?? 'completed',
        notes: req.body.notes ?? fixture.notes,
      },
    });
    res.json(updated);
  }));

  // Plain CRUD for manual fixture edits / scheduling — writes require the organiser
  // of the event that owns the fixture's draw.
  router.use('/fixtures', makeCrudRouter(prisma.fixtures, {
    name: 'Fixture',
    createSchema: createFixtureSchema,
    updateSchema: updateFixtureSchema,
    listFilters: ['tournament_discipline_id'],
    orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
    writeGuards: [guards.eventCrudGuard({
      body: async (req) => guards.resolvers.eventOfTournamentDiscipline(req.body?.tournament_discipline_id),
      byId: guards.resolvers.eventOfFixture,
    })],
  }));

  return router;
}
