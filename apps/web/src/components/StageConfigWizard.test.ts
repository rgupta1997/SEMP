import { describe, expect, it } from 'vitest';
import { fromStageNode, pinsFromAllocation } from './StageConfigWizard';

// What generate-all saved on the draw (format_config.root): pools feeding a cup and a plate.
const SAVED = {
  type: 'group', numGroups: 3, doubleRound: true,
  tiebreakers: ['points', 'goal_difference', 'head_to_head'],
  points: { win: 3, draw: 1, loss: 0 },
  branches: [
    { id: 'b1', label: 'Cup', rankFrom: 1, rankTo: 2, childStage: { type: 'knockout', eliminationType: 'single', seeding: 'manual', thirdPlaceMatch: true, manualPairs: [{ home: 'A1', away: 'B2' }] } },
    { id: 'b2', label: 'Plate', rankFrom: 3, rankTo: 3, childStage: { type: 'group', numGroups: 1, doubleRound: false, tiebreakers: ['points'], branches: [] } },
  ],
};

describe('reconfiguring a staged draw starts from its saved setup', () => {
  it('reads every setting back into the form', () => {
    const draft = fromStageNode(SAVED, 'Football') as any;
    expect(draft).toMatchObject({ type: 'group', numGroups: 3, doubleRound: true, tiebreakers: SAVED.tiebreakers, points: SAVED.points });
    expect(draft.branches.map((b: any) => [b.label, b.rankFrom, b.rankTo, b.childStage.type])).toEqual([['Cup', 1, 2, 'knockout'], ['Plate', 3, 3, 'group']]);
    expect(draft.branches[0].childStage).toMatchObject({ seeding: 'manual', thirdPlaceMatch: true, manualPairs: [{ home: 'A1', away: 'B2' }] });
  });

  it('returns nothing when there is no saved setup, so the blank form stays', () => {
    expect(fromStageNode(undefined)).toBeNull();
    expect(fromStageNode({ type: 'nonsense' })).toBeNull();
  });

  it('turns saved pool pins (slot numbers) back into team -> pool', () => {
    // Snake seeding over 2 pools: slots 1,4 -> pool A; 2,3 -> pool B.
    expect(pinsFromAllocation([{ slotIndex: 1, teamId: 't1' }, { slotIndex: 2, teamId: 't2' }, { bad: true }], 2)).toEqual({ t1: 1, t2: 2 });
    expect(pinsFromAllocation(null, 2)).toEqual({});
  });
});
