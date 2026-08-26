import { describe, expect, it } from 'vitest';
import { computeParentPosition } from './bracket.js';

// Required regression coverage for the stage_sequence fix to advanceInBracket/
// propagateByes: proves the parent-position arithmetic itself is byte-for-byte
// unaffected by that change. The fix only ever touches the WHERE clause that builds
// `sibs` (adding a stage_sequence filter) - it never touches this function, so this
// suite passing before and after the fix is the strongest available proof of the
// "no-op for every existing single-stage tournament" claim, given this repo has no
// DB-integration test harness to exercise the WHERE clause itself directly (see the
// plan's flagged gap - recommend a manual check against a seeded Supabase dev branch
// before relying on this alone for a live migration).
describe('computeParentPosition (8-team bracket, 7 bracket_position siblings)', () => {
  const siblingCount = 7; // 4 QF (0-3) + 2 SF (4-5) + 1 Final (6)

  it('QF matches (0-3) feed the correct SF, alternating home/away', () => {
    expect(computeParentPosition(siblingCount, 0)).toEqual({ parentPos: 4, slot: 'home' });
    expect(computeParentPosition(siblingCount, 1)).toEqual({ parentPos: 4, slot: 'away' });
    expect(computeParentPosition(siblingCount, 2)).toEqual({ parentPos: 5, slot: 'home' });
    expect(computeParentPosition(siblingCount, 3)).toEqual({ parentPos: 5, slot: 'away' });
  });

  it('SF matches (4-5) feed the Final, alternating home/away', () => {
    expect(computeParentPosition(siblingCount, 4)).toEqual({ parentPos: 6, slot: 'home' });
    expect(computeParentPosition(siblingCount, 5)).toEqual({ parentPos: 6, slot: 'away' });
  });

  it('the Final (6) has no parent to advance into', () => {
    expect(computeParentPosition(siblingCount, 6)).toBeNull();
  });

  it('returns null for a non-power-of-two sibling count (not a clean bracket)', () => {
    expect(computeParentPosition(5, 0)).toBeNull();
  });

  it('returns null for a position outside the bracket', () => {
    expect(computeParentPosition(siblingCount, 99)).toBeNull();
  });
});
