import { describe, expect, it } from 'vitest';
import { applyKnobs, describeKnobs, knobsFor, readKnobs } from './format-knobs.js';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { shootoutLabel } from './rally-rows.js';
import { statSpecFor } from './stat-registry.js';
import { deriveTeamStats } from './team-stats.js';
import { toCategoryRow } from './category-lines.js';
import { usualSide } from './team-sheet.js';
import { cornersLine, penaltyCorners } from './hockey.js';
import { resultSummary } from './result-summary.js';
import { shootoutLine, shootoutTerms, tieProgress } from './tie-break.js';
import type { Side } from './scoring-rules.js';

const goal = (side: Side): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'goal' });
const end: RallyEvent = { t: 'endPeriod' };
const quarters = (n: number) => Array.from({ length: n }, () => end);

describe('hockey cards', () => {
  const spec = statSpecFor('hockey')!;

  it('has a green card, a tone of its own, before the yellow', () => {
    const keys = spec.events.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['green', 'yellow', 'red']));
    expect(keys.indexOf('green')).toBe(keys.indexOf('yellow') - 1);
    expect(spec.events.find((e) => e.key === 'green')?.tone).toBe('warning');
  });

  it('calls a penalty a penalty stroke; football is unchanged', () => {
    expect(spec.events.find((e) => e.key === 'pen_scored')?.label).toBe('Penalty stroke scored');
    expect(statSpecFor('football')!.events.find((e) => e.key === 'pen_scored')?.label).toBe('Penalty scored');
    expect(statSpecFor('football')!.events.map((e) => e.key)).not.toContain('green');
  });

  it('counts greens apart from yellows and stores them in their own column', () => {
    const log: RallyEvent[] = [
      { t: 'point', side: 'A', pts: 0, kind: 'green', playerId: 'p1' },
      { t: 'point', side: 'A', pts: 0, kind: 'yellow', playerId: 'p1' },
    ];
    const bag = deriveTeamStats('hockey', log).players.find((p) => p.userId === 'p1')!.stats;
    expect(bag).toMatchObject({ greens: 1, yellows: 1 });
    const row = toCategoryRow('hockey', bag);
    expect(row?.row).toMatchObject({ greens: 1, yellows: 1 });
    expect(row?.unmapped).toEqual([]);
  });
});

describe('hockey formats', () => {
  it('FIH knockout: level after four quarters goes straight to a shoot-out', () => {
    const ko = presetByKey('fih_4x15_ko')!;
    const st = foldRally(ko, [goal('A'), goal('B'), ...quarters(4)]).state;
    expect(st.ended).toBe(false);
    expect(tieProgress(ko, st, [1, 1]).phase).toBe('penalties');
  });

  it('five-a-side league: 4 x 8, a level game is a draw, 5 on the field', () => {
    const f = presetByKey('hockey5_4x8')!;
    expect(f.clock?.minutes).toBe(32);
    expect(foldRally(f, [goal('A'), goal('B'), ...quarters(4)]).state).toMatchObject({ ended: true, outcome: 'draw' });
    expect(usualSide('hockey', f.rulesSheet)).toEqual({ onField: 5, bench: 5 });
    expect(usualSide('hockey')).toEqual({ onField: 11, bench: 5 });
  });

  it('five-a-side final: extra time 5 + 5, then a shoot-out', () => {
    const f = presetByKey('hockey5_4x8_final')!;
    const level = [goal('A'), goal('B'), ...quarters(4)];
    expect(tieProgress(f, foldRally(f, level).state, [1, 1])).toMatchObject({ phase: 'extraTime', periodMs: 5 * 60_000 });
    expect(tieProgress(f, foldRally(f, [...level, ...quarters(2)]).state, [1, 1]).phase).toBe('penalties');
    expect(foldRally(f, [...level, goal('A'), end, end]).state).toMatchObject({ ended: true, winner: 'A' });
  });
});

describe('hockey wording', () => {
  it('says shoot-out and shooters, football keeps penalties and kicks', () => {
    expect(shootoutTerms('hockey')).toMatchObject({ title: 'Shoot-out', taker: 'Shooter', short: 'SO' });
    expect(shootoutTerms('football')).toMatchObject({ title: 'Penalties', taker: 'Kicker', short: 'pens' });
    expect(shootoutLabel(4, 3, 'hockey')).toBe('4–3 SO');
    expect(shootoutLabel(4, 3)).toBe('4–3 pens');
    const st = { winner: 'A', scored: [4, 3] } as Parameters<typeof shootoutLine>[0];
    expect(shootoutLine(st, (s) => s, 'hockey')).toBe('A won 4–3 in the shoot-out');
  });

  it('the editor offers a shoot-out with shooters for hockey', () => {
    const ko = presetByKey('fih_4x15_ko')!;
    const specs = knobsFor(readKnobs(ko));
    expect(specs.find((s) => s.key === 'shootoutEnabled')?.label).toBe('Shoot-out');
    expect(specs.find((s) => s.key === 'shootoutKicks')?.label).toBe('Shooters each');
    expect(specs.filter((s) => s.key === 'shootoutKicks')).toHaveLength(1);
    expect(describeKnobs(readKnobs(ko))).toContain('shoot-out (5 each)');
    // Football still reads kicks.
    const fb = presetByKey('fih_4x15')!;
    const asFootball = applyKnobs({ ...fb, sport: 'football' }, { ...readKnobs({ ...fb, sport: 'football' }), drawsAllowed: false, shootoutEnabled: true });
    expect(knobsFor(readKnobs(asFootball)).find((s) => s.key === 'shootoutKicks')?.label).toBe('Kicks each');
  });
});

// Penalty corners (team) and the three kinds of goal.
describe('penalty corners and goal types', () => {
  const pc = (side: Side): RallyEvent => ({ t: 'point', side, pts: 0, kind: 'pc' });
  const pcGoal = (side: Side, playerId: string, secondId?: string): RallyEvent =>
    ({ t: 'point', side, pts: 1, kind: 'pc_goal', playerId, ...(secondId ? { secondId } : {}) });

  it('offers field goal, corner goal and the corner itself, the corner as a team action', () => {
    const events = statSpecFor('hockey')!.events;
    expect(events.find((e) => e.key === 'goal')?.label).toBe('Field goal');
    expect(events.find((e) => e.key === 'pc_goal')).toMatchObject({ points: 1, tone: 'score' });
    expect(events.find((e) => e.key === 'pc')).toMatchObject({ perPlayer: false });
    expect(statSpecFor('football')!.events.find((e) => e.key === 'goal')?.label).toBe('Goal');
  });

  it('a corner goal is a goal, a corner goal, and an assist', () => {
    const log = [pc('A'), pcGoal('A', 'p1', 'p2')];
    expect(foldRally(presetByKey('hockey5_4x8')!, log).state.score[0]).toEqual([1, 0]);
    const players = deriveTeamStats('hockey', log).players;
    expect(players.find((p) => p.userId === 'p1')!.stats).toMatchObject({ goals: 1, pc_goals: 1 });
    expect(players.find((p) => p.userId === 'p2')!.stats).toMatchObject({ assists: 1 });
    const row = toCategoryRow('hockey', players.find((p) => p.userId === 'p1')!.stats);
    expect(row?.row).toMatchObject({ goals: 1, pc_goals: 1 });
    expect(row?.unmapped).toEqual([]);
  });

  it('counts corners won and scored per side, a corner goal is always a corner', () => {
    expect(penaltyCorners([pc('A'), pc('A'), pcGoal('A', 'p1'), pc('B')])).toEqual({ A: { won: 2, scored: 1 }, B: { won: 1, scored: 0 } });
    // The corner itself was never tapped: its goal still counts as one.
    expect(penaltyCorners([pcGoal('B', 'p9')]).B).toEqual({ won: 1, scored: 1 });
  });

  it('the results line shows them, home first, and nothing when none were recorded', () => {
    const live = { rally: [pc('A'), pc('A'), pcGoal('A', 'p1'), pc('B'), pc('B'), pc('B')] };
    expect(resultSummary('Hockey', live)).toBe('PC 2–3 (1–0 scored)');
    expect(resultSummary('Hockey', { rally: [pc('B')] })).toBe('PC 0–1');
    expect(resultSummary('Hockey', { rally: [goal('A')] })).toBeNull();
    expect(cornersLine([])).toBeNull();
  });
});
