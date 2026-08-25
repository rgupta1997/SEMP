import { Router } from 'express';
import { createFixtureSchema, fixtureAwardsSchema, fixturePointsSchema, fixtureResultSchema, generateAllStagesSchema, generateFixturesSchema, updateFixtureSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { makeCrudRouter } from '../../http/crud.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { generateFixtures, type TeamRef } from './domain/generators/index.js';
import { generateAllStages } from './domain/stage-orchestrator.js';
import { resolveStageAdvancement } from './domain/stage-resolver.js';
import { recomputeStandingsForFixture, resolveRuleForDraw, resolveSchemeForDraw } from '../standings/standings.service.js';
import { notify } from '@semp/notifications/server/notify.js';
// A match can only be recorded once its championship is under way. Resolves the
// owning championship from the fixture's draw and blocks scoring while it's still
// in draft or registration - nothing should be played before the event starts.
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
    throw new BusinessRuleError('This championship hasn’t started yet - matches can be recorded once it’s set to ongoing.');
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

// Fisher-Yates shuffle - randomizes seed order so each draw (and each sport) gets a
// different bracket/round-robin ordering instead of always the registration order.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

// Pure bracket arithmetic: given how many bracket-position siblings exist in the same
// stage and which position just got decided, returns the parent match's
// bracket_position and which slot (home/away) the winner fills - or null if there's
// no parent (not a clean single-elim bracket, position not found, or it's the
// final). Extracted as a pure function so it's unit-testable with no DB involved -
// this is what lets a regression test prove the stage_sequence filter added to
// advanceInBracket below never changes this arithmetic for existing brackets.
export function computeParentPosition(siblingCount: number, position: number): { parentPos: number; slot: 'home' | 'away' } | null {
  const size = siblingCount + 1;
  if (size < 2 || (size & (size - 1)) !== 0) return null; // not a clean single-elim bracket
  const rounds = Math.log2(size);
  const offsets: number[] = [];
  let acc = 0;
  for (let r = 0; r < rounds; r++) { offsets.push(acc); acc += size / 2 ** (r + 1); }
  let round = -1;
  let j = -1;
  for (let ri = 0; ri < rounds; ri++) {
    const matchesInRound = size / 2 ** (ri + 1);
    if (position >= offsets[ri] && position < offsets[ri] + matchesInRound) { round = ri; j = position - offsets[ri]; break; }
  }
  if (round < 0 || round >= rounds - 1) return null; // not found, or it's the final - nowhere to advance
  const parentPos = offsets[round + 1] + Math.floor(j / 2);
  // Even child → parent's home slot, odd child → away (mirrors the generator's pairing).
  return { parentPos, slot: j % 2 === 0 ? 'home' : 'away' };
}

// Single-elimination bracket advancement: put `teamId` into the correct slot of the
// match that the match at `position` feeds into. `stageSequence` scopes the sibling
// query to one knockout stage - a draw can have more than one independent bracket
// (branches), each with its own bracket_position starting at 0, so mixing them
// together would corrupt the round-offset arithmetic. Defaults to 1 (today's only
// value for every existing single-stage tournament), so this is a no-op change for
// them. No-op for non-bracket formats (group/round-robin have null positions),
// non-power-of-two brackets, the final, or a parent that's already been played.
export async function advanceInBracket(prisma: Prisma, drawId: string, position: number, teamId: string, stageSequence = 1): Promise<void> {
  const sibs = await prisma.fixtures.findMany({
    where: { tournament_discipline_id: drawId, bracket_position: { not: null }, stage_sequence: stageSequence },
    select: { id: true, bracket_position: true, status: true },
  });
  const result = computeParentPosition(sibs.length, position);
  if (!result) return;
  const parent = sibs.find((s) => s.bracket_position === result.parentPos);
  if (!parent || parent.status === 'completed') return; // don't overwrite a played match
  await prisma.fixtures.update({ where: { id: parent.id }, data: result.slot === 'home' ? { home_team_id: teamId } : { away_team_id: teamId } });
}

// After a completed bracket result, push the winner into the next round. Best-effort -
// the result is already saved, so an advancement hiccup must not fail the request.
async function advanceWinner(prisma: Prisma, fixtureId: string): Promise<void> {
  try {
    const fx = await prisma.fixtures.findUnique({
      where: { id: fixtureId },
      select: { tournament_discipline_id: true, bracket_position: true, winner_team_id: true, status: true, stage_sequence: true },
    });
    const advancing = fx?.status === 'completed' || fx?.status === 'walkover';
    if (!fx || !advancing || fx.winner_team_id == null || fx.bracket_position == null) return;
    await advanceInBracket(prisma, fx.tournament_discipline_id, fx.bracket_position, fx.winner_team_id, fx.stage_sequence ?? 1);
  } catch (err) {
    console.error(`[bracket] winner advancement failed for fixture ${fixtureId}:`, err);
  }
}

// Round-0 byes: the lone present team auto-advances to the next round. Run right
// after generation so byes don't leave a permanent TBD in the next round.
async function propagateByes(prisma: Prisma, drawId: string): Promise<void> {
  try {
    const byes = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: drawId, status: 'bye', bracket_position: { not: null } },
      select: { bracket_position: true, home_team_id: true, away_team_id: true, stage_sequence: true },
    });
    for (const b of byes) {
      const team = b.home_team_id ?? b.away_team_id;
      if (team && b.bracket_position != null) await advanceInBracket(prisma, drawId, b.bracket_position, team, b.stage_sequence ?? 1);
    }
  } catch (err) {
    console.error(`[bracket] bye propagation failed for draw ${drawId}:`, err);
  }
}

// When a completed match belongs to a draw scored by the "custom" point system and
// has no hand-entered points yet, nudge the championship's organiser(s) to add them.
// Direct (target_user_id) notifications so only organisers are pinged. Best-effort -
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
    await Promise.all(
      organisers.map((o) =>
        notify(prisma, {
          type: 'manual',
          championshipId,
          userId: o.user_id,
          senderId,
          data: {
            title: 'A result needs championship points',
            body: `A completed ${label} match still needs custom points. Open it on the Results page to award them.`,
          },
        }),
      ),
    );
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

      // Teams: explicit seed order is respected as given; otherwise the rosters entered
      // into this draw are shuffled so every draw (and sport) gets a fresh random
      // bracket instead of always the registration order.
      let teams: TeamRef[];
      if (req.body.team_ids?.length) {
        teams = req.body.team_ids.map((id: string) => ({ teamId: id }));
      } else {
        const registered = await prisma.team_entries.findMany({
          where: { tournament_discipline_id: td.id },
          select: { team_id: true },
        });
        teams = shuffle(registered.map((e) => ({ teamId: e.team_id })));
      }

      const existing = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        select: { id: true, home_team_id: true, away_team_id: true, status: true, home_score: true, away_score: true },
      });

      // Incremental generate: a league / round-robin that already has fixtures keeps
      // them (and their scheduling/results) and only adds matches for newly-registered
      // "pending" teams - the ones not yet in any fixture. Each pending team is paired
      // with every other team it hasn't been drawn against. Knockout / pool draws can't
      // be partially extended, so they fall through to a full rebuild below.
      const name = formatName.trim().toLowerCase();
      const isLeague = name.includes('league') || name.includes('round robin') || name.includes('round-robin');
      if (isLeague && existing.length > 0) {
        const placed = new Set<string>();
        for (const f of existing) { if (f.home_team_id) placed.add(f.home_team_id); if (f.away_team_id) placed.add(f.away_team_id); }
        const pairKey = (a: string, b: string) => [a, b].sort().join('|');
        const drawn = new Set(existing.filter((f) => f.home_team_id && f.away_team_id).map((f) => pairKey(f.home_team_id!, f.away_team_id!)));
        const allIds = teams.map((t) => t.teamId);
        const pending = allIds.filter((id) => !placed.has(id));
        const doubleRound = Boolean((params as any).double_round ?? (params as any).doubleRound ?? false);
        const toCreate: Array<{ tournament_discipline_id: string; home_team_id: string; away_team_id: string; round: string; status: string }> = [];
        for (const p of pending) {
          for (const other of allIds) {
            if (other === p) continue;
            const key = pairKey(p, other);
            if (drawn.has(key)) continue;
            drawn.add(key);
            toCreate.push({ tournament_discipline_id: td.id, home_team_id: p, away_team_id: other, round: 'Added', status: 'scheduled' });
            if (doubleRound) toCreate.push({ tournament_discipline_id: td.id, home_team_id: other, away_team_id: p, round: 'Added', status: 'scheduled' });
          }
        }
        if (toCreate.length) await prisma.fixtures.createMany({ data: toCreate });
        const rows = await prisma.fixtures.findMany({
          where: { tournament_discipline_id: td.id },
          orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
        });
        res.status(201).json(rows);
        return;
      }

      // Rebuild: wipe and regenerate from scratch - refuse if any fixture has already
      // been played (completed/walkover, or a score recorded). Discarding those
      // would corrupt results and standings. Mirrors the cascade-delete safety rule.
      // A bye carries no result (no score, nothing competitive happened - it's just
      // "this team had no opponent this round/slot"), so it must not count as
      // "played": an odd-sized pool/league or a non-power-of-two knockout produces
      // byes the instant it's generated, before any real match is played, which
      // would otherwise permanently block ever regenerating that draw again.
      const played = existing.some((f) => ['completed', 'walkover'].includes(f.status) || f.home_score != null || f.away_score != null);
      if (played) {
        throw new BusinessRuleError('This draw already has played matches - regenerating would erase those results. Edit fixtures individually instead.');
      }

      const generated = generateFixtures(formatName, teams, params);

      // Replace any existing fixtures for this draw atomically - a failed insert
      // must not leave the draw wiped, and concurrent regenerations can't interleave.
      await prisma.$transaction([
        prisma.fixtures.deleteMany({ where: { tournament_discipline_id: td.id } }),
        prisma.fixtures.createMany({
          data: generated.map((f) => ({
            tournament_discipline_id: td.id,
            home_team_id: f.homeTeamId,
            away_team_id: f.awayTeamId,
            winner_team_id: f.winnerTeamId ?? null,
            round: f.round,
            pool_number: f.poolNumber,
            bracket_position: f.bracketPosition,
            status: f.status,
          })),
        }),
      ]);

      // Auto-advance round-0 byes so the next round isn't left with a permanent TBD.
      await propagateByes(prisma, td.id);

      const rows = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
      });
      res.status(201).json(rows);
    }));

  // Generate EVERY stage of a stage-config tree (group + knockout wizard) up front -
  // later stages are created as TBD placeholders (home_slot_label/away_slot_label)
  // that stage-resolver.ts fills in automatically as earlier stages finish. Separate
  // from /fixtures/generate above, which only ever produces one flat stage and is
  // untouched by this feature.
  router.post('/tournament-disciplines/:id/fixtures/generate-all',
    drawOrganiser,
    validateBody(generateAllStagesSchema),
    asyncHandler(async (req, res) => {
      const td = await prisma.tournament_disciplines.findUnique({ where: { id: req.params.id } });
      if (!td) throw new NotFoundError('Tournament discipline');

      let teams: TeamRef[];
      if (req.body.team_ids?.length) {
        teams = req.body.team_ids.map((id: string) => ({ teamId: id }));
      } else {
        const registered = await prisma.team_entries.findMany({
          where: { tournament_discipline_id: td.id },
          select: { team_id: true },
        });
        teams = shuffle(registered.map((e) => ({ teamId: e.team_id })));
      }

      const existing = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        select: { id: true, status: true, home_score: true, away_score: true },
      });
      // A bye carries no result (no score, nothing competitive happened - it's just
      // "this team had no opponent this round/slot"), so it must not count as
      // "played": an odd-sized pool/league or a non-power-of-two knockout produces
      // byes the instant it's generated, before any real match is played, which
      // would otherwise permanently block ever regenerating that draw again.
      const played = existing.some((f) => ['completed', 'walkover'].includes(f.status) || f.home_score != null || f.away_score != null);
      if (played) {
        throw new BusinessRuleError('This draw already has played matches - regenerating would erase those results. Edit fixtures individually instead.');
      }

      const { inserts } = generateAllStages(req.body.config.root, teams, req.body.config.manualAllocation ?? []);

      await prisma.$transaction([
        prisma.fixtures.deleteMany({ where: { tournament_discipline_id: td.id } }),
        prisma.fixtures.createMany({ data: inserts.map((f) => ({ tournament_discipline_id: td.id, ...f })) }),
        // Persisted so stage-resolver.ts can re-derive the tree later (format_config
        // already exists as a free-form jsonb column on this row).
        prisma.tournament_disciplines.update({ where: { id: td.id }, data: { format_config: req.body.config } }),
      ]);

      await propagateByes(prisma, td.id); // stage-1 byes only, unchanged signature (default stageSequence = 1)
      await resolveStageAdvancement(prisma, td.id); // resolves anything stage 1 already decided (e.g. a fully-bye pool)

      const rows = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        orderBy: [{ stage_sequence: 'asc' }, { pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
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
    // Scoring a match (going live or completing) requires both teams to be known - a
    // TBD bracket slot can't be played. Fetch once and reuse for the winner check.
    let fxTeams: { home_team_id: string | null; away_team_id: string | null; tournament_disciplines: { format_config: any } | null } | null = null;
    const needsTeams = b.status === 'live' || b.status === 'completed';
    if (needsTeams || b.winner_team_id != null) {
      fxTeams = await prisma.fixtures.findUnique({ where: { id: req.params.id }, select: { home_team_id: true, away_team_id: true, tournament_disciplines: { select: { format_config: true } } } });
      if (!fxTeams) throw new NotFoundError('Fixture');
    }
    if (needsTeams && (!fxTeams!.home_team_id || !fxTeams!.away_team_id)) {
      // Multi-competitor events (swimming/powerlifting) are intentionally team-less, so
      // the "both teams" rule doesn't apply to them - only to real TBD bracket slots. An
      // event is recognised by its stored config or by the event state being scored.
      const cfgType = (fxTeams!.tournament_disciplines?.format_config as any)?.scoring?.fixtureType;
      const isEvent = cfgType === 'event' || !!(b.live_state && (b.live_state.event || b.live_state.eventRanking));
      if (!isEvent) throw new BusinessRuleError('Both teams must be set before this match can go live or be scored.');
    }
    // A declared winner must be one of the two teams in this fixture.
    if (b.winner_team_id != null && b.winner_team_id !== fxTeams!.home_team_id && b.winner_team_id !== fxTeams!.away_team_id) {
      throw new BusinessRuleError('Winner must be one of the two teams in this match');
    }
    const headlineChanged = Object.keys(data).length > 0;
    if (headlineChanged) {
      await prisma.fixtures.update({ where: { id: req.params.id }, data });
    }
    let persisted = true;
    if ('live_state' in b || 'live_log' in b) {
      try {
        // Preserve any organiser-entered custom_points - live scoring never sends
        // them, so keep the existing value rather than wiping it.
        await prisma.$executeRaw`
          update fixtures
          set live_state = jsonb_set(
                jsonb_set(${JSON.stringify(b.live_state ?? {})}::jsonb, '{custom_points}', coalesce(live_state -> 'custom_points', 'null'::jsonb), true),
                '{scorecard_url}', coalesce(live_state -> 'scorecard_url', 'null'::jsonb), true),
              live_log = ${JSON.stringify(b.live_log ?? [])}::jsonb,
              updated_at = now()
          where id = ${req.params.id}::uuid`;
      } catch {
        persisted = false; // live_* columns not migrated yet - headline still saved
      }
    }
    // Recompute standings AFTER both writes, so a freshly-persisted eventStandings (event
    // sign-off) is reflected - recomputing before the live_state write would read the old
    // contribution and leave the materialized table stale.
    if (headlineChanged) await refreshStandings(prisma, req.params.id);
    // Completing a bracket match (or a walkover with a winner) → advance the winner;
    // custom-points → remind organiser.
    if (b.status === 'completed' || b.status === 'walkover') {
      await advanceWinner(prisma, req.params.id);
      const fx = await prisma.fixtures.findUnique({ where: { id: req.params.id }, select: { tournament_discipline_id: true } });
      if (fx) await resolveStageAdvancement(prisma, fx.tournament_discipline_id);
    }
    if (b.status === 'completed') await remindCustomPointsIfNeeded(prisma, req.params.id, req.user!.id);
    res.json({ ok: true, persisted });
  }));

  // Full fixture detail for the scoring console. Same authorization as scoring
  // (assigned official, organiser, or super) so the host can score any fixture in
  // their championship - not just an official's assigned list. Shape mirrors the
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
    // The effective point system for this draw - drives the custom-points input on
    // the console (shown only when the organiser chose "custom").
    const tdx = fixture.tournament_disciplines;
    const champId = tdx?.tournament_sports?.tournaments?.championships?.id;
    const formatId = tdx?.format_id ?? tdx?.tournament_sports?.format_id ?? null;
    const rule = champId ? await resolveRuleForDraw(prisma, champId, tdx?.discipline_id ?? null, formatId) : null;
    // `ranking_points` / `ranking_participation` let the ranking console award the
    // organiser-configured placement points (1st/2nd/3rd/…) + a participation floor for
    // every ranked org, instead of the template default.
    const ranking_points = rule?.scheme === 'ranking' ? rule.places : null;
    const ranking_participation = rule?.scheme === 'ranking' ? rule.participation : 0;
    res.json({ ...fixture, point_scheme: rule?.scheme ?? null, ranking_points, ranking_participation });
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

    // A TBD slot can't be played - both teams must be set before recording a result.
    const resultStatus = req.body.status ?? 'completed';
    if ((resultStatus === 'live' || resultStatus === 'completed') && (!fixture.home_team_id || !fixture.away_team_id)) {
      throw new BusinessRuleError('Both teams must be set before this match can go live or be scored.');
    }

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
    if ((req.body.status ?? 'completed') === 'completed') {
      await advanceWinner(prisma, req.params.id);
      await resolveStageAdvancement(prisma, updated.tournament_discipline_id);
      await remindCustomPointsIfNeeded(prisma, req.params.id, req.user!.id);
    }
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

  // Set/clear the external full-scorecard link (e.g. CrickHeroes) for a match. Stored
  // on live_state.scorecard_url (no migration) and merged so live-scoring keys stay
  // intact. Surfaced as a "View full scorecard" CTA on the match views.
  router.patch('/fixtures/:id/scorecard', guards.fixtureScorer, asyncHandler(async (req, res) => {
    const fx = await prisma.fixtures.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!fx) throw new NotFoundError('Fixture');
    const raw = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (raw && !/^https?:\/\//i.test(raw)) throw new BusinessRuleError('Enter a full URL starting with http(s)://');
    await prisma.$executeRaw`
      update fixtures
      set live_state = jsonb_set(coalesce(live_state, '{}'::jsonb), '{scorecard_url}', ${JSON.stringify(raw || null)}::jsonb, true),
          updated_at = now()
      where id = ${req.params.id}::uuid`;
    res.json({ ok: true, scorecard_url: raw || null });
  }));

  // Plain CRUD for manual fixture edits / scheduling - writes require the organiser
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
