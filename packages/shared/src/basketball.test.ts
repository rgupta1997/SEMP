import { describe, expect, it } from 'vitest';
import { foldRally, aggregateScore, type RallyEvent, type RallyLog } from './rally-kernel.js';
import { presetByKey, presetsFor } from './racquet-presets.js';
import { tieProgress } from './tie-break.js';
import type { ScoringFormat } from './scoring-rules.js';
import { deriveTeamStats } from './team-stats.js';
import { foldCareerStats, statSpecFor } from './stat-registry.js';
import { COLUMN_MAP } from './category-lines.js';

const basket = (side: 'A' | 'B', pts: number): RallyEvent => ({ t: 'point', side, pts });
const whistle: RallyEvent = { t: 'endPeriod' };
const play = (f: ScoringFormat, log: RallyLog) => {
  const state = foldRally(f, log, 'A').state;
  return { state, progress: tieProgress(f, state, aggregateScore(state)) };
};
// Four quarters ending level at 2-2 each quarter.
const levelQuarters = (n: number): RallyLog => Array.from({ length: n }, () => [basket('A', 2), basket('B', 2), whistle]).flat();

describe('basketball has no draws', () => {
  it('no basketball format allows a draw', () => {
    for (const f of presetsFor('basketball')) expect(f.endStates.drawsAllowed, f.presetKey).toBe(false);
  });

  it('level after four quarters goes to a 5-minute overtime', () => {
    const f = presetByKey('fiba_4x10')!;
    const { state, progress } = play(f, levelQuarters(4));
    expect(state.ended).toBe(false);
    expect(progress).toMatchObject({ phase: 'extraTime', extraPlayed: 0, periodMs: 5 * 60_000 });
  });

  it('still level after overtime plays another, and a lead then wins it', () => {
    const f = presetByKey('fiba_4x10')!;
    const ot1Level = [...levelQuarters(4), basket('A', 3), basket('B', 3), whistle];
    expect(play(f, ot1Level).progress).toMatchObject({ phase: 'extraTime', extraPlayed: 1 });
    const won = play(f, [...ot1Level, basket('B', 2), whistle]).state;
    expect(won).toMatchObject({ ended: true, winner: 'B' });
  });

  it('the corporate format goes to overtime too, instead of recording a draw', () => {
    const f = presetByKey('basketball_corp_2x10')!;
    const { state, progress } = play(f, levelQuarters(2));
    expect(state.ended).toBe(false);
    expect(progress.phase).toBe('extraTime');
  });

  it('a lead after the last quarter wins with no overtime', () => {
    const f = presetByKey('fiba_4x10')!;
    expect(play(f, [...levelQuarters(3), basket('A', 3), whistle]).state).toMatchObject({ ended: true, winner: 'A' });
  });
});

describe('basketball shooting percentages', () => {
  const shot = (kind: string, pts: number, playerId = 'p1'): RallyEvent => ({ t: 'point', side: 'A', pts, kind, playerId });
  const bagOf = (log: RallyLog) => deriveTeamStats('basketball', log).players.find((p) => p.userId === 'p1')!.stats;

  it('counts made and missed shots as attempts', () => {
    const bag = bagOf([shot('fg2', 2), shot('fg2_miss', 0), shot('fg3', 3), shot('fg3_miss', 0), shot('fg1', 1), shot('ft_miss', 0)]);
    expect(bag).toMatchObject({ points_scored: 6, fgm: 2, fga: 4, fg3m: 1, fg3a: 2, ftm: 1, fta: 2 });
    const career = foldCareerStats(statSpecFor('basketball')!, [{ ...bag, matches: 1 }]);
    expect(career).toMatchObject({ fg_pct: 50, fg3_pct: 50, ft_pct: 50, points_per_match: 6 });
  });

  it('a match with no misses logged keeps no attempts, so no fake 100%', () => {
    const bag = bagOf([shot('fg2', 2), shot('fg1', 1)]);
    expect(bag.fga).toBeUndefined();
    expect(bag.fg_2).toBe(1);
    expect(foldCareerStats(statSpecFor('basketball')!, [bag]).fg_pct).toBeUndefined();
  });

  it('per-match averages are plain averages, not percentages', () => {
    expect(foldCareerStats(statSpecFor('football')!, [{ goals: 3, matches: 2 }]).goals_per_match).toBe(1.5);
    expect(foldCareerStats(statSpecFor('basketball')!, [{ points_scored: 41, matches: 2 }]).points_per_match).toBe(20.5);
  });

  it('every new counter has a column', () => {
    for (const k of ['ftm', 'fta', 'fgm', 'fga', 'fg3m', 'fg3a']) expect(COLUMN_MAP.invasion[k], k).toBeTruthy();
  });
});
