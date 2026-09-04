import { describe, expect, it } from 'vitest';
import {
  CRICKET_PRESETS, cricketFormatSchema, cricketPresetByKey, cricketPresetsFor,
  defaultCricketFormat, isCricketSport, oversOf, ballsOf, describeCricketFormat,
  parseCricketFormat,
} from './cricket-rules.js';
import {
  aggregateFor, chaseLine, cricketHeadline, economy, extrasLine, foldCricket,
  inningsLine, oversLeft, runRate, strikeRate, undoCricket,
  type CricketEvent, type CricketLog,
} from './cricket-engine.js';

const fmt = (k: string) => cricketPresetByKey(k)!;
const dot: CricketEvent = { t: 'ball', runs: 0 };
const run = (n: number): CricketEvent => ({ t: 'ball', runs: n });
const dots = (n: number): CricketLog => Array.from({ length: n }, () => ({ ...dot }));
const wicket = (how: any = 'bowled'): CricketEvent => ({ t: 'ball', runs: 0, wicket: { how } });

describe('the shelf', () => {
  it('every preset validates', () => {
    for (const p of CRICKET_PRESETS) {
      const r = cricketFormatSchema.safeParse(p);
      expect(r.success, `${p.presetKey}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('covers cricket and box cricket, with unique keys', () => {
    expect(cricketPresetsFor('cricket').length).toBeGreaterThan(4);
    expect(cricketPresetsFor('Box Cricket').length).toBeGreaterThan(2);
    expect(isCricketSport('cricket')).toBe(true);
    expect(isCricketSport('badminton')).toBe(false);
    const keys = CRICKET_PRESETS.map((p) => p.presetKey!);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('defaults to T20, which is what a limited-overs match means now', () => {
    expect(defaultCricketFormat('cricket')?.presetKey).toBe('cricket_t20');
    expect(defaultCricketFormat('box cricket')?.oversPerInnings).toBe(6);
  });

  it('rejects a format whose wicket count cannot be reached', () => {
    const bad = { ...fmt('cricket_t20'), playersPerSide: 6, wicketsToEndInnings: 9, lastManStands: false };
    expect(cricketFormatSchema.safeParse(bad).success).toBe(false);
    // ...unless the last batter stands alone, which box cricket really does.
    expect(cricketFormatSchema.safeParse({ ...bad, lastManStands: true }).success).toBe(true);
  });

  it('resolves a stored preset REFERENCE rather than falling back silently', () => {
    // A live_state holding only { presetKey } must not score as the sport default:
    // a super over played as a twenty-over match never ends, and nothing says why.
    const ref = parseCricketFormat({ presetKey: 'cricket_super_over' });
    expect(ref?.oversPerInnings).toBe(1);
    // A full snapshot still wins over anything inferred.
    const snap = parseCricketFormat({ ...fmt('cricket_t10'), oversPerInnings: 12 });
    expect(snap?.oversPerInnings).toBe(12);
    // And an unrecognised reference is still a refusal, not a guess.
    expect(parseCricketFormat({ presetKey: 'no_such_format' })).toBeNull();
    expect(parseCricketFormat(null)).toBeNull();
  });

  it('describes itself in one readable line', () => {
    expect(describeCricketFormat(fmt('cricket_t20'))).toContain('20 overs');
    expect(describeCricketFormat(fmt('box_5ov_6_lms'))).toContain('last man stands');
    expect(describeCricketFormat(fmt('cricket_test'))).toContain('unlimited overs');
    // One over, not "1 overs" - a shelf row is read by people.
    expect(describeCricketFormat(fmt('cricket_super_over'))).toContain('1 over ');
  });
});

describe('overs are BALLS, not decimals', () => {
  it('formats and parses without losing a ball', () => {
    expect(oversOf(0)).toBe('0.0');
    expect(oversOf(6)).toBe('1.0');
    expect(oversOf(22)).toBe('3.4');
    expect(ballsOf('3.4')).toBe(22);
    // The round trip is the point: 3.4 + 3.4 overs is 7.2, not the 6.8 that decimal
    // arithmetic gives - so the state has to count balls.
    expect(oversOf(ballsOf('3.4') + ballsOf('3.4'))).toBe('7.2');
  });

  it('respects a format with shorter overs', () => {
    expect(oversOf(9, 4)).toBe('2.1');
    expect(ballsOf('2.1', 4)).toBe(9);
  });
});

describe('one delivery at a time', () => {
  const f = fmt('cricket_t20');

  it('counts runs off the bat to the batter and the total', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 4, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1' },
      { t: 'ball', runs: 6, bowlerId: 'b1' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.runs).toBe(10);
    expect(inn.balls).toBe(2);
    const p1 = inn.batting.find((b) => b.playerId === 'p1')!;
    expect(p1.runs).toBe(10);
    expect(p1.fours).toBe(1);
    expect(p1.sixes).toBe(1);
    expect(p1.ballsFaced).toBe(2);
  });

  it('does NOT advance the over on a wide', () => {
    // An over with two wides is eight deliveries long. This is the rule a naive
    // scorer gets wrong, and it changes when the bowler must change.
    const log: CricketLog = [
      ...dots(2),
      { t: 'ball', runs: 0, extra: 'wide' },
      { t: 'ball', runs: 0, extra: 'wide' },
      ...dots(4),
    ];
    const r = foldCricket(f, log);
    const inn = r.state.innings[0];
    expect(inn.balls).toBe(6);            // six LEGAL balls
    expect(inn.runs).toBe(2);             // two wides, one run each
    expect(inn.wides).toBe(2);
    expect(r.trace.filter((s) => s.legal).length).toBe(6);
    expect(r.trace.some((s) => s.overComplete)).toBe(true);
  });

  it('never puts a wide on the batter but does put a no-ball hit', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, extra: 'wide', strikerId: 'p1', bowlerId: 'b1' },
      { t: 'ball', runs: 4, extra: 'noball', strikerId: 'p1', bowlerId: 'b1' },
    ]);
    const inn = r.state.innings[0];
    const p1 = inn.batting.find((b) => b.playerId === 'p1')!;
    // Wide: nothing to the batter, and not even a ball faced - they never had a
    // chance to play at it.
    expect(p1.runs).toBe(4);
    expect(p1.ballsFaced).toBe(1);
    expect(p1.fours).toBe(1);
    // 1 (wide) + 1 (no-ball) + 4 off the bat.
    expect(inn.runs).toBe(6);
    expect(inn.balls).toBe(0);            // neither was legal
  });

  it('charges byes to the team and not to the bowler', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, extra: 'bye', extraRuns: 4, bowlerId: 'b1' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.runs).toBe(4);
    expect(inn.byes).toBe(4);
    // The bowler bowled a legal ball and conceded nothing - byes are the keeper's.
    const b1 = inn.bowling.find((b) => b.playerId === 'b1')!;
    expect(b1.runsConceded).toBe(0);
    expect(b1.ballsBowled).toBe(1);
  });

  it('itemises extras so a scorecard balances', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, extra: 'wide' },
      { t: 'ball', runs: 0, extra: 'noball' },
      { t: 'ball', runs: 0, extra: 'bye', extraRuns: 2 },
      { t: 'ball', runs: 0, extra: 'legbye', extraRuns: 1 },
    ]);
    expect(extrasLine(r.state.innings[0])).toBe('5 (w 1, nb 1, b 2, lb 1)');
  });
});

describe('the strike rotates the way it does on a field', () => {
  const f = fmt('cricket_t20');

  it('crosses on odd runs and not on even', () => {
    let r = foldCricket(f, [{ t: 'ball', runs: 1, strikerId: 'p1', nonStrikerId: 'p2' }]);
    expect(r.state.innings[0].strikerId).toBe('p2');
    r = foldCricket(f, [{ t: 'ball', runs: 2, strikerId: 'p1', nonStrikerId: 'p2' }]);
    expect(r.state.innings[0].strikerId).toBe('p1');
  });

  it('crosses at the end of an over, and clears the bowler', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1' },
      ...dots(5),
    ]);
    const inn = r.state.innings[0];
    expect(inn.strikerId).toBe('p2');
    // The same bowler cannot bowl consecutive overs, so the console must be asked.
    expect(inn.bowlerId).toBeUndefined();
  });

  it('a single off the last ball of an over crosses TWICE, ending where it began', () => {
    // Two crossings cancel: the batter who ran the single is on strike again. This
    // is the sequence hand-built scorers reliably get wrong.
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1' },
      ...dots(4),
      { t: 'ball', runs: 1 },
    ]);
    expect(r.state.innings[0].strikerId).toBe('p1');
  });
});

describe('naming who is on the field', () => {
  const f = fmt('cricket_t20');

  it('puts the opening pair in before a ball is bowled', () => {
    // A `ball` event cannot open the innings - it would have to score something.
    const r = foldCricket(f, [
      { t: 'setBatter', end: 'striker', batterId: 'p1' },
      { t: 'setBatter', end: 'nonStriker', batterId: 'p2' },
      { t: 'setBowler', bowlerId: 'b1' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.strikerId).toBe('p1');
    expect(inn.nonStrikerId).toBe('p2');
    expect(inn.bowlerId).toBe('b1');
    expect(inn.balls).toBe(0);
  });

  it('registers the batting line, so a first-ball duck still appears', () => {
    // Without this, somebody bowled first ball has faced nothing and would vanish
    // off the scorecard entirely.
    const r = foldCricket(f, [{ t: 'setBatter', end: 'striker', batterId: 'p1' }]);
    expect(r.state.innings[0].batting.map((b) => b.playerId)).toEqual(['p1']);
  });

  it('corrects a mis-recorded striker without touching the score', () => {
    const r = foldCricket(f, [
      { t: 'setBatter', end: 'striker', batterId: 'p1' },
      { t: 'ball', runs: 2, strikerId: 'p1' },
      { t: 'setBatter', end: 'striker', batterId: 'p3' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.strikerId).toBe('p3');
    expect(inn.runs).toBe(2);
    // The two runs stay with whoever actually faced the ball.
    expect(inn.batting.find((b) => b.playerId === 'p1')!.runs).toBe(2);
  });
});

describe('wickets', () => {
  const f = fmt('cricket_t20');

  it('credits the bowler for a bowled dismissal', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1',
        wicket: { how: 'bowled' }, nextBatterId: 'p3' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.wickets).toBe(1);
    expect(inn.bowling.find((b) => b.playerId === 'b1')!.wickets).toBe(1);
    const p1 = inn.batting.find((b) => b.playerId === 'p1')!;
    expect(p1.out).toBe(true);
    expect(p1.dismissal).toBe('bowled');
    expect(inn.strikerId).toBe('p3');
  });

  it('does NOT credit the bowler for a run-out', () => {
    // The commonest error in a hand-built scorer.
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1',
        wicket: { how: 'run_out', fielderId: 'f1' }, nextBatterId: 'p3' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.wickets).toBe(1);
    expect(inn.bowling.find((b) => b.playerId === 'b1')!.wickets).toBe(0);
    expect(inn.batting.find((b) => b.playerId === 'p1')!.fielderId).toBe('f1');
  });

  it('can take the non-striker, which a run-out does', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, strikerId: 'p1', nonStrikerId: 'p2', bowlerId: 'b1',
        wicket: { how: 'run_out', end: 'nonStriker' }, nextBatterId: 'p3' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.batting.find((b) => b.playerId === 'p2')!.out).toBe(true);
    expect(inn.batting.find((b) => b.playerId === 'p1')!.out).toBe(false);
    expect(inn.nonStrikerId).toBe('p3');
  });

  it('records a catch against the fielder AND the bowler', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 0, strikerId: 'p1', bowlerId: 'b1',
        wicket: { how: 'caught', fielderId: 'f1' } },
    ]);
    const inn = r.state.innings[0];
    expect(inn.bowling.find((b) => b.playerId === 'b1')!.wickets).toBe(1);
    expect(inn.batting.find((b) => b.playerId === 'p1')!.fielderId).toBe('f1');
  });
});

describe('an innings ends on its own terms', () => {
  it('on overs', () => {
    const f = fmt('cricket_super_over');   // 1 over
    const r = foldCricket(f, dots(6));
    expect(r.state.innings[0].ended).toBe(true);
    expect(r.state.innings[0].endedBy).toBe('overs');
    // ...and the second innings has begun, with a target.
    expect(r.state.innings).toHaveLength(2);
    expect(r.state.innings[1].target).toBe(1);
  });

  it('on all out', () => {
    const f = fmt('cricket_super_over');   // 2 wickets end it
    const r = foldCricket(f, [wicket(), wicket()]);
    expect(r.state.innings[0].ended).toBe(true);
    expect(r.state.innings[0].endedBy).toBe('all_out');
  });

  it('the moment the target is passed, not at the end of the over', () => {
    const f = fmt('cricket_super_over');
    // First innings: 4 runs off 6 balls.
    const first: CricketLog = [run(4), ...dots(5)];
    const r = foldCricket(f, [...first, run(3), run(2)]);
    // Target is 5; 3 then 2 reaches it on the second ball of the chase.
    expect(r.state.innings[1].target).toBe(5);
    expect(r.state.innings[1].endedBy).toBe('target');
    expect(r.state.innings[1].balls).toBe(2);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('B');
  });
});

describe('the result, phrased the way cricket phrases it', () => {
  const f = fmt('cricket_super_over');

  it('the side batting last wins BY WICKETS', () => {
    const r = foldCricket(f, [run(2), ...dots(5), run(3)]);
    expect(r.state.winner).toBe('B');
    // Two wickets end this innings and none fell, so two remain.
    expect(r.state.margin).toBe('won by 2 wickets');
  });

  it('the side bowling last wins BY RUNS', () => {
    const r = foldCricket(f, [run(6), run(6), ...dots(4), run(1), ...dots(5)]);
    expect(r.state.winner).toBe('A');
    expect(r.state.margin).toBe('won by 11 runs');
  });

  it('equal scores is a TIE, which is not a draw', () => {
    const r = foldCricket(f, [run(3), ...dots(5), run(3), ...dots(5)]);
    expect(r.state.outcome).toBe('tie');
    expect(r.state.winner).toBeNull();
    // T20 sends a tie to a super over; the console says so rather than inventing one.
    expect(r.state.margin).toContain('tied');
  });

  it('the headline standings read is RUNS, aggregated per side', () => {
    const r = foldCricket(f, [run(6), ...dots(5), run(2), ...dots(5)]);
    expect(cricketHeadline(r.state)).toEqual([6, 2]);
    expect(aggregateFor(r.state, 'A')).toBe(6);
  });
});

describe('a Test is two innings a side', () => {
  const f = fmt('cricket_test');

  it('plays four innings before deciding', () => {
    const r = foldCricket(f, [
      { t: 'endInnings', reason: 'declared' },
      { t: 'endInnings', reason: 'declared' },
      { t: 'endInnings', reason: 'declared' },
    ]);
    expect(r.state.innings).toHaveLength(4);
    expect(r.state.ended).toBe(false);
    expect(r.state.innings.map((i) => i.battingSide)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('allows a draw, which limited-overs does not', () => {
    expect(f.drawsAllowed).toBe(true);
    expect(fmt('cricket_t20').drawsAllowed).toBe(false);
  });
});

describe('box cricket really is different', () => {
  it('plays shorter overs and a smaller side', () => {
    const f = fmt('box_4ov_4ball');
    expect(f.ballsPerOver).toBe(4);
    expect(f.playersPerSide).toBe(6);
    expect(f.wideRuns).toBe(2);
    // Four balls completes the over here, not six.
    const r = foldCricket(f, dots(4));
    expect(r.trace.some((s) => s.overComplete)).toBe(true);
    expect(inningsLine(r.state.innings[0], 4)).toBe('0/0 (1.0)');
  });

  it('lets the last batter stand alone', () => {
    const f = fmt('box_5ov_6_lms');
    expect(f.lastManStands).toBe(true);
    expect(f.wicketsToEndInnings).toBe(6);   // all six can be dismissed
  });
});

describe('corrections', () => {
  const f = fmt('cricket_t20');

  it('undo is a truncate, and takes the ball back off the over', () => {
    const log: CricketLog = [run(4), run(1), wicket()];
    const three = foldCricket(f, log);
    expect(three.state.innings[0].wickets).toBe(1);
    const back = undoCricket(f, log);
    expect(back.state.innings[0].wickets).toBe(0);
    expect(back.state.innings[0].balls).toBe(2);
    expect(back.state.innings[0].runs).toBe(5);
  });

  it('penalty runs go to the side, not to any batter', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 2, strikerId: 'p1' },
      { t: 'penalty', side: 'A', runs: 5, reason: 'ball tampering' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.runs).toBe(7);
    expect(inn.penaltyRuns).toBe(5);
    expect(inn.batting.find((b) => b.playerId === 'p1')!.runs).toBe(2);
  });

  it('a retirement is not a dismissal', () => {
    const r = foldCricket(f, [
      { t: 'ball', runs: 30, strikerId: 'p1', nonStrikerId: 'p2' },
      { t: 'retire', batterId: 'p1', nextBatterId: 'p3', reason: 'cramp' },
    ]);
    const inn = r.state.innings[0];
    expect(inn.wickets).toBe(0);
    const p1 = inn.batting.find((b) => b.playerId === 'p1')!;
    expect(p1.out).toBe(false);
    expect(p1.dismissal).toBe('retired');
    expect(inn.strikerId).toBe('p3');
  });

  it('an abandoned match records no winner', () => {
    const r = foldCricket(f, [run(4), { t: 'end', reason: 'abandoned', winner: null }]);
    expect(r.state.ended).toBe(true);
    expect(r.state.outcome).toBe('void');
    expect(r.state.winner).toBeNull();
  });
});

describe('the numbers a scorecard shows', () => {
  const f = fmt('cricket_t20');

  it('a maiden is an over with no runs off it', () => {
    const r = foldCricket(f, [{ t: 'ball', runs: 0, bowlerId: 'b1' }, ...dots(5)]);
    expect(r.state.innings[0].bowling.find((b) => b.playerId === 'b1')!.maidens).toBe(1);
    const scored = foldCricket(f, [{ t: 'ball', runs: 1, bowlerId: 'b1' }, ...dots(5)]);
    expect(scored.state.innings[0].bowling.find((b) => b.playerId === 'b1')!.maidens).toBe(0);
  });

  it('economy and strike rate, rounded the way a scorecard rounds them', () => {
    const r = foldCricket(f, [{ t: 'ball', runs: 6, strikerId: 'p1', bowlerId: 'b1' }, ...dots(5)]);
    const inn = r.state.innings[0];
    expect(economy(inn.bowling.find((b) => b.playerId === 'b1')!)).toBe(6);
    expect(strikeRate(inn.batting.find((b) => b.playerId === 'p1')!)).toBe(100);
    expect(runRate(inn)).toBe(6);
  });

  it('reads out the innings the way a scoreboard does', () => {
    const r = foldCricket(f, [run(4), run(2), wicket(), run(1)]);
    expect(inningsLine(r.state.innings[0])).toBe('7/1 (0.4)');
  });

  it('says what the chase needs, in runs and balls', () => {
    const f1 = fmt('cricket_super_over');
    const r = foldCricket(f1, [run(6), ...dots(5), run(1)]);
    // Target 7, one scored, five balls left.
    expect(chaseLine(r.state)).toBe('need 6 from 5 balls');
  });

  it('stops offering a bowler who has bowled their allocation', () => {
    const f4 = fmt('cricket_super_over');   // max 1 over
    const r = foldCricket(f4, [{ t: 'ball', runs: 0, bowlerId: 'b1' }, ...dots(5)]);
    const line = r.state.innings[0].bowling.find((b) => b.playerId === 'b1')!;
    expect(oversLeft(f4, line)).toBe(0);
    expect(oversLeft(fmt('cricket_test'), line)).toBeNull();   // no limit in a Test
  });
});
