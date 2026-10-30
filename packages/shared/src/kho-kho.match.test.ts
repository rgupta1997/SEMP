import { describe, expect, it } from 'vitest';
import {
  inningsEnd, khoSettlementOf, khoStatus, khoTurnLines, KHO_END_LABEL, KHO_END_SHORT, KHO_RESULT_WORDS,
  minChaseEnd, minChaseState, MIN_CHASE_GRACE_MS,
} from './kho-kho.js';
import { aggregateScore, foldRally, resultEnvelope, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { tieProgress } from './tie-break.js';
import { deriveTeamStats } from './team-stats.js';
import { toCategoryRow } from './category-lines.js';
import type { ScoringFormat, Side } from './scoring-rules.js';

// Whole matches, played the way the console writes them: the toss, outs tapped on the
// defending side (scored for the chasers), the chaser riding along, a whistle per turn.

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');
const toss = (side: Side): RallyEvent => ({ t: 'chaseFirst', side });
/** An out tapped on the defending side: the point goes to the chasers. */
const out = (defending: Side, kind: string, defender: string, chaser?: string): RallyEvent =>
  ({ t: 'point', side: other(defending), pts: 1, kind, playerId: defender, ...(chaser ? { secondId: chaser } : {}) }) as RallyEvent;
const outs = (defending: Side, n: number, prefix = 'd'): RallyEvent[] =>
  Array.from({ length: n }, (_, i) => out(defending, 'kho_touch', `${prefix}${i}`, 'c1'));
const whistle = (ms = 540_000): RallyEvent => ({ t: 'endPeriod', clockMs: ms });

const play = (f: ScoringFormat, log: RallyEvent[]) => {
  const state = foldRally(f, log).state;
  return { state, env: resultEnvelope(f, state), kho: khoStatus(f, log, state), total: aggregateScore(state) };
};

const four = presetByKey('kho_4turns')!;
const seven = presetByKey('kho_2x7')!;
const oneInnings = presetByKey('kho_2x9')!;

describe('a full 4-turn match, played out', () => {
  // A chases turns 1 and 3, B chases 2 and 4.
  const log: RallyEvent[] = [
    toss('A'),
    { t: 'clockStart' } as RallyEvent,
    out('B', 'kho_touch', 'b1', 'a1'),
    out('B', 'kho_pole_dive', 'b2', 'a2'),
    out('B', 'kho_dive', 'b3', 'a1'),
    out('B', 'kho_sudden_attack', 'b4', 'a3'),
    out('B', 'kho_out_of_field', 'b5'),
    out('B', 'kho_late_entry', 'b6'),
    out('B', 'kho_touch', 'b7'),                       // "Not sure": no chaser
    { t: 'point', side: 'A', pts: 0, kind: 'kho_foul', playerId: 'a1' } as RallyEvent,
    { t: 'point', side: 'B', pts: 0, kind: 'kho_yellow', playerId: 'b1' } as RallyEvent,
    whistle(),
    ...outs('A', 5, 'a'),
    whistle(),
    ...outs('B', 3, 'b'),
    whistle(),
    ...outs('A', 4, 'a'),
    { t: 'point', side: 'B', pts: 0, kind: 'kho_red', playerId: 'b9' } as RallyEvent,
    whistle(),
  ];

  it('swaps the chasers every turn', () => {
    const chasers = [1, 12, 19, 23].map((n) => play(four, log.slice(0, n)).kho.chaser);
    expect(chasers).toEqual(['A', 'B', 'A', 'B']);
  });

  it('adds the turns up and ends after the fourth whistle, the leader winning', () => {
    const { state, env, total } = play(four, log);
    expect(total).toEqual([10, 9]);
    expect(state.ended).toBe(true);
    expect(env.ended).toBe(true);
    expect(env.winner).toBe('A');
    expect(env.headline).toEqual([10, 9]);
    expect(khoSettlementOf({ rally: log })).toBeNull();     // a plain win carries no note
  });

  it('cards and fouls score nothing', () => {
    // Toss, clock, seven outs = 9 events; then the foul and the yellow.
    const before = play(four, log.slice(0, 9)).total;
    expect(before).toEqual([7, 0]);
    expect(play(four, log.slice(0, 11)).total).toEqual(before);
  });

  it('records each turn with who chased, the points and the time', () => {
    expect(khoTurnLines(four, log, play(four, log).state).map((l) => [l.turn, l.chaser, l.points]))
      .toEqual([[1, 'A', 7], [2, 'B', 5], [3, 'A', 3], [4, 'B', 4]]);
  });

  it('credits defenders and chasers, and a "Not sure" out credits no chaser', () => {
    const s = deriveTeamStats('kho-kho', log);
    const bag = (id: string) => s.players.find((x) => x.userId === id)?.stats ?? {};
    expect(bag('a1')).toMatchObject({ touch_points: 2, dive_outs: 1, kho_fouls: 1 });
    expect(bag('a2')).toMatchObject({ touch_points: 1, pole_dive_outs: 1 });
    expect(bag('a3')).toMatchObject({ touch_points: 1, sudden_attack_outs: 1 });
    expect(bag('b1')).toMatchObject({ times_out: 2, yellows: 1 });
    expect(bag('b5')).toMatchObject({ times_out: 1, out_of_field_outs: 1 });
    expect(bag('b6')).toMatchObject({ times_out: 1, late_entries: 1 });
    expect(bag('b9')).toMatchObject({ reds: 1 });
    // c1 chased in the bulk turns; b7 went out to nobody named.
    const chaserCredits = s.players.reduce((n, p) => n + ((p.stats as Record<string, number>).touch_points ?? 0), 0);
    expect(chaserCredits).toBe(4 + 5 + 3 + 4);                // every out bar the 3 with no chaser
  });

  it('files every player line into the raid table with nothing dropped', () => {
    for (const p of deriveTeamStats('kho-kho', log).players) {
      expect(toCategoryRow('kho-kho', p.stats as Record<string, number>)?.unmapped).toEqual([]);
    }
  });

  it('undo is a truncate: taking back the last whistle reopens turn 4', () => {
    const { state, kho } = play(four, log.slice(0, -1));
    expect(state.ended).toBe(false);
    expect(kho.chaser).toBe('B');
  });
});

describe('follow-on', () => {
  // A chases first and leads by 9+ after the first innings.
  const innings1: RallyEvent[] = [toss('A'), ...outs('B', 12), whistle(), ...outs('A', 2, 'a'), whistle()];

  it('is offered to the leader with the right lead', () => {
    expect(play(four, innings1).kho.followOnOffer).toEqual({ leader: 'A', lead: 10, compulsory: false });
  });

  it('declined: the offer disappears once turn 3 starts and the order is unchanged', () => {
    const { kho } = play(four, [...innings1, ...outs('B', 1, 'x')]);
    expect(kho.followOnOffer).toBeNull();
    expect(kho.chaser).toBe('A');
  });

  it('accepted and still behind: won by an innings, ending after turn 3', () => {
    const log = [...innings1, { t: 'followOn', side: 'A' } as RallyEvent, ...outs('A', 3, 'a'), whistle()];
    const { kho } = play(four, log);
    expect(kho.wonByInnings).toBe('A');
    const done = [...log, inningsEnd('A')];
    const { state, env } = play(four, done);
    expect(state).toMatchObject({ ended: true, winner: 'A', reason: 'innings' });
    expect(env.winner).toBe('A');
    expect(env.headline).toEqual([12, 5]);
    expect(khoSettlementOf({ rally: done })).toEqual({ reason: 'innings', winner: 'A' });
  });

  it('accepted, the follow-on side chases again in turn 3', () => {
    const { kho } = play(four, [...innings1, { t: 'followOn', side: 'A' } as RallyEvent]);
    expect(kho.chaser).toBe('B');
  });

  it('accepted and caught up: turn 4 is played, the follow-on side defending... then chasing', () => {
    const log = [...innings1, { t: 'followOn', side: 'A' } as RallyEvent, ...outs('A', 11, 'a'), whistle()];
    const mid = play(four, log);
    expect(mid.kho.wonByInnings).toBeNull();
    expect(mid.kho.chaser).toBe('A');
    const end = play(four, [...log, ...outs('B', 2, 'y'), whistle()]);
    expect(end.state.ended).toBe(true);
    expect(end.total).toEqual([14, 13]);
    expect(end.env.winner).toBe('A');
  });

  it('is never offered in a one-innings match', () => {
    const { kho } = play(oneInnings, [toss('A'), ...outs('B', 12), whistle()]);
    expect(kho.followOnOffer).toBeNull();
  });
});

describe('level after the last turn: minimum chase', () => {
  const level: RallyEvent[] = [
    toss('B'), ...outs('A', 6, 'a'), whistle(), ...outs('B', 4), whistle(),
    ...outs('A', 2, 'a'), whistle(), ...outs('B', 4), whistle(),
  ];

  it('the match does not end as a draw', () => {
    const { state, total } = play(four, level);
    expect(total).toEqual([8, 8]);
    expect(state.ended).toBe(false);
    expect(tieProgress(four, state, total).phase).toBe('minimumChase');
  });

  it('the side that chased first chases first, and the second has a time to beat', () => {
    const first = minChaseState(level, 'B');
    expect(first.next).toBe('B');
    const second = minChaseState([...level, { t: 'minChase', side: 'B', ms: 80_000 }], 'B');
    expect(second.next).toBe('A');
    expect(second.limitMs).toBe(80_000 + MIN_CHASE_GRACE_MS);
  });

  it('a tied round and a round with no outs go again; then the faster side wins', () => {
    const log: RallyEvent[] = [
      ...level,
      { t: 'minChase', side: 'B', ms: 60_000 }, { t: 'minChase', side: 'A', ms: 60_000 },
      { t: 'minChase', side: 'B', ms: null }, { t: 'minChase', side: 'A', ms: null },
      { t: 'minChase', side: 'B', ms: 75_000 }, { t: 'minChase', side: 'A', ms: null },
    ];
    const mc = minChaseState(log, 'B');
    expect(mc.rounds).toHaveLength(3);
    expect(mc.winner).toBe('B');
    // Undo the last time: the round reopens with A to chase.
    const undone = minChaseState(log.slice(0, -1), 'B');
    expect(undone.winner).toBeNull();
    expect(undone.next).toBe('A');
  });

  it('settling keeps the score level and records how it was won', () => {
    const done = [...level, { t: 'minChase', side: 'B', ms: 50_000 } as RallyEvent, { t: 'minChase', side: 'A', ms: 41_000 } as RallyEvent, minChaseEnd('A')];
    const { state, env } = play(four, done);
    expect(state).toMatchObject({ ended: true, winner: 'A', reason: 'minimum_chase' });
    expect(env.headline).toEqual([8, 8]);
    expect(env.winner).toBe('A');
    const settled = khoSettlementOf({ rally: done });
    expect(settled).toEqual({ reason: 'minimum_chase', winner: 'A' });
    expect(KHO_END_SHORT[settled!.reason]).toBe('min. chase');
    expect(KHO_END_LABEL[settled!.reason]).toBe('won on minimum chase');
    expect(`Won ${KHO_RESULT_WORDS[settled!.reason]}`).toBe('Won on minimum chase');
  });

  it('a 0-0 match goes to minimum chase too', () => {
    const { state, total } = play(four, [toss('A'), whistle(), whistle(), whistle(), whistle()]);
    expect(total).toEqual([0, 0]);
    expect(tieProgress(four, state, total).phase).toBe('minimumChase');
  });

  it('works the same in the 7-minute and one-innings formats', () => {
    const lvl7 = [toss('A'), ...outs('B', 3), whistle(420_000), ...outs('A', 3, 'a'), whistle(420_000), whistle(420_000), whistle(420_000)];
    expect(tieProgress(seven, play(seven, lvl7).state, [3, 3]).phase).toBe('minimumChase');
    const lvl1 = [toss('A'), ...outs('B', 3), whistle(), ...outs('A', 3, 'a'), whistle()];
    const r = play(oneInnings, lvl1);
    expect(r.state.ended).toBe(false);
    expect(tieProgress(oneInnings, r.state, r.total).phase).toBe('minimumChase');
  });
});

describe('the other formats end where they should', () => {
  it('7-minute turns: four turns', () => {
    const r = play(seven, [toss('A'), ...outs('B', 5), whistle(), ...outs('A', 3, 'a'), whistle(), whistle(), whistle()]);
    expect(r.state.ended).toBe(true);
    expect(r.env.winner).toBe('A');
  });

  it('one innings: two turns', () => {
    const r = play(oneInnings, [toss('A'), ...outs('B', 2), whistle(), ...outs('A', 5, 'a'), whistle()]);
    expect(r.state.ended).toBe(true);
    expect(r.env.winner).toBe('B');
  });
});
