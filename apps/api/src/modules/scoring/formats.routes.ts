import { Router } from 'express';
import {
  matchPresetsFor, isScoredSport, predictKnockoutRounds, matchFormatSchema, roundFormatsSchema,
} from '@semp/shared';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import type { Request } from 'express';
import { makeGuards } from '../../http/middleware/permissions.js';
import { verifyPlayerStats } from '../records/fixture-events.service.js';
import { assertNotLocked } from '../fixtures/lock.service.js';

// ============================================================================
// The format shelf.
//
// Formats are ORG-SCOPED: an institution defines "our table tennis format" once and
// reuses it across every championship it hosts, which is what makes a returning
// customer's second event faster to set up than their first. Resolved through
// championships.host_organization_id, which is nullable - a championship with no
// host org sees only the platform shelf, by design.
//
// Reads and writes go through raw SQL because scoring_formats lands in
// 20260903000000 and the generated Prisma client only learns about it after a
// `prisma db pull`. Everything is parameterised.
// ============================================================================

interface FormatRow {
  id: string;
  organization_id: string | null;
  sport_id: string | null;
  name: string;
  preset_key: string | null;
  config: unknown;
  is_system: boolean;
  created_at: Date;
}

const saveFormatSchema = z.object({
  name: z.string().min(1).max(160),
  sportId: z.string().uuid().optional(),
  presetKey: z.string().max(60).optional(),
  // Either family. Validating with the rally schema alone refused every cricket
  // format, so the shelf offered cricket presets and would not keep a variation.
  config: matchFormatSchema,
});

const drawFormatSchema = z.object({
  /** null clears the draw default and falls back to the sport default. */
  scoringFormatId: z.string().uuid().nullable().optional(),
  roundFormats: roundFormatsSchema.optional(),
});

export function makeScoringFormatsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const drawOrganiser = guards.championshipManager(async (req: Request) =>
    guards.resolvers.championshipOfTournamentDiscipline(req.params.id));

  /** The host org of the championship that owns this draw, for shelf scoping. */
  const hostOrgOfDraw = async (tournamentDisciplineId: string): Promise<string | null> => {
    const td = await prisma.tournament_disciplines.findUnique({
      where: { id: tournamentDisciplineId },
      select: {
        tournament_sports: {
          select: {
            sport_id: true,
            tournaments: { select: { championships: { select: { host_organization_id: true } } } },
          },
        },
      },
    });
    return td?.tournament_sports?.tournaments?.championships?.host_organization_id ?? null;
  };

  /**
   * What this draw can be scored with: the sport's built-in presets, plus every
   * saved format belonging to the host org, plus the platform shelf.
   *
   * The built-in presets are returned as CONFIGS, not rows - they need no database
   * and are the reason an unconfigured draw still gets a real, correct format rather
   * than the generic counter this platform used to fall back to.
   */
  router.get('/tournament-disciplines/:id/scoring-formats', asyncHandler(async (req, res) => {
    const td = await prisma.tournament_disciplines.findUnique({
      where: { id: req.params.id },
      select: {
        format_config: true,
        tournament_sports: { select: { sport_id: true, sports: { select: { name: true } } } },
      },
    });
    if (!td) throw new NotFoundError('Tournament discipline');
    const sportName = td.tournament_sports?.sports?.name ?? null;
    const sportId = td.tournament_sports?.sport_id ?? null;
    const orgId = await hostOrgOfDraw(req.params.id);

    let saved: FormatRow[] = [];
    try {
      saved = await prisma.$queryRaw<FormatRow[]>`
        select id, organization_id, sport_id, name, preset_key, config, is_system, created_at
        from scoring_formats
        where archived_at is null
          and (sport_id is null or sport_id = ${sportId}::uuid)
          and (organization_id is null or organization_id = ${orgId}::uuid)
        order by is_system asc, name asc
        limit 200`;
    } catch {
      // Table not migrated yet: the built-in shelf still works, which is the whole
      // point of keeping the presets in code rather than seeding them as data only.
      saved = [];
    }

    // What this draw is CURRENTLY set to, and its per-round overrides. Without
    // these the edit dialog opened showing the first preset, so a draw already
    // running a saved custom format looked as though it had lost it.
    let current: { formatId: string | null; roundFormats: unknown } = { formatId: null, roundFormats: [] };
    try {
      const rows = await prisma.$queryRaw<Array<{ scoring_format_id: string | null; round_formats: unknown }>>`
        select scoring_format_id, round_formats
        from tournament_disciplines where id = ${req.params.id}::uuid`;
      if (rows[0]) current = { formatId: rows[0].scoring_format_id, roundFormats: rows[0].round_formats ?? [] };
    } catch {
      // Columns not migrated yet - the shelf still works, nothing is selected.
    }

    // THE ROUNDS THIS DRAW ACTUALLY HAS.
    //
    // The editor used to fall back to a generic R32/R16/QF/SF/Final ladder whenever
    // it did not know them - which was always, before generation. So an 8-team draw
    // could be given overrides on R32 and R16, saved happily, and they sat inert
    // forever because the generator never creates those rounds.
    //
    // Generated: read the real rounds off the fixtures, with a match count each.
    // Not generated: PREDICT them from how many squads have entered, which is
    // exactly knowable for a bracket. Either way the editor only ever offers rounds
    // that will exist.
    let rounds: Array<{ round: string; matches: number; stageSequence: number }> = [];
    let entrants = 0;
    try {
      entrants = await prisma.team_entries.count({ where: { tournament_discipline_id: req.params.id } });
      const fx = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: req.params.id },
        select: { round: true, stage_sequence: true, bracket_position: true, scheduled_at: true },
      });
      if (fx.length) {
        const seen = new Map<string, { round: string; matches: number; stageSequence: number; order: number }>();
        fx.forEach((f, i) => {
          if (!f.round) return;
          const stage = f.stage_sequence ?? 1;
          const key = `${stage}|${f.round}`;
          const existing = seen.get(key);
          if (existing) { existing.matches += 1; return; }
          seen.set(key, { round: f.round, matches: 1, stageSequence: stage, order: i });
        });
        // Play order: a bracket's rounds should read R16 -> QF -> SF -> Final, which
        // is descending match count, not insertion order.
        rounds = [...seen.values()]
          .sort((a, b) => a.stageSequence - b.stageSequence || b.matches - a.matches || a.order - b.order)
          .map(({ round, matches, stageSequence }) => ({ round, matches, stageSequence }));
      } else if (entrants >= 2) {
        rounds = predictKnockoutRounds(entrants).map((round, i) => ({
          // A predicted round's match count halves each time from the bracket size.
          round, matches: Math.max(1, 2 ** (predictKnockoutRounds(entrants).length - 1 - i)), stageSequence: 1,
        }));
      }
    } catch {
      // Nothing to offer rather than something wrong.
    }

    res.json({
      sport: sportName,
      sportId,
      // isScoredSport, not isKernelSport: cricket IS scored, just not by the rally
      // kernel, and the narrower question would hide the picker for it entirely.
      supported: isScoredSport(sportName),
      presets: matchPresetsFor(sportName),
      saved,
      current,
      rounds,
      entrants,
      generated: rounds.length > 0 && entrants >= 0,
    });
  }));

  /**
   * Save a (possibly tweaked) format against the host organisation so it can be
   * reused across every championship that org runs.
   */
/**
 * Is this a unique-constraint violation?
 *
 * Matched on the Postgres SQLSTATE rather than on a message, because the message
 * names the constraint and Prisma wraps raw-query failures as P2010 with the code
 * nested in `meta` - so a check on the Prisma code alone misses it.
 */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } } | null;
  return err?.code === 'P2002' || err?.meta?.code === '23505' || err?.code === '23505';
}

  router.post('/tournament-disciplines/:id/scoring-formats',
    drawOrganiser,
    validateBody(saveFormatSchema),
    asyncHandler(async (req, res) => {
      const orgId = await hostOrgOfDraw(req.params.id);
      if (!orgId) {
        throw new BusinessRuleError(
          'This championship has no host institution, so a format cannot be saved against one. Pick a preset instead.',
        );
      }
      const b = req.body as z.infer<typeof saveFormatSchema>;
      let rows: Array<{ id: string }>;
      try {
        rows = await prisma.$queryRaw<Array<{ id: string }>>`
          insert into scoring_formats (organization_id, sport_id, name, preset_key, config, created_by)
          values (${orgId}::uuid, ${b.sportId ?? null}::uuid, ${b.name},
                  ${b.presetKey ?? null}, ${JSON.stringify(b.config)}::jsonb, ${req.user!.id}::uuid)
          returning id`;
      } catch (e) {
        // The shelf is unique on (organisation, sport, lower(name)). Reusing a name
        // returned a raw 500 "Internal server error", which tells an organiser
        // nothing and reads as the product breaking. The picker pre-checks the names
        // it has already loaded, but that cannot cover a name saved in another tab,
        // an in-place edit, or a shelf list that is a minute old.
        if (isUniqueViolation(e)) {
          throw new BusinessRuleError(
            `Your institution already has a format called "${b.name}" for this sport. `
            + 'Give this one a different name, or edit the existing one instead.',
          );
        }
        throw e;
      }
      res.status(201).json({ id: rows[0]?.id ?? null });
    }));

  /**
   * Update a saved org format in place.
   *
   * Editing a format and saving it again should CHANGE it, not leave a trail of
   * near-identical rows on the shelf. Platform presets (organization_id null,
   * is_system) are never writable - they are the shelf everybody shares.
   */
  router.patch('/tournament-disciplines/:id/scoring-formats/:formatId',
    drawOrganiser,
    validateBody(saveFormatSchema.partial({ name: true })),
    asyncHandler(async (req, res) => {
      const orgId = await hostOrgOfDraw(req.params.id);
      const b = req.body as Partial<z.infer<typeof saveFormatSchema>>;
      const n = await prisma.$executeRaw`
        update scoring_formats
        set name = coalesce(${b.name ?? null}, name),
            config = coalesce(${b.config ? JSON.stringify(b.config) : null}::jsonb, config),
            updated_at = now()
        where id = ${req.params.formatId}::uuid
          and is_system = false
          and organization_id = ${orgId}::uuid`;
      if (n === 0) {
        throw new BusinessRuleError(
          'That format cannot be edited here - a built-in preset is shared by every institution. Save it under a new name instead.',
        );
      }
      res.json({ ok: true });
    }));

  /**
   * Set the draw default (rung 4) and the per-round overrides (rung 5).
   *
   * This is the endpoint the fixture-generation flow calls BEFORE generating, which
   * is the whole shape of the requirement: the format is settled first, so every
   * fixture resolves a real format from the moment it exists.
   */
  router.patch('/tournament-disciplines/:id/scoring-format',
    drawOrganiser,
    validateBody(drawFormatSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof drawFormatSchema>;
      if (b.scoringFormatId !== undefined) {
        await prisma.$executeRaw`
          update tournament_disciplines
          set scoring_format_id = ${b.scoringFormatId}::uuid
          where id = ${req.params.id}::uuid`;
      }
      if (b.roundFormats !== undefined) {
        // Per-round overrides are keyed on (stage_sequence, round) - exactly what the
        // generators already stamp ('Final', 'SF', 'QF', 'R16'). First match wins, so
        // a specific round listed above a stage-wide rule beats it.
        await prisma.$executeRaw`
          update tournament_disciplines
          set round_formats = ${JSON.stringify(b.roundFormats)}::jsonb
          where id = ${req.params.id}::uuid`;
      }
      res.json({ ok: true });
    }));

  /**
   * Re-verify a match's statistics against its recorded facts.
   *
   * Rebuilds the rally log from fixture_events, re-derives the stats through the
   * same kernel, and reports any field that disagrees with what is stored. This is
   * what makes the derived jsonb defensible: it is a cache, and here is the check.
   *
   * Read-only - it reports drift, it does not repair it. Re-locking recomputes.
   */
  router.get('/fixtures/:id/stats/verify', guards.fixtureScorer, asyncHandler(async (req, res) => {
    res.json(await verifyPlayerStats(prisma, req.params.id));
  }));

  /**
   * Override the format for one match only (rung 6).
   *
   * AND CLEAR THE FROZEN SNAPSHOT, which is the whole reason this was not working.
   * The console freezes the resolved format into `live_state.format` on the first
   * tap so a played match stays reproducible, and rung 7 (frozen) outranks every
   * configured layer. So setting a per-match format on a match that had ALREADY
   * been scored saved happily and changed nothing at all - the freeze kept winning
   * and nothing said so.
   *
   * The freeze is right for a PUBLISHED result and wrong for a match still in play.
   * So: a locked scorecard refuses the change outright (unlock it, with a reason, on
   * the record); anything else clears the snapshot so the new format applies, and
   * the console re-freezes to it on the next tap.
   */
  router.patch('/fixtures/:id/scoring-format',
    guards.fixtureScorer,
    validateBody(z.object({ scoringFormatId: z.string().uuid().nullable() })),
    asyncHandler(async (req, res) => {
      // A locked result is immutable for everyone - the same rule every other write
      // path on a fixture obeys.
      await assertNotLocked(prisma, req.params.id);

      const before = await prisma.fixtures.findUnique({
        where: { id: req.params.id },
        select: { scoring_format_id: true, live_state: true, status: true },
      });
      if (!before) throw new NotFoundError('Fixture');

      const changed = (before.scoring_format_id ?? null) !== (req.body.scoringFormatId ?? null);
      const wasFrozen = !!(before.live_state as { format?: unknown } | null)?.format;

      await prisma.$executeRaw`
        update fixtures
        set scoring_format_id = ${req.body.scoringFormatId}::uuid
        where id = ${req.params.id}::uuid`;

      // Only when the format actually changed: clearing the snapshot on a no-op
      // write would throw away the rules a match is mid-way through playing under.
      if (changed && wasFrozen) {
        await prisma.$executeRaw`
          update fixtures
          set live_state = live_state - 'format'
          where id = ${req.params.id}::uuid`;
      }

      res.json({
        ok: true,
        // So the UI can say what happened rather than leaving somebody to wonder.
        reapplied: changed && wasFrozen,
        hadScored: wasFrozen,
      });
    }));

  return router;
}
