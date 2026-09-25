import { describe, expect, it } from 'vitest';
import {
  ALL_STAT_SPECS, deriveRacquetStats, foldCareerStats, headlineMetricsFor, metricsFor,
  statSpecFor,
  type SportStatSpec, type StatBag,
} from './stat-registry.js';
import { RACQUET_PRESETS, presetByKey } from './racquet-presets.js';
import { TEAM_PRESETS } from './team-presets.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import type { RallyEvent, RallyLog } from './rally-kernel.js';

// ============================================================================
// PLAYER STATISTICS REGRESSION SUITE — everything that is not cricket.
//
// Cricket's figures are hand-entered by a scorer who can see them. EVERY OTHER
// SPORT'S are DERIVED: nobody taps "that was a service point won on a break point
// in the decider" - the kernel already knows, and this module reads it back off the
// rally log. Which means a defect here is completely invisible at the venue and
// surfaces weeks later on somebody's profile, with no way to check it against
// anything.
//
// `stat-registry.ts` is 675 lines and had no tests at all.
//
// THE FIVE INVARIANTS:
//
//   REGISTRY      every metric an event feeds, a rate divides by, or a formula
//                 references, is a metric that actually exists. A typo here is a
//                 statistic that silently never appears.
//   CONSERVED     one side's points won are the other's points lost, exactly.
//                 The same for games, sets and every other paired tally.
//   BOUNDED       no "won" tally ever exceeds the "played" tally it came from.
//                 Service points won > service points played is a percentage
//                 above 100 on somebody's profile.
//   OUTCOME       every match produces exactly one win and one loss, or two draws,
//                 and one appearance for each side. Never two winners.
//   CAREER        rates are computed from the folded totals, never averaged from
//                 per-match rates - averaging percentages is simply wrong, and it
//                 is the commonest error in a hand-built stats rollup.
// ============================================================================

const fmt = (key: string): ScoringFormat => {
  const f = [...RACQUET_PRESETS, ...TEAM_PRESETS].find((p) => p.presetKey === key);
  if (!f) throw new Error(`no preset ${key}`);
  return f;
};

const pt = (side: Side): RallyEvent => ({ t: 'point', side });
const pts = (side: Side, n: number): RallyLog => Array.from({ length: n }, () => pt(side));
const rally = (n: number, first: Side = 'A'): RallyLog =>
  Array.from({ length: n }, (_, i) => pt(i % 2 === 0 ? first : (first === 'A' ? 'B' : 'A')));

const n = (bag: StatBag, key: string) => bag[key] ?? 0;

// ---- invariants ----

/** Paired tallies: what one side won, the other lost. Exactly. */
function expectConserved(sides: Record<Side, StatBag>, note = '') {
  const pairs: Array<[string, string]> = [
    ['points_won', 'points_lost'],
    ['games_won', 'games_lost'],
    ['sets_won', 'sets_lost'],
    ['tiebreaks_won', 'tiebreaks_lost'],
    ['deciders_won', 'deciders_lost'],
    ['wins', 'losses'],
  ];
  for (const [won, lost] of pairs) {
    expect(n(sides.A, won), `CONSERVED ${note} A.${won}=${n(sides.A, won)} but B.${lost}=${n(sides.B, lost)}`)
      .toBe(n(sides.B, lost));
    expect(n(sides.B, won), `CONSERVED ${note} B.${won}=${n(sides.B, won)} but A.${lost}=${n(sides.A, lost)}`)
      .toBe(n(sides.A, lost));
  }
  expect(n(sides.A, 'draws'), `CONSERVED ${note} draws disagree`).toBe(n(sides.B, 'draws'));
  expect(n(sides.A, 'matches'), `CONSERVED ${note} appearances disagree`).toBe(n(sides.B, 'matches'));
}

/** No "won" tally ever exceeds the "played" tally it came out of. */
function expectBounded(sides: Record<Side, StatBag>, note = '') {
  const withins: Array<[string, string]> = [
    ['service_points_won', 'service_points_played'],
    ['return_points_won', 'return_points_played'],
    ['deuce_points_won', 'deuce_points_played'],
    ['break_points_won', 'break_points_played'],
  ];
  for (const side of ['A', 'B'] as Side[]) {
    for (const [won, played] of withins) {
      expect(n(sides[side], won),
        `BOUNDED ${note} ${side}.${won}=${n(sides[side], won)} exceeds ${played}=${n(sides[side], played)}`)
        .toBeLessThanOrEqual(n(sides[side], played));
    }
    for (const [k, v] of Object.entries(sides[side])) {
      expect(v, `BOUNDED ${note} ${side}.${k} is negative`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(v), `BOUNDED ${note} ${side}.${k} is not a number`).toBe(true);
    }
  }
}

function expectOutcomeSound(sides: Record<Side, StatBag>, note = '') {
  const wins = n(sides.A, 'wins') + n(sides.B, 'wins');
  const losses = n(sides.A, 'losses') + n(sides.B, 'losses');
  const draws = n(sides.A, 'draws') + n(sides.B, 'draws');
  expect(n(sides.A, 'matches'), `OUTCOME ${note} A did not get an appearance`).toBe(1);
  expect(n(sides.B, 'matches'), `OUTCOME ${note} B did not get an appearance`).toBe(1);
  if (draws) {
    expect(draws, `OUTCOME ${note} a draw was recorded for only one side`).toBe(2);
    expect(wins + losses, `OUTCOME ${note} a drawn match also recorded a win`).toBe(0);
  } else {
    expect(wins, `OUTCOME ${note} ${wins} winners`).toBeLessThanOrEqual(1);
    expect(wins, `OUTCOME ${note} a win without a loss`).toBe(losses);
  }
}

function expectStatsSound(sides: Record<Side, StatBag>, note = '') {
  expectConserved(sides, note);
  expectBounded(sides, note);
  expectOutcomeSound(sides, note);
}

// ============================================================================
// 1. THE REGISTRY IS INTERNALLY CONSISTENT
// ============================================================================

describe('1. the stat registry', () => {
  it('1.1 every sport has metrics, and no sport is declared twice', () => {
    expect(ALL_STAT_SPECS.length, 'no stat specs at all').toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const s of ALL_STAT_SPECS) {
      expect(seen.has(s.sport), `${s.sport} is declared twice`).toBe(false);
      seen.add(s.sport);
      expect(s.metrics.length, `${s.sport}: no metrics`).toBeGreaterThan(0);
      expect(s.sport, `${s.sport}: sport names are looked up lowercased`).toBe(s.sport.toLowerCase());
    }
  });

  it('1.2 metric keys are unique within a sport', () => {
    for (const s of ALL_STAT_SPECS) {
      const keys = s.metrics.map((m) => m.key);
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(dupes, `${s.sport}: duplicate metric keys ${dupes.join(',')}`).toEqual([]);
    }
  });

  it('1.3 every metric has a label and a column header', () => {
    for (const s of ALL_STAT_SPECS) {
      for (const m of s.metrics) {
        expect(m.label?.trim(), `${s.sport}/${m.key}: no label`).toBeTruthy();
        expect(m.short?.trim(), `${s.sport}/${m.key}: no column header`).toBeTruthy();
        expect(m.short.length, `${s.sport}/${m.key}: "${m.short}" is too wide for a dense table`)
          .toBeLessThanOrEqual(6);
      }
    }
  });

  it('1.4 A RATE DIVIDES BY A METRIC THAT EXISTS', () => {
    // A typo in `rateOf` is a percentage that silently never appears on any profile.
    for (const s of ALL_STAT_SPECS) {
      const keys = new Set(s.metrics.map((m) => m.key));
      for (const m of s.metrics) {
        if (m.aggregate !== 'rate') continue;
        expect(m.rateOf, `${s.sport}/${m.key}: a rate with nothing to divide`).toBeTruthy();
        const [num, den] = m.rateOf!;
        expect(keys.has(num), `${s.sport}/${m.key}: numerator "${num}" is not a metric`).toBe(true);
        expect(keys.has(den), `${s.sport}/${m.key}: denominator "${den}" is not a metric`).toBe(true);
      }
    }
  });

  it('1.5 a derived formula references metrics that exist', () => {
    for (const s of ALL_STAT_SPECS) {
      const keys = new Set(s.metrics.map((m) => m.key));
      for (const m of s.metrics) {
        if (!m.formula) continue;
        for (const ref of m.formula.of) {
          expect(keys.has(ref), `${s.sport}/${m.key}: formula references "${ref}", which is not a metric`)
            .toBe(true);
        }
      }
    }
  });

  it('1.6 EVERY EVENT FEEDS A METRIC THAT EXISTS', () => {
    // A goal that credits "gols" instead of "goals" is a tap that scores nothing,
    // for ever, with nothing on screen saying so.
    for (const s of ALL_STAT_SPECS) {
      const keys = new Set(s.metrics.map((m) => m.key));
      for (const e of s.events ?? []) {
        expect(e.key?.trim(), `${s.sport}: an event with no key`).toBeTruthy();
        expect(e.label?.trim(), `${s.sport}/${e.key}: an event with no label`).toBeTruthy();
        for (const mk of Object.keys(e.metrics ?? {})) {
          expect(keys.has(mk), `${s.sport}/${e.key}: credits "${mk}", which is not a metric`).toBe(true);
        }
        for (const mk of Object.keys(e.secondPlayerMetrics ?? {})) {
          expect(keys.has(mk), `${s.sport}/${e.key}: the second player credits "${mk}", which is not a metric`)
            .toBe(true);
          expect(e.secondPlayer,
            `${s.sport}/${e.key}: credits a second player it never asks for`).toBeTruthy();
        }
      }
    }
  });

  it('1.6b EVERY RACQUET SPORT CAN RECORD AN ACE, not just tennis', () => {
    for (const sport of ['table tennis', 'badminton', 'tennis', 'pickleball', 'squash']) {
      const s = statSpecFor(sport)!;
      const keys = new Set(s.metrics.map((m) => m.key));
      expect(s.events.some((e) => e.key === 'ace'), `${sport}: no ace tap`).toBe(true);
      expect(keys.has('aces'), `${sport}: offers an Ace tap that credits nothing`).toBe(true);
      expect(keys.has('double_faults'), `${sport}: offers a Double fault tap that credits nothing`)
        .toBe(true);
    }
  });

  it('1.6c A VOLLEYBALL KILL SCORES A POINT FOR THE PLAYER WHO MADE IT', () => {
    for (const sport of ['volleyball', 'throwball']) {
      const s = statSpecFor(sport)!;
      const keys = new Set(s.metrics.map((m) => m.key));
      for (const tap of ['ace', 'kill', 'block_vb']) {
        const e = s.events.find((x) => x.key === tap)!;
        expect(e, `${sport}: no ${tap} tap`).toBeTruthy();
        for (const mk of Object.keys(e.metrics)) {
          expect(keys.has(mk), `${sport}/${tap}: credits "${mk}", which is not a metric`).toBe(true);
        }
      }
      expect(keys.has('points_scored'), `${sport}: no per-player points metric`).toBe(true);
    }
  });

  it('1.7 an event that names a second player asks for them properly', () => {
    for (const s of ALL_STAT_SPECS) {
      for (const e of s.events ?? []) {
        if (!e.secondPlayer) continue;
        expect(e.secondPlayer.key?.trim(), `${s.sport}/${e.key}: second player with no key`).toBeTruthy();
        expect(e.secondPlayer.label?.trim(), `${s.sport}/${e.key}: second player with no label`).toBeTruthy();
        expect(typeof e.secondPlayer.optional,
          `${s.sport}/${e.key}: does not say whether the second player is optional`).toBe('boolean');
      }
    }
  });

  it('1.8 an event carrying a magnitude declares a sane range', () => {
    for (const s of ALL_STAT_SPECS) {
      for (const e of s.events ?? []) {
        if (!e.value) continue;
        expect(e.value.label?.trim(), `${s.sport}/${e.key}: an unlabelled magnitude`).toBeTruthy();
        if (e.value.min !== undefined && e.value.max !== undefined) {
          expect(e.value.max, `${s.sport}/${e.key}: max below min`).toBeGreaterThanOrEqual(e.value.min);
        }
      }
    }
  });

  it('1.9 every sport offers at least one headline metric for the profile card', () => {
    for (const s of ALL_STAT_SPECS) {
      expect(headlineMetricsFor(s.sport).length, `${s.sport}: nothing to show on a profile card`)
        .toBeGreaterThan(0);
    }
  });

  it('1.10 a metric that is better when lower says so', () => {
    // Drives the sort direction and the colour. A "points lost" column sorted as if
    // more were better puts the worst performer at the top of the leaderboard.
    const lowerIsBetter = ['points_lost', 'games_lost', 'sets_lost', 'errors', 'faults',
      'runs_conceded', 'losses', 'tiebreaks_lost', 'deciders_lost'];
    for (const s of ALL_STAT_SPECS) {
      for (const m of s.metrics) {
        if (!lowerIsBetter.includes(m.key)) continue;
        expect(m.higherIsBetter, `${s.sport}/${m.key}: "${m.label}" claims more is better`)
          .toBe(false);
      }
    }
  });

  it('1.11 a sport resolves by name, trimmed and case-insensitively', () => {
    const known = ALL_STAT_SPECS[0].sport;
    expect(statSpecFor(known)?.sport).toBe(known);
    expect(statSpecFor(known.toUpperCase())?.sport).toBe(known);
    expect(statSpecFor(`  ${known} `)?.sport).toBe(known);
    expect(statSpecFor('not a sport')).toBeUndefined();
    expect(statSpecFor(null)).toBeUndefined();
    expect(metricsFor(null)).toEqual([]);
  });

  it('1.12 EVERY SCORED SPORT ON THE SHELF HAS SOMEWHERE TO PUT ITS STATS', () => {
    // A format with no stat spec plays fine and records nothing about anybody.
    const missing: string[] = [];
    for (const p of [...RACQUET_PRESETS, ...TEAM_PRESETS]) {
      if (!statSpecFor(p.sport)) missing.push(p.sport);
    }
    expect([...new Set(missing)], 'these sports can be scored but record no player stats')
      .toEqual([]);
  });
});

// ============================================================================
// 2. DERIVING A MATCH
// ============================================================================

describe('2. what one match produces', () => {
  const tt = fmt('ittf_bo5_11');

  it('2.1 a straightforward win produces one winner and one loser', () => {
    const { sides } = deriveRacquetStats(tt, [...pts('A', 11), ...pts('A', 11), ...pts('A', 11)], {});
    expect(n(sides.A, 'wins')).toBe(1);
    expect(n(sides.B, 'losses')).toBe(1);
    expect(n(sides.A, 'losses')).toBe(0);
    expectStatsSound(sides, 'straight win');
  });

  it('2.2 points won by one side are points lost by the other, exactly', () => {
    const { sides } = deriveRacquetStats(tt, rally(37), {});
    expect(n(sides.A, 'points_won')).toBe(n(sides.B, 'points_lost'));
    expect(n(sides.A, 'points_won') + n(sides.B, 'points_won')).toBe(37);
    expectConserved(sides, 'alternating');
  });

  it('2.3 games won and lost mirror each other', () => {
    const { sides } = deriveRacquetStats(tt, [...pts('A', 11), ...pts('B', 11), ...pts('A', 11)], {});
    expect(n(sides.A, 'games_won')).toBe(2);
    expect(n(sides.A, 'games_lost')).toBe(1);
    expect(n(sides.B, 'games_won')).toBe(1);
    expectConserved(sides, 'games');
  });

  it('2.4 every point has a server, so service and return account for all of them', () => {
    const { sides } = deriveRacquetStats(tt, rally(24), {});
    for (const side of ['A', 'B'] as Side[]) {
      const played = n(sides[side], 'points_won') + n(sides[side], 'points_lost');
      const split = n(sides[side], 'service_points_played') + n(sides[side], 'return_points_played');
      expect(split, `${side}: ${split} service+return points for ${played} points played`).toBe(played);
    }
  });

  it('2.5 a service point won is the receiver\'s return point lost', () => {
    const { sides } = deriveRacquetStats(tt, rally(24), {});
    const aServed = n(sides.A, 'service_points_played');
    expect(n(sides.B, 'return_points_played'), 'the return count does not mirror the service count')
      .toBe(aServed);
    expect(n(sides.A, 'service_points_won') + n(sides.B, 'return_points_won'),
      'service and return wins do not account for every point A served').toBe(aServed);
  });

  it('2.6 DEUCE POINTS ARE COUNTED FOR BOTH SIDES, and won by one', () => {
    const { sides } = deriveRacquetStats(tt, [...rally(20), pt('A'), pt('A')], {});
    expect(n(sides.A, 'deuce_points_played')).toBe(n(sides.B, 'deuce_points_played'));
    expect(n(sides.A, 'deuce_points_played'), 'no deuce points were recorded at 10-10')
      .toBeGreaterThan(0);
    expect(n(sides.A, 'deuce_points_won') + n(sides.B, 'deuce_points_won'))
      .toBe(n(sides.A, 'deuce_points_played'));
    expectBounded(sides, 'deuce');
  });

  it('2.7 a let is recorded for both sides and scores nothing', () => {
    const { sides } = deriveRacquetStats(tt, [pt('A'), { t: 'let' }, pt('A')], {});
    expect(n(sides.A, 'lets')).toBe(1);
    expect(n(sides.B, 'lets')).toBe(1);
    expect(n(sides.A, 'points_won')).toBe(2);
  });

  it('2.8 a fault belongs to the SERVING side only', () => {
    const { sides } = deriveRacquetStats(tt, [{ t: 'fault', side: 'A' }], { firstServer: 'A' });
    expect(n(sides.A, 'faults')).toBe(1);
    expect(n(sides.B, 'faults'), 'the receiver was charged with the server\'s fault').toBe(0);
  });

  it('2.9 a retirement is recorded against both sides, a walkover against one', () => {
    const r = deriveRacquetStats(tt, [...pts('A', 4),
      { t: 'end', outcome: 'win', reason: 'retired', winner: 'A' }], {});
    expect(n(r.sides.A, 'retirements')).toBe(1);
    expect(n(r.sides.B, 'retirements')).toBe(1);

    const w = deriveRacquetStats(tt, [{ t: 'end', outcome: 'win', reason: 'walkover', winner: 'B' }], {});
    expect(n(w.sides.B, 'walkovers_received')).toBe(1);
    expect(n(w.sides.A, 'walkovers_received')).toBe(0);
  });

  it('2.10 the longest streak is the longest run of points, not the total', () => {
    const { sides } = deriveRacquetStats(tt, [...pts('A', 5), pt('B'), ...pts('A', 3)], {});
    expect(n(sides.A, 'longest_streak')).toBe(5);
    expect(n(sides.B, 'longest_streak')).toBe(1);
  });

  it('2.11 A COMEBACK IS WINNING AFTER LOSING THE FIRST GAME', () => {
    const comeback = deriveRacquetStats(tt,
      [...pts('B', 11), ...pts('A', 11), ...pts('A', 11), ...pts('A', 11)], {});
    expect(n(comeback.sides.A, 'comeback_wins')).toBe(1);

    const straight = deriveRacquetStats(tt, [...pts('A', 11), ...pts('A', 11), ...pts('A', 11)], {});
    expect(n(straight.sides.A, 'comeback_wins'), 'a straight-games win was called a comeback').toBe(0);
  });

  it('2.12 a whitewash is winning without dropping a game', () => {
    const { sides } = deriveRacquetStats(tt, [...pts('A', 11), ...pts('A', 11), ...pts('A', 11)], {});
    expect(n(sides.A, 'whitewashes')).toBe(1);
    expect(n(sides.A, 'games_lost')).toBe(0);
  });

  it('2.13 a match dropping one game is NOT a whitewash', () => {
    const { sides } = deriveRacquetStats(tt,
      [...pts('A', 11), ...pts('B', 11), ...pts('A', 11), ...pts('A', 11)], {});
    expect(n(sides.A, 'whitewashes')).toBe(0);
  });

  it('2.14 a drawn match records a draw for both and a win for neither', () => {
    const f = fmt('fifa_2x45');
    const { sides } = deriveRacquetStats(f,
      [...pts('A', 1), { t: 'endPeriod' }, ...pts('B', 1), { t: 'endPeriod' }], {});
    expect(n(sides.A, 'draws')).toBe(1);
    expect(n(sides.B, 'draws')).toBe(1);
    expect(n(sides.A, 'wins') + n(sides.B, 'wins')).toBe(0);
    expectOutcomeSound(sides, 'draw');
  });

  it('2.15 an unfinished match still records an appearance for both sides', () => {
    const { sides } = deriveRacquetStats(tt, pts('A', 4), {});
    expect(n(sides.A, 'matches')).toBe(1);
    expect(n(sides.B, 'matches')).toBe(1);
    expect(n(sides.A, 'wins')).toBe(0);
    expectOutcomeSound(sides, 'unfinished');
  });

  it('2.16 an empty log produces two appearances and nothing else', () => {
    const { sides } = deriveRacquetStats(tt, [], {});
    expect(n(sides.A, 'matches')).toBe(1);
    expect(n(sides.A, 'points_won')).toBe(0);
    expectStatsSound(sides, 'empty');
  });
});

// ============================================================================
// 3. TENNIS — the sport with the richest derived stats
// ============================================================================

describe('3. tennis break points and tie-breaks', () => {
  const f = fmt('itf_standard_bo3');
  const game = (side: Side) => pts(side, 4);

  it('3.1 a break point is the RECEIVER one point from taking the serve\'s game', () => {
    // At 0-30 the NEXT point makes it 0-40, which does not win the game - so that is
    // not yet a break point. The point played AT 0-40 is the one that can break.
    const atThirty = deriveRacquetStats(f, pts('B', 2), { firstServer: 'A' });
    expect(n(atThirty.sides.B, 'break_points_played'), 'a break point was recorded at 0-30')
      .toBe(0);
    const atForty = deriveRacquetStats(f, pts('B', 4), { firstServer: 'A' });
    expect(n(atForty.sides.B, 'break_points_played'), 'no break point was recorded at 0-40')
      .toBeGreaterThan(0);
  });

  it('3.2 taking it is a break won; saving it is a break saved for the server', () => {
    const broken = deriveRacquetStats(f, pts('B', 4), { firstServer: 'A' });
    expect(n(broken.sides.B, 'break_points_won')).toBeGreaterThan(0);

    const saved = deriveRacquetStats(f, [...pts('B', 3), pt('A')], { firstServer: 'A' });
    expect(n(saved.sides.A, 'break_points_saved'), 'the server got no credit for saving it')
      .toBeGreaterThan(0);
    expectBounded(saved.sides, 'break saved');
  });

  it('3.3 BREAK POINTS ARE MEANINGLESS where the serve is not locked to the unit', () => {
    // Table tennis changes hands every two points; "breaking" has no meaning, and
    // recording it would put a statistic on a profile that the sport does not have.
    const tt = fmt('ittf_bo5_11');
    const { sides } = deriveRacquetStats(tt, rally(30), {});
    expect(n(sides.A, 'break_points_played')
      + n(sides.B, 'break_points_played'), 'table tennis recorded break points').toBe(0);
  });

  it('3.7 a decider in a TWO-LEVEL sport is the deciding game', () => {
    const tt = fmt('ittf_bo5_11');   // best of 5 games to 11
    const games = [...pts('A', 11), ...pts('B', 11), ...pts('A', 11), ...pts('B', 11)];
    const atTwoAll = deriveRacquetStats(tt, games, {});
    expect(n(atTwoAll.sides.A, 'deciders_won'), 'a decider was counted before two-all').toBe(0);
    const decided = deriveRacquetStats(tt, [...games, ...pts('A', 11)], {});
    expect(n(decided.sides.A, 'deciders_won'), 'the fifth game at two-all was not a decider')
      .toBe(1);
    expectConserved(decided.sides, 'tt decider');
  });

  it('3.4 a tie-break is counted as a tie-break, not just another game', () => {
    const toSixAll: RallyLog = [];
    for (let i = 0; i < 6; i += 1) toSixAll.push(...game('A'), ...game('B'));
    const { sides } = deriveRacquetStats(f, [...toSixAll, ...pts('A', 7)], {});
    expect(n(sides.A, 'tiebreaks_won'), 'the tie-break was not recorded as one').toBe(1);
    expect(n(sides.B, 'tiebreaks_lost')).toBe(1);
    expectConserved(sides, 'tiebreak');
  });

  it('3.5 sets won and lost mirror each other', () => {
    const set = (side: Side) => Array.from({ length: 6 }, () => game(side)).flat();
    const { sides } = deriveRacquetStats(f, [...set('A'), ...set('B'), ...set('A')], {});
    expect(n(sides.A, 'sets_won')).toBe(2);
    expect(n(sides.B, 'sets_won')).toBe(1);
    expectConserved(sides, 'sets');
  });

  it('3.6 a decider is counted once it is actually the decider', () => {
    const set = (side: Side) => Array.from({ length: 6 }, () => game(side)).flat();
    const { sides } = deriveRacquetStats(f, [...set('A'), ...set('B'), ...set('A')], {});
    expect(n(sides.A, 'deciders_won'), 'the third set of a best-of-three was not a decider')
      .toBeGreaterThan(0);
    expectConserved(sides, 'decider');
  });
});

// ============================================================================
// 4. ATTRIBUTION — who gets the credit in doubles
// ============================================================================

describe('4. attributing to people', () => {
  const f = fmt('ittf_bo5_11');

  it('4.1 with no pairing, the sides are still totalled and nobody is credited', () => {
    const r = deriveRacquetStats(f, rally(12), {});
    expect(r.players, 'people were invented without a team sheet').toEqual([]);
    expect(n(r.sides.A, 'points_won')).toBeGreaterThan(0);
  });

  it('4.2 singles: the one player carries the whole side\'s line', () => {
    const r = deriveRacquetStats(f, [...pts('A', 11)], { pairing: { A: ['p1'], B: ['p2'] } });
    expect(r.players.length).toBe(2);
    const p1 = r.players.find((x) => x.userId === 'p1')!;
    expect(p1.side).toBe('A');
    expect(p1.partnerUserId, 'a singles player was given a partner').toBeNull();
    expect(n(p1.stats, 'points_won')).toBe(n(r.sides.A, 'points_won'));
  });

  it('4.3 DOUBLES: BOTH PARTNERS RECEIVE THE PAIR\'S RALLY STATS', () => {
    // A doubles point is won by the pair. Splitting it between them would halve
    // everybody's career totals; giving it to whoever happened to be at the net
    // would be worse.
    // A finished match, so there is a result to share as well as points.
    const r = deriveRacquetStats(f, [...pts('A', 11), ...pts('A', 11), ...pts('A', 11)], {
      pairing: { A: ['p1', 'p2'], B: ['p3', 'p4'] },
    });
    const a = r.players.filter((x) => x.side === 'A');
    expect(a.length).toBe(2);
    for (const p of a) {
      expect(n(p.stats, 'points_won'), `${p.userId} did not receive the pair's points`)
        .toBe(n(r.sides.A, 'points_won'));
      expect(n(p.stats, 'wins')).toBe(1);
    }
  });

  it('4.4 partners point at each other, so "my record with X" is a group-by', () => {
    const r = deriveRacquetStats(f, [...pts('A', 11)], {
      pairing: { A: ['p1', 'p2'], B: ['p3', 'p4'] },
    });
    expect(r.players.find((x) => x.userId === 'p1')!.partnerUserId).toBe('p2');
    expect(r.players.find((x) => x.userId === 'p2')!.partnerUserId).toBe('p1');
  });

  it('4.5 a player line never exceeds its own side\'s bounds', () => {
    const r = deriveRacquetStats(f, rally(31), {
      pairing: { A: ['p1', 'p2'], B: ['p3', 'p4'] },
    });
    for (const p of r.players) {
      expect(n(p.stats, 'service_points_won'),
        `${p.userId} won more service points than they played`)
        .toBeLessThanOrEqual(n(p.stats, 'service_points_played'));
      expect(n(p.stats, 'service_points_played'),
        `${p.userId} served more points than their side did`)
        .toBeLessThanOrEqual(n(r.sides[p.side], 'service_points_played'));
    }
  });

  it('4.6 a pairing with an empty slot does not invent a player', () => {
    const r = deriveRacquetStats(f, rally(9), { pairing: { A: ['p1', ''], B: ['p3'] } } as never);
    expect(r.players.every((p) => !!p.userId), 'a blank team-sheet slot became a player').toBe(true);
  });

  it('4.7 every attributed player belongs to exactly one side', () => {
    const r = deriveRacquetStats(f, rally(25), {
      pairing: { A: ['p1', 'p2'], B: ['p3', 'p4'] },
    });
    const ids = r.players.map((p) => p.userId);
    expect(new Set(ids).size, 'somebody was attributed twice').toBe(ids.length);
    for (const p of r.players) expect(['A', 'B']).toContain(p.side);
  });
});

// ============================================================================
// 5. THE CAREER FOLD
// ============================================================================

describe('5. folding a career', () => {
  const spec = (): SportStatSpec => ({
    sport: 'testsport',
    family: 'racquet',
    events: [],
    metrics: [
      { key: 'matches', label: 'Matches', short: 'M', source: 'rally', aggregate: 'sum', higherIsBetter: true },
      { key: 'points_won', label: 'Points won', short: 'PW', source: 'rally', aggregate: 'sum', higherIsBetter: true },
      { key: 'service_points_played', label: 'Serves', short: 'SP', source: 'rally', aggregate: 'sum', higherIsBetter: true },
      { key: 'service_points_won', label: 'Serves won', short: 'SW', source: 'rally', aggregate: 'sum', higherIsBetter: true },
      { key: 'longest_streak', label: 'Best streak', short: 'Str', source: 'rally', aggregate: 'max', higherIsBetter: true },
      { key: 'fewest', label: 'Fewest', short: 'Fw', source: 'rally', aggregate: 'min', higherIsBetter: false },
      { key: 'avg_pts', label: 'Average', short: 'Avg', source: 'rally', aggregate: 'avg', higherIsBetter: true },
      {
        key: 'serve_pct', label: 'Service win %', short: 'SW%', source: 'derived',
        aggregate: 'rate', rateOf: ['service_points_won', 'service_points_played'],
        percent: true, higherIsBetter: true,
      },
      {
        key: 'diff', label: 'Difference', short: 'Dif', source: 'derived', aggregate: 'sum',
        formula: { op: 'diff', of: ['points_won', 'service_points_played'] }, higherIsBetter: true,
      },
    ],
  });

  it('5.1 sums add up across matches', () => {
    const c = foldCareerStats(spec(), [{ matches: 1, points_won: 30 }, { matches: 1, points_won: 22 }]);
    expect(c.matches).toBe(2);
    expect(c.points_won).toBe(52);
  });

  it('5.2 a max metric takes the best single match, not the total', () => {
    const c = foldCareerStats(spec(), [{ longest_streak: 5 }, { longest_streak: 9 }, { longest_streak: 3 }]);
    expect(c.longest_streak, 'the best streak was summed instead of taken').toBe(9);
  });

  it('5.3 a min metric takes the lowest', () => {
    expect(foldCareerStats(spec(), [{ fewest: 5 }, { fewest: 2 }]).fewest).toBe(2);
  });

  it('5.4 an average metric averages over the matches it appeared in', () => {
    expect(foldCareerStats(spec(), [{ avg_pts: 10 }, { avg_pts: 20 }]).avg_pts).toBe(15);
  });

  it('5.5 A RATE IS COMPUTED FROM THE TOTALS, NEVER AVERAGED FROM THE MATCHES', () => {
    // 1/1 in one match and 1/99 in another is 2/100 = 2%, not (100% + 1%)/2 = 50.5%.
    // Averaging percentages across matches is the commonest error in a hand-built
    // rollup, and it flatters anybody who played one tiny match well.
    const c = foldCareerStats(spec(), [
      { service_points_won: 1, service_points_played: 1 },
      { service_points_won: 1, service_points_played: 99 },
    ]);
    expect(c.service_points_played).toBe(100);
    expect(c.serve_pct, 'the rate was averaged from the per-match rates').toBe(2);
  });

  it('5.6 a rate with nothing played is absent rather than zero or NaN', () => {
    const c = foldCareerStats(spec(), [{ points_won: 4 }]);
    expect(c.serve_pct, 'a percentage was invented for somebody who never served').toBeUndefined();
  });

  it('5.7 a derived difference is computed from the folded totals', () => {
    const c = foldCareerStats(spec(), [
      { points_won: 30, service_points_played: 10 },
      { points_won: 20, service_points_played: 5 },
    ]);
    expect(c.diff).toBe(50 - 15);
  });

  it('5.8 an empty career folds to nothing rather than throwing', () => {
    expect(foldCareerStats(spec(), [])).toEqual({});
  });

  it('5.9 a metric nobody has recorded is left out, not zeroed', () => {
    const c = foldCareerStats(spec(), [{ matches: 1 }]);
    expect('longest_streak' in c, 'an unrecorded metric was invented as zero').toBe(false);
  });

  it('5.10 every shipped sport folds its own real metrics without throwing', () => {
    for (const s of ALL_STAT_SPECS) {
      const line: StatBag = {};
      for (const m of s.metrics) line[m.key] = 3;
      const c = foldCareerStats(s, [line, line]);
      for (const [k, v] of Object.entries(c)) {
        expect(Number.isFinite(v), `${s.sport}/${k} folded to ${v}`).toBe(true);
      }
    }
  });
});

// ============================================================================
// 6. WHOLE MATCHES, EVERY RACQUET AND TEAM FORMAT
// ============================================================================

describe('6. every format produces sound statistics', () => {
  function rng(seed: number) {
    let x = seed;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  }

  function realistic(f: ScoringFormat, seed: number): RallyLog {
    const r = rng(seed);
    const log: RallyLog = [];
    for (let i = 0; i < 260; i += 1) {
      const d = r();
      if (d < 0.02 && f.letsEnabled) log.push({ t: 'let' });
      else if (d < 0.05) log.push({ t: 'fault', side: r() < 0.5 ? 'A' : 'B' });
      else log.push({ t: 'point', side: r() < 0.55 ? 'A' : 'B' });
      if (f.levels[0].terminator === 'clock' && i % 14 === 13) log.push({ t: 'endPeriod' });
    }
    return log;
  }

  const SAMPLE = [
    'ittf_bo5_11', 'bwf_official_3x21', 'itf_standard_bo3', 'usap_tournament_bo3_11',
    'classic_15_sideout', 'fivb_25_bo5', 'fifa_2x45', 'fiba_4x10', 'pkl_2x20',
    'icf_bo3_boards', 'legacy_21_bo3', 'no_ad_match_tb_bo3',
  ];

  for (const key of SAMPLE) {
    for (const seed of [13, 2024]) {
      it(`6.x ${key}, seed ${seed}: conserved, bounded and one result`, () => {
        const f = fmt(key);
        const log = realistic(f, seed);
        const r = deriveRacquetStats(f, log, { pairing: { A: ['p1', 'p2'], B: ['p3', 'p4'] } });
        expectStatsSound(r.sides, `${key}/${seed}`);

        // Every attributed person is inside their own side's envelope.
        for (const p of r.players) {
          expect(n(p.stats, 'points_won'), `${key}/${seed}: ${p.userId} outscored their side`)
            .toBeLessThanOrEqual(n(r.sides[p.side], 'points_won'));
        }

        // Deriving twice gives the same thing - the fold is pure.
        expect(JSON.stringify(deriveRacquetStats(f, log, {}).sides))
          .toBe(JSON.stringify(deriveRacquetStats(f, log, {}).sides));
      });
    }
  }

  it('6.100 a career folded from many matches stays inside its own bounds', () => {
    const f = fmt('ittf_bo5_11');
    const s = statSpecFor('table tennis')!;
    const lines: StatBag[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      lines.push(deriveRacquetStats(f, realistic(f, seed * 37), {}).sides.A);
    }
    const c = foldCareerStats(s, lines);
    expect(c.matches).toBe(12);
    if (typeof c.service_points_won === 'number' && typeof c.service_points_played === 'number') {
      expect(c.service_points_won, 'a career won more service points than it played')
        .toBeLessThanOrEqual(c.service_points_played);
    }
    for (const m of s.metrics) {
      if (!m.percent) continue;
      const v = c[m.key];
      if (typeof v !== 'number') continue;
      expect(v, `${m.key} is ${v}%`).toBeGreaterThanOrEqual(0);
      expect(v, `${m.key} is ${v}%`).toBeLessThanOrEqual(100);
    }
  });
});
