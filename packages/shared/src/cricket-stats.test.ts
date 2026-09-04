import { describe, expect, it } from 'vitest';
import { cricketPresetByKey } from './cricket-rules.js';
import { foldCricket, type CricketEvent, type CricketLog } from './cricket-engine.js';
import {
  bestBowlingLine, cricketScorecard, foldCricketCareer, highScoreLine,
  type BattingRow, type BowlingRow, type FieldingRow,
} from './cricket-stats.js';

const fmt = (k: string) => cricketPresetByKey(k)!;
const dots = (n: number, over?: Partial<CricketEvent>): CricketLog =>
  Array.from({ length: n }, () => ({ t: 'ball', runs: 0, ...over } as CricketEvent));

const bat = (o: Partial<BattingRow>): BattingRow => ({
  userId: 'p1', innings: 1, batPosition: 1, runs: 0, ballsFaced: 0, fours: 0, sixes: 0,
  dismissal: 'not_out', bowlerId: null, fielderId: null, ...o,
});
const bowl = (o: Partial<BowlingRow>): BowlingRow => ({
  userId: 'b1', innings: 1, ballsBowled: 0, maidens: 0, runsConceded: 0,
  wickets: 0, wides: 0, noBalls: 0, dots: 0, ...o,
});
const field = (o: Partial<FieldingRow>): FieldingRow => ({
  userId: 'f1', innings: 1, catches: 0, stumpings: 0, runOuts: 0, drops: 0, ...o,
});

describe('the scorecard, off the ball log', () => {
  const f = fmt('cricket_super_over');

  it('splits one match into batting, bowling and fielding rows', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 4, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1' },
      { t: 'ball', runs: 0, wicket: { how: 'caught', fielderId: 'f1' }, nextBatterId: 'p3' },
      ...dots(4),
    ]);
    const card = cricketScorecard(r.state);

    expect(card.batting.find((b) => b.userId === 'p1')).toMatchObject({
      runs: 4, fours: 1, dismissal: 'caught', bowlerId: 'b1', fielderId: 'f1', innings: 1,
    });
    expect(card.bowling.find((b) => b.userId === 'b1')).toMatchObject({ wickets: 1, ballsBowled: 6 });
    expect(card.fielding.find((x) => x.userId === 'f1')).toMatchObject({ catches: 1 });
  });

  it('files each person on the right side, batters and bowlers alike', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 1, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1' },
    ]);
    const card = cricketScorecard(r.state);
    expect(card.sideOf.get('p1')).toBe('A');
    expect(card.sideOf.get('b1')).toBe('B');   // bowling for the other side
    expect([...card.appeared].sort()).toEqual(['b1', 'p1', 'p2']);
  });

  it('reads fielding OFF the dismissals rather than counting it twice', () => {
    // Two tallies of the same facts could disagree; one cannot.
    const r = foldCricket(fmt('cricket_t20'), [
      { t: 'ball', runs: 0, strikerId: 'p1', bowlerId: 'b1', wicket: { how: 'caught', fielderId: 'f1' }, nextBatterId: 'p2' },
      { t: 'ball', runs: 0, strikerId: 'p2', bowlerId: 'b1', wicket: { how: 'stumped', fielderId: 'wk' }, nextBatterId: 'p3' },
      { t: 'ball', runs: 0, strikerId: 'p3', bowlerId: 'b1', wicket: { how: 'run_out', fielderId: 'f1' }, nextBatterId: 'p4' },
    ]);
    const card = cricketScorecard(r.state);
    expect(card.fielding.find((x) => x.userId === 'f1')).toMatchObject({ catches: 1, runOuts: 1 });
    expect(card.fielding.find((x) => x.userId === 'wk')).toMatchObject({ stumpings: 1 });
  });

  it('gives a caught-and-bowled to the bowler as one catch', () => {
    const r = foldCricket(fmt('cricket_t20'), [
      { t: 'ball', runs: 0, strikerId: 'p1', bowlerId: 'b1',
        wicket: { how: 'caught_and_bowled', fielderId: 'b1' }, nextBatterId: 'p2' },
    ]);
    const card = cricketScorecard(r.state);
    expect(card.fielding.find((x) => x.userId === 'b1')).toMatchObject({ catches: 1 });
    expect(card.bowling.find((b) => b.userId === 'b1')!.wickets).toBe(1);
  });

  it('marks the squad members who never came to the crease', () => {
    // A DNB row and no row at all are different: the first says they were picked.
    const r = foldCricket(fmt('cricket_t20'), [
      { t: 'ball', runs: 1, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1' },
    ]);
    const card = cricketScorecard(r.state, { A: ['p1', 'p2', 'p3', 'p4'], B: ['b1'] });
    const dnb = card.batting.filter((b) => b.dismissal === 'did_not_bat').map((b) => b.userId);
    expect(dnb.sort()).toEqual(['p3', 'p4']);
    expect(card.batting.find((b) => b.userId === 'p3')!.batPosition).toBeGreaterThan(2);
  });

  it('carries the team-level innings row, extras itemised', () => {
    const r = foldCricket(fmt('cricket_super_over'), [
      { t: 'ball', runs: 0, extra: 'wide' },
      { t: 'ball', runs: 0, extra: 'bye', extraRuns: 2 },
      ...dots(5),
    ]);
    const inn = cricketScorecard(r.state).innings[0];
    // A total that cannot be broken into bat + extras does not balance.
    expect(inn).toMatchObject({
      innings: 1, battingSide: 'A', runs: 3, wides: 1, byes: 2, balls: 6, endedBy: 'overs',
    });
  });

  it('keeps a Test appearance as four separate innings rows', () => {
    const r = foldCricket(fmt('cricket_test'), [
      { t: 'ball', runs: 10, strikerId: 'p1', bowlerId: 'b1' },
      { t: 'endInnings', reason: 'declared' },
      { t: 'ball', runs: 5, strikerId: 'q1', bowlerId: 'c1' },
      { t: 'endInnings', reason: 'declared' },
      { t: 'ball', runs: 20, strikerId: 'p1', bowlerId: 'c1' },
      { t: 'endInnings', reason: 'declared' },
    ]);
    const card = cricketScorecard(r.state);
    // Same person, two batting rows - which is the reason the grain is per innings.
    const p1 = card.batting.filter((b) => b.userId === 'p1');
    expect(p1.map((b) => b.innings)).toEqual([1, 3]);
    expect(p1.map((b) => b.runs)).toEqual([10, 20]);
  });
});

describe('the career fold', () => {
  it('averages on DISMISSALS, not on innings', () => {
    // 120 runs, three innings, one not out => 120 / 2 = 60, not 40. Every cricket
    // average in the world works this way and using innings understates a finisher.
    const c = foldCricketCareer(3, [
      bat({ runs: 50, dismissal: 'bowled', ballsFaced: 40 }),
      bat({ runs: 30, dismissal: 'caught', ballsFaced: 25 }),
      bat({ runs: 40, dismissal: 'not_out', ballsFaced: 35 }),
    ], [], []);
    expect(c.runs).toBe(120);
    expect(c.inningsBatted).toBe(3);
    expect(c.notOuts).toBe(1);
    expect(c.battingAverage).toBe(60);
  });

  it('never counts a did-not-bat as an innings', () => {
    const c = foldCricketCareer(2, [
      bat({ runs: 40, dismissal: 'lbw', ballsFaced: 30 }),
      bat({ dismissal: 'did_not_bat' }),
    ], [], []);
    expect(c.inningsBatted).toBe(1);
    expect(c.battingAverage).toBe(40);
  });

  it('a duck is OUT for nought; not out for nought is not a duck', () => {
    const c = foldCricketCareer(3, [
      bat({ runs: 0, dismissal: 'bowled' }),
      bat({ runs: 0, dismissal: 'not_out' }),
      bat({ runs: 0, dismissal: 'did_not_bat' }),
    ], [], []);
    expect(c.ducks).toBe(1);
  });

  it('prefers an unbeaten high score when the scores are level', () => {
    // 84* betters 84, which is how cricket ranks them.
    const c = foldCricketCareer(2, [
      bat({ runs: 84, dismissal: 'caught' }),
      bat({ runs: 84, dismissal: 'not_out' }),
    ], [], []);
    expect(highScoreLine(c)).toBe('84*');
    const beaten = foldCricketCareer(2, [
      bat({ runs: 84, dismissal: 'not_out' }),
      bat({ runs: 91, dismissal: 'caught' }),
    ], [], []);
    expect(highScoreLine(beaten)).toBe('91');
  });

  it('counts a hundred once, not as a hundred and a fifty', () => {
    const c = foldCricketCareer(2, [
      bat({ runs: 112, dismissal: 'caught' }),
      bat({ runs: 63, dismissal: 'lbw' }),
    ], [], []);
    expect(c.hundreds).toBe(1);
    expect(c.fifties).toBe(1);
  });

  it('ranks best bowling by wickets first and runs second', () => {
    // 5/23 betters 5/40, and 5/40 betters 4/10.
    const c = foldCricketCareer(3, [], [
      bowl({ wickets: 4, runsConceded: 10, ballsBowled: 24 }),
      bowl({ wickets: 5, runsConceded: 40, ballsBowled: 24 }),
      bowl({ wickets: 5, runsConceded: 23, ballsBowled: 24 }),
    ], []);
    expect(bestBowlingLine(c)).toBe('5/23');
    expect(c.fiveWicketHauls).toBe(2);
    expect(c.wickets).toBe(14);
  });

  it('economy is per SIX balls, from the ball count', () => {
    // 30 runs off 24 balls = 4 overs = 7.5 an over. Decimal overs get this wrong.
    const c = foldCricketCareer(1, [], [bowl({ ballsBowled: 24, runsConceded: 30, wickets: 2 })], []);
    expect(c.economy).toBe(7.5);
    expect(c.bowlingAverage).toBe(15);
  });

  it('leaves an average undefined rather than zero when nobody is out', () => {
    // A zero average reads as "terrible", not as "never dismissed".
    const c = foldCricketCareer(1, [bat({ runs: 40, dismissal: 'not_out', ballsFaced: 20 })], [], []);
    expect(c.battingAverage).toBeNull();
    expect(c.strikeRate).toBe(200);
    expect(c.bowlingAverage).toBeNull();
    expect(c.economy).toBeNull();
  });

  it('does not count a retirement as a dismissal', () => {
    // Retired hurt is not out; it must not deflate the average.
    const c = foldCricketCareer(1, [bat({ runs: 60, dismissal: 'retired', ballsFaced: 40 })], [], []);
    expect(c.notOuts).toBe(1);
    expect(c.battingAverage).toBeNull();
  });

  it('sums the fielding across innings', () => {
    const c = foldCricketCareer(2, [], [], [
      field({ catches: 2, runOuts: 1 }),
      field({ innings: 3, catches: 1, stumpings: 2 }),
    ]);
    expect(c).toMatchObject({ catches: 3, runOuts: 1, stumpings: 2 });
  });

  it('counts matches from the caller, not from the innings rows', () => {
    // Two innings in one Test is one appearance, not two.
    const c = foldCricketCareer(1, [
      bat({ innings: 1, runs: 20, dismissal: 'bowled' }),
      bat({ innings: 3, runs: 30, dismissal: 'bowled' }),
    ], [], []);
    expect(c.matches).toBe(1);
    expect(c.inningsBatted).toBe(2);
  });

  it('shows an em dash rather than 0/0 for somebody who has not bowled', () => {
    const c = foldCricketCareer(1, [bat({ runs: 5, dismissal: 'bowled' })], [], []);
    expect(bestBowlingLine(c)).toBe('—');
    expect(highScoreLine(foldCricketCareer(0, [], [], []))).toBe('—');
  });
});
