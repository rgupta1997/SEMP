import { z } from 'zod';
import { STANDINGS_TIEBREAKER, type StandingsTiebreaker } from './enums.js';

// A tournament discipline's draw as an ordered, possibly-branching tree of stages.
// Stage 1 (the tree root) always has real entrants; every stage beyond that is
// generated with slot-label placeholders ("A1", "L3") that get resolved into real
// team ids automatically once the stage that produces them finishes. See
// apps/api/src/modules/fixtures/domain/stage-orchestrator.ts for how the tree is
// turned into fixtures, and stage-resolver.ts for how placeholders get resolved.

export const ELIMINATION_TYPE = ['single', 'double'] as const;
export type EliminationType = (typeof ELIMINATION_TYPE)[number];

export const SEEDING_MODE = ['auto', 'manual'] as const;
export type SeedingMode = (typeof SEEDING_MODE)[number];

// One organiser-specified pairing for a manually-seeded knockout's round 0. A pair
// with one side left null is an explicit bye - the other side auto-advances.
export const manualPairSchema = z.object({
  home: z.string().nullable(),
  away: z.string().nullable(),
}).refine((p) => p.home !== null || p.away !== null, {
  message: 'Each pair needs at least one side filled in',
});
export type ManualPair = z.infer<typeof manualPairSchema>;

export interface KnockoutStage {
  type: 'knockout';
  // Schema accepts 'double'; stage-orchestrator.ts's generateAllStages rejects it at
  // generation time with a clear BusinessRuleError - not implemented in v1.
  eliminationType: EliminationType;
  seeding: SeedingMode;
  // Required, and must cover exactly this stage's expected entrant count, when
  // seeding === 'manual' - enforced by stage-orchestrator.ts's validateStageTree
  // (not here, since the expected count depends on this stage's position in the tree).
  manualPairs?: ManualPair[];
  thirdPlaceMatch?: boolean;
}

export interface Branch {
  // Client-generated, persisted verbatim - only needs to be unique within the tree.
  id: string;
  label?: string; // display only, e.g. "Cup" / "Plate"
  rankFrom: number; // 1-based inclusive
  rankTo: number; // 1-based inclusive, >= rankFrom (checked in stageConfigSchema below)
  childStage: StageNode;
}

export interface GroupStage {
  type: 'group';
  numGroups: number; // >= 1
  doubleRound?: boolean;
  // This stage's own qualification tiebreak order - independent of the
  // championship-level StandingsRule.tiebreakers used for the points table.
  tiebreakers: StandingsTiebreaker[];
  branches: Branch[]; // >= 1
}

export type StageNode = GroupStage | KnockoutStage;

const knockoutStageSchema = z.object({
  type: z.literal('knockout'),
  eliminationType: z.enum(ELIMINATION_TYPE).default('single'),
  seeding: z.enum(SEEDING_MODE).default('auto'),
  manualPairs: z.array(manualPairSchema).optional(),
  thirdPlaceMatch: z.boolean().optional(),
}).refine((k) => k.seeding !== 'manual' || !!(k.manualPairs && k.manualPairs.length > 0), {
  message: 'manualPairs is required when seeding is manual',
});

// Recursive schemas (StageNode <-> Branch <-> GroupStage) need z.lazy - the arrow
// functions aren't evaluated until parse() runs, by which point every const below
// has been initialized, so declaration order here doesn't matter. Kept as plain
// z.object() (no .refine()) so each assigns cleanly to its explicit z.ZodType<T>
// annotation; the rankFrom/rankTo ordering check lives in stageConfigSchema's
// superRefine below instead, where a single recursive walk covers the whole tree.
// Input generic is loosened to `unknown` (rather than defaulting to the output type)
// because every field with a zod .default() makes that field OPTIONAL on the input
// side but required on the output side - a plain z.ZodType<T> annotation demands
// input === output and would reject exactly that, which is the standard gotcha with
// recursive zod schemas that also carry defaults.
export const stageNodeSchema: z.ZodType<StageNode, z.ZodTypeDef, unknown> = z.lazy(() => z.union([groupStageSchema, knockoutStageSchema]));

export const branchSchema: z.ZodType<Branch, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  rankFrom: z.number().int().min(1),
  rankTo: z.number().int().min(1),
  childStage: stageNodeSchema,
}));

export const groupStageSchema: z.ZodType<GroupStage, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  type: z.literal('group'),
  numGroups: z.number().int().min(1),
  doubleRound: z.boolean().optional(),
  tiebreakers: z.array(z.enum(STANDINGS_TIEBREAKER)).min(1).default(['points', 'wins', 'lost']),
  branches: z.array(branchSchema).min(1),
}));

export const manualAllocationEntrySchema = z.object({
  slotIndex: z.number().int().min(1),
  teamId: z.string(),
});
export type ManualAllocationEntry = z.infer<typeof manualAllocationEntrySchema>;

// Walks a StageNode tree checking invariants that span the whole tree rather than
// one node in isolation (a single-node zod .refine() can't see sibling/ancestor
// context). Returns every violation found rather than stopping at the first, so the
// wizard can surface them all at once.
function collectStageTreeIssues(node: StageNode, path: (string | number)[]): Array<{ path: (string | number)[]; message: string }> {
  if (node.type !== 'group') return [];
  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  node.branches.forEach((branch, i) => {
    if (branch.rankTo < branch.rankFrom) {
      issues.push({ path: [...path, 'branches', i, 'rankTo'], message: 'rankTo must be >= rankFrom' });
    }
    issues.push(...collectStageTreeIssues(branch.childStage, [...path, 'branches', i, 'childStage']));
  });
  // Sibling branches off the same group stage must not claim overlapping ranks - two
  // branches both resolving e.g. "1st in Pool A" would both receive that same real
  // team once the pool finishes (stage-resolver.ts matches purely by label string,
  // with no awareness of which branch "should" own a given rank).
  for (let i = 0; i < node.branches.length; i++) {
    for (let j = i + 1; j < node.branches.length; j++) {
      const a = node.branches[i];
      const b = node.branches[j];
      if (a.rankFrom <= b.rankTo && b.rankFrom <= a.rankTo) {
        issues.push({
          path: [...path, 'branches', j, 'rankFrom'],
          message: `Branch "${b.label || b.id}" (ranks ${b.rankFrom}-${b.rankTo}) overlaps "${a.label || a.id}" (ranks ${a.rankFrom}-${a.rankTo}) - each rank can only feed one branch`,
        });
      }
    }
  }
  return issues;
}

export const stageConfigSchema = z.object({
  root: stageNodeSchema,
  manualAllocation: z.array(manualAllocationEntrySchema).optional(),
}).superRefine((cfg, ctx) => {
  for (const issue of collectStageTreeIssues(cfg.root, ['root'])) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
  // Reject duplicate slotIndex or duplicate teamId within manualAllocation - a
  // duplicate teamId would otherwise silently drop one real entrant from the draw
  // while another loses its slot (see stage-orchestrator.ts's applyManualAllocation).
  if (!cfg.manualAllocation) return;
  const slots = new Set<number>();
  const usedTeams = new Set<string>();
  cfg.manualAllocation.forEach((a, i) => {
    if (slots.has(a.slotIndex)) ctx.addIssue({ code: 'custom', message: `Duplicate slotIndex ${a.slotIndex}`, path: ['manualAllocation', i, 'slotIndex'] });
    if (usedTeams.has(a.teamId)) ctx.addIssue({ code: 'custom', message: `Duplicate teamId ${a.teamId}`, path: ['manualAllocation', i, 'teamId'] });
    slots.add(a.slotIndex);
    usedTeams.add(a.teamId);
  });
});
export type StageConfig = z.infer<typeof stageConfigSchema>;
