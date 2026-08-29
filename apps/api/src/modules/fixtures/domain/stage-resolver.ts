import { stageConfigSchema, type StandingsTiebreaker } from '@semp/shared';
import type { Prisma } from '../../../infra/prisma.js';
import { resolveRuleForDraw } from '../../standings/standings.service.js';
import { advanceInBracket } from '../bracket.js';
import { matchAudience, notifyMatch } from '../match-audience.js';
import { computePoolStandings, isPoolComplete, tiedRanks, type PoolFixture, type PoolStanding } from './generators/pool-standings.js';
import { assignStageSequence, type AssignedStageTree } from './stage-tree.js';

async function notifyTeamQualifies(prisma: Prisma, teamId: string): Promise<void> {
  const audience = await matchAudience(prisma, teamId, null);
  await notifyMatch(prisma, 'team_qualifies', audience, null, { body: 'Your team has qualified for the next stage.' });
}

const poolLetter = (poolNumber: number) => String.fromCharCode(64 + poolNumber);

type FixtureRow = {
  id: string;
  stage_sequence: number | null;
  pool_number: number | null;
  bracket_position: number | null;
  round: string | null;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_slot_label: string | null;
  away_slot_label: string | null;
  winner_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  teams_fixtures_home_team_idToteams: { organization_id: string } | null;
  teams_fixtures_away_team_idToteams: { organization_id: string } | null;
};

function toSchemeFixture(f: FixtureRow): PoolFixture {
  return {
    status: f.status, round: f.round,
    home_team_id: f.home_team_id, away_team_id: f.away_team_id,
    home_org_id: f.teams_fixtures_home_team_idToteams?.organization_id ?? null,
    away_org_id: f.teams_fixtures_away_team_idToteams?.organization_id ?? null,
    home_score: f.home_score, away_score: f.away_score,
    winner_team_id: f.winner_team_id,
  };
}

// Best-effort, called after every result/live-score write - a resolution hiccup must
// never fail the scorer's request, exactly like advanceWinner/refreshStandings.
export async function resolveStageAdvancement(prisma: Prisma, tournamentDisciplineId: string): Promise<void> {
  try {
    const td = await prisma.tournament_disciplines.findUnique({
      where: { id: tournamentDisciplineId },
      select: {
        format_config: true, discipline_id: true, format_id: true,
        tournament_sports: { select: { format_id: true, tournaments: { select: { championship_id: true } } } },
      },
    });
    if (!td) return;
    const parsed = stageConfigSchema.safeParse(td.format_config);
    if (!parsed.success) return; // this discipline wasn't built with the stage wizard - nothing to resolve

    const championshipId = td.tournament_sports?.tournaments?.championship_id;
    if (!championshipId) return;
    const formatId = td.format_id ?? td.tournament_sports?.format_id ?? null;
    const rule = await resolveRuleForDraw(prisma, championshipId, td.discipline_id ?? null, formatId);

    const tree = assignStageSequence(parsed.data.root);
    // Single-stage draw (no branches beyond the root) - nothing to resolve, even
    // though the config technically parsed. Cheap early exit.
    if (tree.stages.length <= 1) return;

    const all: FixtureRow[] = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: tournamentDisciplineId },
      select: {
        id: true, stage_sequence: true, pool_number: true, bracket_position: true, round: true, status: true,
        home_team_id: true, away_team_id: true, home_slot_label: true, away_slot_label: true, winner_team_id: true,
        home_score: true, away_score: true,
        teams_fixtures_home_team_idToteams: { select: { organization_id: true } },
        teams_fixtures_away_team_idToteams: { select: { organization_id: true } },
      },
    });

    for (const stage of tree.stages) {
      if (stage.node.type !== 'group') continue;
      const stageFixtures = all.filter((f) => (f.stage_sequence ?? 1) === stage.sequence);
      const poolNumbers = new Set(stageFixtures.map((f) => f.pool_number).filter((n): n is number => n != null));
      for (const poolNumber of poolNumbers) {
        const poolFixtures = stageFixtures.filter((f) => f.pool_number === poolNumber).map(toSchemeFixture);
        if (!isPoolComplete(poolFixtures)) continue;
        const standings = computePoolStandings(poolFixtures, rule, stage.node.tiebreakers);
        await resolveGroupQualifierLabels(prisma, tournamentDisciplineId, stage.sequence, poolNumber, standings, tree);
      }
    }

    await resolveThirdPlaceLabels(prisma, tournamentDisciplineId, all);
  } catch (err) {
    console.error(`[stages] advancement failed for draw ${tournamentDisciplineId}:`, err);
  }
}

// Resolves one pool's qualifier labels ("A1", "B2", ...) into real team ids on every
// fixture belonging to a stage this pool feeds. Idempotent: only ever touches rows
// where the label is still present, so re-running after a pool is already resolved
// is a safe no-op.
async function resolveGroupQualifierLabels(
  prisma: Prisma,
  drawId: string,
  producingSequence: number,
  poolNumber: number,
  standings: PoolStanding[],
  tree: AssignedStageTree,
): Promise<void> {
  const childSequences = tree.stages.filter((s) => s.parentSequence === producingSequence).map((s) => s.sequence);
  if (childSequences.length === 0) return;

  const stage = tree.bySequence.get(producingSequence);
  const tiebreakers = stage?.node.type === 'group' ? stage.node.tiebreakers : ['points', 'wins', 'lost'];
  const ambiguous = tiedRanks(standings, tiebreakers as any);

  for (const standing of standings) {
    const label = `${poolLetter(poolNumber)}${standing.rank}`;
    // Select real team ids too - a side already carrying a real team_id has already
    // been resolved (either by us earlier, or by an organiser manually editing the
    // fixture through the generic editor before this pool naturally finished) and
    // must never be overwritten, even though its slot_label is still sitting there
    // unset. Only ever fill a side that is BOTH labelled AND still null.
    const targets = await prisma.fixtures.findMany({
      where: {
        tournament_discipline_id: drawId,
        stage_sequence: { in: childSequences },
        OR: [{ home_slot_label: label }, { away_slot_label: label }],
      },
      select: { id: true, home_slot_label: true, away_slot_label: true, home_team_id: true, away_team_id: true },
    });

    if (ambiguous.has(standing.rank)) {
      // A rank inside an unresolved tie must not be guessed - leave the placeholder
      // as-is, but flag every fixture waiting on it so the organiser can SEE why a
      // bracket slot is stuck instead of only finding out via a server log. Cleared
      // automatically once the tie is broken and this label resolves normally below.
      console.error(`[stages] pool ${poolNumber} (stage ${producingSequence}) rank ${standing.rank} is tied - skipping qualifier resolution for it`);
      for (const t of targets) {
        if ((t.home_slot_label === label && t.home_team_id == null) || (t.away_slot_label === label && t.away_team_id == null)) {
          await flagTieBlocked(prisma, t.id, poolNumber, standing.rank);
        }
      }
      continue;
    }

    for (const t of targets) {
      const data: Record<string, unknown> = {};
      if (t.home_slot_label === label && t.home_team_id == null) { data.home_team_id = standing.teamId; data.home_slot_label = null; }
      if (t.away_slot_label === label && t.away_team_id == null) { data.away_team_id = standing.teamId; data.away_slot_label = null; }
      if (Object.keys(data).length === 0) continue; // both sides already resolved/manually set - nothing to do
      await prisma.fixtures.update({ where: { id: t.id }, data });
      await clearTieBlocked(prisma, t.id);
      await notifyTeamQualifies(prisma, standing.teamId);

      // If that update fully resolved a structural bye row (the other side was
      // never labeled - see stage-orchestrator.ts), the lone team is the winner:
      // finalize it and push it forward, exactly like propagateByes does at stage 1.
      const refreshed = await prisma.fixtures.findUnique({
        where: { id: t.id },
        select: { status: true, home_team_id: true, away_team_id: true, bracket_position: true, stage_sequence: true },
      });
      if (refreshed?.status === 'bye' && refreshed.bracket_position != null) {
        const team = refreshed.home_team_id ?? refreshed.away_team_id;
        if (team) {
          await prisma.fixtures.update({ where: { id: t.id }, data: { winner_team_id: team } });
          await advanceInBracket(prisma, drawId, refreshed.bracket_position, team, refreshed.stage_sequence ?? 1);
        }
      }
    }
  }
}

// Marks a still-unresolved fixture as blocked by a tie the standings can't break, so
// the frontend can show "tied - needs manual resolution" instead of a bare
// placeholder. Stored on live_state (no migration needed), merged so it doesn't
// disturb any other live-scoring keys already there.
async function flagTieBlocked(prisma: Prisma, fixtureId: string, pool: number, rank: number): Promise<void> {
  await prisma.$executeRaw`
    update fixtures
    set live_state = jsonb_set(coalesce(live_state, '{}'::jsonb), '{tie_blocked}', ${JSON.stringify({ pool, rank })}::jsonb, true)
    where id = ${fixtureId}::uuid`;
}

async function clearTieBlocked(prisma: Prisma, fixtureId: string): Promise<void> {
  await prisma.$executeRaw`
    update fixtures set live_state = (coalesce(live_state, '{}'::jsonb) - 'tie_blocked') where id = ${fixtureId}::uuid`;
}

// Resolves any '3rd Place' row's L{n} labels once the referenced semifinal (within
// the same stage_sequence) has a decided winner.
async function resolveThirdPlaceLabels(prisma: Prisma, drawId: string, all: FixtureRow[]): Promise<void> {
  const pending = all.filter((f) => f.home_slot_label?.startsWith('L') || f.away_slot_label?.startsWith('L'));
  for (const row of pending) {
    const data: Record<string, unknown> = {};
    for (const side of ['home', 'away'] as const) {
      const label = side === 'home' ? row.home_slot_label : row.away_slot_label;
      if (!label?.startsWith('L')) continue;
      if ((side === 'home' ? row.home_team_id : row.away_team_id) != null) continue; // already resolved or manually set - don't clobber
      const sfPosition = Number(label.slice(1));
      const sf = all.find((f) => (f.stage_sequence ?? 1) === (row.stage_sequence ?? 1) && f.bracket_position === sfPosition);
      if (!sf || (sf.status !== 'completed' && sf.status !== 'walkover') || !sf.winner_team_id) continue; // not decided yet
      const loser = sf.winner_team_id === sf.home_team_id ? sf.away_team_id : sf.home_team_id;
      if (!loser) continue;
      data[`${side}_team_id`] = loser;
      data[`${side}_slot_label`] = null;
    }
    if (Object.keys(data).length > 0) await prisma.fixtures.update({ where: { id: row.id }, data });
  }
}
