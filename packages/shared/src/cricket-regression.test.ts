import { describe, expect, it } from 'vitest';
import {
  CRICKET_PRESETS, cricketPresetByKey, cricketFormatSchema, oversOf,
  type CricketFormat,
} from './cricket-rules.js';
import {
  aggregateFor, chaseLine, cricketHeadline, economy, extrasLine, foldCricket,
  inningsLine, oversLeft, runRate, strikeRate, undoCricket,
  type BattingLine, type BowlingLine, type CricketEvent, type CricketLog,
  type CricketState, type InningsState,
} from './cricket-engine.js';
import { cricketScorecard, foldCricketCareer } from './cricket-stats.js';

// ============================================================================
// CRICKET REGRESSION SUITE — the match-day one.
//
// The unit tests next door pin single behaviours down. This file plays WHOLE
// MATCHES, in every format on the shelf, and asserts the things a scorer would be
// sacked for getting wrong. It exists because a match is tomorrow and the console
// is going to production: the question it answers is not "does the fold work" but
// "is there any sequence of taps a real over can produce that leaves the scorecard
// wrong, the console stuck, or a player's figures misattributed".
//
// THE FOUR INVARIANTS every scenario below is checked against:
//
//   BALANCE   innings runs === sum of batters' runs + itemised extras.
//             If these disagree the scorecard cannot be printed, full stop.
//   BOWLING   runs charged to bowlers + byes + leg-byes + penalties === innings runs.
//   LEGALITY  legal balls bowled === sum of bowlers' ballsBowled, and an innings
//             never exceeds its overs.
//   PROGRESS  a live innings always has somebody able to face the next ball, or has
//             ended. A console that can be neither scored nor closed is the worst
//             failure mode there is — it strands a real match.
// ============================================================================

const fmt = (k: string): CricketFormat => cricketPresetByKey(k)!;

const T20 = () => fmt('cricket_t20');
const T10 = () => fmt('cricket_t10');
const ODI = () => fmt('cricket_odi');
const TEST = () => fmt('cricket_test');
const SUPER = () => fmt('cricket_super_over');
const BOX8 = () => fmt('box_6ov_8');
const BOXLMS = () => fmt('box_5ov_6_lms');
const BOX4 = () => fmt('box_4ov_4ball');

// ---- tap helpers: one call per tap a scorer would actually make ----

const open = (striker: string, nonStriker: string, bowlerId: string): CricketLog => [
  { t: 'setBatter', end: 'striker', batterId: striker },
  { t: 'setBatter', end: 'nonStriker', batterId: nonStriker },
  { t: 'setBowler', bowlerId },
];
const run = (n: number): CricketEvent => ({ t: 'ball', runs: n });
const dot = (): CricketEvent => ({ t: 'ball', runs: 0 });
const dots = (n: number): CricketLog => Array.from({ length: n }, dot);
const wide = (extraRuns = 0): CricketEvent => ({ t: 'ball', runs: 0, extra: 'wide', extraRuns });
const noball = (offBat = 0, extraRuns = 0): CricketEvent =>
  ({ t: 'ball', runs: offBat, extra: 'noball', extraRuns });
const bye = (n: number): CricketEvent => ({ t: 'ball', runs: 0, extra: 'bye', extraRuns: n });
const legbye = (n: number): CricketEvent => ({ t: 'ball', runs: 0, extra: 'legbye', extraRuns: n });
const out = (
  how: any = 'bowled',
  o: Partial<{ next: string; fielder: string; end: 'striker' | 'nonStriker'; runs: number }> = {},
): CricketEvent => ({
  t: 'ball',
  runs: o.runs ?? 0,
  wicket: { how, ...(o.end ? { end: o.end } : {}), ...(o.fielder ? { fielderId: o.fielder } : {}) },
  ...(o.next ? { nextBatterId: o.next } : {}),
});
const bowler = (id: string): CricketEvent => ({ t: 'setBowler', bowlerId: id });

const play = (f: CricketFormat, log: CricketLog, firstBatting: 'A' | 'B' = 'A'): CricketState =>
  foldCricket(f, log, firstBatting).state;

// ---- the invariants ----

const battedRuns = (inn: InningsState) => inn.batting.reduce((n, b) => n + b.runs, 0);
const itemisedExtras = (inn: InningsState) =>
  inn.wides + inn.noBalls + inn.byes + inn.legByes + inn.penaltyRuns;

/** BALANCE — a scorecard that does not add up cannot be printed. */
function expectBalance(inn: InningsState, note = '') {
  expect(
    battedRuns(inn) + itemisedExtras(inn),
    `BALANCE innings ${inn.innings}${note ? ` (${note})` : ''}: `
    + `bat ${battedRuns(inn)} + extras ${itemisedExtras(inn)} != total ${inn.runs}`,
  ).toBe(inn.runs);
}

/** BOWLING — every run in the innings is charged somewhere, and only once. */
function expectBowlingBalance(inn: InningsState, note = '') {
  const charged = inn.bowling.reduce((n, b) => n + b.runsConceded, 0);
  expect(
    charged + inn.byes + inn.legByes + inn.penaltyRuns,
    `BOWLING innings ${inn.innings}${note ? ` (${note})` : ''}: `
    + `charged ${charged} + b/lb/pen ${inn.byes + inn.legByes + inn.penaltyRuns} != total ${inn.runs}`,
  ).toBe(inn.runs);
}

/** LEGALITY — the over count and the bowling figures are the same count. */
function expectLegality(f: CricketFormat, inn: InningsState) {
  const bowled = inn.bowling.reduce((n, b) => n + b.ballsBowled, 0);
  expect(bowled, `LEGALITY innings ${inn.innings}: bowlers bowled ${bowled}, innings counted ${inn.balls}`)
    .toBe(inn.balls);
  if (f.oversPerInnings !== null) {
    expect(inn.balls, `LEGALITY innings ${inn.innings} overran its overs`)
      .toBeLessThanOrEqual(f.oversPerInnings * f.ballsPerOver);
  }
}

/** PROGRESS — a live innings can always be given another ball. */
function expectPlayable(f: CricketFormat, s: CricketState) {
  const inn = s.innings[s.current];
  if (!inn || inn.ended || s.ended) return;
  // An innings nobody has bowled a ball in yet is waiting to be opened, which is
  // what the console asks for. Only an innings UNDER WAY can be stranded.
  if (inn.balls === 0 && inn.wickets === 0 && !inn.strikerId && !inn.nonStrikerId) return;
  const atCrease = [inn.strikerId, inn.nonStrikerId].filter(Boolean).length;
  const needed = f.lastManStands ? 1 : 2;
  expect(
    atCrease,
    `PROGRESS innings ${inn.innings}: ${inn.wickets} down, innings open, but only `
    + `${atCrease} batter(s) at the crease — the console cannot accept another ball`,
  ).toBeGreaterThanOrEqual(needed);
}

/** All four, over every innings of a finished or in-flight match. */
function expectSound(f: CricketFormat, s: CricketState, note = '') {
  for (const inn of s.innings) {
    expectBalance(inn, note);
    expectBowlingBalance(inn, note);
    expectLegality(f, inn);
  }
  expectPlayable(f, s);
}

const batOf = (inn: InningsState, id: string): BattingLine =>
  inn.batting.find((b) => b.playerId === id)!;
const bowlOf = (inn: InningsState, id: string): BowlingLine =>
  inn.bowling.find((b) => b.playerId === id)!;

// ============================================================================
// 1. THE SHELF — every format on it is one somebody could actually play
// ============================================================================

describe('1. the shelf every format is picked from', () => {
  it('1.1 every preset is a legal format the database would accept', () => {
    for (const p of CRICKET_PRESETS) {
      const r = cricketFormatSchema.safeParse(p);
      expect(r.success, `${p.presetKey}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('1.2 no preset asks for more wickets than it has batters to lose', () => {
    for (const p of CRICKET_PRESETS) {
      const ceiling = p.lastManStands ? p.playersPerSide : p.playersPerSide - 1;
      expect(p.wicketsToEndInnings, `${p.presetKey}`).toBeLessThanOrEqual(ceiling);
    }
  });

  it('1.3 no preset asks a bowler for more overs than the innings has', () => {
    for (const p of CRICKET_PRESETS) {
      if (p.maxOversPerBowler === null || p.oversPerInnings === null) continue;
      expect(p.maxOversPerBowler, `${p.presetKey}`).toBeLessThanOrEqual(p.oversPerInnings);
    }
  });

  it('1.4 every limited-overs preset can be bowled out by its own bowlers', () => {
    // If max-per-bowler x (side - 1) < overs, the innings physically cannot be bowled.
    for (const p of CRICKET_PRESETS) {
      if (p.maxOversPerBowler === null || p.oversPerInnings === null) continue;
      const capacity = p.maxOversPerBowler * (p.playersPerSide - 1);
      expect(capacity, `${p.presetKey}: ${p.playersPerSide - 1} bowlers x ${p.maxOversPerBowler} `
        + `= ${capacity} overs, innings needs ${p.oversPerInnings}`)
        .toBeGreaterThanOrEqual(p.oversPerInnings);
    }
  });

  it('1.5 the Test preset is unlimited, not a twenty-over match wearing its name', () => {
    expect(TEST().oversPerInnings).toBeNull();
    expect(TEST().inningsPerSide).toBe(2);
  });

  it('1.6 box cricket is on the shelf under its own sport', () => {
    const box = CRICKET_PRESETS.filter((p) => p.sport === 'box cricket');
    expect(box.length).toBeGreaterThanOrEqual(3);
    for (const p of box) expect(p.oversPerInnings).toBeLessThanOrEqual(6);
  });
});

// ============================================================================
// 2. THE DELIVERY — every outcome one ball can have
// ============================================================================

describe('2. one delivery, every outcome it can have', () => {
  const f = T20();

  it('2.1 a dot ball: nothing moves but the ball count', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), dot()]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(0);
    expect(inn.balls).toBe(1);
    expect(batOf(inn, 'b1').ballsFaced).toBe(1);
    expect(bowlOf(inn, 'o1').dots).toBe(1);
    expectSound(f, s);
  });

  it('2.2 runs off the bat reach the batter, the total and the bowler', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4)]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(4);
    expect(batOf(inn, 'b1').runs).toBe(4);
    expect(batOf(inn, 'b1').fours).toBe(1);
    expect(bowlOf(inn, 'o1').runsConceded).toBe(4);
    expectSound(f, s);
  });

  it('2.3 a six is a six and not two boundaries', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), run(6)]);
    const inn = s.innings[0];
    expect(batOf(inn, 'b1').sixes).toBe(1);
    expect(batOf(inn, 'b1').fours).toBe(0);
    expectSound(f, s);
  });

  it("2.4 a wide is never the batter's run and never the batter's ball", () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), wide()]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(1);
    expect(inn.wides).toBe(1);
    expect(batOf(inn, 'b1').runs).toBe(0);
    expect(batOf(inn, 'b1').ballsFaced).toBe(0);
    expect(inn.balls).toBe(0);
    expect(bowlOf(inn, 'o1').wides).toBe(1);
    expect(bowlOf(inn, 'o1').runsConceded).toBe(1);
    expectSound(f, s);
  });

  it('2.5 four byes off a wide are five to the side and nothing to anybody', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), wide(4)]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(5);
    expect(inn.wides).toBe(5);
    expect(batOf(inn, 'b1').runs).toBe(0);
    expect(bowlOf(inn, 'o1').runsConceded).toBe(5);
    expectSound(f, s);
  });

  it('2.6 a no-ball is a ball the batter faced, and runs off it are theirs', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(4)]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(5);
    expect(inn.noBalls).toBe(1);
    expect(batOf(inn, 'b1').runs).toBe(4);
    expect(batOf(inn, 'b1').fours).toBe(1);
    expect(batOf(inn, 'b1').ballsFaced).toBe(1);
    expect(inn.balls).toBe(0);
    expect(bowlOf(inn, 'o1').runsConceded).toBe(5);
    expectSound(f, s);
  });

  it('2.7 BYES OFF A NO-BALL are itemised, not swallowed', () => {
    // A no-ball the keeper then lets through for two. The total is 1 + 2 = 3, and
    // every one of those three has to appear somewhere in the extras, or the card
    // will not add up.
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(0, 2)]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(3);
    expectBalance(inn, 'byes off a no-ball');
    expectBowlingBalance(inn, 'byes off a no-ball');
  });

  it("2.8 byes are the team's runs, not the batter's and not the bowler's", () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), bye(2)]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(2);
    expect(inn.byes).toBe(2);
    expect(batOf(inn, 'b1').runs).toBe(0);
    expect(batOf(inn, 'b1').ballsFaced).toBe(1);
    expect(bowlOf(inn, 'o1').runsConceded).toBe(0);
    expect(inn.balls).toBe(1);
    expectSound(f, s);
  });

  it('2.9 leg-byes behave as byes but are itemised apart', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), legbye(1)]);
    const inn = s.innings[0];
    expect(inn.legByes).toBe(1);
    expect(inn.byes).toBe(0);
    expect(bowlOf(inn, 'o1').runsConceded).toBe(0);
    expectSound(f, s);
  });

  it('2.10 a bye is not a dot for the bowler — runs were scored off the over', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), bye(2)]);
    expect(bowlOf(s.innings[0], 'o1').dots).toBe(0);
  });

  it("2.11 box cricket's two-run wide is worth two", () => {
    const b = BOX4();
    const s = play(b, [...open('b1', 'b2', 'o1'), wide()]);
    expect(s.innings[0].runs).toBe(2);
    expect(s.innings[0].wides).toBe(2);
    expectSound(b, s);
  });
});

// ============================================================================
// 3. THE OVER — six legal balls, and what does and does not advance it
// ============================================================================

describe('3. the over', () => {
  it('3.1 an over with two wides is eight deliveries long', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), wide(), ...dots(3), wide(), ...dots(3)]);
    const inn = s.innings[0];
    expect(inn.balls).toBe(6);
    expect(inn.overBalls).toBe(0);
    expect(bowlOf(inn, 'o1').ballsBowled).toBe(6);
    expectSound(f, s);
  });

  it('3.2 the end of an over crosses the strike and unseats the bowler', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6)]);
    const inn = s.innings[0];
    expect(inn.strikerId).toBe('b2');
    expect(inn.nonStrikerId).toBe('b1');
    expect(inn.bowlerId).toBeUndefined();
  });

  it('3.3 a single off the last ball crosses twice and so changes nothing', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(5), run(1)]);
    expect(s.innings[0].strikerId).toBe('b1');
  });

  it('3.4 a wide off the last ball does NOT end the over', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(5), wide()]);
    const inn = s.innings[0];
    expect(inn.balls).toBe(5);
    expect(inn.overBalls).toBe(5);
    expect(inn.bowlerId).toBe('o1');
    expect(inn.strikerId).toBe('b1');
  });

  it('3.5 a maiden is an over off which nothing was scored', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6)]);
    expect(bowlOf(s.innings[0], 'o1').maidens).toBe(1);
  });

  it('3.6 an over containing a wide is NOT a maiden', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), wide(), ...dots(6)]);
    expect(bowlOf(s.innings[0], 'o1').maidens).toBe(0);
  });

  it('3.7 an over of leg-byes is not a maiden either', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), legbye(1), ...dots(5)]);
    expect(bowlOf(s.innings[0], 'o1').maidens).toBe(0);
  });

  it('3.8 a wicket maiden is still a maiden', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(5), out('bowled', { next: 'b3' })]);
    const inn = s.innings[0];
    expect(bowlOf(inn, 'o1').maidens).toBe(1);
    expect(bowlOf(inn, 'o1').wickets).toBe(1);
  });

  it("3.9 box cricket's four-ball over ends after four", () => {
    const b = BOX4();
    const s = play(b, [...open('b1', 'b2', 'o1'), ...dots(4)]);
    const inn = s.innings[0];
    expect(inn.balls).toBe(4);
    expect(inn.overBalls).toBe(0);
    expect(inn.bowlerId).toBeUndefined();
    expect(oversOf(4, 4)).toBe('1.0');
  });

  it('3.10 the over count is balls, never a decimal that can be added wrongly', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), bowler('o2'), ...dots(4)]);
    expect(s.innings[0].balls).toBe(10);
    expect(inningsLine(s.innings[0], 6)).toBe('0/0 (1.4)');
  });

  it('3.11 A BOWLER MAY NOT BOWL CONSECUTIVE OVERS', () => {
    // The oldest rule in the book. Naming the same bowler again must be refused, or
    // the console will happily let one person bowl the whole innings.
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), bowler('o1'), dot()]);
    const inn = s.innings[0];
    expect(
      bowlOf(inn, 'o1').ballsBowled,
      'o1 bowled the 1st over and was allowed to bowl the 2nd',
    ).toBe(6);
  });

  it('3.12 a bowler who has bowled their allocation is no longer offered', () => {
    const f = T10(); // max 2 overs
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), bowler('o2'), ...dots(6), bowler('o1'), ...dots(6)]);
    const line = bowlOf(s.innings[0], 'o1');
    expect(oversLeft(f, line)).toBe(0);
    expect(oversLeft(TEST(), line)).toBeNull();
  });

  it('3.13 a bowler part-way through an over still has that over left to finish', () => {
    const f = T10();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), bowler('o2'), ...dots(6), bowler('o1'), ...dots(3)]);
    expect(oversLeft(f, bowlOf(s.innings[0], 'o1'))).toBe(1);
  });
});

// ============================================================================
// 4. THE STRIKE — who faces the next ball
// ============================================================================

describe('4. the strike', () => {
  const f = T20();

  it('4.1 odd runs cross, even runs do not', () => {
    expect(play(f, [...open('b1', 'b2', 'o1'), run(1)]).innings[0].strikerId).toBe('b2');
    expect(play(f, [...open('b1', 'b2', 'o1'), run(2)]).innings[0].strikerId).toBe('b1');
    expect(play(f, [...open('b1', 'b2', 'o1'), run(3)]).innings[0].strikerId).toBe('b2');
    expect(play(f, [...open('b1', 'b2', 'o1'), run(4)]).innings[0].strikerId).toBe('b1');
  });

  it('4.2 a single bye crosses the batters — they ran it', () => {
    expect(play(f, [...open('b1', 'b2', 'o1'), bye(1)]).innings[0].strikerId).toBe('b2');
  });

  it('4.3 a single leg-bye crosses too', () => {
    expect(play(f, [...open('b1', 'b2', 'o1'), legbye(1)]).innings[0].strikerId).toBe('b2');
  });

  it('4.4 a plain wide does not cross — nobody ran', () => {
    expect(play(f, [...open('b1', 'b2', 'o1'), wide()]).innings[0].strikerId).toBe('b1');
  });

  it('4.5 a wide they ran a single off DOES cross', () => {
    expect(play(f, [...open('b1', 'b2', 'o1'), wide(1)]).innings[0].strikerId).toBe('b2');
  });

  it('4.6 a single off a no-ball crosses', () => {
    expect(play(f, [...open('b1', 'b2', 'o1'), noball(1)]).innings[0].strikerId).toBe('b2');
  });

  it('4.7 the strike can be corrected without touching the score', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4), { t: 'swapEnds' }]);
    expect(s.innings[0].strikerId).toBe('b2');
    expect(s.innings[0].runs).toBe(4);
  });

  it('4.8 a new batter takes strike when the striker is out', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('bowled', { next: 'b3' })]);
    expect(s.innings[0].strikerId).toBe('b3');
    expect(s.innings[0].nonStrikerId).toBe('b2');
  });

  it('4.9 a new batter goes to the OTHER end when the non-striker is run out', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('run_out', { end: 'nonStriker', next: 'b3' })]);
    expect(s.innings[0].strikerId).toBe('b1');
    expect(s.innings[0].nonStrikerId).toBe('b3');
  });

  it('4.10 a wicket off the last ball: the new batter ends up NOT on strike', () => {
    // The incoming batter takes the striker's end, then the over ends and crosses
    // them. So the not-out batter faces the first ball of the next over.
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(5), out('bowled', { next: 'b3' })]);
    expect(s.innings[0].strikerId).toBe('b2');
    expect(s.innings[0].nonStrikerId).toBe('b3');
  });
});

// ============================================================================
// 5. WICKETS — all ten of them, and who gets the credit
// ============================================================================

describe('5. wickets', () => {
  const f = T20();

  it("5.1 bowled, LBW, stumped, hit wicket and c&b are the bowler's", () => {
    for (const how of ['bowled', 'lbw', 'stumped', 'hit_wicket', 'caught_and_bowled'] as const) {
      const s = play(f, [...open('b1', 'b2', 'o1'), out(how, { next: 'b3', fielder: 'o2' })]);
      expect(bowlOf(s.innings[0], 'o1').wickets, how).toBe(1);
      expect(batOf(s.innings[0], 'b1').dismissal, how).toBe(how);
    }
  });

  it("5.2 a catch is the bowler's wicket AND the fielder's catch", () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('caught', { next: 'b3', fielder: 'f7' })]);
    const inn = s.innings[0];
    expect(bowlOf(inn, 'o1').wickets).toBe(1);
    expect(batOf(inn, 'b1').fielderId).toBe('f7');
    const card = cricketScorecard(s);
    expect(card.fielding.find((x) => x.userId === 'f7')?.catches).toBe(1);
  });

  it("5.3 a run-out is NOT the bowler's wicket", () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('run_out', { next: 'b3', fielder: 'f4' })]);
    const inn = s.innings[0];
    expect(inn.wickets).toBe(1);
    expect(bowlOf(inn, 'o1').wickets).toBe(0);
    const card = cricketScorecard(s);
    expect(card.fielding.find((x) => x.userId === 'f4')?.runOuts).toBe(1);
  });

  it("5.4 obstructing and timed out are nobody's wicket", () => {
    for (const how of ['obstructing', 'timed_out'] as const) {
      const s = play(f, [...open('b1', 'b2', 'o1'), out(how, { next: 'b3' })]);
      expect(bowlOf(s.innings[0], 'o1').wickets, how).toBe(0);
      expect(s.innings[0].wickets, how).toBe(1);
    }
  });

  it('5.5 runs completed before a run-out count to the batter and the side', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('run_out', { runs: 2, next: 'b3', end: 'nonStriker' })]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(2);
    expect(batOf(inn, 'b1').runs).toBe(2);
    expectSound(f, s);
  });

  it('5.6 A CAUGHT BATTER IS CREDITED NO RUNS — they never completed them', () => {
    // If the console lets a "runs completed" value survive a change of dismissal, a
    // catch will silently award runs that were never made.
    const s = play(f, [...open('b1', 'b2', 'o1'),
      { t: 'ball', runs: 2, wicket: { how: 'caught', fielderId: 'f3' }, nextBatterId: 'b3' }]);
    const inn = s.innings[0];
    expect(inn.runs, 'a catch credited runs to the side').toBe(0);
    expect(batOf(inn, 'b1').runs, 'a catch credited runs to the batter').toBe(0);
  });

  it('5.7 a caught-and-bowled is one catch to the bowler, not two dismissals', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('caught_and_bowled', { next: 'b3', fielder: 'o1' })]);
    const card = cricketScorecard(s);
    expect(card.fielding.find((x) => x.userId === 'o1')?.catches).toBe(1);
    expect(s.innings[0].wickets).toBe(1);
  });

  it('5.8 a first-ball duck still appears on the scorecard', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), out('bowled', { next: 'b3' })]);
    const line = batOf(s.innings[0], 'b1');
    expect(line.runs).toBe(0);
    expect(line.ballsFaced).toBe(1);
    expect(line.out).toBe(true);
  });

  it('5.9 a retirement is not a dismissal and does not cost a wicket', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4), { t: 'retire', batterId: 'b1', nextBatterId: 'b3' }]);
    const inn = s.innings[0];
    expect(inn.wickets).toBe(0);
    expect(batOf(inn, 'b1').out).toBe(false);
    expect(batOf(inn, 'b1').dismissal).toBe('retired');
    expect(inn.strikerId).toBe('b3');
  });

  it('5.10 a retired batter may come back later in the innings', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'),
      run(4),
      { t: 'retire', batterId: 'b1', nextBatterId: 'b3' },
      out('bowled', { next: 'b1' }),
      run(2),
    ]);
    const line = batOf(s.innings[0], 'b1');
    expect(line.runs).toBe(6);
    expect(line.out).toBe(false);
  });

  it('5.11 a wicket off a no-ball can only be a run-out — the delivery was illegal', () => {
    // A batter cannot be bowled off a no-ball. This is the scorer's commonest illegal
    // entry, and the console must not accept it.
    const s = play(f, [...open('b1', 'b2', 'o1'),
      { t: 'ball', runs: 0, extra: 'noball', wicket: { how: 'bowled' }, nextBatterId: 'b3' }]);
    expect(s.innings[0].wickets, 'a batter was bowled off a no-ball').toBe(0);
  });

  it('5.12 a batter cannot be stumped or caught off a WIDE either — only run out or stumped', () => {
    // Stumped off a wide is legal cricket; caught off a wide is not, because the bat
    // never touched it.
    const s = play(f, [...open('b1', 'b2', 'o1'),
      { t: 'ball', runs: 0, extra: 'wide', wicket: { how: 'caught', fielderId: 'f2' }, nextBatterId: 'b3' }]);
    expect(s.innings[0].wickets, 'a batter was caught off a wide').toBe(0);
  });

  it('5.13 a stumping off a wide DOES stand', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'),
      { t: 'ball', runs: 0, extra: 'wide', wicket: { how: 'stumped', fielderId: 'k1' }, nextBatterId: 'b3' }]);
    expect(s.innings[0].wickets).toBe(1);
    expect(bowlOf(s.innings[0], 'o1').wickets).toBe(1);
  });
});

// ============================================================================
// 6. THE FREE HIT
// ============================================================================

describe('6. the free hit', () => {
  const f = T20(); // freeHitAfterNoBall: true

  it('6.1 a no-ball sets a free hit', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball()]);
    expect(s.innings[0].freeHit).toBe(true);
  });

  it('6.2 a wide off a free hit does NOT consume it', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(), wide()]);
    expect(s.innings[0].freeHit).toBe(true);
  });

  it('6.3 the next legal ball consumes it', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(), dot()]);
    expect(s.innings[0].freeHit).toBe(false);
  });

  it('6.4 a second no-ball renews it', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(), noball()]);
    expect(s.innings[0].freeHit).toBe(true);
  });

  it('6.5 A BATTER CANNOT BE BOWLED OFF A FREE HIT', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(), out('bowled', { next: 'b3' })]);
    expect(s.innings[0].wickets, 'a batter was bowled off a free hit').toBe(0);
  });

  it('6.6 A BATTER CANNOT BE CAUGHT OFF A FREE HIT', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(), out('caught', { next: 'b3', fielder: 'f3' })]);
    expect(s.innings[0].wickets, 'a batter was caught off a free hit').toBe(0);
  });

  it('6.7 a RUN-OUT off a free hit stands — that one is still on', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), noball(), out('run_out', { next: 'b3', fielder: 'f3' })]);
    expect(s.innings[0].wickets).toBe(1);
  });

  it('6.8 a format without free hits does not set one', () => {
    const b = BOX8();
    const s = play(b, [...open('b1', 'b2', 'o1'), noball()]);
    expect(s.innings[0].freeHit).toBe(false);
  });
});

// ============================================================================
// 7. THE INNINGS ENDS
// ============================================================================

describe('7. how an innings ends', () => {
  it('7.1 on overs', () => {
    const f = SUPER(); // one over
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6)]);
    expect(s.innings[0].ended).toBe(true);
    expect(s.innings[0].endedBy).toBe('overs');
  });

  it('7.2 on all out', () => {
    const f = SUPER(); // two wickets end it
    const s = play(f, [...open('b1', 'b2', 'o1'), out('bowled', { next: 'b3' }), out('bowled')]);
    expect(s.innings[0].ended).toBe(true);
    expect(s.innings[0].endedBy).toBe('all_out');
  });

  it('7.3 the moment the target is passed, not at the end of the over', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(4), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(4), run(1),
    ]);
    expect(s.innings[1].ended).toBe(true);
    expect(s.innings[1].endedBy).toBe('target');
    expect(s.innings[1].balls).toBe(2);
    expect(s.ended).toBe(true);
  });

  it('7.4 a target reached off a WIDE still ends the innings', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(1), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(1), wide(),
    ]);
    expect(s.innings[1].endedBy).toBe('target');
    expect(s.ended).toBe(true);
  });

  it('7.5 a declaration ends an innings that had overs left', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4), { t: 'endInnings', reason: 'declared' }]);
    expect(s.innings[0].endedBy).toBe('declared');
    expect(s.innings.length).toBe(2);
  });

  it('7.6 no ball can be scored into an innings that has ended', () => {
    const f = SUPER();
    const base: CricketLog = [...open('b1', 'b2', 'o1'), ...dots(6)];
    const c = play(f, [...base, ...open('c1', 'c2', 'p1'), run(2)]);
    expect(c.innings[0].runs).toBe(0);
    expect(c.innings[1].runs).toBe(2);
  });

  it('7.7 the chase target is one more than the runs already made', () => {
    const f = SUPER();
    const s = play(f, [...open('a1', 'a2', 'o1'), run(6), run(4), ...dots(4)]);
    expect(s.innings[0].runs).toBe(10);
    expect(s.innings[1].target).toBe(11);
    expect(chaseLine(s)).toBe('need 11 from 6 balls');
  });

  it('7.8 the chase line counts down in balls, not overs', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(6), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(2), dot(),
    ]);
    expect(chaseLine(s)).toBe('need 5 from 4 balls');
  });
});

// ============================================================================
// 8. THE RESULT — phrased the way cricket phrases it
// ============================================================================

describe('8. the result', () => {
  it('8.1 the side batting last wins BY WICKETS', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(4), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(6),
    ]);
    expect(s.winner).toBe('B');
    expect(s.margin).toBe('won by 2 wickets');
  });

  it('8.2 the side bowling last wins BY RUNS', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(6), run(6), ...dots(4),
      ...open('b1', 'b2', 'p1'), run(4), ...dots(5),
    ]);
    expect(s.winner).toBe('A');
    expect(s.margin).toBe('won by 8 runs');
  });

  it('8.3 one run is "1 run", not "1 runs"', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(2), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(1), ...dots(5),
    ]);
    expect(s.margin).toBe('won by 1 run');
  });

  it('8.4 one wicket is "1 wicket"', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(2), ...dots(5),
      ...open('b1', 'b2', 'p1'), out('bowled', { next: 'b3' }), run(4),
    ]);
    expect(s.margin).toBe('won by 1 wicket');
  });

  it('8.5 level scores is a TIE, and a tie is not a draw', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(4), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(4), ...dots(5),
    ]);
    expect(s.outcome).toBe('tie');
    expect(s.winner).toBeNull();
  });

  it('8.6 a tie in a format with a super over says so', () => {
    const f = T20(); // superOverOnTie
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(4), { t: 'endInnings', reason: 'declared' },
      ...open('b1', 'b2', 'p1'), run(4), { t: 'endInnings', reason: 'declared' },
    ]);
    expect(s.outcome).toBe('tie');
    expect(s.margin).toContain('super over');
  });

  it('8.7 the headline standings read is runs per side', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(6), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(4), ...dots(5),
    ]);
    expect(cricketHeadline(s)).toEqual([6, 4]);
    expect(aggregateFor(s, 'A')).toBe(6);
  });

  it('8.8 an abandoned match has no winner and is void, not a draw', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4), { t: 'end', reason: 'abandoned', winner: null }]);
    expect(s.ended).toBe(true);
    expect(s.winner).toBeNull();
    expect(s.outcome).toBe('void');
  });

  it('8.9 a concession names a winner', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4), { t: 'end', reason: 'conceded', winner: 'A' }]);
    expect(s.winner).toBe('A');
    expect(s.outcome).toBe('win');
  });

  it('8.10 the second innings batting side is the one that did not bat first', () => {
    const f = SUPER();
    const s = play(f, [...open('a1', 'a2', 'o1'), ...dots(6)], 'B');
    expect(s.innings[0].battingSide).toBe('B');
    expect(s.innings[1].battingSide).toBe('A');
  });
});

// ============================================================================
// 9. BOX CRICKET
// ============================================================================

describe('9. box cricket', () => {
  it('9.1 six overs, eight a side, seven wickets end it', () => {
    const b = BOX8();
    expect(b.oversPerInnings).toBe(6);
    expect(b.playersPerSide).toBe(8);
    expect(b.wicketsToEndInnings).toBe(7);
    expect(b.maxOversPerBowler).toBe(2);
  });

  it('9.2 a full six-over box innings tracks to thirty-six balls', () => {
    const b = BOX8();
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (let over = 0; over < 6; over += 1) {
      if (over > 0) log.push(bowler(`o${(over % 3) + 1}`));
      log.push(...dots(5), run(2));
    }
    const s = play(b, log);
    const inn = s.innings[0];
    expect(inn.balls).toBe(36);
    expect(inn.runs).toBe(12);
    expect(inn.ended).toBe(true);
    expect(inn.endedBy).toBe('overs');
    expectSound(b, s);
  });

  it('9.3 LAST MAN STANDS: the innings continues with one batter left', () => {
    const b = BOXLMS(); // 6 a side, 6 wickets end it, last man stands
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (const next of ['b3', 'b4', 'b5', 'b6']) log.push(out('bowled', { next }));
    log.push(out('bowled')); // fifth wicket, nobody left to come in
    const s = play(b, log);
    const inn = s.innings[0];
    expect(inn.wickets).toBe(5);
    expect(inn.ended, 'the innings ended early — last man stands was ignored').toBe(false);
    expectPlayable(b, s);
  });

  it('9.4 LAST MAN STANDS: the last batter can still score', () => {
    const b = BOXLMS();
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (const next of ['b3', 'b4', 'b5', 'b6']) log.push(out('bowled', { next }));
    log.push(out('bowled'));       // b6 out, b2 alone
    log.push(bowler('o1'), run(4));
    const s = play(b, log);
    const inn = s.innings[0];
    expect(inn.runs, 'the lone batter could not be credited a run').toBe(4);
    expect(batOf(inn, 'b2').runs).toBe(4);
    expectSound(b, s);
  });

  it('9.5 LAST MAN STANDS: the sixth wicket ends it', () => {
    const b = BOXLMS();
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (const next of ['b3', 'b4', 'b5', 'b6']) log.push(out('bowled', { next }));
    log.push(out('bowled'));
    log.push(bowler('o1'), out('bowled'));
    const s = play(b, log);
    expect(s.innings[0].wickets).toBe(6);
    expect(s.innings[0].ended).toBe(true);
    expect(s.innings[0].endedBy).toBe('all_out');
  });

  it('9.6 LAST MAN STANDS: an odd run does not strand the lone batter', () => {
    // With one batter there is nobody to cross with, so the strike must stay put
    // rather than swapping to an empty end.
    const b = BOXLMS();
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (const next of ['b3', 'b4', 'b5', 'b6']) log.push(out('bowled', { next }));
    log.push(out('bowled'), bowler('o1'), run(1));
    const s = play(b, log);
    expectPlayable(b, s);
    expect(s.innings[0].runs).toBe(1);
  });

  it('9.7 without last man stands, being one short ENDS the innings', () => {
    const b = BOX8(); // 8 a side, 7 wickets
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (const next of ['b3', 'b4', 'b5', 'b6', 'b7', 'b8']) log.push(out('bowled', { next }));
    log.push(bowler('o2'), out('bowled')); // the seventh falls in the second over
    const s = play(b, log);
    expect(s.innings[0].wickets).toBe(7);
    expect(s.innings[0].ended).toBe(true);
    expect(s.innings[0].endedBy).toBe('all_out');
  });

  it('9.8 four-ball overs: a whole innings is sixteen balls', () => {
    const b = BOX4();
    const log: CricketLog = [...open('b1', 'b2', 'o1')];
    for (let over = 0; over < 4; over += 1) {
      if (over > 0) log.push(bowler(`o${over + 1}`));
      log.push(...dots(3), run(2));
    }
    const s = play(b, log);
    expect(s.innings[0].balls).toBe(16);
    expect(s.innings[0].ended).toBe(true);
    expectSound(b, s);
  });

  it('9.9 a two-run wide in a four-ball over still does not advance it', () => {
    const b = BOX4();
    const s = play(b, [...open('b1', 'b2', 'o1'), wide(), wide(), ...dots(4)]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(4);
    expect(inn.balls).toBe(4);
    expect(bowlOf(inn, 'o1').ballsBowled).toBe(4);
    expectSound(b, s);
  });

  it('9.10 box cricket run rate is per ITS over, not per six', () => {
    const b = BOX4(); // four-ball overs
    const s = play(b, [...open('b1', 'b2', 'o1'), run(4), run(4), run(4), run(4)]);
    expect(runRate(s.innings[0], b.ballsPerOver)).toBe(16);
  });
});

// ============================================================================
// 10. CORRECTIONS — what a scorer does when they mis-tap
// ============================================================================

describe('10. corrections', () => {
  const f = T20();

  it('10.1 undo takes the ball back off the over', () => {
    const log: CricketLog = [...open('b1', 'b2', 'o1'), run(4), run(2)];
    const { state, log: back } = undoCricket(f, log);
    expect(state.innings[0].runs).toBe(4);
    expect(state.innings[0].balls).toBe(1);
    expect(back.length).toBe(log.length - 1);
  });

  it('10.2 undo across the end of an over restores the strike and the bowler', () => {
    const log: CricketLog = [...open('b1', 'b2', 'o1'), ...dots(6)];
    const { state } = undoCricket(f, log);
    expect(state.innings[0].strikerId).toBe('b1');
    expect(state.innings[0].bowlerId).toBe('o1');
    expect(state.innings[0].overBalls).toBe(5);
  });

  it('10.3 undo across the end of an INNINGS reopens it', () => {
    const sf = SUPER();
    const log: CricketLog = [...open('b1', 'b2', 'o1'), ...dots(6)];
    const { state } = undoCricket(sf, log);
    expect(state.innings.length).toBe(1);
    expect(state.innings[0].ended).toBe(false);
    expect(state.current).toBe(0);
  });

  it('10.4 undoing a wicket gives the batter back', () => {
    const log: CricketLog = [...open('b1', 'b2', 'o1'), out('bowled', { next: 'b3' })];
    const { state } = undoCricket(f, log);
    expect(state.innings[0].wickets).toBe(0);
    expect(state.innings[0].strikerId).toBe('b1');
    expect(batOf(state.innings[0], 'b1').out).toBe(false);
  });

  it('10.5 undoing all the way back leaves an empty, scoreable innings', () => {
    let log: CricketLog = [...open('b1', 'b2', 'o1'), run(4), wide(), out('bowled', { next: 'b3' })];
    while (log.length) ({ log } = undoCricket(f, log));
    const s = play(f, log);
    expect(s.innings[0].runs).toBe(0);
    expect(s.innings[0].balls).toBe(0);
    expect(s.innings.length).toBe(1);
  });

  it("10.6 penalty runs go to the side and to nobody's average", () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), { t: 'penalty', side: 'A', runs: 5 }]);
    const inn = s.innings[0];
    expect(inn.runs).toBe(5);
    expect(inn.penaltyRuns).toBe(5);
    expect(batOf(inn, 'b1').runs).toBe(0);
    expectSound(f, s);
  });

  it('10.7 PENALTY RUNS AGAINST THE BATTING SIDE reach the other side', () => {
    // Five penalty runs awarded against the batting side belong to the OPPOSITION.
    // Dropping them on the floor loses runs that decide close matches.
    const s = play(f, [...open('b1', 'b2', 'o1'), { t: 'penalty', side: 'B', runs: 5 }], 'A');
    expect(
      aggregateFor(s, 'B'),
      'five penalty runs awarded against the batting side went nowhere',
    ).toBe(5);
  });

  it('10.7b a penalty awarded before a side bats opens their innings account', () => {
    // Five against the side batting first belong to the side batting second, who
    // have no innings yet. They must appear when that innings starts, not be held
    // somewhere the scoreboard never reads.
    const sf = SUPER();
    const s = play(sf, [
      ...open('a1', 'a2', 'o1'), run(4), { t: 'penalty', side: 'B', runs: 5 }, ...dots(5),
      ...open('b1', 'b2', 'p1'),
    ], 'A');
    expect(s.innings[1].runs).toBe(5);
    expect(s.innings[1].penaltyRuns).toBe(5);
    expect(aggregateFor(s, 'B')).toBe(5);
    expectBalance(s.innings[1], 'penalty carried into the next innings');
  });

  it('10.7c a penalty in the LAST innings still counts towards the result', () => {
    const sf = SUPER();
    const s = play(sf, [
      ...open('a1', 'a2', 'o1'), run(2), ...dots(5),
      ...open('b1', 'b2', 'p1'), { t: 'penalty', side: 'A', runs: 5 }, ...dots(6),
    ], 'A');
    expect(aggregateFor(s, 'A')).toBe(7);
    expect(s.winner).toBe('A');
  });

  it('10.11 a delivery with nobody bowling it is refused, not silently uncounted', () => {
    // The over ended and the scorer kept tapping. Counted, the ball lands in the
    // over count and in no bowling figure, and the two disagree for the rest of the
    // innings with nothing on screen saying so.
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), run(4)]);
    expect(s.innings[0].balls, 'a ball was counted with no bowler').toBe(6);
    expect(s.innings[0].runs).toBe(0);
    expectLegality(f, s.innings[0]);
  });

  it("10.12 naming the previous over's bowler again is refused", () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), bowler('o1')]);
    expect(s.innings[0].bowlerId, 'the same bowler was given consecutive overs').toBeUndefined();
    expect(s.innings[0].lastOverBowlerId).toBe('o1');
  });

  it('10.13 a different bowler is accepted, and may bowl the over after next', () => {
    const f = T20();
    const s = play(f, [...open('b1', 'b2', 'o1'), ...dots(6), bowler('o2'), ...dots(6), bowler('o1'), dot()]);
    expect(s.innings[0].bowlerId).toBe('o1');
    expect(s.innings[0].balls).toBe(13);
    expectLegality(f, s.innings[0]);
  });

  it('10.8 a mis-recorded striker is corrected without moving the score', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'), run(4),
      { t: 'setBatter', end: 'striker', batterId: 'b3' }, run(2)]);
    const inn = s.innings[0];
    expect(batOf(inn, 'b1').runs).toBe(4);
    expect(batOf(inn, 'b3').runs).toBe(2);
    expect(inn.runs).toBe(6);
    expectSound(f, s);
  });

  it('10.9 a delivery that names its people overrides the inherited state', () => {
    const s = play(f, [...open('b1', 'b2', 'o1'),
      { t: 'ball', runs: 4, strikerId: 'b5', nonStrikerId: 'b6', bowlerId: 'o9' }]);
    const inn = s.innings[0];
    expect(batOf(inn, 'b5').runs).toBe(4);
    expect(bowlOf(inn, 'o9').runsConceded).toBe(4);
  });

  it('10.10 the fold is pure — replaying the same log gives the same state', () => {
    const log: CricketLog = [...open('b1', 'b2', 'o1'), run(4), wide(2), noball(6),
      out('caught', { next: 'b3', fielder: 'f2' }), bye(1), ...dots(4)];
    expect(JSON.stringify(play(f, log))).toBe(JSON.stringify(play(f, log)));
  });
});

// ============================================================================
// 11. THE TEST MATCH — two innings a side
// ============================================================================

describe('11. two innings a side', () => {
  const f = TEST();

  it('11.1 plays four innings before deciding anything', () => {
    const log: CricketLog = [];
    for (let i = 0; i < 4; i += 1) {
      log.push(...open(`p${i}1`, `p${i}2`, `q${i}`), run(4), { t: 'endInnings', reason: 'declared' });
    }
    const s = play(f, log);
    expect(s.innings.length).toBe(4);
    expect(s.ended).toBe(true);
  });

  it('11.2 the last-innings target is the aggregate difference plus one', () => {
    const log: CricketLog = [
      ...open('a1', 'a2', 'o1'), run(6), { t: 'endInnings', reason: 'declared' },   // A 6
      ...open('b1', 'b2', 'p1'), run(4), { t: 'endInnings', reason: 'declared' },   // B 4
      ...open('a3', 'a4', 'p2'), run(4), { t: 'endInnings', reason: 'declared' },   // A 10
    ];
    const s = play(f, log);
    expect(s.innings[3].target).toBe(7); // needs 10 - 4 + 1
  });

  it('11.3 unlimited overs never end an innings on the over count', () => {
    const log: CricketLog = [...open('a1', 'a2', 'o1')];
    for (let i = 0; i < 200; i += 1) {
      if (i > 0 && i % 6 === 0) log.push(bowler(i % 12 === 0 ? 'o1' : 'o2'));
      log.push(dot());
    }
    const s = play(f, log);
    expect(s.innings[0].ended).toBe(false);
    expect(s.innings[0].balls).toBe(200);
  });

  it('11.4 a draw is allowed where a limited-overs match has none', () => {
    const s = play(f, [...open('a1', 'a2', 'o1'), run(4), { t: 'end', reason: 'override', winner: null }]);
    expect(s.outcome).toBe('draw');
    expect(f.drawsAllowed).toBe(true);
    expect(T20().drawsAllowed).toBe(false);
  });

  it('11.5 a Test appearance is four innings rows, not one match row', () => {
    const log: CricketLog = [];
    for (let i = 0; i < 4; i += 1) {
      log.push(...open(`p${i}1`, `p${i}2`, `q${i}`), run(4), { t: 'endInnings', reason: 'declared' });
    }
    const card = cricketScorecard(play(f, log));
    expect(card.innings.length).toBe(4);
    expect(new Set(card.innings.map((i) => i.innings)).size).toBe(4);
  });
});

// ============================================================================
// 12. THE SCORECARD AND THE PLAYER STATS
// ============================================================================

describe("12. the scorecard and what reaches a player's record", () => {
  const f = T20();

  /** A short, realistic innings that exercises every kind of entry. */
  const innings = (): CricketLog => [
    ...open('b1', 'b2', 'o1'),
    run(4), dot(), run(1),                                     // b1 4, strike to b2
    legbye(1),                                                 // back to b1
    run(6), out('caught', { next: 'b3', fielder: 'f5' }),      // b1 out for 10
    bowler('o2'),
    wide(), noball(4), run(2), dot(), run(1),
    out('run_out', { end: 'nonStriker', next: 'b4', fielder: 'f7' }),
    ...dots(2),
    bowler('o1'), ...dots(4),
  ];

  it('12.1 the card splits into batting, bowling, fielding and innings rows', () => {
    const card = cricketScorecard(play(f, innings()));
    expect(card.batting.length).toBeGreaterThan(0);
    expect(card.bowling.length).toBe(2);
    expect(card.fielding.length).toBe(2);
    expect(card.innings.length).toBe(1);
  });

  it('12.2 the batting rows add up to the innings total less the extras', () => {
    const s = play(f, innings());
    expectBalance(s.innings[0], 'mixed innings');
    expectBowlingBalance(s.innings[0], 'mixed innings');
    expectLegality(f, s.innings[0]);
  });

  it('12.3 every wicket-taker and catcher is filed on the bowling side', () => {
    const card = cricketScorecard(play(f, innings()));
    expect(card.sideOf.get('o1')).toBe('B');
    expect(card.sideOf.get('f5')).toBe('B');
    expect(card.sideOf.get('b1')).toBe('A');
  });

  it('12.4 a squad member who never batted gets a did-not-bat row, not silence', () => {
    const card = cricketScorecard(play(f, innings()), {
      A: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], B: ['o1', 'o2'],
    });
    const dnb = card.batting.filter((b) => b.dismissal === 'did_not_bat').map((b) => b.userId);
    expect(dnb).toContain('b5');
    expect(dnb).toContain('b6');
    expect(dnb).not.toContain('b1');
  });

  it('12.5 a did-not-bat never drags a batting average down', () => {
    const career = foldCricketCareer(1, [
      { userId: 'x', innings: 1, batPosition: 1, runs: 40, ballsFaced: 30, fours: 5, sixes: 1, dismissal: 'bowled', bowlerId: null, fielderId: null },
      { userId: 'x', innings: 2, batPosition: 8, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dismissal: 'did_not_bat', bowlerId: null, fielderId: null },
    ], [], []);
    expect(career.inningsBatted).toBe(1);
    expect(career.battingAverage).toBe(40);
    expect(career.ducks).toBe(0);
  });

  it('12.6 the batting average divides by dismissals, not by innings', () => {
    const career = foldCricketCareer(2, [
      { userId: 'x', innings: 1, batPosition: 3, runs: 50, ballsFaced: 40, fours: 6, sixes: 0, dismissal: 'caught', bowlerId: 'o', fielderId: 'f' },
      { userId: 'x', innings: 2, batPosition: 3, runs: 30, ballsFaced: 20, fours: 3, sixes: 0, dismissal: 'not_out', bowlerId: null, fielderId: null },
    ], [], []);
    expect(career.runs).toBe(80);
    expect(career.notOuts).toBe(1);
    expect(career.battingAverage).toBe(80);
    expect(career.fifties).toBe(1);
  });

  it('12.7 a duck is out for nought; not out for nought is not a duck', () => {
    const career = foldCricketCareer(2, [
      { userId: 'x', innings: 1, batPosition: 9, runs: 0, ballsFaced: 3, fours: 0, sixes: 0, dismissal: 'bowled', bowlerId: 'o', fielderId: null },
      { userId: 'x', innings: 2, batPosition: 9, runs: 0, ballsFaced: 1, fours: 0, sixes: 0, dismissal: 'not_out', bowlerId: null, fielderId: null },
    ], [], []);
    expect(career.ducks).toBe(1);
  });

  it('12.8 best bowling ranks by wickets first, then by fewer runs', () => {
    const career = foldCricketCareer(3, [], [
      { userId: 'x', innings: 1, ballsBowled: 24, maidens: 0, runsConceded: 40, wickets: 5, wides: 0, noBalls: 0, dots: 6 },
      { userId: 'x', innings: 2, ballsBowled: 24, maidens: 1, runsConceded: 23, wickets: 5, wides: 1, noBalls: 0, dots: 9 },
      { userId: 'x', innings: 3, ballsBowled: 24, maidens: 0, runsConceded: 10, wickets: 4, wides: 0, noBalls: 0, dots: 12 },
    ], []);
    expect(career.bestInningsWickets).toBe(5);
    expect(career.bestInningsRuns).toBe(23);
    expect(career.fiveWicketHauls).toBe(2);
  });

  it("12.9 economy is per the format's over, off the ball count", () => {
    const career = foldCricketCareer(1, [], [
      { userId: 'x', innings: 1, ballsBowled: 24, maidens: 0, runsConceded: 36, wickets: 2, wides: 0, noBalls: 0, dots: 5 },
    ], []);
    expect(career.economy).toBe(9);
  });

  it('12.10 fielding sums across innings', () => {
    const career = foldCricketCareer(2, [], [], [
      { userId: 'x', innings: 1, catches: 2, stumpings: 0, runOuts: 1, drops: 0 },
      { userId: 'x', innings: 2, catches: 1, stumpings: 1, runOuts: 0, drops: 0 },
    ]);
    expect(career.catches).toBe(3);
    expect(career.stumpings).toBe(1);
    expect(career.runOuts).toBe(1);
  });

  it('12.11 an average is undefined, not zero, when nobody has been out', () => {
    const career = foldCricketCareer(1, [
      { userId: 'x', innings: 1, batPosition: 1, runs: 20, ballsFaced: 10, fours: 2, sixes: 0, dismissal: 'not_out', bowlerId: null, fielderId: null },
    ], [], []);
    expect(career.battingAverage).toBeNull();
  });

  it('12.12 the strike rate and economy on the card round the way cricket rounds', () => {
    const s = play(f, innings());
    const inn = s.innings[0];
    const line = batOf(inn, 'b1');
    expect(strikeRate(line)).toBeCloseTo(Math.round((line.runs / line.ballsFaced) * 1000) / 10, 5);
    expect(economy(bowlOf(inn, 'o1'), 6)).toBeGreaterThan(0);
  });

  it('12.13 the extras line itemises everything and totals correctly', () => {
    const s = play(f, innings());
    const inn = s.innings[0];
    const total = Number(extrasLine(inn).split(' ')[0]);
    expect(total).toBe(itemisedExtras(inn));
  });

  it('12.14 nobody appears on the card who never touched the ball', () => {
    const card = cricketScorecard(play(f, innings()));
    expect(card.appeared.has('z9')).toBe(false);
    expect(card.appeared.has('b1')).toBe(true);
    expect(card.appeared.has('f7')).toBe(true);
  });
});

// ============================================================================
// 13. FULL MATCHES — the whole thing, start to sign-off
// ============================================================================

describe('13. whole matches', () => {
  /** Deterministic pseudo-random, so a failure is reproducible. */
  function rng(seed: number) {
    let x = seed;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  }

  /**
   * Bowl a complete innings by tapping, the way an official would: a different
   * bowler each over within their allocation, a new batter whenever one is out, and
   * the whole spread of deliveries.
   */
  function bowlInnings(f: CricketFormat, seed: number, prefix: string, opp: string): CricketLog {
    const r = rng(seed);
    const squad = Array.from({ length: f.playersPerSide }, (_, i) => `${prefix}${i + 1}`);
    const bowlers = Array.from({ length: f.playersPerSide }, (_, i) => `${opp}${i + 1}`);
    const log: CricketLog = [
      { t: 'setBatter', end: 'striker', batterId: squad[0] },
      { t: 'setBatter', end: 'nonStriker', batterId: squad[1] },
    ];
    let nextIn = 2;
    let wickets = 0;
    const overs = f.oversPerInnings ?? 10;
    const perBowler = new Map<string, number>();
    let lastBowler = '';

    for (let over = 0; over < overs; over += 1) {
      const pick = bowlers.find((b) => b !== lastBowler
        && (f.maxOversPerBowler === null || (perBowler.get(b) ?? 0) < f.maxOversPerBowler));
      if (!pick) break;
      perBowler.set(pick, (perBowler.get(pick) ?? 0) + 1);
      lastBowler = pick;
      log.push({ t: 'setBowler', bowlerId: pick });

      let legal = 0;
      let guard = 0;
      while (legal < f.ballsPerOver && guard < 40) {
        guard += 1;
        const d = r();
        if (d < 0.06) { log.push(wide()); continue; }
        if (d < 0.10) { log.push(noball(r() < 0.4 ? 4 : 0)); continue; }
        legal += 1;
        if (d < 0.16 && wickets < f.wicketsToEndInnings - 1) {
          wickets += 1;
          const next = nextIn < squad.length ? squad[nextIn] : undefined;
          if (next) nextIn += 1;
          const how = r() < 0.3 ? 'run_out' : r() < 0.5 ? 'caught' : 'bowled';
          log.push(out(how, {
            ...(next ? { next } : {}),
            ...(how !== 'bowled' ? { fielder: bowlers[Math.floor(r() * bowlers.length)] } : {}),
          }));
          continue;
        }
        if (d < 0.22) { log.push(legbye(1)); continue; }
        if (d < 0.26) { log.push(bye(2)); continue; }
        log.push(run([0, 0, 1, 1, 2, 3, 4, 6][Math.floor(r() * 8)]));
      }
    }
    return log;
  }

  const CASES: Array<[string, () => CricketFormat]> = [
    ['T20', T20], ['T10', T10], ['ODI', ODI], ['super over', SUPER],
    ['box — 6 overs, 8 a side', BOX8],
    ['box — 4-ball overs', BOX4],
    ['box — last man stands', BOXLMS],
  ];

  for (const [name, make] of CASES) {
    for (const seed of [7, 4242, 90210]) {
      it(`13.x ${name}, seed ${seed}: a whole match stays sound and reaches a result`, () => {
        const f = make();
        const log = [...bowlInnings(f, seed, 'a', 'o'), ...bowlInnings(f, seed + 1, 'b', 'p')];
        const s = play(f, log);
        expectSound(f, s, `${name}/${seed}`);
        for (const inn of s.innings) {
          expect(inn.runs, `${name}/${seed} innings ${inn.innings} went negative`).toBeGreaterThanOrEqual(0);
          expect(inn.wickets).toBeLessThanOrEqual(f.wicketsToEndInnings);
        }
        // The headline the standings read equals the innings totals.
        const [ra, rb] = cricketHeadline(s);
        expect(ra + rb).toBe(s.innings.reduce((n, i) => n + i.runs, 0));
      });
    }
  }

  it('13.100 a completed match names exactly one outcome', () => {
    const f = SUPER();
    const s = play(f, [
      ...open('a1', 'a2', 'o1'), run(6), ...dots(5),
      ...open('b1', 'b2', 'p1'), run(4), ...dots(5),
    ]);
    expect(s.ended).toBe(true);
    expect(['win', 'tie', 'draw', 'void']).toContain(s.outcome);
    expect(s.margin).toBeTruthy();
  });

  it('13.101 a whole match survives the round trip through the stats layer', () => {
    const f = BOX8();
    const log = [...bowlInnings(f, 31, 'a', 'o'), ...bowlInnings(f, 32, 'b', 'p')];
    const s = play(f, log);
    const card = cricketScorecard(s, {
      A: Array.from({ length: 8 }, (_, i) => `a${i + 1}`),
      B: Array.from({ length: 8 }, (_, i) => `b${i + 1}`),
    });
    for (const innRow of card.innings) {
      const engineInn = s.innings.find((i) => i.innings === innRow.innings)!;
      expect(innRow.runs).toBe(engineInn.runs);
      expect(innRow.wickets).toBe(engineInn.wickets);
      expect(innRow.balls).toBe(engineInn.balls);
    }
    for (const inn of s.innings) {
      const rows = card.batting.filter((b) => b.innings === inn.innings && b.dismissal !== 'did_not_bat');
      expect(rows.reduce((n, b) => n + b.runs, 0)).toBe(battedRuns(inn));
    }
  });
});
