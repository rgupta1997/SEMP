import { Router } from 'express';
import { createFixtureSchema, fixtureAwardsSchema, fixturePointsSchema, fixtureResultSchema, generateFixturesSchema, updateFixtureSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { makeCrudRouter } from '../../http/crud.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { generateFixtures, type TeamRef } from './domain/generators/index.js';
import { recomputeStandingsForFixture, resolveSchemeForDraw } from '../standings/standings.service.js';
import { createNotification } from '../notifications/audience.js';

// A match can only be recorded once its championship is under way. Resolves the
// owning championship from the fixture's draw and blocks scoring while it's still
// in draft or registration — nothing should be played before the event starts.
async function assertChampionshipStarted(prisma: Prisma, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId },
    select: {
      tournament_disciplines: {
        select: { tournament_sports: { select: { tournaments: { select: { championships: { select: { status: true } } } } } } },
      },
    },
  });
  if (!fx) throw new NotFoundError('Fixture');
  const status = fx.tournament_disciplines?.tournament_sports?.tournaments?.championships?.status;
  if (status === 'draft' || status === 'registration_open') {
    throw new BusinessRuleError('This championship hasn’t started yet — matches can be recorded once it’s set to ongoing.');
  }
}

// Rebuild standings after a fixture's score/status changes. Best-effort: the result
// is already committed, so a recompute hiccup must not fail the scorer's request.
async function refreshStandings(prisma: Prisma, fixtureId: string): Promise<void> {
  try {
    await recomputeStandingsForFixture(prisma, fixtureId);
  } catch (err) {
    console.error(`[standings] recompute failed for fixture ${fixtureId}:`, err);
  }
}

// When a completed match belongs to a draw scored by the "custom" point system and
// has no hand-entered points yet, nudge the championship's organiser(s) to add them.
// Direct (target_user_id) notifications so only organisers are pinged. Best-effort —
// never fails the result write.
async function remindCustomPointsIfNeeded(prisma: Prisma, fixtureId: string, senderId: string): Promise<void> {
  try {
    const fx = await prisma.fixtures.findUnique({
      where: { id: fixtureId },
      select: {
        status: true, live_state: true,
        tournament_disciplines: {
          select: {
            discipline_id: true, format_id: true,
            disciplines: { select: { name: true } },
            tournament_sports: {
              select: { format_id: true, sports: { select: { name: true } }, tournaments: { select: { championship_id: true } } },
            },
          },
        },
      },
    });
    if (!fx || fx.status !== 'completed') return;
    const td = fx.tournament_disciplines;
    const championshipId = td?.tournament_sports?.tournaments?.championship_id;
    if (!championshipId) return;
    const cp = (fx.live_state as any)?.custom_points;
    if (cp && (typeof cp.home === 'number' || typeof cp.away === 'number')) return; // points already entered
    const formatId = td?.format_id ?? td?.tournament_sports?.format_id ?? null;
    const scheme = await resolveSchemeForDraw(prisma, championshipId, td?.discipline_id ?? null, formatId);
    if (scheme !== 'custom') return;
    const organiserRole = await prisma.roles.findUnique({ where: { name: 'Organiser' }, select: { id: true } });
    if (!organiserRole) return;
    const organisers = await prisma.user_championship_roles.findMany({
      where: { championship_id: championshipId, role_id: organiserRole.id },
      select: { user_id: true },
    });
    const label = [td?.tournament_sports?.sports?.name, td?.disciplines?.name].filter(Boolean).join(' · ') || 'a discipline';
    await Promise.all(organisers.map((o) => createNotification(prisma, {
      championship_id: championshipId,
      target_user_id: o.user_id,
      sender_id: senderId,
      type: 'manual',
      audience: 'all', // ignored for direct notifications — target_user_id drives visibility
      title: 'A result needs championship points',
      body: `A completed ${label} match still needs custom points. Open it on the Results page to award them.`,
    })));
  } catch (err) {
    console.error(`[points] custom-points reminder failed for fixture ${fixtureId}:`, err);
  }
}

export function makeFixturesRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // organiser of the championship that owns this draw (from the :id tournament_discipline).
  const drawOrganiser = guards.championshipManager(async (req) => guards.resolvers.championshipOfTournamentDiscipline(req.params.id));

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

      // Teams: explicit seed order, else all rosters entered into this draw.
      let teams: TeamRef[];
      if (req.body.team_ids?.length) {
        teams = req.body.team_ids.map((id: string) => ({ teamId: id }));
      } else {
        const registered = await prisma.team_entries.findMany({
          where: { tournament_discipline_id: td.id },
          orderBy: { created_at: 'asc' },
          select: { team_id: true },
        });
        teams = registered.map((e) => ({ teamId: e.team_id }));
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
    await assertChampionshipStarted(prisma, req.params.id);
    const b = req.body ?? {};
    // Only touch fields that were actually sent, so a status-only change (e.g.
    // walkover/postpone/cancel) doesn't clobber the score or live snapshot.
    const data: Record<string, unknown> = {};
    if ('home_score' in b) data.home_score = b.home_score ?? null;
    if ('away_score' in b) data.away_score = b.away_score ?? null;
    if ('winner_team_id' in b) data.winner_team_id = b.winner_team_id ?? null;
    if ('notes' in b) data.notes = b.notes ?? null;
    if (b.status) data.status = b.status;
    // A declared winner must be one of the two teams in this fixture.
    if (b.winner_team_id != null) {
      const fx = await prisma.fixtures.findUnique({ where: { id: req.params.id }, select: { home_team_id: true, away_team_id: true } });
      if (!fx) throw new NotFoundError('Fixture');
      if (b.winner_team_id !== fx.home_team_id && b.winner_team_id !== fx.away_team_id) {
        throw new BusinessRuleError('Winner must be one of the two teams in this match');
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.fixtures.update({ where: { id: req.params.id }, data });
      // Headline (score/status/winner) changed — refresh the championship's standings.
      await refreshStandings(prisma, req.params.id);
    }
    let persisted = true;
    if ('live_state' in b || 'live_log' in b) {
      try {
        // Preserve any organiser-entered custom_points — live scoring never sends
        // them, so keep the existing value rather than wiping it.
        await prisma.$executeRaw`
          update fixtures
          set live_state = jsonb_set(${JSON.stringify(b.live_state ?? {})}::jsonb, '{custom_points}', coalesce(live_state -> 'custom_points', 'null'::jsonb), true),
              live_log = ${JSON.stringify(b.live_log ?? [])}::jsonb,
              updated_at = now()
          where id = ${req.params.id}::uuid`;
      } catch {
        persisted = false; // live_* columns not migrated yet — headline still saved
      }
    }
    // Completing a custom-points match with no points yet → remind the organiser.
    if (b.status === 'completed') await remindCustomPointsIfNeeded(prisma, req.params.id, req.user!.id);
    res.json({ ok: true, persisted });
  }));

  // Full fixture detail for the scoring console. Same authorization as scoring
  // (assigned official, organiser, or super) so the host can score any fixture in
  // their championship — not just an official's assigned list. Shape mirrors the
  // rows from GET /me/officiating so the console reads them interchangeably.
  router.get('/fixtures/:id/scoring', guards.fixtureScorer, asyncHandler(async (req, res) => {
    const fixture = await prisma.fixtures.findUnique({
      where: { id: req.params.id },
      include: {
        teams_fixtures_home_team_idToteams: { include: { organizations: true, team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true } } } } } },
        teams_fixtures_away_team_idToteams: { include: { organizations: true, team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true } } } } } },
        tournament_disciplines: {
          include: {
            disciplines: true,
            tournament_sports: { include: { sports: true, tournaments: { include: { championships: true } } } },
          },
        },
        venue_grounds: { include: { venues: true } },
      },
    });
    if (!fixture) throw new NotFoundError('Fixture');
    // The effective point system for this draw — drives the custom-points input on
    // the console (shown only when the organiser chose "custom").
    const tdx = fixture.tournament_disciplines;
    const champId = tdx?.tournament_sports?.tournaments?.championships?.id;
    const formatId = tdx?.format_id ?? tdx?.tournament_sports?.format_id ?? null;
    const point_scheme = champId ? await resolveSchemeForDraw(prisma, champId, tdx?.discipline_id ?? null, formatId) : null;
    res.json({ ...fixture, point_scheme });
  }));

  // ---- Awards (player-of-the-match etc.) ----
  // Free-text award name + a recipient who plays for one of the two teams. Read +
  // replace-all write, both authorized like scoring. These surface as the
  // recipient's "achievements" on their participant dashboard.
  const awardView = (a: { id: string; award_name: string; recipient_user_id: string; users?: { name: string } | null }) =>
    ({ id: a.id, award_name: a.award_name, recipient_user_id: a.recipient_user_id, recipient_name: a.users?.name ?? null });

  router.get('/fixtures/:id/awards', guards.fixtureScorer, asyncHandler(async (req, res) => {
    const rows = await prisma.fixture_awards.findMany({
      where: { fixture_id: req.params.id },
      include: { users: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    });
    res.json(rows.map(awardView));
  }));

  router.patch('/fixtures/:id/awards', guards.fixtureScorer, validateBody(fixtureAwardsSchema), asyncHandler(async (req, res) => {
    const fixtureId = req.params.id;
    const fixture = await prisma.fixtures.findUnique({ where: { id: fixtureId } });
    if (!fixture) throw new NotFoundError('Fixture');
    const awards = req.body.awards as { award_name: string; recipient_user_id: string }[];
    // Replace-all: wipe the fixture's awards then re-insert, atomically.
    await prisma.$transaction([
      prisma.fixture_awards.deleteMany({ where: { fixture_id: fixtureId } }),
      ...(awards.length
        ? [prisma.fixture_awards.createMany({ data: awards.map((a) => ({ fixture_id: fixtureId, award_name: a.award_name, recipient_user_id: a.recipient_user_id })) })]
        : []),
    ]);
    const rows = await prisma.fixture_awards.findMany({
      where: { fixture_id: fixtureId },
      include: { users: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    });
    res.json(rows.map(awardView));
  }));

  router.patch('/fixtures/:id/result', guards.fixtureScorer, validateBody(fixtureResultSchema), asyncHandler(async (req, res) => {
    await assertChampionshipStarted(prisma, req.params.id);
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
    if (winner != null && winner !== fixture.home_team_id && winner !== fixture.away_team_id) {
      throw new BusinessRuleError('Winner must be one of the two teams in this match');
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
    await refreshStandings(prisma, req.params.id);
    if ((req.body.status ?? 'completed') === 'completed') await remindCustomPointsIfNeeded(prisma, req.params.id, req.user!.id);
    res.json(updated);
  }));

  // Award custom championship points for a result (the "custom" point system). Stored
  // on the fixture's live_state JSON (no migration needed), merged in so live-scoring
  // keys stay intact, then standings recompute.
  router.patch('/fixtures/:id/points', guards.fixtureScorer, validateBody(fixturePointsSchema), asyncHandler(async (req, res) => {
    await assertChampionshipStarted(prisma, req.params.id);
    const fx = await prisma.fixtures.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!fx) throw new NotFoundError('Fixture');
    const home = req.body.home_points ?? null;
    const away = req.body.away_points ?? null;
    await prisma.$executeRaw`
      update fixtures
      set live_state = jsonb_set(coalesce(live_state, '{}'::jsonb), '{custom_points}', ${JSON.stringify({ home, away })}::jsonb, true),
          updated_at = now()
      where id = ${req.params.id}::uuid`;
    await refreshStandings(prisma, req.params.id);
    res.json({ ok: true, home_points: home, away_points: away });
  }));

  // Plain CRUD for manual fixture edits / scheduling — writes require the organiser
  // of the championship that owns the fixture's draw.
  router.use('/fixtures', makeCrudRouter(prisma.fixtures, {
    name: 'Fixture',
    createSchema: createFixtureSchema,
    updateSchema: updateFixtureSchema,
    listFilters: ['tournament_discipline_id'],
    orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
    writeGuards: [guards.championshipCrudGuard({
      body: async (req) => guards.resolvers.championshipOfTournamentDiscipline(req.body?.tournament_discipline_id),
      byId: guards.resolvers.championshipOfFixture,
    })],
  }));

  return router;
}
