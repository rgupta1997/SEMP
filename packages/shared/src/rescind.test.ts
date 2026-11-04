import { describe, expect, it } from 'vitest';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { deriveTeamStats } from './team-stats.js';

// Taking back a card or foul keeps it on the record and out of every count.
describe('rescinded cards and fouls', () => {
  const foul = (n: number): RallyEvent => ({ t: 'point', side: 'A', pts: 0, kind: 'foul', playerId: 'p1', label: `Foul ${n}` });
  const rescinded = (ev: RallyEvent): RallyEvent => ({ ...(ev as Extract<RallyEvent, { t: 'point' }>), rescinded: { reason: 'wrong player' } });

  it('a rescinded foul is not in the player stats', () => {
    const log = [foul(1), foul(2), rescinded(foul(3))];
    const p1 = deriveTeamStats('basketball', log).players.find((x) => x.userId === 'p1')!;
    expect(p1.stats.fouls).toBe(2);
  });

  it('a rescinded event that carried points scores nothing', () => {
    const f = presetByKey('fiba_4x10')!;
    const basket: RallyEvent = { t: 'point', side: 'A', pts: 2 };
    expect(foldRally(f, [basket, rescinded(basket)]).state.score[0]).toEqual([2, 0]);
  });
});
