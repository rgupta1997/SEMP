import type { GroupStage, KnockoutStage, StageNode } from '@semp/shared';
import { describe, expect, it } from 'vitest';
import { assignStageSequence, findStageBySequence } from './stage-tree.js';

const knockout = (overrides: Partial<KnockoutStage> = {}): KnockoutStage => ({
  type: 'knockout', eliminationType: 'single', seeding: 'auto', ...overrides,
});

describe('assignStageSequence', () => {
  it('a single knockout stage gets sequence 1 and no other stages', () => {
    const tree = assignStageSequence(knockout());
    expect(tree.stages).toHaveLength(1);
    expect(tree.stages[0]).toMatchObject({ sequence: 1, parentSequence: null, producingBranch: null });
  });

  it('a group with one branch -> [1: group, 2: knockout], child parentSequence is 1', () => {
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'b1', rankFrom: 1, rankTo: 2, childStage: knockout() }],
    };
    const tree = assignStageSequence(root);
    expect(tree.stages.map((s) => s.sequence)).toEqual([1, 2]);
    expect(tree.stages[1].parentSequence).toBe(1);
    expect(tree.stages[1].producingBranch?.id).toBe('b1');
  });

  it('a group with two branches -> [1: group, 2: cup, 3: plate], both parented at 1, distinct branchPath (BFS order)', () => {
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [
        { id: 'cup', label: 'Cup', rankFrom: 1, rankTo: 1, childStage: knockout() },
        { id: 'plate', label: 'Plate', rankFrom: 2, rankTo: 2, childStage: knockout() },
      ],
    };
    const tree = assignStageSequence(root);
    expect(tree.stages.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(tree.stages[1].parentSequence).toBe(1);
    expect(tree.stages[2].parentSequence).toBe(1);
    expect(tree.stages[1].branchPath).toEqual(['cup']);
    expect(tree.stages[2].branchPath).toEqual(['plate']);
  });

  it('group -> group -> knockout chain -> sequences [1,2,3] in depth order', () => {
    const inner: GroupStage = {
      type: 'group', numGroups: 1, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'b2', rankFrom: 1, rankTo: 4, childStage: knockout() }],
    };
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'b1', rankFrom: 1, rankTo: 2, childStage: inner }],
    };
    const tree = assignStageSequence(root);
    expect(tree.stages.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(tree.stages[1].node.type).toBe('group');
    expect(tree.stages[2].parentSequence).toBe(2);
  });

  it('findStageBySequence returns undefined for an out-of-range sequence', () => {
    const tree = assignStageSequence(knockout());
    expect(findStageBySequence(tree, 99)).toBeUndefined();
  });
});
