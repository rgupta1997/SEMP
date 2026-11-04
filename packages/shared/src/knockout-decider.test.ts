import { describe, expect, it } from 'vitest';
import { resolveFormat } from './format-ladder.js';
import { aggregateScore, foldRally, type RallyEvent } from './rally-kernel.js';
import { describeTieBreak, tieProgress } from './tie-break.js';
import { knockoutDeciderFor } from './team-presets.js';

// A pool format reused for a knockout must still produce a winner.
describe('knockout matches never end level', () => {
  const kabaddiPool = { sport: 'kabaddi', scoring_preset_key: 'pkl_2x20' };
  const level: RallyEvent[] = [
    { t: 'point', side: 'A', pts: 2 }, { t: 'point', side: 'B', pts: 2 }, { t: 'endPeriod' }, { t: 'endPeriod' },
  ];

  it('a pool format allows draws in a pool match', () => {
    const f = resolveFormat({ round: 'Pool A - Match 1' }, kabaddiPool).format!;
    expect(f.endStates.drawsAllowed).toBe(true);
  });

  it('the same format in a final gets the sport decider: extra time then golden raids', () => {
    const f = resolveFormat({ round: 'Final' }, kabaddiPool).format!;
    expect(f.endStates.drawsAllowed).toBe(false);
    expect(f.tieBreak).toMatchObject({ extraTime: { periods: 2, minutes: 3 }, goldenRaid: true });
    const state = foldRally(f, level, 'A').state;
    expect(state.ended).toBe(false);
    expect(tieProgress(f, state, aggregateScore(state)).phase).toBe('extraTime');
  });

  it('a bracket match counts as a knockout whatever its label', () => {
    expect(resolveFormat({ round: 'Pool A - Match 1', bracket_position: 1 }, kabaddiPool).format!.endStates.drawsAllowed).toBe(false);
  });

  it('a knockout format keeps its own decider', () => {
    const f = resolveFormat({ round: 'SF' }, { sport: 'football', scoring_preset_key: 'football9_final_2x30' }).format!;
    expect(f.tieBreak?.extraTime?.minutes).toBe(10);
  });

  it('each sport has its standard decider', () => {
    expect(knockoutDeciderFor('football')).toMatchObject({ extraTime: { periods: 2, minutes: 10 }, penalties: { kicks: 5 } });
    expect(knockoutDeciderFor('futsal')).toMatchObject({ penalties: { kicks: 3 } });
    expect(knockoutDeciderFor('hockey')).toMatchObject({ penalties: { kicks: 5 } });
    expect(knockoutDeciderFor('handball')).toBeNull();
  });

  it('describes the decider in words', () => {
    expect(describeTieBreak(knockoutDeciderFor('kabaddi')!, 'kabaddi')).toBe('extra time 3 + 3 min, then golden raids');
    expect(describeTieBreak(knockoutDeciderFor('hockey')!, 'hockey')).toBe('5-shot shoot-out');
  });
});
