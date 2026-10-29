import { describe, expect, it } from 'vitest';
import { foldRally, resultEnvelope, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import type { Side } from './scoring-rules.js';

const pts = (side: Side, n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side } as RallyEvent));
const retire = (winner: Side): RallyEvent => ({ t: 'end', outcome: 'win', reason: 'retired', winner });

// Sheet BD02: a retirement awards the remaining points, not just the games.
describe('retirement awards the remaining points', () => {
  const f = presetByKey('bwf_official_3x21')!;
  const env = (log: RallyEvent[]) => resultEnvelope(f, foldRally(f, log, 'A').state);

  it('the unfinished game is completed for the winner, then any game still needed is 21-0', () => {
    // A wins game 1, B leads game 2 15-10, A retires: B needs games 2 and 3.
    const e = env([...pts('A', 21), ...pts('B', 15), ...pts('A', 10), retire('B')]);
    expect(e.winner).toBe('B');
    expect(e.headline).toEqual([1, 2]);
    expect(e.unitScores).toEqual([[21, 0], [10, 21], [0, 21]]);
    expect(e.pointsFor).toEqual([31, 42]);
  });

  it('a game at deuce goes to 2 clear, capped at 30', () => {
    const deuce = env([...pts('A', 21), ...pts('B', 20), ...pts('A', 20), retire('B')]);
    expect(deuce.unitScores[1]).toEqual([20, 22]);
    const alternate = Array.from({ length: 29 }, () => [...pts('B', 1), ...pts('A', 1)]).flat();
    const late = env([...pts('A', 21), ...alternate, retire('B')]);
    expect(late.unitScores[1]).toEqual([29, 30]);
  });

  it('the side ahead retiring still loses every game it needed', () => {
    // A leads 1-0 and 18-3, then retires: B gets game 2 at 21 (18 kept for A) and game 3 at 21-0.
    const e = env([...pts('A', 21), ...pts('A', 18), ...pts('B', 3), retire('B')]);
    expect(e.unitScores).toEqual([[21, 0], [18, 21], [0, 21]]);
  });

  it('a casual format keeps the score as played', () => {
    const casual = { ...f, endStates: { ...f.endStates, retirementScore: 'freezeAsPlayed' as const } };
    const e = resultEnvelope(casual, foldRally(casual, [...pts('A', 21), ...pts('B', 15), ...pts('A', 10), retire('B')], 'A').state);
    expect(e.unitScores).toEqual([[21, 0]]);
    expect(e.pointsFor).toEqual([31, 15]);
  });
});
