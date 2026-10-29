import { describe, expect, it } from 'vitest';
import { applyKnobs, describeKnobs, knobsFor, readKnobs } from './format-knobs.js';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { statSpecFor } from './stat-registry.js';
import { deriveTeamStats } from './team-stats.js';
import { tieProgress } from './tie-break.js';
import { toCategoryRow } from './category-lines.js';
import type { Side } from './scoring-rules.js';

const f = presetByKey('ultimate_2x20')!;
const goals = (side: Side, n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side, pts: 1, kind: 'goal' }) as RallyEvent);
const half: RallyEvent = { t: 'endPeriod' };

describe('ultimate: first to 13 with a 40-minute cap', () => {
  it('the preset says what it plays', () => {
    expect(f.name).toBe('First to 13, 40-minute cap (two halves of 20)');
    expect(f.levels[1]).toMatchObject({ decide: 'aggregate', target: 2, firstTo: 13 });
    expect(f.endStates.drawsAllowed).toBe(false);
    expect(f.tieBreak?.universalPoint).toBe(true);
  });

  it('ends the moment a side reaches 13, even in the first half', () => {
    const st = foldRally(f, [...goals('A', 12), ...goals('B', 5), ...goals('A', 1)]).state;
    expect(st).toMatchObject({ ended: true, winner: 'A' });
  });

  it('otherwise the leader after two halves wins', () => {
    const st = foldRally(f, [...goals('A', 6), half, ...goals('B', 4), half]).state;
    expect(st).toMatchObject({ ended: true, winner: 'A' });
  });

  it('level after two halves: the universal point - next goal wins', () => {
    const level = [...goals('A', 5), half, ...goals('B', 5), half];
    const st = foldRally(f, level).state;
    expect(st.ended).toBe(false);
    expect(tieProgress(f, st, [5, 5]).phase).toBe('universalPoint');
    expect(foldRally(f, [...level, ...goals('B', 1)]).state).toMatchObject({ ended: true, winner: 'B' });
  });

  it('the final plays extra time of 8 + 8 before the universal point', () => {
    const fin = presetByKey('ultimate_final_2x20')!;
    const level = [...goals('A', 5), half, ...goals('B', 5), half];
    expect(tieProgress(fin, foldRally(fin, level).state, [5, 5]).phase).toBe('extraTime');
    // A goal in extra time does not end it - the extra halves are played out.
    expect(foldRally(fin, [...level, ...goals('A', 1)]).state.ended).toBe(false);
    const afterExtra = [...level, ...goals('A', 1), half, ...goals('B', 1), half];
    expect(tieProgress(fin, foldRally(fin, afterExtra).state, [6, 6]).phase).toBe('universalPoint');
    expect(foldRally(fin, [...afterExtra, ...goals('A', 1)]).state).toMatchObject({ ended: true, winner: 'A' });
  });
});

describe('ultimate actions and stats', () => {
  it('offers ultimate actions, not football ones', () => {
    const keys = statSpecFor('frisbee')!.events.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['goal', 'callahan', 'ul_block', 'ul_turnover']));
    expect(keys).not.toContain('own_goal');
    expect(keys).not.toContain('pen_scored');
    expect(keys).not.toContain('yellow');
  });

  it('goal + assist, a Callahan, blocks and turnovers land on the right people and columns', () => {
    const log: RallyEvent[] = [
      { t: 'point', side: 'A', pts: 1, kind: 'goal', playerId: 'catcher', secondId: 'thrower' },
      { t: 'point', side: 'B', pts: 1, kind: 'callahan', playerId: 'def' },
      { t: 'point', side: 'A', pts: 0, kind: 'ul_turnover', playerId: 'thrower' },
      { t: 'point', side: 'B', pts: 0, kind: 'ul_block', playerId: 'def' },
    ];
    const s = deriveTeamStats('frisbee', log);
    const bag = (id: string) => s.players.find((x) => x.userId === id)?.stats ?? {};
    expect(bag('catcher')).toMatchObject({ goals: 1 });
    expect(bag('thrower')).toMatchObject({ assists: 1, turnovers: 1 });
    expect(bag('def')).toMatchObject({ goals: 1, blocks: 2 });
    expect(foldRally(f, log).state.score[0]).toEqual([1, 1]);
    const row = toCategoryRow('frisbee', { goals: 2, assists: 1, blocks: 2, turnovers: 1 });
    expect(row?.table).toBe('invasion_match_lines');
    expect(row?.unmapped).toEqual([]);
  });
});

describe('format editor', () => {
  it('keeps "first to" and the universal point on save, and can turn them off', () => {
    const k = readKnobs(f);
    expect(k.firstTo).toBe(13);
    expect(knobsFor(k).map((x) => x.key)).toEqual(expect.arrayContaining(['firstTo', 'universalPointEnabled']));
    const saved = applyKnobs(f, k);
    expect(saved.levels[1].firstTo).toBe(13);
    expect(saved.tieBreak?.universalPoint).toBe(true);
    const off = applyKnobs(f, { ...k, firstTo: 0, universalPointEnabled: false });
    expect(off.levels[1].firstTo).toBeUndefined();
    expect(off.tieBreak).toBeNull();
    expect(describeKnobs(k)).toBe('2 halves · first to 13 · 40 min cap (20/period) · universal point · 1 timeout a match (60s)');
  });
});

// Sheet FR03: 12-12 at the cap in the final. Either reading of the rulebook can be set.
describe('the win score in extra time', () => {
  const fin = presetByKey('ultimate_final_2x20')!;
  const twelveAll = [...goals('A', 6), ...goals('B', 6), half, ...goals('A', 6), ...goals('B', 6), half];

  it('by default the first goal to 13 in extra time wins at once', () => {
    expect(foldRally(fin, twelveAll).state.ended).toBe(false);
    expect(foldRally(fin, [...twelveAll, ...goals('A', 1)]).state).toMatchObject({ ended: true, winner: 'A' });
  });

  it('switched off in the editor, extra time is played in full and the leader wins', () => {
    const k = readKnobs(fin);
    expect(k.extraTimeFirstTo).toBe(true);
    expect(knobsFor(k).map((x) => x.key)).toContain('extraTimeFirstTo');
    const full = applyKnobs(fin, { ...k, extraTimeFirstTo: false });
    expect(full.tieBreak?.extraTime).toMatchObject({ periods: 2, minutes: 8, fullTime: true });
    // 13-12 in extra time does not end it; 15-14 after both extra halves does.
    expect(foldRally(full, [...twelveAll, ...goals('A', 1)]).state.ended).toBe(false);
    const st = foldRally(full, [...twelveAll, ...goals('A', 2), half, ...goals('B', 2), ...goals('A', 1), half]).state;
    expect(st).toMatchObject({ ended: true, winner: 'A' });
    expect(describeKnobs(readKnobs(full))).toContain('ET 2x8 min played in full');
  });

  it('a regulation goal to 13 still wins straight away either way', () => {
    const full = applyKnobs(fin, { ...readKnobs(fin), extraTimeFirstTo: false });
    expect(foldRally(full, [...goals('A', 12), ...goals('B', 3), ...goals('A', 1)]).state).toMatchObject({ ended: true, winner: 'A' });
  });

  it('is not offered without extra time', () => {
    expect(knobsFor(readKnobs(f)).map((x) => x.key)).not.toContain('extraTimeFirstTo');
  });
});
