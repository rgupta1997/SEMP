import type { Branch, StageNode } from '@semp/shared';

// A StageNode with its assigned position in the tree. sequence 1 is always the tree
// root (real entrants); every other sequence is a placeholder stage fed by a branch
// on its parent's group stage.
export interface AssignedStage {
  sequence: number; // 1-based, unique across the tree
  node: StageNode;
  parentSequence: number | null; // null only for sequence 1
  producingBranch: Branch | null; // the Branch on the parent GroupStage whose childStage is this node; null for sequence 1
  branchPath: string[]; // chain of Branch.id from root - display/debug only, NOT used for label resolution
}

export interface AssignedStageTree {
  stages: AssignedStage[]; // in BFS assignment order == ascending sequence order
  bySequence: Map<number, AssignedStage>;
}

interface QueueEntry {
  node: StageNode;
  parentSequence: number | null;
  producingBranch: Branch | null;
  branchPath: string[];
}

// Assigns stage_sequence numbers breadth-first, so a group stage with N branches
// yields sibling sequences (in branch-array order) before descending into any of
// their children - e.g. a group with 2 branches -> [1: group, 2: branch0, 3: branch1],
// both children at the same depth, rather than depth-first numbering.
export function assignStageSequence(root: StageNode): AssignedStageTree {
  const stages: AssignedStage[] = [];
  let next = 1;
  const queue: QueueEntry[] = [{ node: root, parentSequence: null, producingBranch: null, branchPath: [] }];

  while (queue.length > 0) {
    const { node, parentSequence, producingBranch, branchPath } = queue.shift()!;
    const sequence = next++;
    stages.push({ sequence, node, parentSequence, producingBranch, branchPath });
    if (node.type === 'group') {
      for (const branch of node.branches) {
        queue.push({ node: branch.childStage, parentSequence: sequence, producingBranch: branch, branchPath: [...branchPath, branch.id] });
      }
    }
  }

  return { stages, bySequence: new Map(stages.map((s) => [s.sequence, s])) };
}

export function findStageBySequence(tree: AssignedStageTree, sequence: number): AssignedStage | undefined {
  return tree.bySequence.get(sequence);
}
