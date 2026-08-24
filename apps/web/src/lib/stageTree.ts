// Lightweight, duck-typed mirror of apps/api's stage-tree.ts assignStageSequence
// (BFS) - just enough to recover each branch's display label ("Cup"/"Plate") for
// the schedule view, without importing server domain code into the web bundle (not
// this codebase's pattern) or re-validating the full stage-config schema. A
// malformed/legacy/absent format_config simply yields no labels, and callers fall
// back to a generic "Stage N".
export function resolveBranchLabels(formatConfig: unknown): Map<number, string> {
  const labels = new Map<number, string>();
  const root = (formatConfig as any)?.root;
  if (!root || typeof root !== 'object') return labels;

  const queue: Array<{ node: any; branch: any | null }> = [{ node: root, branch: null }];
  let sequence = 0;
  while (queue.length > 0) {
    const { node, branch } = queue.shift()!;
    sequence += 1;
    if (branch) labels.set(sequence, branch.label || branch.id || `Stage ${sequence}`);
    if (node?.type === 'group' && Array.isArray(node.branches)) {
      for (const b of node.branches) queue.push({ node: b?.childStage, branch: b });
    }
  }
  return labels;
}

// A fixture's home_slot_label/away_slot_label ("A1", "L3") in plain language, for
// display when the real team isn't resolved yet. "A1" = the 1st-place qualifier
// from Pool A; "L3" = the loser of the semifinal at bracket position 3.
export function describeSlot(label: string | null | undefined): string | null {
  if (!label) return null;
  // Check the loser-reference pattern FIRST - "L0"/"L1" would otherwise also match
  // the pool-qualifier pattern below (L is a valid single uppercase letter too),
  // misreading a 3rd-place slot as "0th/1st in Pool L" instead of what it actually
  // is: the loser of a specific semifinal.
  const loser = label.match(/^L(\d+)$/);
  if (loser) return `Loser of match ${Number(loser[1]) + 1}`;
  const pool = label.match(/^([A-Z])(\d+)$/);
  if (pool) {
    const rank = Number(pool[2]);
    const ord = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
    return `${ord} in Pool ${pool[1]}`;
  }
  return null;
}

// A fixture's live_state.tie_blocked (set by stage-resolver.ts when a pool finishes
// but two-plus teams are fully tied on every configured tiebreaker) in plain
// language, so the organiser sees WHY a slot is stuck instead of just a bare
// placeholder that never fills in.
export function describeTieBlocked(tieBlocked: { pool: number; rank: number } | null | undefined): string | null {
  if (!tieBlocked) return null;
  const letter = String.fromCharCode(64 + tieBlocked.pool);
  const rank = tieBlocked.rank;
  const ord = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
  return `Pool ${letter} tied for ${ord} - needs manual resolution`;
}

// A fixture's live_state.tie_blocked doesn't say which of its two sides it applies
// to - a knockout match's two sides usually come from two different pools/ranks, so
// this checks whether THIS side's own slot label is the one the flag was raised
// for, before showing the tie-blocked message on it.
export function isTieBlockedFor(label: string | null | undefined, tieBlocked: { pool: number; rank: number } | null | undefined): boolean {
  if (!label || !tieBlocked) return false;
  const m = label.match(/^([A-Z])(\d+)$/);
  if (!m) return false;
  return m[1].charCodeAt(0) - 64 === tieBlocked.pool && Number(m[2]) === tieBlocked.rank;
}
