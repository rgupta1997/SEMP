import type { RequestHandler } from 'express';
import type { CapabilityKey } from '@semp/entitlements';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import {
  assertEventCapability,
  assertEventLimit,
  assertFormatAllowed,
  championshipOfTournament,
  championshipOfTournamentSport,
  countDisciplinesInSport,
  countDraws,
} from './event-plan.js';

// Plan gates for the generic CRUD resources that make up an event's setup and
// schedule. Mounted in server.ts AHEAD of each CRUD router, so the routers stay
// generic. Each guard returns next() at once when the request carries nothing it
// gates - a time or venue edit pays for no plan read at all.

/** Fixture fields that change WHO plays or WHERE in the draw - "manual schedule". */
const STRUCTURAL_FIXTURE_FIELDS = ['tournament_discipline_id', 'home_team_id', 'away_team_id', 'round', 'pool_number', 'bracket_position'] as const;

export function makeEventPlanGuards(prisma: Prisma) {
  const actor = (req: Parameters<RequestHandler>[0]) => req.user ? { id: req.user.id, isSuperAdmin: req.user.isSuperAdmin } : undefined;

  const championshipOfFixture = async (fixtureId: string) =>
    (await prisma.fixtures.findUnique({
      where: { id: fixtureId },
      select: { tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } } } },
    }))?.tournament_disciplines?.tournament_sports?.tournaments?.championship_id ?? null;

  const championshipOfDraw = async (drawId: string | null | undefined) => {
    if (!drawId) return null;
    const d = await prisma.tournament_disciplines.findUnique({ where: { id: drawId }, select: { tournament_sport_id: true } });
    return championshipOfTournamentSport(prisma, d?.tournament_sport_id);
  };

  /** POST /tournament-sports - a non-default format needs advanced_formats. */
  const tournamentSportCreate: RequestHandler = asyncHandler(async (req, _res, next) => {
    if (!req.body?.format_id) return next();
    await assertFormatAllowed(prisma, await championshipOfTournament(prisma, req.body.tournament_id), req.body.format_id, actor(req));
    next();
  });

  /** PATCH /tournament-sports/:id - only when the format changes. */
  const tournamentSportUpdate: RequestHandler = asyncHandler(async (req, _res, next) => {
    if (!req.body?.format_id) return next();
    await assertFormatAllowed(prisma, await championshipOfTournamentSport(prisma, req.params.id), req.body.format_id, actor(req));
    next();
  });

  /** POST /tournament-disciplines - format, tournaments per event, disciplines per sport. */
  const tournamentDisciplineCreate: RequestHandler = asyncHandler(async (req, _res, next) => {
    const tsId: string | undefined = req.body?.tournament_sport_id;
    const championshipId = await championshipOfTournamentSport(prisma, tsId);
    if (!championshipId) return next();
    const a = actor(req);
    await assertFormatAllowed(prisma, championshipId, req.body?.format_id, a);
    await assertEventLimit(prisma, championshipId, 'draws_per_event', () => countDraws(prisma, championshipId), { actor: a });
    if (req.body?.discipline_id && tsId) {
      await assertEventLimit(prisma, championshipId, 'disciplines_per_sport', () => countDisciplinesInSport(prisma, tsId), { actor: a });
    }
    next();
  });

  /** PATCH /tournament-disciplines/:id - only when the format changes. */
  const tournamentDisciplineUpdate: RequestHandler = asyncHandler(async (req, _res, next) => {
    if (!req.body?.format_id) return next();
    await assertFormatAllowed(prisma, await championshipOfDraw(req.params.id), req.body.format_id, actor(req));
    next();
  });

  /** POST /fixtures - adding a match by hand. */
  const fixtureCreate: RequestHandler = asyncHandler(async (req, _res, next) => {
    await assertEventCapability(prisma, await championshipOfDraw(req.body?.tournament_discipline_id), 'manual_schedule', actor(req));
    next();
  });

  /** DELETE /fixtures/:id - removing a match by hand. */
  const fixtureDelete: RequestHandler = asyncHandler(async (req, _res, next) => {
    await assertEventCapability(prisma, await championshipOfFixture(req.params.id), 'manual_schedule', actor(req));
    next();
  });

  /**
   * PATCH /fixtures/:id - re-pairing or moving a match in the draw is manual
   * scheduling; setting its time, venue, official or score is not. Only fields
   * whose value actually CHANGES count, because the schedule editor re-sends the
   * whole row when only the time moved.
   */
  const fixtureUpdate: RequestHandler = asyncHandler(async (req, _res, next) => {
    const body = req.body ?? {};
    const touched = STRUCTURAL_FIXTURE_FIELDS.filter((k) => k in body);
    if (touched.length === 0) return next();
    const current = await prisma.fixtures.findUnique({
      where: { id: req.params.id },
      select: { tournament_discipline_id: true, home_team_id: true, away_team_id: true, round: true, pool_number: true, bracket_position: true },
    });
    if (!current) return next();
    const changed = touched.some((k) => (body[k] ?? null) !== ((current as Record<string, unknown>)[k] ?? null));
    if (!changed) return next();
    await assertEventCapability(prisma, await championshipOfDraw(current.tournament_discipline_id), 'manual_schedule', actor(req));
    next();
  });

  /** Any route under /championships/:id that is wholly a plan capability. */
  const eventCapability = (capability: CapabilityKey): RequestHandler => asyncHandler(async (req, _res, next) => {
    await assertEventCapability(prisma, req.params.id, capability, actor(req));
    next();
  });

  return {
    eventCapability,
    tournamentSportCreate, tournamentSportUpdate,
    tournamentDisciplineCreate, tournamentDisciplineUpdate,
    fixtureCreate, fixtureDelete, fixtureUpdate,
  };
}
