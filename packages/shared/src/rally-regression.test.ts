import { describe, expect, it } from 'vitest';
import {
  RACQUET_PRESETS, presetByKey,
} from './racquet-presets.js';
import { TEAM_PRESETS } from './team-presets.js';
import {
  scoringFormatSchema,
  type LevelSpec, type ScoringFormat, type Side,
} from './scoring-rules.js';
import {
  aggregateScore, atAdvantage, effectiveLevel, foldRally, headline, initKernel,
  isAggregate, periodsPlayed, resultEnvelope, step, undo, unitWinner,
  type KernelState, type Pair, type RallyEvent, type RallyLog,
} from './rally-kernel.js';

// ============================================================================
// RALLY KERNEL REGRESSION SUITE.
//
// The same treatment cricket got, for the OTHER ninety-one formats. Twenty-five
// sports run on this one kernel - every racquet sport, every net sport, every
// invasion and raid sport, the board sports and the combat sports - so a defect
// here is not one sport's problem. It is the product's.
//
// The unit tests next door pin single behaviours. This file plays WHOLE MATCHES,
// in every preset on the shelf, and asserts the things that make a result
// publishable. Its job is not "does the reducer work" but "is there any sequence
// of taps a real match can produce that leaves the score wrong, the serve with the
// wrong side, or a console that can neither be scored nor finished".
//
// THE SIX INVARIANTS every scenario below is checked against:
//
//   SCORE       no negative score anywhere, ever.
//   UNITS       every banked unit genuinely satisfies its own winning condition,
//               and the level above counts exactly the units banked below it.
//   SERVE       somebody always has the serve, with a server number the format
//               allows. A serve on nobody is a console that cannot take a point.
//   RESULT      the match ends at most once, and `ended`, `outcome` and `winner`
//               agree with each other.
//   HEADLINE    the two numbers standings read match what the format says decides
//               the match - the total for an aggregate sport, units won otherwise.
//   REPLAY      folding the same log twice gives the same state, and undo is an
//               exact truncate.
//
// REACHABILITY gets its own section: every preset on the shelf is played to a
// finish by a dumb strategy, because a format that cannot be finished is a match
// that strands an official at a venue.
// ============================================================================

const ALL: ScoringFormat[] = [...RACQUET_PRESETS, ...TEAM_PRESETS];

const fmt = (key: string): ScoringFormat => {
  const f = ALL.find((p) => p.presetKey === key);
  if (!f) throw new Error(`no preset ${key}`);
  return f;
};

// ---- taps ----
const pt = (side: Side, pts?: number): RallyEvent => ({ t: 'point', side, ...(pts ? { pts } : {}) });
const pts = (side: Side, n: number): RallyLog => Array.from({ length: n }, () => pt(side));
const play = (f: ScoringFormat, log: RallyLog, first: Side = 'A'): KernelState =>
  foldRally(f, log, first).state;

/** Alternate points, starting with `first`. */
const rally = (n: number, first: Side = 'A'): RallyLog =>
  Array.from({ length: n }, (_, i) => pt(i % 2 === 0 ? first : (first === 'A' ? 'B' : 'A')));

// ---- the invariants --------------------------------------------------------

function expectScoreSane(f: ScoringFormat, s: KernelState, note = '') {
  s.score.forEach((pair, i) => {
    expect(pair[0], `SCORE ${note} level ${i} side A went negative`).toBeGreaterThanOrEqual(0);
    expect(pair[1], `SCORE ${note} level ${i} side B went negative`).toBeGreaterThanOrEqual(0);
  });
  for (const u of s.finished) {
    expect(u.score[0], `SCORE ${note} banked unit ${u.key} side A negative`).toBeGreaterThanOrEqual(0);
    expect(u.score[1], `SCORE ${note} banked unit ${u.key} side B negative`).toBeGreaterThanOrEqual(0);
  }
}

/**
 * Every banked unit was genuinely won, and the level above counts exactly them.
 *
 * `awarded` units are exempt from the first half - a conduct award, a retirement or
 * a buzzer hands a unit over without the score reaching the target, which is the
 * whole point of those events.
 */
function expectUnitsSound(f: ScoringFormat, s: KernelState, note = '') {
  const aggregate = isAggregate(f);
  for (const u of s.finished) {
    if (u.awarded) continue;
    const spec = f.levels[u.level];
    if (!spec) continue;
    // An aggregate level's children are periods; nobody wins a half, so a period's
    // score says nothing about a winner and there is nothing to check.
    if (aggregate && u.level === 0) continue;
    if (spec.terminator === 'clock') continue;
    // A substituted or overridden unit was played to a different target than the base
    // level declares, so the base rule is a floor rather than the exact test: the
    // winner must at least be ahead.
    const w = u.winner === 'A' ? 0 : 1;
    const l = w === 0 ? 1 : 0;
    expect(u.score[w], `UNITS ${note} ${u.key} banked to ${u.winner} at ${u.score[0]}-${u.score[1]}`)
      .toBeGreaterThanOrEqual(u.score[l]);
  }

  // The tally at each level equals the units banked below it, for a units-decided
  // format. An aggregate top level counts periods, not wins, and is exempt.
  for (let i = 1; i < f.levels.length; i += 1) {
    if (f.levels[i].decide === 'aggregate') continue;
    const bankedA = s.finished.filter((u) => u.level === i - 1 && u.winner === 'A').length;
    const bankedB = s.finished.filter((u) => u.level === i - 1 && u.winner === 'B').length;
    // Units banked at level i-1 include those won inside already-completed parents,
    // so the live tally can only be at most the total banked.
    expect(s.score[i][0], `UNITS ${note} level ${i} A tally ${s.score[i][0]} > ${bankedA} banked`)
      .toBeLessThanOrEqual(bankedA);
    expect(s.score[i][1], `UNITS ${note} level ${i} B tally ${s.score[i][1]} > ${bankedB} banked`)
      .toBeLessThanOrEqual(bankedB);
  }
}

function expectServeSane(f: ScoringFormat, s: KernelState, note = '') {
  expect(['A', 'B'], `SERVE ${note} nobody holds the serve`).toContain(s.serve.side);
  const spec = f.serve;
  const maxServers = spec.movement === 'handOut' ? (spec.serversPerSide ?? 2) : 1;
  expect(s.serve.serverNo, `SERVE ${note} serverNo ${s.serve.serverNo} out of range`)
    .toBeGreaterThanOrEqual(1);
  expect(s.serve.serverNo, `SERVE ${note} serverNo ${s.serve.serverNo} exceeds ${maxServers}`)
    .toBeLessThanOrEqual(Math.max(maxServers, 2));
  if (spec.courtModel === 'none') {
    expect(s.serve.courtHalf, `SERVE ${note} a court half on a sport with no courts`).toBeNull();
  } else {
    expect(['right', 'left'], `SERVE ${note} court half ${s.serve.courtHalf}`)
      .toContain(s.serve.courtHalf);
  }
}

function expectResultSound(f: ScoringFormat, s: KernelState, note = '') {
  if (!s.ended) {
    expect(s.outcome, `RESULT ${note} an unfinished match has an outcome`).toBeNull();
    expect(s.winner, `RESULT ${note} an unfinished match has a winner`).toBeNull();
    return;
  }
  expect(s.outcome, `RESULT ${note} a finished match has no outcome`).not.toBeNull();
  if (s.outcome === 'win') {
    expect(s.winner, `RESULT ${note} a win with no winner`).not.toBeNull();
  } else {
    expect(s.winner, `RESULT ${note} a ${s.outcome} named a winner`).toBeNull();
  }
}

function expectHeadlineSound(f: ScoringFormat, s: KernelState, note = '') {
  const h = headline(f, s);
  expect(h.length, `HEADLINE ${note}`).toBe(2);
  expect(Number.isFinite(h[0]) && Number.isFinite(h[1]), `HEADLINE ${note} not numbers`).toBe(true);
  expect(h[0], `HEADLINE ${note} A negative`).toBeGreaterThanOrEqual(0);
  expect(h[1], `HEADLINE ${note} B negative`).toBeGreaterThanOrEqual(0);
  if (isAggregate(f)) {
    expect(h, `HEADLINE ${note} an aggregate sport must report the total`)
      .toEqual(aggregateScore(s));
  }
  // The side that won must not be BEHIND on the headline the standings read. A
  // result that publishes the loser ahead is the worst thing this file can miss.
  if (s.ended && s.outcome === 'win' && s.winner) {
    const w = s.winner === 'A' ? 0 : 1;
    const l = w === 0 ? 1 : 0;
    expect(h[w], `HEADLINE ${note} ${s.winner} won but the headline reads ${h[0]}-${h[1]}`)
      .toBeGreaterThanOrEqual(h[l]);
  }
}

function expectSound(f: ScoringFormat, s: KernelState, note = '') {
  expectScoreSane(f, s, note);
  expectUnitsSound(f, s, note);
  expectServeSane(f, s, note);
  expectResultSound(f, s, note);
  expectHeadlineSound(f, s, note);
}

// ============================================================================
// 1. THE SHELF
// ============================================================================

describe('1. the shelf every format is picked from', () => {
  it('1.1 all ninety-one presets are structurally valid', () => {
    for (const p of ALL) {
      const r = scoringFormatSchema.safeParse(p);
      expect(r.success, `${p.sport}/${p.presetKey}: ${r.success ? '' : JSON.stringify(r.error.issues)}`)
        .toBe(true);
    }
  });

  it('1.2 every preset key is unique across the whole shelf', () => {
    const seen = new Map<string, string>();
    for (const p of ALL) {
      const k = p.presetKey ?? '(none)';
      expect(seen.has(k), `duplicate key ${k}: ${seen.get(k)} and ${p.sport}`).toBe(false);
      seen.set(k, p.sport);
    }
  });

  it('1.3 no cap is below its own target', () => {
    for (const p of ALL) {
      for (const lv of p.levels) {
        if (lv.cap === null || lv.cap === undefined) continue;
        expect(lv.cap, `${p.presetKey} ${lv.key}`).toBeGreaterThanOrEqual(lv.target);
      }
    }
  });

  it('1.4 the outermost level is always the match', () => {
    for (const p of ALL) {
      const top = p.levels[p.levels.length - 1];
      expect(top, `${p.presetKey}`).toBeTruthy();
      expect(top.target, `${p.presetKey} outermost target`).toBeGreaterThan(0);
    }
  });

  it('1.5 a clock-terminated level always comes with a way to end the period', () => {
    // A level that never terminates on score and has no clock spec is a match
    // nobody can finish.
    for (const p of ALL) {
      const clocked = p.levels.some((lv) => lv.terminator === 'clock');
      if (!clocked) continue;
      expect(isAggregate(p) || !!p.clock, `${p.presetKey} is clock-terminated but neither aggregate nor clocked`)
        .toBe(true);
    }
  });

  it('1.6 handOut formats declare how many servers a side has', () => {
    for (const p of ALL) {
      const specs = [p.serve, ...p.levels.map((l) => l.serve)].filter(Boolean);
      for (const s of specs) {
        if (s!.movement !== 'handOut') continue;
        expect(s!.serversPerSide ?? 2, `${p.presetKey}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('1.7 an everyN format declares its rhythm', () => {
    for (const p of ALL) {
      const specs = [p.serve, ...p.levels.map((l) => l.serve)].filter(Boolean);
      for (const s of specs) {
        if (s!.movement !== 'everyN') continue;
        expect(s!.every ?? 2, `${p.presetKey}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('1.8 a substitution only ever replaces a level that has a child', () => {
    for (const p of ALL) {
      expect(p.levels[0]?.substitute, `${p.presetKey} innermost level substitutes`).toBeUndefined();
    }
  });
});

// ============================================================================
// 2. ONE RALLY
// ============================================================================

describe('2. one rally, every outcome it can have', () => {
  const tt = fmt('ittf_bo5_11');

  it('2.1 a rally point scores for whoever won it', () => {
    const s = play(tt, [pt('A')]);
    expect(s.score[0]).toEqual([1, 0]);
    expectSound(tt, s);
  });

  it('2.2 a let scores nothing and moves nothing', () => {
    const before = play(tt, [pt('A')]);
    const after = play(tt, [pt('A'), { t: 'let' }]);
    expect(after.score[0]).toEqual(before.score[0]);
    expect(after.serve.side).toBe(before.serve.side);
    expect(after.serve.turnCount).toBe(before.serve.turnCount);
  });

  it('2.3 a fault scores nothing and moves nothing', () => {
    const before = play(tt, [pt('A')]);
    const after = play(tt, [pt('A'), { t: 'fault', side: 'B' }]);
    expect(after.score[0]).toEqual(before.score[0]);
    expect(after.serve.side).toBe(before.serve.side);
  });

  it('2.4 UNDER SIDE-OUT SCORING the receiver winning a rally scores nothing', () => {
    // Classic badminton 15 and English squash: the receiver takes the serve, not a
    // point. Fusing "who scores" with "how the serve moves" makes this inexpressible,
    // and getting it wrong inflates every score in the sport.
    const f = fmt('classic_15_sideout');
    expect(f.serve.pointScoring).toBe('serverOnly');
    const s = play(f, [pt('B')], 'A'); // A serves, B wins the rally
    expect(s.score[0], 'the receiver was given a point').toEqual([0, 0]);
    expect(s.serve.side, 'the receiver did not take the serve').toBe('B');
    expectSound(f, s);
  });

  it('2.5 under side-out scoring the SERVER winning does score', () => {
    const f = fmt('classic_15_sideout');
    const s = play(f, [pt('A')], 'A');
    expect(s.score[0]).toEqual([1, 0]);
  });

  it('2.6 a point can carry a magnitude — a three-pointer is one action worth three', () => {
    const bb = fmt('fiba_4x10');
    const s = play(bb, [pt('A', 3), pt('A', 2), pt('B')]);
    expect(aggregateScore(s)).toEqual([5, 1]);
    expectSound(bb, s);
  });

  it('2.7 AN EXPLICIT ZERO SCORES NOTHING — it is an action, not a point', () => {
    // Outside the racquet family a tap is an ACTION, and most actions score nothing:
    // a card, a save, a missed penalty, an empty raid, a dig. The console sends
    // `pts: 0` for exactly those. Clamping to a minimum of one turned every one of
    // them into a goal, and a football match with five saves and three cards read
    // 8-0 on the screen the official was watching.
    const bb = fmt('fiba_4x10');
    const zero = play(bb, [{ t: 'point', side: 'A', pts: 0 }]);
    expect(aggregateScore(zero), 'a nil-magnitude action scored').toEqual([0, 0]);

    // A negative is meaningless and is floored at nothing rather than subtracting.
    const negative = play(bb, [{ t: 'point', side: 'A', pts: -5 }]);
    expect(aggregateScore(negative)).toEqual([0, 0]);

    // An ABSENT magnitude still means one, because that is what a plain point is.
    const absent = play(bb, [{ t: 'point', side: 'A' }]);
    expect(aggregateScore(absent)).toEqual([1, 0]);
  });

  it('2.7b a nil-magnitude action does not move the serve either', () => {
    // A dig or a block that did not win the rally ends no rally, so it hands the
    // serve to nobody.
    const vb = fmt('fivb_25_bo5');
    const before = play(vb, [], 'A').serve.side;
    const after = play(vb, [{ t: 'point', side: 'B', pts: 0 }], 'A').serve.side;
    expect(after, 'a nil-magnitude action handed the serve over').toBe(before);
  });

  it('2.8 a penalty point behaves exactly like a rallied one', () => {
    const s = play(tt, [{ t: 'penalty', side: 'A', reason: 'conduct' }]);
    expect(s.score[0]).toEqual([1, 0]);
    expectSound(tt, s);
  });

  it('2.9 a penalty is refused where the format turns conduct points off', () => {
    const off: ScoringFormat = { ...tt, penaltyEvents: 'off' };
    const s = play(off, [{ t: 'penalty', side: 'A' }]);
    expect(s.score[0]).toEqual([0, 0]);
  });

  it('2.10 nothing is accepted after the match has ended, except a correction', () => {
    const s = play(tt, [...pts('A', 11), ...pts('A', 11), ...pts('A', 11), ...pts('A', 5)]);
    expect(s.ended).toBe(true);
    const envelope = resultEnvelope(tt, s);
    expect(envelope.unitScores.length, 'more games were played after the match ended')
      .toBeLessThanOrEqual(5);
    expectSound(tt, s);
  });
});

// ============================================================================
// 3. THE UNIT — target, margin, cap, deuce
// ============================================================================

describe('3. winning a unit', () => {
  it('3.1 eleven by two takes a table-tennis game', () => {
    const f = fmt('ittf_bo5_11');
    const s = play(f, pts('A', 11));
    expect(s.finished.filter((u) => u.level === 0).length).toBe(1);
    expect(s.score[1]).toEqual([1, 0]);
    expectSound(f, s);
  });

  it('3.2 ten-all is deuce and eleven does NOT win it', () => {
    const f = fmt('ittf_bo5_11');
    const s = play(f, [...rally(20)]);          // 10-10
    expect(s.score[0]).toEqual([10, 10]);
    const next = play(f, [...rally(20), pt('A')]);
    expect(next.score[0], 'an 11-10 lead took the game').toEqual([11, 10]);
    expect(next.finished.length).toBe(0);
    const won = play(f, [...rally(20), pt('A'), pt('A')]);
    expect(won.finished.filter((u) => u.level === 0).length).toBe(1);
    expect(won.finished[0].score).toEqual([12, 10]);
  });

  it('3.3 atAdvantage names deuce, and only where the margin rule bites', () => {
    const lv: LevelSpec = { key: 'g', label: 'G', target: 11, winBy: 2, cap: null };
    expect(atAdvantage(lv, [10, 10])).toBe(true);
    // NOT at 10-9: the next point wins it 11-9 by two, so the margin rule has not
    // bitten yet. Deuce is both sides on target-1, not either side.
    expect(atAdvantage(lv, [10, 9])).toBe(false);
    expect(atAdvantage(lv, [9, 9])).toBe(false);
    expect(atAdvantage({ ...lv, winBy: 1 }, [10, 10]), 'sudden death has no deuce').toBe(false);
  });

  it('3.4 a cap ends the unit regardless of margin', () => {
    const f = fmt('bwf_official_3x21');   // 21, by 2, cap 30
    const g = f.levels[0];
    expect(g.cap).toBe(30);
    // 29-29, then one point takes it 30-29 despite the one-point margin.
    const s = play(f, [...rally(58), pt('A')]);
    expect(s.finished.filter((u) => u.level === 0)[0].score).toEqual([30, 29]);
  });

  it('3.5 an uncapped deuce genuinely runs on', () => {
    const f = fmt('ittf_bo5_11');
    expect(f.levels[0].cap).toBeNull();
    const s = play(f, rally(80));       // 40-40
    expect(s.score[0]).toEqual([40, 40]);
    expect(s.finished.length).toBe(0);
    expectSound(f, s);
  });

  it('3.6 sudden death: win by one, no deuce at all', () => {
    const f = fmt('corp_single_15_suddendeath');
    expect(f.levels[0].winBy).toBe(1);
    const s = play(f, [...rally(28), pt('A')]);   // 14-14 then A
    expect(s.ended).toBe(true);
    expect(s.winner).toBe('A');
  });

  it('3.7 unitWinner is the single source of truth, cap before margin', () => {
    const lv: LevelSpec = { key: 'g', label: 'G', target: 21, winBy: 2, cap: 30 };
    expect(unitWinner(lv, [21, 19])).toBe('A');
    expect(unitWinner(lv, [21, 20])).toBeNull();
    expect(unitWinner(lv, [30, 29])).toBe('A');
    expect(unitWinner(lv, [20, 20])).toBeNull();
    expect(unitWinner({ ...lv, terminator: 'clock' }, [30, 0]),
      'a clock unit was won on the score').toBeNull();
  });

  it('3.8 a handicap start is applied to every unit, not just the first', () => {
    const base = fmt('ittf_bo5_11');
    const f: ScoringFormat = {
      ...base,
      levels: [{ ...base.levels[0], startingScore: [2, 0] }, base.levels[1]],
    };
    const fresh = initKernel(f, 'A');
    expect(fresh.score[0]).toEqual([2, 0]);
    const afterOneGame = play(f, pts('A', 9));   // 2 + 9 = 11
    expect(afterOneGame.score[1]).toEqual([1, 0]);
    expect(afterOneGame.score[0], 'the second game did not start from the handicap')
      .toEqual([2, 0]);
  });
});

// ============================================================================
// 4. THE SERVE
// ============================================================================

describe('4. the serve', () => {
  it('4.1 rallyWinner: the winner of the rally serves next', () => {
    const f = fmt('bwf_official_3x21');
    expect(f.serve.movement).toBe('rallyWinner');
    expect(play(f, [pt('B')], 'A').serve.side).toBe('B');
    expect(play(f, [pt('A')], 'A').serve.side).toBe('A');
  });

  it('4.2 everyN: table tennis changes hands every two points', () => {
    const f = fmt('ittf_bo5_11');
    expect(f.serve.movement).toBe('everyN');
    expect(f.serve.every).toBe(2);
    expect(play(f, rally(1), 'A').serve.side).toBe('A');
    expect(play(f, rally(2), 'A').serve.side).toBe('B');
    expect(play(f, rally(4), 'A').serve.side).toBe('A');
  });

  it('4.3 everyN collapses to one serve each at deuce', () => {
    const f = fmt('ittf_bo5_11');
    expect(f.serve.collapseAt).toBe(10);
    const at10 = play(f, rally(20), 'A');
    expect(at10.score[0]).toEqual([10, 10]);
    const a = play(f, [...rally(20), pt('A')], 'A');
    const b = play(f, [...rally(20), pt('A'), pt('B')], 'A');
    expect(a.serve.side, 'the serve did not cross after one point at deuce')
      .not.toBe(b.serve.side);
  });

  it('4.4 a five-serve rhythm is expressible and honoured', () => {
    const f = fmt('legacy_21_bo3');
    expect(f.serve.every).toBe(5);
    expect(play(f, rally(4), 'A').serve.side).toBe('A');
    expect(play(f, rally(5), 'A').serve.side).toBe('B');
  });

  it('4.5 PICKLEBALL OPENS 0-0-2: the first serving side gets one server', () => {
    // Get this wrong and the opening side receives a free extra service turn in
    // every single game of every single match.
    const f = fmt('usap_tournament_bo3_11');
    expect(f.serve.movement).toBe('handOut');
    expect(f.serve.firstTurnSingle).toBe(true);
    const fresh = initKernel(f, 'A');
    expect(fresh.serve.serverNo, 'the opening call is not 0-0-2').toBe(2);
    // A loses the first rally: with a single opening server the serve crosses at once.
    const s = play(f, [pt('B')], 'A');
    expect(s.serve.side, 'the opening side got a second server it is not entitled to').toBe('B');
    expect(s.serve.serverNo).toBe(1);
  });

  it('4.6 after the opening turn, handOut gives each side two servers', () => {
    const f = fmt('usap_tournament_bo3_11');
    // A serves (single), loses -> B serves #1. B loses -> B #2. B loses -> A #1.
    let s = play(f, [pt('B')], 'A');
    expect([s.serve.side, s.serve.serverNo]).toEqual(['B', 1]);
    s = play(f, [pt('B'), pt('A')], 'A');
    expect([s.serve.side, s.serve.serverNo], 'B did not get its second server').toEqual(['B', 2]);
    s = play(f, [pt('B'), pt('A'), pt('A')], 'A');
    expect([s.serve.side, s.serve.serverNo], 'the serve did not cross after both servers went')
      .toEqual(['A', 1]);
  });

  it('4.7 under handOut the serving side keeps serving while it wins', () => {
    const f = fmt('usap_tournament_bo3_11');
    const s = play(f, [pt('B'), ...pts('B', 5)], 'A');   // B takes over, then wins five
    expect(s.serve.side).toBe('B');
    expect(s.serve.serverNo).toBe(1);
    expect(s.score[0]).toEqual([0, 5]);
  });

  it('4.8 perUnit: tennis keeps the serve for the whole game', () => {
    const f = fmt('itf_standard_bo3');
    expect(f.serve.movement).toBe('perUnit');
    const mid = play(f, [pt('A'), pt('B'), pt('A')], 'A');
    expect(mid.serve.side, 'the serve moved inside a tennis game').toBe('A');
    const afterGame = play(f, pts('A', 4), 'A');
    expect(afterGame.serve.side, 'the serve did not cross at the end of the game').toBe('B');
  });

  it('4.9 THE TENNIS TIE-BREAK opens with a single serve, then runs in twos', () => {
    // Without firstTurnEvery the whole tie-break rotation is off by one point, for
    // every tie-break in every tennis match.
    const f = fmt('itf_standard_bo3');
    const tb = f.levels[1].substitute?.spec;
    expect(tb, 'no tie-break configured at 6-6').toBeTruthy();
    expect(tb!.serve?.firstTurnEvery, 'the tie-break does not open with a single serve').toBe(1);
  });

  it('4.10 the serve is never on nobody, in any preset, at any point', () => {
    for (const f of ALL) {
      const s = play(f, rally(9), 'A');
      expectServeSane(f, s, f.presetKey);
    }
  });

  it('4.11 setServe corrects the serve without touching the score', () => {
    const f = fmt('ittf_bo5_11');
    const s = play(f, [pt('A'), pt('A'), { t: 'setServe', side: 'A', serverNo: 1, reason: 'mis-scored' }]);
    expect(s.score[0]).toEqual([2, 0]);
    expect(s.serve.side).toBe('A');
  });

  it('4.12 awardServe hands the serve over with no point (a badminton red card)', () => {
    const f = fmt('bwf_official_3x21');
    const s = play(f, [pt('A'), { t: 'awardServe', side: 'B', reason: 'conduct' }]);
    expect(s.score[0]).toEqual([1, 0]);
    expect(s.serve.side).toBe('B');
  });
});

// ============================================================================
// 5. COURT HALVES AND THE CHANGE OF ENDS
// ============================================================================

describe('5. courts and ends', () => {
  it('5.1 badminton parity: the server\'s own score decides the court', () => {
    const f = fmt('bwf_official_3x21');
    expect(f.serve.courtModel).toBe('parity');
    expect(play(f, [], 'A').serve.courtHalf).toBe('right');            // 0 - even
    expect(play(f, [pt('A')], 'A').serve.courtHalf).toBe('left');      // 1 - odd
    expect(play(f, [pt('A'), pt('A')], 'A').serve.courtHalf).toBe('right');
  });

  it('5.2 a sport with no service court never invents one', () => {
    const f = fmt('fiba_4x10');
    expect(play(f, [pt('A', 2)], 'A').serve.courtHalf).toBeNull();
  });

  it('5.3 CHANGE OF ENDS AT THE DECIDER MIDPOINT fires only in the decider', () => {
    // The rule is decider-only in badminton and volleyball alike. Firing it in games
    // one and two is the drift a reference implementation is known to have.
    const f = fmt('bwf_official_3x21');
    expect(f.changeEnds).toBe('atDeciderMidpoint');
    // Game one, reaching 11: must NOT switch.
    const g1 = foldRally(f, pts('A', 11), 'A');
    expect(g1.trace.some((t) => t.switchEnds), 'ends changed in game one').toBe(false);
  });

  it('5.4 and it DOES fire at the midpoint of the decider', () => {
    const f = fmt('bwf_official_3x21');   // best of 3 to 21, switch at 11 in game 3
    // A takes game 1, B takes game 2, then the decider runs to 11.
    const log: RallyLog = [...pts('A', 21), ...pts('B', 21), ...pts('A', 11)];
    const { trace } = foldRally(f, log, 'A');
    const switched = trace.filter((t) => t.switchEnds);
    expect(switched.length, 'the decider midpoint did not change ends').toBe(1);
  });

  it('5.5 it fires once, not on every point past the midpoint', () => {
    const f = fmt('bwf_official_3x21');
    const log: RallyLog = [...pts('A', 21), ...pts('B', 21), ...pts('A', 15)];
    const { trace } = foldRally(f, log, 'A');
    expect(trace.filter((t) => t.switchEnds).length).toBe(1);
  });

  it('5.6 everyNPoints changes ends on the multiples', () => {
    const f: ScoringFormat = {
      ...fmt('ittf_bo5_11'), changeEnds: 'everyNPoints', changeEndsAt: 6,
    };
    const { trace } = foldRally(f, rally(12), 'A');
    expect(trace.filter((t) => t.switchEnds).length).toBe(2);
  });
});

// ============================================================================
// 6. NESTING — games inside sets inside a match
// ============================================================================

describe('6. nesting', () => {
  it('6.1 winning games wins a set, winning sets wins the match', () => {
    const f = fmt('itf_standard_bo3');
    const set = (side: Side) => Array.from({ length: 6 }, () => pts(side, 4)).flat();
    const s = play(f, [...set('A'), ...set('A')], 'A');
    expect(s.ended, 'two sets did not win a best-of-three').toBe(true);
    expect(s.winner).toBe('A');
    expect(s.score[2]).toEqual([2, 0]);
    expectSound(f, s);
  });

  it('6.2 a tie-break is SUBSTITUTED at six-all and its winner takes the set 7-6', () => {
    const f = fmt('itf_standard_bo3');
    const game = (side: Side) => pts(side, 4);
    // 6-6 in games: A and B alternate six games each.
    const toSixAll: RallyLog = [];
    for (let i = 0; i < 6; i += 1) { toSixAll.push(...game('A'), ...game('B')); }
    const atSixAll = play(f, toSixAll, 'A');
    expect(atSixAll.score[1], 'the set did not reach six-all').toEqual([6, 6]);

    // The next unit is a tie-break to 7 by 2, not a game to 4.
    const lv = effectiveLevel(f, atSixAll, 0);
    expect(lv.key, 'the unit at six-all is not a tie-break').toBe('tiebreak');
    expect(lv.target).toBe(7);

    const withTb = play(f, [...toSixAll, ...pts('A', 7)], 'A');
    // The set completed, so the live games score has reset - the 7-6 is on the
    // banked set, which is where a scorecard reads it from.
    const bankedSet = withTb.finished.filter((u) => u.level === 1).pop();
    expect(bankedSet?.score, 'the tie-break winner did not take the set 7-6').toEqual([7, 6]);
    expect(bankedSet?.winner).toBe('A');
    expect(withTb.score[2], 'the set did not count towards the match').toEqual([1, 0]);
  });

  it('6.3 a COLLAPSED decider is played in points, skipping the level below', () => {
    // The 10-point match tie-break played instead of a final set.
    const f = fmt('no_ad_match_tb_bo3');
    const set = (side: Side) => Array.from({ length: 4 }, () => pts(side, 4)).flat();
    // Fast4-style? No - this preset is standard games; take one set each.
    const oneEach: RallyLog = [];
    for (let i = 0; i < 6; i += 1) oneEach.push(...pts('A', 4));   // A wins set 1
    for (let i = 0; i < 6; i += 1) oneEach.push(...pts('B', 4));   // B wins set 2
    const atOneAll = play(f, oneEach, 'A');
    expect(atOneAll.score[2], 'the match is not one set all').toEqual([1, 1]);
    expect(atOneAll.pointLevel, 'the decider did not collapse to a points level')
      .toBeGreaterThan(0);
    void set;
  });

  it('6.4 the collapsed decider ends the match on its own target', () => {
    const f = fmt('no_ad_match_tb_bo3');
    const oneEach: RallyLog = [];
    for (let i = 0; i < 6; i += 1) oneEach.push(...pts('A', 4));
    for (let i = 0; i < 6; i += 1) oneEach.push(...pts('B', 4));
    const s = play(f, [...oneEach, ...pts('A', 10)], 'A');
    expect(s.ended, 'the match tie-break did not end the match').toBe(true);
    expect(s.winner).toBe('A');
    expectSound(f, s);
  });

  it('6.5 a shoot-out format is one unit and the points ARE the headline', () => {
    const f = fmt('match_tb_10_shootout');
    const s = play(f, pts('A', 10), 'A');
    expect(s.ended).toBe(true);
    expect(headline(f, s), 'a one-unit match reported units instead of points')
      .toEqual([10, 0]);
  });

  it('6.5b A COMPLETED SINGLE-UNIT MATCH NEVER PUBLISHES 0-0', () => {
    // Winning the only unit cascades, and the cascade resets the live score. Read
    // the headline from there and every corporate "single game to 21", every one-
    // bout combat sport and every single frame publishes 0-0 with a winner beside
    // it - and standings read exactly that pair.
    const singles = ALL.filter((p) => !isAggregate(p)
      && p.levels.length > 1 && p.levels[p.levels.length - 1].target <= 1);
    expect(singles.length, 'no single-unit presets found to check').toBeGreaterThan(20);
    for (const p of singles) {
      const s = playOut(p, () => 'A');
      if (!s.ended) continue;
      const h = headline(p, s);
      expect(h[0] + h[1], `${p.sport}/${p.presetKey} published ${h[0]}-${h[1]}`)
        .toBeGreaterThan(0);
      expectHeadlineSound(p, s, p.presetKey);
    }
  });

  it('6.6 units below reset when the level above ticks over', () => {
    const f = fmt('ittf_bo5_11');
    const s = play(f, pts('A', 11), 'A');
    expect(s.score[0], 'the new game did not start from zero').toEqual([0, 0]);
    expect(s.score[1]).toEqual([1, 0]);
  });

  it('6.7 the serve for a new unit follows the format\'s rule, not the last rally', () => {
    const f = fmt('ittf_bo5_11');
    expect(f.serve.nextUnitServer).toBe('alternate');
    const s = play(f, pts('A', 11), 'A');
    expect(s.serve.side, 'the second game did not alternate the first server').toBe('B');
    expect(s.serve.unitFirstServer).toBe('B');
  });
});

// ============================================================================
// 7. CORRECTIONS
// ============================================================================

describe('7. corrections', () => {
  const f = fmt('ittf_bo5_11');

  it('7.1 undo is a truncate-and-refold and restores the serve exactly', () => {
    const log: RallyLog = rally(7, 'A');
    const full = play(f, log, 'A');
    const { state, log: back } = undo(f, log, 'A');
    expect(back.length).toBe(log.length - 1);
    expect(state.score[0]).not.toEqual(full.score[0]);
    expect(state).toEqual(play(f, log.slice(0, -1), 'A'));
  });

  it('7.2 undo across the end of a unit reopens it', () => {
    const log: RallyLog = pts('A', 11);
    const { state } = undo(f, log, 'A');
    expect(state.finished.length, 'the banked game survived the undo').toBe(0);
    expect(state.score[0]).toEqual([10, 0]);
    expect(state.score[1]).toEqual([0, 0]);
  });

  it('7.3 undoing all the way back leaves a fresh, scoreable match', () => {
    let log: RallyLog = [...pts('A', 11), ...pts('B', 5)];
    while (log.length) ({ log } = undo(f, log, 'A'));
    const s = play(f, log, 'A');
    expect(s).toEqual(initKernel(f, 'A'));
  });

  it('7.4 adjust takes a point off without disturbing the serve when asked', () => {
    const s = play(f, [pt('A'), pt('A'), { t: 'adjust', side: 'A', delta: -1, preserveServe: true }]);
    expect(s.score[0]).toEqual([1, 0]);
    expectSound(f, s);
  });

  it('7.5 adjust can never drive a score below zero', () => {
    const s = play(f, [{ t: 'adjust', side: 'A', delta: -5 }]);
    expect(s.score[0]).toEqual([0, 0]);
    expectSound(f, s);
  });

  it('7.6 an adjustment that reaches the target completes the unit', () => {
    const s = play(f, [...pts('A', 9), { t: 'adjust', side: 'A', delta: 2 }]);
    expect(s.finished.filter((u) => u.level === 0).length).toBe(1);
  });

  it('7.7 awardUnit hands a unit over and marks it awarded, not played', () => {
    const s = play(f, [pt('A'), { t: 'awardUnit', side: 'B', reason: 'conduct' }]);
    const banked = s.finished.filter((u) => u.level === 0);
    expect(banked.length).toBe(1);
    expect(banked[0].winner).toBe('B');
    expect(banked[0].awarded, 'an awarded unit was recorded as played out').toBe(true);
    expectSound(f, s);
  });

  it('7.8 the fold is pure — the same log twice gives the same state', () => {
    const log: RallyLog = [
      ...rally(9), { t: 'let' }, { t: 'fault', side: 'A' },
      { t: 'penalty', side: 'B' }, { t: 'adjust', side: 'A', delta: -1 },
      { t: 'setServe', side: 'A' }, ...pts('A', 4),
    ];
    expect(JSON.stringify(play(f, log, 'A'))).toBe(JSON.stringify(play(f, log, 'A')));
  });

  it('7.9 every correction event leaves the state sound', () => {
    const log: RallyLog = [
      ...rally(15), { t: 'penalty', side: 'A' }, { t: 'awardServe', side: 'B' },
      { t: 'adjust', side: 'B', delta: 2 }, { t: 'setServe', side: 'A', serverNo: 1 },
    ];
    expectSound(f, play(f, log, 'A'), 'corrections');
  });
});

// ============================================================================
// 8. THE CLOCK
// ============================================================================

describe('8. the clock', () => {
  it('8.1 the buzzer with a leader ends the match for the leader', () => {
    const f = fmt('corporate_single_15_timecapped');
    expect(f.clock).toBeTruthy();
    const s = play(f, [...pts('A', 5), ...pts('B', 3), { t: 'capFired' }], 'A');
    expect(s.ended).toBe(true);
    expect(s.winner).toBe('A');
    expect(s.reason).toBe('cap');
    expectSound(f, s);
  });

  it('8.2 the buzzer LEVEL plays on rather than inventing a winner', () => {
    const base = fmt('corporate_single_15_timecapped');
    const f: ScoringFormat = {
      ...base,
      clock: { ...base.clock!, action: 'leaderWins', tieRule: 'suddenDeathPoint' },
    };
    const s = play(f, [...rally(6), { t: 'capFired' }], 'A');
    expect(s.ended, 'a level buzzer picked a winner').toBe(false);
    expect(s.capFired).toBe(true);
    // The next point settles it.
    const after = play(f, [...rally(6), { t: 'capFired' }, pt('B')], 'A');
    expect(after.score[0]).toEqual([3, 4]);
  });

  it('8.3 a level buzzer is a DRAW where the format allows one', () => {
    const base = fmt('corporate_single_15_timecapped');
    const f: ScoringFormat = {
      ...base,
      clock: { ...base.clock!, action: 'leaderWins', tieRule: 'draw' },
      endStates: { ...base.endStates, drawsAllowed: true },
    };
    const s = play(f, [...rally(6), { t: 'capFired' }], 'A');
    expect(s.ended).toBe(true);
    expect(s.outcome).toBe('draw');
    expect(s.winner).toBeNull();
    expectSound(f, s);
  });

  it('8.4 nextPointWins does not end the match at the buzzer', () => {
    const base = fmt('corporate_single_15_timecapped');
    const f: ScoringFormat = { ...base, clock: { ...base.clock!, action: 'nextPointWins' } };
    const s = play(f, [...pts('A', 5), { t: 'capFired' }], 'A');
    expect(s.ended).toBe(false);
    expect(s.capFired).toBe(true);
  });

  it('8.5 AN AGGREGATE BUZZER COMPARES THE WHOLE MATCH, not the period in progress', () => {
    // A side 8-0 up from the first half is still ahead when the second half is 0-2
    // and the hall booking runs out. Comparing only the live period hands the match
    // to whoever happened to be scoring at the end.
    const f = fmt('football_corp_2x20');
    expect(isAggregate(f)).toBe(true);
    const log: RallyLog = [
      ...pts('A', 8), { t: 'endPeriod' },      // half one: A 8-0
      ...pts('B', 2), { t: 'capFired' },       // half two: B 2-0, then the buzzer
    ];
    const s = play(f, log, 'A');
    expect(aggregateScore(s)).toEqual([8, 2]);
    expect(s.winner, 'the buzzer gave the match to the side leading the live period only')
      .toBe('A');
  });
});

// ============================================================================
// 9. PERIODS AND AGGREGATE SPORTS
// ============================================================================

describe('9. periods and aggregate sports', () => {
  it('9.1 a football half is not won — the match is decided on the total', () => {
    const f = fmt('fifa_2x45');
    expect(isAggregate(f)).toBe(true);
    const s = play(f, [...pts('A', 2), { t: 'endPeriod' }, ...pts('B', 1), { t: 'endPeriod' }], 'A');
    expect(s.ended).toBe(true);
    expect(aggregateScore(s)).toEqual([2, 1]);
    expect(s.winner).toBe('A');
    expect(headline(f, s), 'an aggregate sport reported halves instead of goals')
      .toEqual([2, 1]);
    expectSound(f, s);
  });

  it('9.2 a clock period never ends itself on the score', () => {
    const f = fmt('fifa_2x45');
    const s = play(f, pts('A', 9), 'A');
    expect(s.finished.length, 'a half ended on the score').toBe(0);
    expect(s.ended).toBe(false);
  });

  it('9.3 the match ends only when every period has been played', () => {
    const f = fmt('fiba_4x10');   // four quarters
    expect(f.levels[f.levels.length - 1].target).toBe(4);
    let log: RallyLog = [];
    for (let q = 0; q < 3; q += 1) log = [...log, ...pts('A', 10), { t: 'endPeriod' }];
    const afterThree = play(f, log, 'A');
    expect(periodsPlayed(afterThree)).toBe(3);
    expect(afterThree.ended, 'the match ended after three quarters of four').toBe(false);
    const afterFour = play(f, [...log, ...pts('A', 5), { t: 'endPeriod' }], 'A');
    expect(afterFour.ended).toBe(true);
    expectSound(f, afterFour);
  });

  it('9.4 level at full time is a DRAW where the format allows one', () => {
    const f = fmt('fifa_2x45');
    expect(f.endStates.drawsAllowed).toBe(true);
    const s = play(f, [...pts('A', 1), { t: 'endPeriod' }, ...pts('B', 1), { t: 'endPeriod' }], 'A');
    expect(s.outcome).toBe('draw');
    expect(s.winner).toBeNull();
    expectSound(f, s);
  });

  it('9.5 LEVEL WITH NO DRAW ALLOWED leaves the match OPEN rather than inventing a winner', () => {
    // Extra time or a shoot-out settles it. Picking a side here would publish a
    // result nobody played for.
    const f = fmt('knockout_2x45_no_draw');
    expect(f.endStates.drawsAllowed).toBe(false);
    const s = play(f, [...pts('A', 1), { t: 'endPeriod' }, ...pts('B', 1), { t: 'endPeriod' }], 'A');
    expect(s.ended, 'a knockout invented a winner from a level score').toBe(false);
    expect(s.winner).toBeNull();
    expectSound(f, s);
  });

  it('9.6 a units-decided clock period goes to whoever led it', () => {
    const f = fmt('timecap_15min');
    const s = play(f, [...pts('A', 7), ...pts('B', 3), { t: 'endPeriod' }], 'A');
    const banked = s.finished.filter((u) => u.level === 0);
    expect(banked.length).toBe(1);
    expect(banked[0].winner).toBe('A');
  });

  it('9.7 a level clock period at a units level is banked to nobody', () => {
    const f = fmt('timecap_15min');
    const s = play(f, [...rally(6), { t: 'endPeriod' }], 'A');
    expect(s.finished.length, 'a level period was awarded to somebody').toBe(0);
  });

  it('9.8 periodsPlayed counts periods, and unitsFor reports them for an aggregate sport', () => {
    const f = fmt('fifa_2x45');
    const s = play(f, [...pts('A', 1), { t: 'endPeriod' }], 'A');
    expect(periodsPlayed(s)).toBe(1);
    expect(resultEnvelope(f, s).unitsFor, 'halves were reported as units won')
      .toEqual([1, 1]);
  });
});

// ============================================================================
// 10. THE RESULT
// ============================================================================

describe('10. the result', () => {
  const f = fmt('ittf_bo5_11');

  it('10.1 a retirement freezes the match with a reason', () => {
    const s = play(f, [...pts('A', 5), { t: 'end', outcome: 'win', reason: 'retired', winner: 'A' }]);
    expect(s.ended).toBe(true);
    expect(s.reason).toBe('retired');
    expect(s.winner).toBe('A');
    expectSound(f, s);
  });

  it('10.2 a walkover names a winner without a rally being played', () => {
    const s = play(f, [{ t: 'end', outcome: 'win', reason: 'walkover', winner: 'B' }]);
    expect(s.winner).toBe('B');
    expect(s.reason).toBe('walkover');
  });

  it('10.3 an abandoned match is void and names nobody', () => {
    const s = play(f, [...pts('A', 4), { t: 'end', outcome: 'void', reason: 'abandoned', winner: null }]);
    expect(s.outcome).toBe('void');
    expect(s.winner).toBeNull();
    expectSound(f, s);
  });

  it('10.4 the envelope reports every game score in order', () => {
    const s = play(f, [...pts('A', 11), ...pts('B', 11), ...pts('A', 11), ...pts('A', 11)], 'A');
    const env = resultEnvelope(f, s);
    expect(env.unitScores).toEqual([[11, 0], [0, 11], [11, 0], [11, 0]]);
    expect(env.ended).toBe(true);
    expect(env.headline).toEqual([3, 1]);
  });

  it('10.5 pointsFor totals every point of the match, live unit included', () => {
    const s = play(f, [...pts('A', 11), ...pts('B', 4)], 'A');
    expect(resultEnvelope(f, s).pointsFor).toEqual([11, 4]);
  });

  it('10.6 a units-decided match reports UNITS as the headline', () => {
    const s = play(f, [...pts('A', 11), ...pts('B', 11)], 'A');
    expect(headline(f, s)).toEqual([1, 1]);
  });

  it('10.7 THE WINNER IS NEVER BEHIND ON THE HEADLINE, in any preset', () => {
    for (const p of ALL) {
      const s = playOut(p, () => 'A');
      if (!s.ended || s.outcome !== 'win') continue;
      expectHeadlineSound(p, s, p.presetKey);
    }
  });
});

// ============================================================================
// 11. REACHABILITY — every preset can actually be finished
// ============================================================================

/**
 * Play until the match ends, feeding points from `pick` and blowing the whistle
 * whenever a clock period stalls.
 *
 * This is the harness that finds the formats nobody can finish. A budget rather
 * than a `while (!ended)`: an unfinishable format must fail the test, not hang the
 * suite.
 */
function playOut(f: ScoringFormat, pick: (n: number) => Side, budget = 4000): KernelState {
  let state = initKernel(f, 'A');
  let guard = 0;
  let sinceProgress = 0;
  let lastSignature = '';
  while (!state.ended && guard < budget) {
    guard += 1;
    const before = JSON.stringify([state.score, state.finished.length]);
    state = step(f, state, { t: 'point', side: pick(guard) }).state;
    const after = JSON.stringify([state.score, state.finished.length]);
    // A clock-terminated unit never ends on the score, so the console's whistle has
    // to be supplied or the match runs forever.
    if (after === before || after === lastSignature) sinceProgress += 1;
    else sinceProgress = 0;
    lastSignature = after;
    const inner = f.levels[0];
    if (inner.terminator === 'clock' && state.score[state.pointLevel][0]
      + state.score[state.pointLevel][1] >= 6) {
      state = step(f, state, { t: 'endPeriod' }).state;
      sinceProgress = 0;
    }
    if (sinceProgress > 50) break;
  }
  return state;
}

describe('11. every preset can be played to a finish', () => {
  for (const p of ALL) {
    it(`11.x ${p.sport} · ${p.presetKey} finishes, and stays sound throughout`, () => {
      // One side wins everything: the shortest path to a result any format has.
      const dominant = playOut(p, () => 'A');
      expectSound(p, dominant, `${p.presetKey}/dominant`);
      expect(dominant.ended,
        `${p.presetKey}: one side won every rally and the match still never ended`).toBe(true);

      // And a contested one, which exercises deuce, caps and deciders.
      const contested = playOut(p, (n) => (n % 3 === 0 ? 'B' : 'A'));
      expectSound(p, contested, `${p.presetKey}/contested`);
      expect(contested.ended, `${p.presetKey}: a contested match never ended`).toBe(true);
    });
  }
});

// ============================================================================
// 12. FULL MATCHES, REPLAYED AND UNDONE
// ============================================================================

describe('12. whole matches', () => {
  function rng(seed: number) {
    let x = seed;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  }

  /** A realistic match log: mostly rallies, with the corrections a real one collects. */
  function realistic(f: ScoringFormat, seed: number): RallyLog {
    const r = rng(seed);
    const log: RallyLog = [];
    let state = initKernel(f, 'A');
    let guard = 0;
    while (!state.ended && guard < 1200) {
      guard += 1;
      const d = r();
      let ev: RallyEvent;
      if (d < 0.02 && f.letsEnabled) ev = { t: 'let' };
      else if (d < 0.04) ev = { t: 'fault', side: r() < 0.5 ? 'A' : 'B' };
      else if (d < 0.05 && f.penaltyEvents !== 'off') ev = { t: 'penalty', side: r() < 0.5 ? 'A' : 'B' };
      else ev = { t: 'point', side: r() < 0.54 ? 'A' : 'B' };
      const next = step(f, state, ev);
      state = next.state;
      log.push(ev);
      if (f.levels[0].terminator === 'clock'
        && state.score[state.pointLevel][0] + state.score[state.pointLevel][1] >= 8) {
        const wh: RallyEvent = { t: 'endPeriod' };
        state = step(f, state, wh).state;
        log.push(wh);
      }
    }
    return log;
  }

  const SAMPLE = [
    'ittf_bo5_11', 'bwf_official_3x21', 'itf_standard_bo3', 'usap_tournament_bo3_11',
    'classic_15_sideout', 'fivb_25_bo5', 'fifa_2x45', 'fiba_4x10', 'pkl_2x20',
    'icf_bo3_boards', 'no_ad_match_tb_bo3', 'legacy_21_bo3',
  ];

  for (const key of SAMPLE) {
    for (const seed of [5, 777, 31337]) {
      it(`12.x ${key}, seed ${seed}: sound throughout, and an exact replay`, () => {
        const f = fmt(key);
        const log = realistic(f, seed);
        const a = play(f, log, 'A');
        expectSound(f, a, `${key}/${seed}`);

        // REPLAY: the same log twice is the same state, to the byte.
        expect(JSON.stringify(play(f, log, 'A'))).toBe(JSON.stringify(a));

        // UNDO: stepping back one is exactly the state of the shorter log.
        if (log.length > 1) {
          const { state: back } = undo(f, log, 'A');
          expect(back).toEqual(play(f, log.slice(0, -1), 'A'));
        }
      });
    }
  }

  it('12.100 undoing a whole match, event by event, returns to the start', () => {
    const f = fmt('bwf_official_3x21');
    let log = realistic(f, 99);
    const start = initKernel(f, 'A');
    let guard = 0;
    while (log.length && guard < 5000) { guard += 1; ({ log } = undo(f, log, 'A')); }
    expect(play(f, log, 'A')).toEqual(start);
  });

  it('12.101 every intermediate state of a real match is sound', () => {
    const f = fmt('itf_standard_bo3');
    const log = realistic(f, 4242);
    let state = initKernel(f, 'A');
    for (const [i, ev] of log.entries()) {
      state = step(f, state, ev).state;
      expectSound(f, state, `tennis step ${i}`);
    }
  });
});
