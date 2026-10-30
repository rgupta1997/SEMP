import { describe, expect, it } from 'vitest';
import { cricketPresetByKey, type CricketFormat } from './cricket-rules.js';
import { chaseLine, cricketHeadline, cricketSideTotals, foldCricket, type CricketEvent, type CricketLog } from './cricket-engine.js';
import { cricketScorecard } from './cricket-stats.js';

// Inter-IIM cricket: the toss decides who bats first; a tie goes to a Super Over (the side
// that batted second bats first, 1 over, 2 wickets), and a tied Super Over to another.

const T20 = (): CricketFormat => cricketPresetByKey('cricket_t20')!;
const open = (striker: string, nonStriker: string, bowlerId: string): CricketLog => [
  { t: 'setBatter', end: 'striker', batterId: striker },
  { t: 'setBatter', end: 'nonStriker', batterId: nonStriker },
  { t: 'setBowler', bowlerId },
];
const run = (n: number): CricketEvent => ({ t: 'ball', runs: n });
const dots = (n: number): CricketLog => Array.from({ length: n }, () => run(0));
const out: CricketEvent = { t: 'ball', runs: 0, wicket: { how: 'bowled' }, nextBatterId: 'x3' };
const declare: CricketEvent = { t: 'endInnings', reason: 'declared' };
const play = (log: CricketLog, f = T20()) => foldCricket(f, log).state;
// A main match tied 4-4, A batting first.
const tied: CricketLog = [...open('a1', 'a2', 'b9'), run(4), declare, ...open('b1', 'b2', 'a9'), run(4), declare];

describe('the toss', () => {
  it('the toss winner choosing to bowl sends the other side in first', () => {
    const s = play([{ t: 'toss', winner: 'A', elected: 'bowl' }]);
    expect(s.innings[0].battingSide).toBe('B');
    expect(s.toss).toEqual({ winner: 'A', elected: 'bowl' });
    expect(play([{ t: 'toss', winner: 'B', elected: 'bat' }]).innings[0].battingSide).toBe('B');
    expect(play([{ t: 'toss', winner: 'B', elected: 'bowl' }]).innings[0].battingSide).toBe('A');
  });

  it('can be changed before the first ball, clearing the openers named for the wrong side', () => {
    const s = play([{ t: 'toss', winner: 'A', elected: 'bat' }, ...open('a1', 'a2', 'b9'), { t: 'toss', winner: 'A', elected: 'bowl' }]);
    expect(s.innings[0].battingSide).toBe('B');
    expect(s.innings[0].strikerId).toBeUndefined();
    expect(s.innings[0].bowlerId).toBeUndefined();
    expect(s.innings[0].batting).toEqual([]);
  });

  it('is ignored once a ball has been bowled', () => {
    const s = play([{ t: 'toss', winner: 'A', elected: 'bat' }, ...open('a1', 'a2', 'b9'), run(1), { t: 'toss', winner: 'B', elected: 'bat' }]);
    expect(s.innings[0].battingSide).toBe('A');
    expect(s.toss?.winner).toBe('A');
  });

  it('the second innings is the other side, and the result follows it', () => {
    const s = play([{ t: 'toss', winner: 'A', elected: 'bowl' }, ...open('b1', 'b2', 'a9'), run(6), declare, ...open('a1', 'a2', 'b9'), run(2), declare]);
    expect(s.innings.map((i) => i.battingSide)).toEqual(['B', 'A']);
    expect(s).toMatchObject({ ended: true, winner: 'B', margin: 'won by 4 runs' });
    expect(cricketHeadline(s)).toEqual([2, 6]);
  });
});

describe('the Super Over', () => {
  it('a tie opens one: the side that batted second bats first, chased by the other', () => {
    let s = play(tied);
    expect(s.ended).toBe(false);
    expect(s.innings[2]).toMatchObject({ superOver: 1, battingSide: 'B', maxBalls: 6, maxWickets: 2 });
    s = play([...tied, ...open('b1', 'b2', 'a9'), run(6), run(4), ...dots(4)]);
    expect(s.innings[3]).toMatchObject({ superOver: 1, battingSide: 'A', target: 11 });
  });

  it('two wickets end a Super Over innings early', () => {
    const s = play([...tied, ...open('b1', 'b2', 'a9'), run(4), out, { t: 'ball', runs: 0, wicket: { how: 'bowled' } }]);
    expect(s.innings[2]).toMatchObject({ ended: true, endedBy: 'all_out', balls: 3 });
    expect(s.innings[3]).toMatchObject({ battingSide: 'A', target: 5 });
  });

  it('the chase decides it: winner set, match total still tied, Super Over runs kept apart', () => {
    const s = play([...tied, ...open('b1', 'b2', 'a9'), run(6), ...dots(5), ...open('a1', 'a2', 'b9'), run(6), run(1)]);
    expect(s).toMatchObject({ ended: true, outcome: 'win', winner: 'A', margin: 'won the Super Over' });
    expect(cricketHeadline(s)).toEqual([4, 4]);
  });

  it('a tied Super Over is followed by another, until one side wins', () => {
    const so1 = [...tied, ...open('b1', 'b2', 'a9'), run(5), ...dots(5), ...open('a1', 'a2', 'b9'), run(5), ...dots(5)];
    let s = play(so1);
    expect(s.ended).toBe(false);
    // Super Over 2: A batted second in Super Over 1, so A bats first now.
    expect(s.innings[4]).toMatchObject({ superOver: 2, battingSide: 'A' });
    s = play([...so1, ...open('a1', 'a2', 'b9'), run(3), ...dots(5), ...open('b1', 'b2', 'a9'), run(1), ...dots(5)]);
    expect(s).toMatchObject({ ended: true, winner: 'A', margin: 'won Super Over 2' });
  });

  it('penalty runs to the fielding side count in the Super Over, not the match', () => {
    const s = play([...tied, ...open('b1', 'b2', 'a9'), run(4), { t: 'penalty', side: 'A', runs: 5 }, ...dots(5)]);
    expect(s.innings[3]).toMatchObject({ battingSide: 'A', runs: 5, target: 5 });
    expect(cricketHeadline(s)).toEqual([4, 4]);
  });

  it('Super Over innings are not player records', () => {
    const s = play([...tied, ...open('b1', 'b2', 'a9'), run(6), ...dots(5), ...open('a1', 'a2', 'b9'), run(6), run(1)]);
    const card = cricketScorecard(s);
    expect(card.innings.map((i) => i.innings)).toEqual([1, 2]);
    expect(card.batting.find((b) => b.userId === 'b1')?.runs).toBe(4);
  });

  it('a format without a Super Over still ends a tie as a tie', () => {
    const f = { ...T20(), superOverOnTie: false };
    expect(play(tied, f)).toMatchObject({ ended: true, outcome: 'tie', winner: null, margin: 'tied' });
  });
});

// Penalty runs to the fielding side during the chase add to the total being chased.
describe('penalty runs in the chase', () => {
  it('raise the target, so the chasing side must pass the new total', () => {
    const chase: CricketLog = [...open('a1', 'a2', 'b9'), run(6), declare, ...open('b1', 'b2', 'a9'), { t: 'penalty', side: 'A', runs: 5 }];
    let s = play(chase);
    expect(s.innings[1].target).toBe(12);
    expect(chaseLine(s)).toContain('12');
    // 7 used to win against the old target of 7; now it doesn't.
    s = play([...chase, run(6), run(1)]);
    expect(s.ended).toBe(false);
    s = play([...chase, run(6), run(6)]);
    expect(s).toMatchObject({ ended: true, winner: 'B' });
    expect(cricketHeadline(s)).toEqual([11, 12]);
  });
});

// The Manual form starts from the ball-by-ball totals (Super Overs left out).
describe('cricketSideTotals', () => {
  it('runs, wickets and balls per side; the Super Over does not change them', () => {
    const s = play([...tied, ...open('b1', 'b2', 'a9'), run(6), ...dots(5), ...open('a1', 'a2', 'b9'), run(6), run(1)]);
    expect(cricketSideTotals(s)).toEqual({ A: { runs: 4, wickets: 0, balls: 1 }, B: { runs: 4, wickets: 0, balls: 1 } });
    expect(s.winner).toBe('A');
  });
});
