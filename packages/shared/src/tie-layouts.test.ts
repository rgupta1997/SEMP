import { describe, expect, it } from 'vitest';
import { formatTemplateSchema } from './scoring.js';
import { buildTieSpec, isGroupRound, tieForRound, tieLayoutsFor } from './tie-templates.js';
import { decideRubber, initTie, rubberSize, tieOutcome, tieTarget } from './tie.js';

describe('tie layouts an organiser can pick', () => {
  it('leads with the sport’s own standard, then the racquet library without repeating it', () => {
    const tt = tieLayoutsFor('Table Tennis');
    expect(tt[0]).toMatchObject({ key: 'default' });
    expect(tt[0].rubbers).toHaveLength(5);
    expect(tt.map((l) => l.key)).toContain('three_mixed');
    expect(tt.map((l) => l.key)).toContain('swaythling');
    expect(tt.map((l) => l.key)).not.toContain('five'); // same as TT's own standard
  });

  it('offers only its own standard for a non-racquet tie sport, and nothing for a sport with no ties', () => {
    expect(tieLayoutsFor('chess').map((l) => l.key)).toEqual(['default']);
    expect(tieLayoutsFor('football')).toEqual([]);
  });
});

describe('buildTieSpec', () => {
  const corp = buildTieSpec('table tennis', [
    { label: "Men's Singles", size: 1 }, { label: "Men's Doubles", size: 2 }, { label: 'Mixed Doubles', size: 2 },
  ]);

  it('a three-rubber corporate tie is first to two, with stable keys and sizes', () => {
    expect(tieTarget(corp)).toBe(2);
    expect(corp.rubbers.map((r) => [r.key, r.size])).toEqual([['r1', 1], ['r2', 2], ['r3', 2]]);
    expect(rubberSize(corp.rubbers[1])).toBe(2);
  });

  it('is a valid stored template, so the API accepts it', () => {
    const parsed = formatTemplateSchema.safeParse({ fixtureType: 'tie', scoringMode: 'detailed', tie: corp });
    expect(parsed.success).toBe(true);
  });

  it('decides on two rubbers and skips the third', () => {
    let s = decideRubber(corp, initTie(corp), 0, 'A');
    s = decideRubber(corp, s, 1, 'A');
    expect(tieOutcome(corp, s)).toMatchObject({ winner: 'A', decided: true });
    expect(s.rubbers[2].status).toBe('dead');
  });

  it('an explicit target is respected but never more than the rubbers', () => {
    expect(tieTarget(buildTieSpec('badminton', [{ label: 'A', size: 1 }, { label: 'B', size: 1 }, { label: 'C', size: 1 }], { target: 3 }))).toBe(3);
    expect(tieTarget(buildTieSpec('badminton', [{ label: 'A', size: 1 }], { target: 4 }))).toBe(1);
  });

  it('a blank name gets a placeholder rather than an invalid rubber', () => {
    expect(buildTieSpec('squash', [{ label: '  ', size: 1 }]).rubbers[0].label).toBe('Rubber 1');
  });
});

describe('dead rubbers by stage', () => {
  const rubbers = [{ label: 'S1', size: 1 }, { label: 'D', size: 2 }, { label: 'S2', size: 1 }];
  const split = buildTieSpec('table tennis', rubbers, { skipDeadRubbers: true, skipDeadInGroups: false });

  it('recognises league and group rounds, and nothing else', () => {
    expect(['Round 3', 'Pool A - Match 2', 'pool b - match 1'].every(isGroupRound)).toBe(true);
    expect(['Final', 'SF', 'QF', 'R16', '3rd Place', 'Event', '', null].some(isGroupRound)).toBe(false);
  });

  it('a group round plays every rubber; a knockout stops once decided', () => {
    const group = tieForRound(split, 'Pool A - Match 1');
    let g = decideRubber(group, initTie(group), 0, 'A');
    g = decideRubber(group, g, 1, 'A');
    expect(g.rubbers[2].status).toBe('pending');

    const ko = tieForRound(split, 'Final');
    let k = decideRubber(ko, initTie(ko), 0, 'A');
    k = decideRubber(ko, k, 1, 'A');
    expect(k.rubbers[2].status).toBe('dead');
  });

  it('a layout saved before the split behaves exactly as it did', () => {
    const old = buildTieSpec('table tennis', rubbers, { skipDeadRubbers: true });
    expect(tieForRound(old, 'Round 1')).toBe(old);
  });
});
