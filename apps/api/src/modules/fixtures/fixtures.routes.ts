import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  assignFixtureOfficialSchema, createFixtureSchema, fixtureAwardsSchema, fixturePointsSchema,
  fixtureResultSchema, generateAllStagesSchema, generateDrawSchema, generateFixturesSchema,
  updateFixtureSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { makeCrudRouter } from '../../http/crud.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { generateFixtures, type TeamRef } from './domain/generators/index.js';
import { generateAllStages } from './domain/stage-orchestrator.js';
import { resolveStageAdvancement } from './domain/stage-resolver.js';
import { clashesByFixture, findClashes } from './domain/clashes.js';
import { recomputeStandingsForFixtureAtomic, resolveRuleForDraw, resolveSchemeForDraw } from '../standings/standings.service.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules } from '@semp/notifications/core/rules.js';
import { matchAudience, notifyMatch } from './match-audience.js';
import { advanceWinner, propagateByes } from './bracket.js';
import { ROLE_CODES, roleWhereByCode, formatIdsForDraw } from '@semp/shared';
import {
  assertNotLocked, lockScorecard, lockScorecardsBulk, lockStatusForChampionship,
  retractScorecard, submitScorecard, unlockScorecard,
} from './lock.service.js';
import { assignMatchNos, championshipOfDiscipline } from './match-no.js';
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
    await recomputeStandingsForFixtureAtomic(prisma, fixtureId);
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
    const organiserRole = await prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.organiser), select: { id: true } });
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
    validateBody(generateDrawSchema),
    asyncHandler(async (req, res) => {
      const td = await prisma.tournament_disciplines.findUnique({
        where: { id: req.params.id },
        include: {
          tournament_formats: true,
          disciplines: { select: { name: true } },
          tournament_sports: { include: { tournament_formats: true, tournaments: { select: { championship_id: true } } } },
        },
      });
      if (!td) throw new NotFoundError('Tournament discipline');

      const formatName = td.tournament_formats?.name ?? td.tournament_sports.tournament_formats?.name;
      if (!formatName) throw new BusinessRuleError('No format configured for this draw');
      const championshipId = td.tournament_sports.tournaments?.championship_id ?? null;
      const notifyFixturesGenerated = async (rows: Array<{ home_team_id: string | null; away_team_id: string | null }>) => {
        if (championshipId) {
          try {
            await notify(prisma, { type: 'fixtures_generated', championshipId, senderId: req.user!.id, data: { disciplineName: td.disciplines?.name } });
          } catch (err) {
            console.error(`[fixtures] fixtures_generated notification failed for draw ${td.id}:`, err);
          }
        }
        // Players/teams get a separate notification from the organiser's - same
        // trigger, different audience (the trigger doc's "Fixtures published" row).
        const teamIds = [...new Set(rows.flatMap((f) => [f.home_team_id, f.away_team_id]).filter((t): t is string => !!t))];
        if (teamIds.length > 0) {
          await notifyMatch(prisma, 'fixtures_published', Rules.compose(teamIds.map((t) => Rules.teamMembers(t))), req.user!.id, { disciplineName: td.disciplines?.name });
        }
      };

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
        if (toCreate.length) {
          await prisma.fixtures.createMany({ data: toCreate });
          // Numbered after the insert, across everything unnumbered in the event.
          // See match-no.ts for why numbering is a second pass rather than a value
          // threaded through each generator.
          const cid = await championshipOfDiscipline(prisma, td.id);
          if (cid) await assignMatchNos(prisma, cid);
        }
        const rows = await prisma.fixtures.findMany({
          where: { tournament_discipline_id: td.id },
          orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
        });
        if (toCreate.length) await notifyFixturesGenerated(rows);
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

      // Nothing has been played, but the draw still holds an organiser's scheduling and
      // official assignments. A rebuild discards all of it, so it has to be asked for -
      // a repeated "Generate draw" click must not quietly destroy a day's work.
      if (existing.length > 0 && req.body.replace !== true) {
        throw new BusinessRuleError('This draw already has fixtures. Regenerating replaces them (and their times, grounds and officials) - confirm the rebuild to continue.');
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
      {
        const cid = await championshipOfDiscipline(prisma, td.id);
        if (cid) await assignMatchNos(prisma, cid);
      }

      const rows = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        orderBy: [{ match_no: { sort: 'asc', nulls: 'last' } }, { pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
      });
      await notifyFixturesGenerated(rows);
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
      const td = await prisma.tournament_disciplines.findUnique({
        where: { id: req.params.id },
        include: {
          disciplines: { select: { name: true } },
          tournament_sports: { select: { tournaments: { select: { championship_id: true } } } },
        },
      });
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
        //
        // MERGE, DO NOT REPLACE. This column carries two unrelated things - the stage
        // tree written here, and the scoring template read by the web console's
        // resolveTemplate(). Assigning req.body.config wholesale silently destroyed
        // format_config.scoring every time a staged draw was generated.
        prisma.tournament_disciplines.update({
          where: { id: td.id },
          data: { format_config: { ...(td.format_config as object), ...req.body.config } },
        }),
      ]);

      await propagateByes(prisma, td.id); // stage-1 byes only, unchanged signature (default stageSequence = 1)
      await resolveStageAdvancement(prisma, td.id); // resolves anything stage 1 already decided (e.g. a fully-bye pool)
      {
        // After byes AND advancement: both rewrite fixtures, and a placeholder that
        // gets resolved away should not have taken a number with it.
        const cid = await championshipOfDiscipline(prisma, td.id);
        if (cid) await assignMatchNos(prisma, cid);
      }

      const rows = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id },
        orderBy: [{ stage_sequence: 'asc' }, { pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
      });
      const championshipId = td.tournament_sports?.tournaments?.championship_id ?? null;
      if (championshipId) {
        try {
          await notify(prisma, { type: 'fixtures_generated', championshipId, senderId: req.user!.id, data: { disciplineName: td.disciplines?.name } });
        } catch (err) {
          console.error(`[fixtures] fixtures_generated notification failed for draw ${td.id}:`, err);
        }
      }
      // Players/teams get a separate notification - only stage-1 fixtures have real
      // team ids at this point (later stages are still TBD placeholders).
      const generatedTeamIds = [...new Set(rows.flatMap((f) => [f.home_team_id, f.away_team_id]).filter((t): t is string => !!t))];
      if (generatedTeamIds.length > 0) {
        await notifyMatch(prisma, 'fixtures_published', Rules.compose(generatedTeamIds.map((t) => Rules.teamMembers(t))), req.user!.id, { disciplineName: td.disciplines?.name });
      }
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
    // A locked result is immutable for everyone - organiser, official and platform
    // admin alike. Changing it means unlocking it first, with a reason, on the record.
    await assertNotLocked(prisma, req.params.id);
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
    let fxTeams: {
      home_team_id: string | null; away_team_id: string | null; status: string;
      live_started_at: Date | null; official_id: string | null;
      tournament_disciplines: { format_config: any } | null;
    } | null = null;
    const needsTeams = b.status === 'live' || b.status === 'completed';
    if (needsTeams || b.winner_team_id != null || b.status === 'cancelled') {
      fxTeams = await prisma.fixtures.findUnique({
        where: { id: req.params.id },
        select: {
          home_team_id: true, away_team_id: true, status: true, live_started_at: true, official_id: true,
          tournament_disciplines: { select: { format_config: true } },
        },
      });
      if (!fxTeams) throw new NotFoundError('Fixture');
    }
    // Kick-off is stamped ONCE, on the way into 'live' (J2-E6-S2). Every score tap
    // comes through this same route, so writing it unconditionally would reset the
    // clock to zero on every point - hence the "only if not already set" test.
    // Leaving 'live' without finishing (a postponement) clears it so a resumed
    // match restarts its clock; completing KEEPS it, because how long the match
    // ran is part of the result.
    if (b.status === 'live') {
      if (!fxTeams?.live_started_at) data.live_started_at = new Date();
    } else if (b.status && b.status !== 'completed') {
      data.live_started_at = null;
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
    // First-ever transition into 'live' (mirrors the live_started_at "only if not
    // already set" test above) - a resumed match after a postponement doesn't re-fire.
    if (b.status === 'live' && fxTeams && !fxTeams.live_started_at) {
      const audience = await matchAudience(prisma, fxTeams.home_team_id, fxTeams.away_team_id, [fxTeams.official_id]);
      await notifyMatch(prisma, 'match_live', audience, req.user!.id, { body: 'The match is now live.' });
    }
    if (b.status === 'cancelled' && fxTeams && fxTeams.status !== 'cancelled') {
      const audience = await matchAudience(prisma, fxTeams.home_team_id, fxTeams.away_team_id, [fxTeams.official_id]);
      await notifyMatch(prisma, 'match_cancelled', audience, req.user!.id, { body: 'This match has been cancelled.' });
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
    // Every scoring format this fixture could resolve to, so the console can walk
    // the ladder (fixture -> round -> draw -> sport default) without a second round
    // trip per rung. WITHOUT THIS the console received no format rows at all, so
    // resolveFormat could not look up any id and every match - even one whose draw
    // had a format chosen - fell through to the sport default. That is the bug this
    // closes; the console's own comment had been promising this payload.
    let scoring_formats: unknown[] = [];
    try {
      const ids = formatIdsForDraw(
        { scoring_format_id: (tdx as { scoring_format_id?: string | null })?.scoring_format_id ?? null,
          round_formats: (tdx as { round_formats?: unknown })?.round_formats },
        [{ scoring_format_id: (fixture as { scoring_format_id?: string | null }).scoring_format_id ?? null }],
      );
      if (ids.length) {
        scoring_formats = await prisma.$queryRaw`
          select id, name, config, organization_id, is_system, archived_at
          from scoring_formats where id = any(${ids}::uuid[])`;
      }
    } catch {
      // Columns/table not migrated yet - the ladder falls through to the sport
      // default, which is a real published format rather than a generic counter.
    }

    res.json({
      ...fixture, point_scheme: rule?.scheme ?? null, ranking_points, ranking_participation,
      scoring_formats,
    });
  }));

  // ---- Awards (player-of-the-match etc.) ----
  // Free-text award name + a recipient who plays for one of the two teams. Read +
  // replace-all write, both authorized like scoring. These surface as the
  // recipient's "achievements" on their participant dashboard.
  const awardView = (a: {
    id: string; award_name: string; award_type_id?: string | null;
    recipient_user_id: string; users?: { name: string } | null;
  }) => ({
    id: a.id,
    award_name: a.award_name,
    award_type_id: a.award_type_id ?? null,
    recipient_user_id: a.recipient_user_id,
    recipient_name: a.users?.name ?? null,
  });

  // The catalogue an official picks from (J4-E4-S2). Sport-agnostic entries plus
  // anything registered for this sport; free text stays available as a fallback,
  // so this list narrows the common case rather than gating it.
  router.get('/award-types', asyncHandler(async (req, res) => {
    const sportId = typeof req.query.sport_id === 'string' ? req.query.sport_id : null;
    const rows = await prisma.award_types.findMany({
      where: { is_active: true, ...(sportId ? { OR: [{ sport_id: null }, { sport_id: sportId }] } : { sport_id: null }) },
      select: { id: true, code: true, label: true, sport_id: true },
      orderBy: [{ sort_order: 'asc' }, { label: 'asc' }],
    });
    res.json(rows);
  }));

  router.get('/fixtures/:id/awards', guards.fixtureScorer, asyncHandler(async (req, res) => {
    const rows = await prisma.fixture_awards.findMany({
      where: { fixture_id: req.params.id },
      include: { users: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    });
    res.json(rows.map(awardView));
  }));

  router.patch('/fixtures/:id/awards', guards.fixtureScorer, validateBody(fixtureAwardsSchema), asyncHandler(async (req, res) => {
    // A locked result is immutable for everyone - organiser, official and platform
    // admin alike. Changing it means unlocking it first, with a reason, on the record.
    await assertNotLocked(prisma, req.params.id);
    // Same gate as /live, /result and /points had all along - awards were the
    // one scoring route without it, so a Player of the Match could be recorded
    // against a championship still in draft (J2-E5-S1).
    await assertChampionshipStarted(prisma, req.params.id);
    const fixtureId = req.params.id;
    const fixture = await prisma.fixtures.findUnique({ where: { id: fixtureId } });
    if (!fixture) throw new NotFoundError('Fixture');
    const awards = req.body.awards as { award_name: string; award_type_id?: string | null; recipient_user_id: string }[];
    // Replace-all: wipe the fixture's awards then re-insert, atomically.
    await prisma.$transaction([
      prisma.fixture_awards.deleteMany({ where: { fixture_id: fixtureId } }),
      ...(awards.length
        ? [prisma.fixture_awards.createMany({
          data: awards.map((a) => ({
            fixture_id: fixtureId,
            award_name: a.award_name,
            award_type_id: a.award_type_id ?? null,
            recipient_user_id: a.recipient_user_id,
          })),
        })]
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
    // A locked result is immutable for everyone - organiser, official and platform
    // admin alike. Changing it means unlocking it first, with a reason, on the record.
    await assertNotLocked(prisma, req.params.id);
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

      try {
        const td = await prisma.tournament_disciplines.findUnique({
          where: { id: updated.tournament_discipline_id },
          select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } },
        });
        const championshipId = td?.tournament_sports?.tournaments?.championship_id;
        if (championshipId) {
          await notify(prisma, {
            type: 'result_submitted',
            championshipId,
            senderId: req.user!.id,
            data: { body: 'A match result is ready to review.' },
          });
        }
      } catch (err) {
        console.error(`[fixtures] result_submitted notification failed for fixture ${req.params.id}:`, err);
      }
    }
    if ((req.body.status ?? 'completed') === 'cancelled' && fixture.status !== 'cancelled') {
      const audience = await matchAudience(prisma, fixture.home_team_id, fixture.away_team_id, [fixture.official_id]);
      await notifyMatch(prisma, 'match_cancelled', audience, req.user!.id, { body: 'This match has been cancelled.' });
    }
    res.json(updated);
  }));

  // Award custom championship points for a result (the "custom" point system). Stored
  // on the fixture's live_state JSON (no migration needed), merged in so live-scoring
  // keys stay intact, then standings recompute.
  router.patch('/fixtures/:id/points', guards.fixtureScorer, validateBody(fixturePointsSchema), asyncHandler(async (req, res) => {
    // A locked result is immutable for everyone - organiser, official and platform
    // admin alike. Changing it means unlocking it first, with a reason, on the record.
    await assertNotLocked(prisma, req.params.id);
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
    // A locked result is immutable for everyone - organiser, official and platform
    // admin alike. Changing it means unlocking it first, with a reason, on the record.
    await assertNotLocked(prisma, req.params.id);
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
  // ---------------------------------------------------------------------------
  // Scorecard lifecycle (J2-E7)
  //
  // Submitting is the scorer's handoff; locking is the organiser's review. They are
  // deliberately different authorities: a scorer who can lock their own card is not
  // being reviewed by anyone. Until the permission engine lands (J6-E1), "organiser"
  // is expressed with the existing championshipManager guard.
  // ---------------------------------------------------------------------------

  const fixtureOrganiser = guards.championshipManager((req) => guards.resolvers.championshipOfFixture(req.params.id));

  // ---------------------------------------------------------------------------
  // Assigning the official responsible for a match (J2-E4-S3)
  //
  // Its own route rather than a field on the fixture update, because assignment has
  // three consequences the generic CRUD path cannot deliver: the match has to land
  // in that person's officiating queue, they have to be told, and the assignment is
  // exactly what grants them scoring rights to this one fixture (fixtureScorer reads
  // fixtures.official_id).
  // ---------------------------------------------------------------------------
  router.patch('/fixtures/:id/official', fixtureOrganiser, validateBody(assignFixtureOfficialSchema),
    asyncHandler(async (req, res) => {
      const fx = await prisma.fixtures.findUnique({
        where: { id: req.params.id },
        select: {
          id: true, official_id: true, scheduled_at: true,
          teams_fixtures_home_team_idToteams: { select: { name: true } },
          teams_fixtures_away_team_idToteams: { select: { name: true } },
          venue_grounds: { select: { name: true, venues: { select: { name: true } } } },
          tournament_disciplines: {
            select: {
              disciplines: { select: { name: true } },
              tournament_sports: {
                select: { sports: { select: { name: true } }, tournaments: { select: { championship_id: true } } },
              },
            },
          },
        },
      });
      if (!fx) throw new NotFoundError('Fixture');

      const championshipId = fx.tournament_disciplines?.tournament_sports?.tournaments?.championship_id ?? null;
      const officialId = req.body.official_id as string | null;

      // GET /me/officiating only lists matches inside championships the user is an
      // active official of, so assigning someone who isn't on the championship's
      // officials list would put the match in a queue they can never see. Refuse it
      // and say where to fix it, rather than assigning into a black hole.
      if (officialId) {
        const membership = championshipId
          ? await prisma.championship_officials.findUnique({
              where: { championship_id_user_id: { championship_id: championshipId, user_id: officialId } },
              select: { is_active: true },
            })
          : null;
        if (!membership?.is_active) {
          throw new BusinessRuleError('Add this person to the championship’s officials first (Organising team → Officials) - otherwise the match won’t appear in their queue.');
        }
      }

      if (officialId === fx.official_id) {
        res.json({ ok: true, official_id: officialId, notified: false });
        return;
      }

      const updated = await prisma.fixtures.update({
        where: { id: fx.id },
        data: { official_id: officialId },
        select: { id: true, official_id: true },
      });

      // Best-effort: the assignment is committed, and a notification failure must not
      // be reported back as a failed assignment.
      const home = fx.teams_fixtures_home_team_idToteams?.name ?? 'TBD';
      const away = fx.teams_fixtures_away_team_idToteams?.name ?? 'TBD';
      const sport = [fx.tournament_disciplines?.tournament_sports?.sports?.name, fx.tournament_disciplines?.disciplines?.name]
        .filter(Boolean).join(' · ');
      const where = fx.venue_grounds ? [fx.venue_grounds.venues?.name, fx.venue_grounds.name].filter(Boolean).join(' · ') : null;
      const when = fx.scheduled_at ? new Date(fx.scheduled_at).toISOString() : null;
      const label = [`${home} vs ${away}`, sport].filter(Boolean).join(' — ');
      const tell = async (userId: string, title: string, body: string) => {
        try {
          // v2: the audience is a rule, not a string. 'manual' takes an explicit
          // title/body and routes to one user, which is exactly this errand.
          await notify(prisma, {
            type: 'manual',
            championshipId,
            userId,
            senderId: req.user!.id,
            data: { title, body },
          });
        } catch (err) {
          console.error(`[officials] assignment notification failed for fixture ${fx.id}:`, err);
        }
      };
      if (officialId) {
        const details = [when ? `Scheduled for ${when}.` : 'Not scheduled yet.', where ? `At ${where}.` : null]
          .filter(Boolean).join(' ');
        await tell(officialId, `You're officiating ${label}`, `You've been assigned to score this match. ${details} It's in your Officiating queue.`);
      }
      // The previous official's queue silently loses a match otherwise, which is how
      // a match ends up with nobody at it.
      if (fx.official_id) {
        await tell(fx.official_id, `No longer officiating ${label}`, 'The organiser has reassigned this match, so it has left your Officiating queue.');
      }

      res.json({ ok: true, official_id: updated.official_id, notified: true });
    }));

  // ---------------------------------------------------------------------------
  // Where the timetable contradicts itself (J2-E4-S2)
  //
  // Advisory, not enforcement: an organiser mid-shuffle is legitimately double-booked
  // for a moment, so this reports clashes and lets them judge, rather than refusing
  // the write that created one.
  // ---------------------------------------------------------------------------
  router.get('/championships/:eventId/fixtures/clashes',
    guards.championshipManager(async (req) => req.params.eventId),
    asyncHandler(async (req, res) => {
      const rows = await prisma.fixtures.findMany({
        where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: req.params.eventId } } } },
        select: {
          id: true, scheduled_at: true, duration_minutes: true, venue_ground_id: true,
          official_id: true, status: true, home_team_id: true, away_team_id: true,
        },
      });
      const clashes = findClashes(rows.map((f) => ({
        id: f.id,
        scheduledAt: f.scheduled_at,
        durationMinutes: f.duration_minutes,
        groundId: f.venue_ground_id,
        officialId: f.official_id,
        teamIds: [f.home_team_id, f.away_team_id],
        status: f.status,
      })));
      res.json({ clashes, by_fixture: clashesByFixture(clashes) });
    }));

  // draft -> submitted, by whoever may score it
  router.post('/fixtures/:id/submit', guards.fixtureScorer, asyncHandler(async (req, res) => {
    res.json(await submitScorecard(prisma, req, req.params.id));
  }));

  // submitted -> draft, while it is still the scorer's to correct
  router.post('/fixtures/:id/retract', guards.fixtureScorer, asyncHandler(async (req, res) => {
    res.json(await retractScorecard(prisma, req, req.params.id));
  }));

  // -> locked. The transaction; organiser only.
  router.post('/fixtures/:id/lock', fixtureOrganiser, asyncHandler(async (req, res) => {
    res.json(await lockScorecard(prisma, req, req.params.id));
  }));

  // locked -> submitted, with a mandatory reason that lands in the audit trail.
  router.post('/fixtures/:id/unlock', fixtureOrganiser, asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason?: string };
    res.json(await unlockScorecard(prisma, req, req.params.id, reason ?? ''));
  }));

  // Finishing a 90-match meet is not 90 separate actions. Per-fixture transactions,
  // looped outside; partial success is the correct outcome.
  router.post('/championships/:eventId/fixtures/lock-bulk',
    guards.championshipManager(async (req) => req.params.eventId),
    asyncHandler(async (req, res) => {
      const ids = Array.isArray(req.body?.fixture_ids) ? req.body.fixture_ids as string[] : [];
      if (ids.length === 0) throw new BusinessRuleError('Select at least one scorecard to lock.');
      if (ids.length > 50) throw new BusinessRuleError('Lock at most 50 scorecards at a time.');
      const results = await lockScorecardsBulk(prisma, req, ids);
      res.json({ results, locked: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
    }));

  // Counts by state - the organiser's "N ready to lock" queue.
  router.get('/championships/:eventId/lock-status',
    guards.championshipManager(async (req) => req.params.eventId),
    asyncHandler(async (req, res) => {
      res.json(await lockStatusForChampionship(prisma, req.params.eventId));
    }));

  const crudGuard = guards.championshipCrudGuard({
    body: async (req) => guards.resolvers.championshipOfTournamentDiscipline(req.body?.tournament_discipline_id),
    byId: guards.resolvers.championshipOfFixture,
  });

  // The generic update/delete path can set scores, status and schedule just as
  // /result can, so immutability has to hold here too - otherwise the lock is a
  // door with the wall missing beside it. Runs after the authorization guard, and
  // only on the by-id routes (a create has no fixture to be locked).
  const notLocked: RequestHandler = asyncHandler(async (req, _res, next) => {
    await assertNotLocked(prisma, req.params.id);
    next();
  });

  // Manual edits through the generic editor (schedule/venue/opponent/cancel) - the
  // one PATCH path that isn't a bespoke route above, so it's the only place these
  // four can actually change. Only fires on a genuine change, never on an
  // unrelated field edit (e.g. round/pool_number).
  const notifyFixtureFieldChanges = async (_id: string, before: any, after: any) => {
    if (!before) return;
    const audience = await matchAudience(prisma, after.home_team_id, after.away_team_id, [after.official_id]);
    if (before.scheduled_at == null && after.scheduled_at != null) {
      await notifyMatch(prisma, 'match_scheduled', audience, null, { body: 'Your match has been scheduled.' });
    } else if (
      before.scheduled_at != null && after.scheduled_at != null &&
      new Date(before.scheduled_at).getTime() !== new Date(after.scheduled_at).getTime()
    ) {
      await notifyMatch(prisma, 'match_rescheduled', audience, null, { body: 'This match’s time has changed.' });
    }
    if (before.venue_ground_id !== after.venue_ground_id) {
      await notifyMatch(prisma, 'match_venue_changed', audience, null, { body: 'This match’s venue has changed.' });
    }
    // Only a genuine swap on an already-real match - a TBD slot getting its first
    // real team is a qualifier resolving (stage-resolver.ts), not an "opponent change".
    if (
      before.home_team_id && before.away_team_id &&
      (before.home_team_id !== after.home_team_id || before.away_team_id !== after.away_team_id)
    ) {
      await notifyMatch(prisma, 'match_opponent_changed', audience, null, { body: 'The opponent for this match has changed.' });
    }
    if (before.status !== 'cancelled' && after.status === 'cancelled') {
      await notifyMatch(prisma, 'match_cancelled', audience, null, { body: 'This match has been cancelled.' });
    }
  };

  router.use('/fixtures', makeCrudRouter(prisma.fixtures, {
    name: 'Fixture',
    createSchema: createFixtureSchema,
    updateSchema: updateFixtureSchema,
    listFilters: ['tournament_discipline_id'],
    orderBy: [{ pool_number: 'asc' }, { bracket_position: 'asc' }, { created_at: 'asc' }],
    createGuards: [crudGuard],
    writeGuards: [crudGuard, notLocked],
    afterUpdate: notifyFixtureFieldChanges,
  }));

  return router;
}
