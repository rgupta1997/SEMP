import { BusinessRuleError } from '../../../shared/errors.js';
import type { Branch, StageNode } from '@semp/shared';
import type { GeneratedFixture, TeamRef } from './generators/types.js';
import { generateGroups } from './generators/groups.js';
import { generateKnockout } from './generators/knockout.js';
import { generateManualKnockout, type ManualKnockoutFixture } from './generators/manual-knockout.js';
import { assignStageSequence, type AssignedStage, type AssignedStageTree } from './stage-tree.js';

// Turns a stage-config tree into every stage's fixtures up front. The key trick:
// TeamRef = { teamId: string } has no uuid constraint, and generateGroups/
// generateKnockout never validate teamId as one - so for any stage beyond stage 1 we
// can call the SAME, UNMODIFIED generators with slot-label strings ("A1") in place of
// real team ids, and they produce structurally correct fixtures whose
// homeTeamId/awayTeamId happen to hold labels. toInsert() below is the only place
// that knows whether a given stage's ids are real (sequence 1) or labels (sequence
// > 1) and routes them to the right columns.

export interface StagedFixtureInsert {
  stage_sequence: number;
  home_team_id: string | null;
  away_team_id: string | null;
  home_slot_label: string | null;
  away_slot_label: string | null;
  winner_team_id: string | null;
  round: string;
  pool_number: number | null;
  bracket_position: number | null;
  status: string;
}

export interface ManualAllocationEntry {
  slotIndex: number;
  teamId: string;
}

export function generateAllStages(
  root: StageNode,
  entrants: TeamRef[],
  manualAllocation: ManualAllocationEntry[] = [],
): { inserts: StagedFixtureInsert[]; tree: AssignedStageTree } {
  assertNoDoubleElimination(root);
  const tree = assignStageSequence(root);
  validateStageTree(tree, entrants.length);
  const orderedEntrants = applyManualAllocation(entrants, manualAllocation);

  const inserts: StagedFixtureInsert[] = [];
  for (const stage of tree.stages) {
    inserts.push(...(stage.sequence === 1 ? generateStageOne(stage, orderedEntrants) : generatePlaceholderStage(stage, tree)));
  }
  return { inserts, tree };
}

// v1 exclusion: double elimination is accepted by the schema but not implemented.
// Walks the whole tree, including nested branches, so it can't be smuggled in deep
// inside a branch either.
function assertNoDoubleElimination(node: StageNode): void {
  if (node.type === 'knockout') {
    if (node.eliminationType === 'double') {
      throw new BusinessRuleError('Double elimination is not supported yet - choose single elimination.');
    }
    return;
  }
  for (const branch of node.branches) assertNoDoubleElimination(branch.childStage);
}

// The number of entrants a stage should expect, derived from its position in the
// tree rather than counted after the fact - lets validateStageTree fail fast with one
// clear error instead of a generator throwing deep inside a branch.
function expectedEntrantCount(stage: AssignedStage, tree: AssignedStageTree, rootEntrantCount: number): number {
  if (stage.sequence === 1) return rootEntrantCount;
  const parent = tree.bySequence.get(stage.parentSequence!);
  if (!parent || parent.node.type !== 'group') throw new BusinessRuleError('Invalid stage tree: only a group stage can branch');
  const branch = stage.producingBranch!;
  const qualifiersPerPool = branch.rankTo - branch.rankFrom + 1;
  return qualifiersPerPool * parent.node.numGroups;
}

function validateStageTree(tree: AssignedStageTree, rootEntrantCount: number): void {
  for (const stage of tree.stages) {
    const n = expectedEntrantCount(stage, tree, rootEntrantCount);
    if (stage.node.type === 'group') {
      if (n < stage.node.numGroups * 2) {
        throw new BusinessRuleError(`Stage ${stage.sequence}: needs at least 2 entrants per pool (${n} entrants, ${stage.node.numGroups} pools)`);
      }
    } else {
      if (n < 2) throw new BusinessRuleError(`Stage ${stage.sequence}: knockout needs at least 2 entrants (got ${n})`);
      if (stage.node.seeding === 'manual') {
        // Exact match required - no silent truncation/padding in a mode whose whole
        // point is explicit organiser control.
        const pairSlots = (stage.node.manualPairs ?? []).length * 2;
        if (pairSlots !== n) {
          throw new BusinessRuleError(`Stage ${stage.sequence}: manual pairing covers ${pairSlots} slots but ${n} entrants are expected`);
        }
      }
    }
  }
}

// Places named teams at their 1-based slotIndex, fills the rest with the remaining
// entrants in original order. Relies on stage-config.ts's stageConfigSchema
// superRefine to have already rejected duplicate slotIndex/teamId - a duplicate
// teamId here would otherwise silently drop one real entrant while another loses
// its slot.
function applyManualAllocation(entrants: TeamRef[], allocation: ManualAllocationEntry[]): TeamRef[] {
  const total = entrants.length;
  const result: (TeamRef | null)[] = new Array(total).fill(null);
  const usedTeamIds = new Set<string>();
  for (const a of allocation) {
    if (a.slotIndex < 1 || a.slotIndex > total) continue;
    const team = entrants.find((t) => t.teamId === a.teamId);
    if (!team) continue;
    result[a.slotIndex - 1] = team;
    usedTeamIds.add(team.teamId);
  }
  const remaining = entrants.filter((t) => !usedTeamIds.has(t.teamId));
  let ri = 0;
  for (let i = 0; i < total; i++) { if (result[i] === null) result[i] = remaining[ri++]; }
  return result as TeamRef[];
}

const poolLetter = (poolNumber: number) => String.fromCharCode(64 + poolNumber);

// Rank-major, pool-minor order: all rank-1 finishers first (across every pool), then
// all rank-2, etc - mirrors the standard "pool winners are top seeds" convention, so
// an auto-seeded child knockout keeps same-pool qualifiers apart for as long as
// possible. (Pool-major ordering is an equally defensible alternative with no
// functional difference beyond bracket aesthetics.)
function qualifierLabels(branch: Branch, numPools: number): TeamRef[] {
  const labels: TeamRef[] = [];
  for (let rank = branch.rankFrom; rank <= branch.rankTo; rank++) {
    for (let pool = 1; pool <= numPools; pool++) labels.push({ teamId: `${poolLetter(pool)}${rank}` });
  }
  return labels;
}

type AnnotatedFixture = GeneratedFixture & { homeSlotLabelOverride?: string; awaySlotLabelOverride?: string };

// Shared dispatcher: stage 1 and every placeholder stage call this with either real
// TeamRefs or label TeamRefs - the generators themselves never know which.
function generateRawFixturesForNode(node: StageNode, entrants: TeamRef[]): AnnotatedFixture[] {
  if (node.type === 'group') {
    return generateGroups(entrants, { numGroups: node.numGroups, doubleRound: node.doubleRound });
  }
  if (node.seeding === 'auto') {
    return generateKnockout(entrants, { thirdPlaceMatch: node.thirdPlaceMatch });
  }
  // manual: pairs' home/away strings are already either real team ids (stage 1) or
  // slot labels (stage 2+) - generateManualKnockout doesn't care which.
  const pairs = (node.manualPairs ?? []).map((p) => ({ home: p.home, away: p.away }));
  const mk: ManualKnockoutFixture[] = generateManualKnockout(pairs, { thirdPlaceMatch: node.thirdPlaceMatch });
  return mk.map((f) => ({
    round: f.round, poolNumber: f.poolNumber, bracketPosition: f.bracketPosition,
    homeTeamId: f.entrantHome, awayTeamId: f.entrantAway, status: f.status,
    winnerTeamId: f.winnerToken, feedsInto: f.feedsInto,
  }));
}

// A knockout's '3rd Place' row is never wired to real entrants by generateKnockout/
// generateManualKnockout - its two sides only become known once both semifinals are
// decided. Wire it to loser-of-bracket-position labels (scoped to this stage's own
// stage_sequence at resolution time - see stage-resolver.ts).
function wireThirdPlaceIfPresent(fixtures: AnnotatedFixture[]): void {
  const thirdPlace = fixtures.find((f) => f.round === '3rd Place');
  if (!thirdPlace) return;
  const sfs = fixtures.filter((f) => f.round === 'SF');
  if (sfs.length !== 2) return; // defensive; always exactly 2 SFs when thirdPlaceMatch is requested on a >=4-team bracket
  thirdPlace.homeSlotLabelOverride = `L${sfs[0].bracketPosition}`;
  thirdPlace.awaySlotLabelOverride = `L${sfs[1].bracketPosition}`;
}

function toInsert(f: AnnotatedFixture, sequence: number): StagedFixtureInsert {
  if (f.homeSlotLabelOverride || f.awaySlotLabelOverride) {
    // The 3rd-place row, at ANY stage (including stage 1): entrants are never known
    // at creation time, regardless of sequence - stage-resolver.ts fills them in.
    return {
      stage_sequence: sequence, home_team_id: null, away_team_id: null,
      home_slot_label: f.homeSlotLabelOverride ?? null, away_slot_label: f.awaySlotLabelOverride ?? null,
      winner_team_id: null, round: f.round, pool_number: f.poolNumber, bracket_position: f.bracketPosition,
      status: 'scheduled',
    };
  }
  if (sequence === 1) {
    // Stage 1: homeTeamId/awayTeamId are real ids already.
    return {
      stage_sequence: 1, home_team_id: f.homeTeamId, away_team_id: f.awayTeamId,
      home_slot_label: null, away_slot_label: null, winner_team_id: f.winnerTeamId ?? null,
      round: f.round, pool_number: f.poolNumber, bracket_position: f.bracketPosition, status: f.status,
    };
  }
  // Stage 2+: the generator's homeTeamId/awayTeamId fields actually hold LABEL
  // strings (the reuse trick above), so redirect them to the label columns. Real id
  // columns and winner stay null - including for a structural bye, since which team
  // it is isn't known until the producing pool resolves - until stage-resolver.ts
  // fills them in.
  return {
    stage_sequence: sequence, home_team_id: null, away_team_id: null,
    home_slot_label: f.homeTeamId, away_slot_label: f.awayTeamId,
    winner_team_id: null, round: f.round, pool_number: f.poolNumber, bracket_position: f.bracketPosition,
    status: f.status === 'bye' ? 'bye' : 'scheduled',
  };
}

function generateStageOne(stage: AssignedStage, entrants: TeamRef[]): StagedFixtureInsert[] {
  const raw = generateRawFixturesForNode(stage.node, entrants);
  wireThirdPlaceIfPresent(raw);
  return raw.map((f) => toInsert(f, 1));
}

function generatePlaceholderStage(stage: AssignedStage, tree: AssignedStageTree): StagedFixtureInsert[] {
  const parent = tree.bySequence.get(stage.parentSequence!);
  if (!parent || parent.node.type !== 'group') throw new BusinessRuleError('Invalid stage tree: only a group stage can branch');
  const labelEntrants = qualifierLabels(stage.producingBranch!, parent.node.numGroups);
  const raw = generateRawFixturesForNode(stage.node, labelEntrants);
  wireThirdPlaceIfPresent(raw);
  return raw.map((f) => toInsert(f, stage.sequence));
}
