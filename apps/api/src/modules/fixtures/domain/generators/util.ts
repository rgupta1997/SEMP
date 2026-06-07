export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket seed ordering for a bracket of `size` (a power of two).
// Returns seed numbers (1-indexed) arranged so #1 and #2 can only meet in the final.
export function seedOrder(size: number): number[] {
  let rounds = [1, 2];
  while (rounds.length < size) {
    const n = rounds.length * 2;
    const next: number[] = [];
    for (const s of rounds) {
      next.push(s);
      next.push(n + 1 - s);
    }
    rounds = next;
  }
  return rounds;
}

// Human-friendly round label given the number of teams remaining in that round.
export function roundLabel(teamsInRound: number): string {
  switch (teamsInRound) {
    case 2: return 'Final';
    case 4: return 'SF';
    case 8: return 'QF';
    default: return `R${teamsInRound}`;
  }
}
