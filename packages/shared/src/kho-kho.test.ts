import { describe, expect, it } from 'vitest';
import { applyKnobs, readKnobs, knobsFor } from './format-knobs.js';
import {
  chaserOfTurn, formatChaseTime, khoStatus, khoTurnLines, minChaseEnd, minChaseState, parseChaseTime,
} from './kho-kho.js';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { statSpecFor } from './stat-registry.js';
import { tieProgress } from './tie-break.js';
import { deriveTeamStats } from './team-stats.js';
import { toCategoryRow } from './category-lines.js';
import type { Side } from './scoring-rules.js';

const f = presetByKey('kho_4turns')!;
const pts = (side: Side, n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side, pts: 1 }) as RallyEvent);
const end = (ms?: number): RallyEvent => ({ t: 'endPeriod', ...(ms ? { clockMs: ms } : {}) });
const status = (log: RallyEvent[]) => khoStatus(f, log, foldRally(f, log).state);

describe('kho kho presets', () => {
  it('lead with two innings of 9-minute turns, allow no draw and settle by minimum chase', () => {
    expect(f.name).toBe('Two innings - 9-minute turns');
    expect(f.levels[1]).toMatchObject({ target: 4, decide: 'aggregate' });
    expect(f.clock?.minutes).toBe(36);
    expect(f.endStates.drawsAllowed).toBe(false);
    expect(f.tieBreak?.minimumChase).toBe(true);
    expect(presetByKey('kho_2x7')!.clock?.minutes).toBe(28);
    // The old "Two innings of 9 minutes" was two turns: it now says so.
    expect(presetByKey('kho_2x9')!.name).toBe('One innings - 9-minute turns');
  });

  it('offer kho kho actions, not kabaddi ones', () => {
    const keys = statSpecFor('kho-kho')!.events.map((e) => e.key);
    expect(keys).toContain('kho_touch');
    expect(keys).toContain('kho_late_entry');
    expect(keys).not.toContain('raid');
    expect(keys).not.toContain('tackle');
  });
});

describe('who chases', () => {
  it('alternates from the toss, the same order in both innings', () => {
    expect([0, 1, 2, 3].map((i) => chaserOfTurn(i, 'B', null))).toEqual(['B', 'A', 'B', 'A']);
  });

  it('is unknown until the toss is recorded, then follows the turns', () => {
    expect(status([]).chaser).toBeNull();
    expect(status([{ t: 'chaseFirst', side: 'B' }]).chaser).toBe('B');
    expect(status([{ t: 'chaseFirst', side: 'B' }, ...pts('B', 3), end()]).chaser).toBe('A');
  });

  it('a follow-on sends the trailing side in to chase again', () => {
    expect([2, 3].map((i) => chaserOfTurn(i, 'A', 'A'))).toEqual(['B', 'A']);
  });
});

describe('follow-on', () => {
  const innings1 = (a: number, b: number): RallyEvent[] => [
    { t: 'chaseFirst', side: 'A' }, ...pts('A', a), end(), ...pts('B', b), end(),
  ];

  it('is offered at the end of the first innings when the lead is 9 or more', () => {
    expect(status(innings1(12, 3)).followOnOffer).toEqual({ leader: 'A', lead: 9 });
    expect(status(innings1(11, 3)).followOnOffer).toBeNull();
  });

  it('is not offered once the third turn has started', () => {
    expect(status([...innings1(12, 3), ...pts('A', 1)]).followOnOffer).toBeNull();
  });

  it('ends the match "by an innings" when the follow-on side is still behind', () => {
    const log: RallyEvent[] = [...innings1(12, 3), { t: 'followOn', side: 'A' }, ...pts('B', 4), end()];
    const s = status(log);
    expect(s.followOnBy).toBe('A');
    expect(s.wonByInnings).toBe('A');
  });

  it('plays the fourth turn when the follow-on side has caught up', () => {
    const log: RallyEvent[] = [...innings1(12, 3), { t: 'followOn', side: 'A' }, ...pts('B', 10), end()];
    const s = status(log);
    expect(s.wonByInnings).toBeNull();
    expect(s.chaser).toBe('A');
  });
});

describe('minimum chase', () => {
  const level: RallyEvent[] = [
    { t: 'chaseFirst', side: 'A' }, ...pts('A', 5), end(), ...pts('B', 5), end(),
    ...pts('A', 4), end(), ...pts('B', 4), end(),
  ];

  it('starts when the match is level after the last turn', () => {
    const st = foldRally(f, level).state;
    expect(st.ended).toBe(false);
    expect(tieProgress(f, st, [9, 9]).phase).toBe('minimumChase');
  });

  it('the faster first out wins, and the limit is the time to beat plus 30 s', () => {
    const one = minChaseState([...level, { t: 'minChase', side: 'A', ms: 62_000 }], 'A');
    expect(one.next).toBe('B');
    expect(one.limitMs).toBe(92_000);
    const two = minChaseState([...level, { t: 'minChase', side: 'A', ms: 62_000 }, { t: 'minChase', side: 'B', ms: 48_500 }], 'A');
    expect(two.winner).toBe('B');
  });

  it('goes again when both take as long, or neither gets an out', () => {
    const log: RallyEvent[] = [...level, { t: 'minChase', side: 'A', ms: null }, { t: 'minChase', side: 'B', ms: null }];
    const st = minChaseState(log, 'A');
    expect(st.winner).toBeNull();
    expect(st.next).toBe('A');
    expect(minChaseState([...log, { t: 'minChase', side: 'A', ms: 70_000 }, { t: 'minChase', side: 'B', ms: null }], 'A').winner).toBe('A');
  });

  it('closes the match with the score still level', () => {
    const r = foldRally(f, [...level, { t: 'minChase', side: 'A', ms: 1 }, { t: 'minChase', side: 'B', ms: 2 }, minChaseEnd('A')]);
    expect(r.state).toMatchObject({ ended: true, winner: 'A', reason: 'minimum_chase' });
  });

  it('reads and writes chase times', () => {
    expect(parseChaseTime('1:23.4')).toBe(83_400);
    expect(parseChaseTime('83.4')).toBe(83_400);
    expect(parseChaseTime('abc')).toBeNull();
    expect(formatChaseTime(83_400)).toBe('1:23.4');
    expect(formatChaseTime(null)).toBe('no out');
  });
});

describe('the turn record', () => {
  it('lists each turn with who chased, what they scored and how long it ran', () => {
    const log: RallyEvent[] = [{ t: 'chaseFirst', side: 'B' }, ...pts('B', 6), end(540_000), ...pts('A', 2), end(301_000)];
    expect(khoTurnLines(f, log, foldRally(f, log).state)).toEqual([
      { turn: 1, chaser: 'B', points: 6, ms: 540_000 },
      { turn: 2, chaser: 'A', points: 2, ms: 301_000 },
    ]);
  });
});

describe('player stats', () => {
  it('a defender out scores for the chasers, counts against the defender and credits the chaser', () => {
    const log: RallyEvent[] = [
      { t: 'chaseFirst', side: 'A' },
      // Tapped on the DEFENDING side (B): the point goes to A, the chaser is A's.
      { t: 'point', side: 'A', pts: 1, kind: 'kho_pole_dive', playerId: 'def1', secondId: 'ch1' },
      { t: 'point', side: 'A', pts: 1, kind: 'kho_late_entry', playerId: 'def2' },
      { t: 'point', side: 'A', pts: 0, kind: 'kho_foul', playerId: 'ch1' },
    ];
    const s = deriveTeamStats('kho-kho', log);
    const bag = (id: string) => s.players.find((x) => x.userId === id)?.stats ?? {};
    expect(bag('ch1')).toMatchObject({ touch_points: 1, pole_dive_outs: 1, kho_fouls: 1 });
    expect(bag('def1')).toMatchObject({ times_out: 1 });
    expect(bag('def2')).toMatchObject({ times_out: 1, late_entries: 1 });
    expect(foldRally(f, log).state.score[0]).toEqual([2, 0]);
  });

  it('every kho kho stat has a column to land in', () => {
    const row = toCategoryRow('kho-kho', { touch_points: 2, pole_dive_outs: 1, dive_outs: 1, sudden_attack_outs: 1,
      times_out: 3, out_of_field_outs: 1, late_entries: 1, kho_fouls: 2, yellows: 1, reds: 0 });
    expect(row?.table).toBe('raid_match_lines');
    expect(row?.unmapped).toEqual([]);
  });
});

describe('format editor', () => {
  it('offers the minimum chase instead of a shoot-out, and keeps it on save', () => {
    const k = readKnobs(f);
    const keys = knobsFor(k).map((x) => x.key);
    expect(keys).toContain('minimumChaseEnabled');
    expect(keys).not.toContain('shootoutEnabled');
    expect(applyKnobs(f, k).tieBreak?.minimumChase).toBe(true);
    expect(applyKnobs(f, { ...k, minimumChaseEnabled: false }).tieBreak).toBeNull();
  });
});
