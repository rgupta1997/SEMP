import type { GroupStage, KnockoutStage } from '@semp/shared';
import { describe, expect, it } from 'vitest';
import type { TeamRef } from './generators/types.js';
import { generateAllStages } from './stage-orchestrator.js';

const teams = (n: number): TeamRef[] => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}` }));

const autoKnockout = (overrides: Partial<KnockoutStage> = {}): KnockoutStage => ({
  type: 'knockout', eliminationType: 'single', seeding: 'auto', ...overrides,
});

describe('generateAllStages', () => {
  it('shape (a): group -> knockout, no branches', () => {
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'main', rankFrom: 1, rankTo: 2, childStage: autoKnockout() }],
    };
    const { inserts } = generateAllStages(root, teams(8));

    const stage1 = inserts.filter((f) => f.stage_sequence === 1);
    const stage2 = inserts.filter((f) => f.stage_sequence === 2);
    expect(stage1).toHaveLength(12); // 2 pools of 4, round-robin each -> 6 matches per pool
    expect(stage1.every((f) => f.home_slot_label === null && f.away_slot_label === null)).toBe(true);

    expect(stage2).toHaveLength(3); // 4 qualifiers -> 2 SF + 1 Final
    expect(stage2.every((f) => f.home_team_id === null && f.away_team_id === null)).toBe(true);
    const sfLabels = new Set(stage2.filter((f) => f.round === 'SF').flatMap((f) => [f.home_slot_label, f.away_slot_label]));
    expect(sfLabels).toEqual(new Set(['A1', 'A2', 'B1', 'B2']));
  });

  it('shape (b): group with 2 branches -> 2 separate knockouts (cup + plate)', () => {
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [
        { id: 'cup', label: 'Cup', rankFrom: 1, rankTo: 1, childStage: autoKnockout() },
        { id: 'plate', label: 'Plate', rankFrom: 2, rankTo: 2, childStage: autoKnockout() },
      ],
    };
    const { inserts } = generateAllStages(root, teams(8));

    const cup = inserts.filter((f) => f.stage_sequence === 2);
    const plate = inserts.filter((f) => f.stage_sequence === 3);
    expect(cup).toHaveLength(1); // 2 rank-1 qualifiers -> a single Final
    expect(plate).toHaveLength(1); // 2 rank-2 qualifiers -> a single Final

    const cupLabels = new Set(cup.flatMap((f) => [f.home_slot_label, f.away_slot_label]));
    const plateLabels = new Set(plate.flatMap((f) => [f.home_slot_label, f.away_slot_label]));
    expect(cupLabels).toEqual(new Set(['A1', 'B1']));
    expect(plateLabels).toEqual(new Set(['A2', 'B2']));
  });

  it('shape (c): group -> group -> knockout, chained', () => {
    const inner: GroupStage = {
      type: 'group', numGroups: 1, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'toKnockout', rankFrom: 1, rankTo: 4, childStage: autoKnockout() }],
    };
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'toInnerGroup', rankFrom: 1, rankTo: 2, childStage: inner }],
    };
    const { inserts } = generateAllStages(root, teams(8));

    const stage2 = inserts.filter((f) => f.stage_sequence === 2);
    const stage3 = inserts.filter((f) => f.stage_sequence === 3);
    // Stage 2 is itself a group stage fed by labels - proves the label-genericity
    // trick works through generateGroups, not just generateKnockout.
    expect(stage2.every((f) => f.home_slot_label !== null && f.away_slot_label !== null)).toBe(true);
    expect(stage2.every((f) => f.pool_number !== null)).toBe(true);
    expect(new Set(stage2.flatMap((f) => [f.home_slot_label, f.away_slot_label]))).toEqual(new Set(['A1', 'A2', 'B1', 'B2']));
    expect(stage3.length).toBeGreaterThan(0);
  });

  it("rejects eliminationType 'double' anywhere in the tree, including nested inside a branch", () => {
    const root: GroupStage = {
      type: 'group', numGroups: 2, tiebreakers: ['points', 'wins', 'lost'],
      branches: [{ id: 'main', rankFrom: 1, rankTo: 2, childStage: autoKnockout({ eliminationType: 'double' }) }],
    };
    expect(() => generateAllStages(root, teams(8))).toThrow(/[Dd]ouble elimination/);
  });

  it('rejects a knockout stage with fewer than 2 entrants', () => {
    expect(() => generateAllStages(autoKnockout(), teams(1))).toThrow();
  });

  it('manual allocation places a named team at slotIndex 1 regardless of entrant order', () => {
    const { inserts } = generateAllStages(autoKnockout(), teams(4), [{ slotIndex: 1, teamId: 't4' }]);
    const firstMatch = inserts.find((f) => f.bracket_position === 0)!;
    expect(firstMatch.home_team_id).toBe('t4');
  });

  it("wires the 3rd-place match's slot labels to L{sfPositionA}/L{sfPositionB}", () => {
    const { inserts } = generateAllStages(autoKnockout({ thirdPlaceMatch: true }), teams(4));
    const thirdPlace = inserts.find((f) => f.round === '3rd Place')!;
    const sfs = inserts.filter((f) => f.round === 'SF');
    expect(thirdPlace.home_slot_label).toBe(`L${sfs[0].bracket_position}`);
    expect(thirdPlace.away_slot_label).toBe(`L${sfs[1].bracket_position}`);
  });
});
