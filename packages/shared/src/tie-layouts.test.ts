import { describe, expect, it } from 'vitest';
import { formatTemplateSchema } from './scoring.js';
import { buildTieSpec, groupTiebreakAllowed, isGroupRound, tieForRound, tieLayoutsFor, tieTemplateFor } from './tie-templates.js';
import { tieSpecSchema } from './scoring.js';
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

  // Sheet BD03: Inter-IIM badminton order, badminton only.
  it('badminton and table tennis offer the Inter-IIM men and women orders', () => {
    const bd = tieLayoutsFor('Badminton');
    const men = bd.find((l) => l.key === 'iim_men')!;
    expect(men.rubbers.map((r) => [r.label, r.size])).toEqual([
      ["Men's Singles 1", 1], ["Men's Singles 2", 1], ["Men's Doubles 1", 2], ["Men's Singles 3", 1], ["Men's Doubles 2", 2],
    ]);
    expect(bd.find((l) => l.key === 'iim_women')!.rubbers.map((r) => r.size)).toEqual([1, 2, 1]);
    // Table tennis plays the same Inter-IIM order (sheet TT02); squash does not get it.
    expect(tieLayoutsFor('Table Tennis').find((l) => l.key === 'iim_men')?.rubbers.map((r) => r.size)).toEqual([1, 1, 2, 1, 2]);
    expect(tieLayoutsFor('Table Tennis').find((l) => l.key === 'iim_women')?.rubbers.map((r) => r.size)).toEqual([1, 2, 1]);
    expect(tieLayoutsFor('Squash').map((l) => l.key)).not.toContain('iim_men');
    // Built as a tie: majority of 5, group rubbers all played, knockouts stop once decided.
    const spec = buildTieSpec('badminton', men.rubbers, { skipDeadRubbers: true, skipDeadInGroups: false });
    expect(spec.rubbers).toHaveLength(5);
    expect(tieForRound(spec, 'Pool A - Match 1').skipDeadRubbers).toBe(false);
    expect(tieForRound(spec, 'Final').skipDeadRubbers).toBe(true);
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

  it('every racquet sport has a standard tie, so "Sport standard" always builds one', () => {
    for (const sport of ['table tennis', 'badminton', 'tennis', 'squash', 'pickleball']) {
      expect(tieTemplateFor(sport)?.tie?.rubbers.length, sport).toBeGreaterThan(0);
    }
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

  // Sheet BD01: the console applies the round rule to a layout saved for one match too.
  it('applying the round rule twice changes nothing, and keeps the knockout setting', () => {
    const group = tieForRound(split, 'Pool A - Match 1');
    expect(tieForRound(group, 'Pool A - Match 1')).toEqual(group);
    expect(group.skipDeadInGroups).toBe(split.skipDeadInGroups);
    // The layout as set still has both settings, so a knockout reads its own.
    expect(tieForRound(split, 'Final').skipDeadRubbers).toBe(true);
    expect(group.skipDeadRubbers).toBe(false);
  });

  it('a layout saved before the split behaves exactly as it did', () => {
    const old = buildTieSpec('table tennis', rubbers, { skipDeadRubbers: true });
    expect(tieForRound(old, 'Round 1')).toBe(old);
  });
});

// Sheet CH03: whether a level group tie can be won on a tie-break is the layout's choice.
describe('level group ties', () => {
  const two = [{ label: 'Board 1', size: 1 }, { label: 'Board 2', size: 1 }];

  it('chess defaults to a draw, other sports keep the tie-break choice', () => {
    expect(groupTiebreakAllowed(tieTemplateFor('chess')!.tie!)).toBe(false);
    expect(groupTiebreakAllowed(tieTemplateFor('badminton')!.tie!)).toBe(true);
  });

  it('the layout can switch it either way, and it survives saving', () => {
    const on = buildTieSpec('chess', two, { groupTiebreak: true });
    expect(groupTiebreakAllowed({ ...on, boardPoints: true })).toBe(true);
    const off = buildTieSpec('badminton', two, { groupTiebreak: false });
    expect(groupTiebreakAllowed(off)).toBe(false);
    expect(tieSpecSchema.parse(off).groupTiebreak).toBe(false);
    // The round rule keeps it.
    expect(tieForRound({ ...off, skipDeadInGroups: false }, 'Round 1').groupTiebreak).toBe(false);
  });
});
