import { describe, expect, it } from 'vitest';
import { TEAM_PRESETS, teamPresetsFor, canonicalTeamSport } from './team-presets.js';
import { allPresets, presetByKey, presetsFor, defaultFormatFor, isKernelSport } from './racquet-presets.js';
import { scoringFormatSchema, type Side } from './scoring-rules.js';
import {
  aggregateScore, foldRally, headline, isAggregate, periodsPlayed, resultEnvelope,
  unitWinner, type RallyEvent, type RallyLog,
} from './rally-kernel.js';

const fmt = (k: string) => presetByKey(k)!;
const goals = (side: Side, n: number): RallyLog =>
  Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);
const whistle: RallyEvent = { t: 'endPeriod' };
const level = (n: number): RallyLog =>
  Array.from({ length: n * 2 }, (_, i) => ({ t: 'point', side: i % 2 === 0 ? 'A' : 'B' }) as RallyEvent);

describe('every non-racquet preset is valid and reachable', () => {
  it('validates against the schema', () => {
    for (const p of TEAM_PRESETS) {
      const r = scoringFormatSchema.safeParse(p);
      expect(r.success, `${p.presetKey}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('covers every family we said we would', () => {
    for (const s of ['volleyball', 'throwball', 'football', 'futsal', 'basketball', 'hockey',
      'handball', 'frisbee', 'kabaddi', 'kho-kho', 'carrom', 'pool/snooker', 'chess',
      'tug of war', 'arm wrestling', 'fencing', 'taekwondo', 'judo', 'wrestling', 'boxing']) {
      expect(teamPresetsFor(s).length, s).toBeGreaterThan(0);
      expect(presetsFor(s).length, s).toBeGreaterThan(0);   // through the ONE shelf
      expect(defaultFormatFor(s), s).toBeTruthy();
      expect(isKernelSport(s), s).toBe(true);
    }
  });

  it('leaves cricket and the measured sports alone, deliberately', () => {
    for (const s of ['cricket', 'box cricket', 'swimming', 'athletics', 'weightlifting',
      'powerlifting', 'gymnastics', 'yoga', 'shooting', 'archery', 'cycling', 'rowing']) {
      expect(presetsFor(s), s).toEqual([]);
      expect(isKernelSport(s), s).toBe(false);
    }
  });

  it('resolves the catalogue spellings', () => {
    expect(canonicalTeamSport('Kho-Kho')).toBe('kho-kho');
    expect(canonicalTeamSport('kho kho')).toBe('kho-kho');
    expect(canonicalTeamSport('Pool/Snooker')).toBe('pool/snooker');
    expect(canonicalTeamSport('Tug of War')).toBe('tug of war');
    expect(canonicalTeamSport('soccer')).toBe('football');
    expect(canonicalTeamSport('netball')).toBe('basketball');
  });

  it('every preset key is unique across the whole shelf', () => {
    const keys = allPresets().map((p) => p.presetKey!);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('a clock-terminated period', () => {
  const f = fmt('fifa_2x45');

  it('never ends on the score, however lopsided', () => {
    // The whole point: a half is not over at 4-0.
    const r = foldRally(f, goals('A', 4));
    expect(r.state.ended).toBe(false);
    expect(periodsPlayed(r.state)).toBe(0);
    expect(unitWinner(f.levels[0], [9, 0])).toBeNull();
  });

  it('ends on the whistle, banking what was scored', () => {
    const r = foldRally(f, [...goals('A', 2), ...goals('B', 1), whistle]);
    expect(periodsPlayed(r.state)).toBe(1);
    expect(r.state.finished[0].score).toEqual([2, 1]);
    expect(r.state.score[0]).toEqual([0, 0]);   // next period starts level
    expect(r.state.ended).toBe(false);           // one half to go
  });
});

describe('an aggregate match', () => {
  const f = fmt('fifa_2x45');

  it('is decided on the TOTAL, not on winning halves', () => {
    // B wins the first half 1-0, A wins the second 3-0. A takes the match 3-1.
    // A units-decided level would have called this 1-1.
    const log: RallyLog = [...goals('B', 1), whistle, ...goals('A', 3), whistle];
    const r = foldRally(f, log);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    expect(aggregateScore(r.state)).toEqual([3, 1]);
    expect(headline(f, r.state)).toEqual([3, 1]);
  });

  it('reports the headline in goals, as a football result is reported', () => {
    const r = foldRally(f, [...goals('A', 2), whistle, ...goals('B', 1), whistle]);
    expect(headline(f, r.state)).toEqual([2, 1]);
    const env = resultEnvelope(f, r.state);
    expect(env.headline).toEqual([2, 1]);
    expect(env.unitScores).toEqual([[2, 0], [0, 1]]);   // the half-by-half breakdown
  });

  it('records a draw where the format allows one', () => {
    expect(f.endStates.drawsAllowed).toBe(true);
    const r = foldRally(f, [...level(1), whistle, ...level(1), whistle]);
    expect(r.state.ended).toBe(true);
    expect(r.state.outcome).toBe('draw');
    expect(r.state.winner).toBeNull();
  });

  it('leaves a level knockout OPEN rather than inventing a winner', () => {
    // Extra time or a shoot-out settles it, recorded through the same `end` event
    // as a retirement. Picking a side here would be a fabricated result.
    const ko = fmt('knockout_2x45_no_draw');
    expect(ko.endStates.drawsAllowed).toBe(false);
    const r = foldRally(ko, [...level(1), whistle, ...level(1), whistle]);
    expect(r.state.ended).toBe(false);
    expect(r.state.outcome).toBeNull();
    // ...and the official can then close it explicitly.
    const settled = foldRally(ko, [...level(1), whistle, ...level(1), whistle,
      { t: 'end', outcome: 'win', reason: 'conceded', winner: 'A' }]);
    expect(settled.state.winner).toBe('A');
  });

  it('handles four quarters as readily as two halves', () => {
    const b = fmt('fiba_4x10');
    expect(b.levels[1].target).toBe(4);
    expect(isAggregate(b)).toBe(true);
    let log: RallyLog = [];
    for (const n of [20, 18, 22, 15]) log = log.concat(goals('A', n), whistle);
    const r = foldRally(b, log);
    expect(periodsPlayed(r.state)).toBe(4);
    expect(r.state.ended).toBe(true);
    expect(aggregateScore(r.state)).toEqual([75, 0]);
  });

  it('does not end early - three quarters is not a basketball match', () => {
    const b = fmt('fiba_4x10');
    let log: RallyLog = [];
    for (const n of [20, 18, 22]) log = log.concat(goals('A', n), whistle);
    expect(foldRally(b, log).state.ended).toBe(false);
  });
});

describe('the families that needed no engine change at all', () => {
  it('volleyball is a target level with a decider - the racquet shape exactly', () => {
    const v = fmt('fivb_25_bo5');
    expect(isAggregate(v)).toBe(false);
    // Two sets each, then the decider plays to 15 rather than 25.
    let log: RallyLog = [];
    for (let i = 0; i < 2; i++) log = log.concat(goals('A', 25));
    for (let i = 0; i < 2; i++) log = log.concat(goals('B', 25));
    const at2 = foldRally(v, log);
    expect(at2.state.score[1]).toEqual([2, 2]);
    // 15 now takes it, not 25.
    const decided = foldRally(v, log.concat(goals('A', 15)));
    expect(decided.state.ended).toBe(true);
    expect(decided.state.winner).toBe('A');
    expect(headline(v, decided.state)).toEqual([3, 2]);
  });

  it('volleyball still needs the two-point margin', () => {
    const v = fmt('fivb_25_bo3');
    const r = foldRally(v, level(24).concat(goals('A', 1)));
    expect(r.state.score[1]).toEqual([0, 0]);   // 25-24 is not a set
    const won = foldRally(v, level(24).concat(goals('A', 2)));
    expect(won.state.score[1]).toEqual([1, 0]);
  });

  it('carrom is boards, decided on units', () => {
    const c = fmt('icf_bo3_boards');
    const r = foldRally(c, [...goals('A', 25), ...goals('A', 25)]);
    expect(r.state.ended).toBe(true);
    expect(headline(c, r.state)).toEqual([2, 0]);
  });

  it('chess allows a drawn board, which is the normal case not an edge one', () => {
    const c = fmt('single_game');
    expect(c.endStates.drawsAllowed).toBe(true);
    const drawn = foldRally(c, [{ t: 'end', outcome: 'draw', reason: 'normal', winner: null }]);
    expect(drawn.state.outcome).toBe('draw');
    expect(drawn.state.winner).toBeNull();
  });

  it('tug of war is best of 3 pulls with no serve and no draw', () => {
    const t = fmt('tow_bo3');
    expect(t.serve.movement).toBe('none');
    expect(t.endStates.drawsAllowed).toBe(false);
    const r = foldRally(t, [{ t: 'point', side: 'A' }, { t: 'point', side: 'B' }, { t: 'point', side: 'A' }]);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
  });

  it('fencing counts touches to 15 in a single bout', () => {
    const f = fmt('fie_to_15');
    expect(foldRally(f, goals('A', 14)).state.ended).toBe(false);
    expect(foldRally(f, goals('A', 15)).state.winner).toBe('A');
  });
});

describe('no serve machinery leaks into a sport without a serve', () => {
  it('leaves the serve indicator off for invasion, raid and combat', () => {
    for (const key of ['fifa_2x45', 'fiba_4x10', 'pkl_2x20', 'tow_bo3', 'fie_to_15']) {
      expect(fmt(key).serve.movement, key).toBe('none');
      expect(fmt(key).serve.courtModel, key).toBe('none');
      expect(fmt(key).letsEnabled, key).toBe(false);
    }
  });

  it('keeps rally serving for the net family, where it is real', () => {
    expect(fmt('fivb_25_bo5').serve.movement).toBe('rallyWinner');
    expect(fmt('tb_bo3_15').serve.movement).toBe('rallyWinner');
  });
});
