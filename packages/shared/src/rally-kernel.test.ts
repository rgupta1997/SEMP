import { describe, expect, it } from 'vitest';
import {
  aggregateScore, changesEndsAfterUnit, expediteAllowed, expediteConfig, foldRally, headline, initKernel, misconductTerms, rallyTiming, resultEnvelope, setChoiceDue, step, timeoutRules, timeoutsLeft, undo, unitClock, unitWinner,
  type KernelState, type RallyEvent, type RallyLog,
} from './rally-kernel.js';
import { defaultFormatFor, presetByKey, presetsFor, RACQUET_PRESETS } from './racquet-presets.js';
import { formatForPairing, resolveServer, serveCall } from './serve-resolvers.js';
import { earlyEndOf } from './rally-rows.js';
import { scoringFormatSchema, type ScoringFormat, type Side } from './scoring-rules.js';
import { deriveRacquetStats, foldCareerStats, statSpecFor } from './stat-registry.js';

const fmtOf = (key: string): ScoringFormat => {
  const f = presetByKey(key);
  if (!f) throw new Error(`no preset ${key}`);
  return f;
};

/** Play a scripted sequence of rally winners. */
const play = (f: ScoringFormat, winners: Side[], firstServer: Side = 'A') =>
  foldRally(f, winners.map((s) => ({ t: 'point', side: s }) as RallyEvent), firstServer);

/** Feed `side` enough points to take a unit outright from the current state. */
const points = (side: Side, n: number): RallyLog =>
  Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);

describe('presets', () => {
  it('every shipped preset validates against the schema', () => {
    for (const p of RACQUET_PRESETS) {
      const r = scoringFormatSchema.safeParse(p);
      expect(r.success, `${p.presetKey}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('covers all five racquet sports and both officiating modes', () => {
    for (const s of ['table tennis', 'badminton', 'tennis', 'pickleball', 'squash']) {
      expect(presetsFor(s).length, s).toBeGreaterThan(4);
    }
    const modes = new Set(RACQUET_PRESETS.map((p) => p.officiatingMode));
    expect(modes).toEqual(new Set(['officiated', 'selfScored']));
  });

  it('self-scored presets promote summary entry and disable penalty events', () => {
    for (const p of RACQUET_PRESETS.filter((x) => x.officiatingMode === 'selfScored')) {
      expect(p.entryMode, p.presetKey).toBe('unitScoresOnly');
      expect(p.penaltyEvents, p.presetKey).toBe('off');
    }
  });

  it('resolves the sport-name aliases the brief actually used', () => {
    expect(presetsFor('Table-Tennis').length).toBeGreaterThan(0);
    expect(presetsFor('pickelball').length).toBeGreaterThan(0); // the brief's spelling
    // Cricket keeps its own model, so the shelf is legitimately empty for it.
    expect(presetsFor('cricket')).toEqual([]);
  });
});

describe('unit termination', () => {
  it('needs the margin, not just the target', () => {
    const g = { key: 'game', label: 'Game', target: 11, winBy: 2, cap: null };
    expect(unitWinner(g, [11, 10])).toBeNull();
    expect(unitWinner(g, [11, 9])).toBe('A');
    expect(unitWinner(g, [20, 20])).toBeNull();
    expect(unitWinner(g, [22, 20])).toBe('A');
  });

  it('lets the cap win regardless of margin - badminton 30-29', () => {
    const g = { key: 'game', label: 'Game', target: 21, winBy: 2, cap: 30 };
    expect(unitWinner(g, [29, 29])).toBeNull();
    expect(unitWinner(g, [30, 29])).toBe('A');
  });

  it('sudden death at the target when winBy is 1', () => {
    const g = { key: 'game', label: 'Game', target: 11, winBy: 1, cap: null };
    expect(unitWinner(g, [11, 10])).toBe('A');
  });
});

describe('table tennis, ITTF best of 5 to 11', () => {
  const f = fmtOf('ittf_bo5_11');

  it('ends a game at 11-9 and not at 11-10', () => {
    const at1110 = play(f, [...'AAAAAAAAAAA'].map(() => 'A' as Side).slice(0, 0)
      .concat(interleave(10, 10)).concat(['A']));
    // 10-10 then A takes one: 11-10, game NOT over
    expect(at1110.state.score[1]).toEqual([0, 0]);
    const at1210 = foldRally(f, [...at1110.trace.map((t) => t.event), { t: 'point', side: 'A' }]);
    expect(at1210.state.score[1]).toEqual([1, 0]);
  });

  it('serves two each, then one each from 10-10', () => {
    let s = initKernel(f, 'A');
    const seen: Side[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(s.serve.side);
      s = step(f, s, { t: 'point', side: 'A' }).state;
    }
    // A A B B A A - two serves per turn
    expect(seen).toEqual(['A', 'A', 'B', 'B', 'A', 'A']);
  });

  it('collapses to single serves once both sides reach 10', () => {
    let s = initKernel(f, 'A');
    for (const ev of interleave(10, 10).map((side) => ({ t: 'point', side }) as RallyEvent)) {
      s = step(f, s, ev).state;
    }
    expect(s.score[0]).toEqual([10, 10]);
    const a = s.serve.side;
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(s.serve.side).not.toBe(a); // every point now swaps
  });

  it('takes the match at three games and stops there', () => {
    let log: RallyLog = [];
    for (let g = 0; g < 3; g++) log = log.concat(points('A', 11));
    const r = foldRally(f, log);
    expect(r.state.score[1]).toEqual([3, 0]);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    expect(headline(f, r.state)).toEqual([3, 0]);
    // Further points are rejected outright.
    const after = foldRally(f, log.concat(points('B', 5)));
    expect(after.state.score[1]).toEqual([3, 0]);
  });
});

describe("the user's Sportagon Sprint - 9 points, serve every 3rd", () => {
  const f = fmtOf('sprint_9_serve3');

  it('is expressible with no new code', () => {
    expect(f.levels[0].target).toBe(9);
    expect(f.levels[0].cap).toBe(11);
    expect(f.serve.every).toBe(3);
    expect(f.serve.collapseAt).toBe(8);
  });

  it('changes serve every third point', () => {
    let s = initKernel(f, 'A');
    const seen: Side[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(s.serve.side);
      s = step(f, s, { t: 'point', side: i % 2 === 0 ? 'A' : 'B' }).state;
    }
    expect(seen).toEqual(['A', 'A', 'A', 'B', 'B', 'B']);
  });

  it('caps the game at 11 so 11-10 ends it', () => {
    const r = foldRally(f, interleave(10, 10).map((side) => ({ t: 'point', side }) as RallyEvent)
      .concat([{ t: 'point', side: 'A' }]));
    expect(r.state.score[1]).toEqual([1, 0]);
  });
});

describe('badminton, BWF 21', () => {
  const f = fmtOf('bwf_official_3x21');

  it('serves to the rally winner', () => {
    let s = initKernel(f, 'A');
    s = step(f, s, { t: 'point', side: 'B' }).state;
    expect(s.serve.side).toBe('B');
    s = step(f, s, { t: 'point', side: 'B' }).state;
    expect(s.serve.side).toBe('B');
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(s.serve.side).toBe('A');
  });

  it('ends the game at the 30 cap with a one-point margin', () => {
    const log = interleave(29, 29).map((side) => ({ t: 'point', side }) as RallyEvent);
    let r = foldRally(f, log);
    expect(r.state.score[0]).toEqual([29, 29]);
    r = foldRally(f, log.concat([{ t: 'point', side: 'A' }]));
    expect(r.state.score[1]).toEqual([1, 0]);
    expect(r.state.finished[0].score).toEqual([30, 29]);
  });

  it('puts the service court on parity of the serving side score', () => {
    let s = initKernel(f, 'A');
    expect(s.serve.courtHalf).toBe('right'); // 0 is even
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(s.serve.courtHalf).toBe('left'); // A serving at 1
  });

  it('prompts the change of ends at 11 in the DECIDER only, and only once', () => {
    // Games 1 and 2 split, so game 3 is the decider.
    const g1 = points('A', 21);
    const g2 = points('B', 21);
    const toTen = interleave(10, 0).map((side) => ({ t: 'point', side }) as RallyEvent);
    const mid = foldRally(f, [...g1, ...g2, ...toTen]);
    expect(mid.trace.some((t) => t.switchEnds)).toBe(false);
    const at11 = foldRally(f, [...g1, ...g2, ...toTen, { t: 'point', side: 'A' }]);
    const fires = at11.trace.filter((t) => t.switchEnds);
    expect(fires).toHaveLength(1);
    // ...and nothing fired at 11 during games 1 or 2.
    const inG1 = foldRally(f, [...points('A', 11)]);
    expect(inG1.trace.some((t) => t.switchEnds)).toBe(false);
  });

  it('keeps the same server after winning on serve, now from the other court', () => {
    const pair = { A: ['Ann', 'Amy'], B: ['Bob', 'Ben'] };
    let s = initKernel(f, 'A');
    expect(resolveServer(f, s, pair)).toMatchObject({ server: 'Ann', courtHalf: 'right' }); // 0-0
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(resolveServer(f, s, pair)).toMatchObject({ server: 'Ann', courtHalf: 'left' }); // 1-0
  });

  const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
  const who = (log: RallyLog) => {
    const r = resolveServer(f, foldRally(f, log, 'A').state, pair);
    return `${r.server}>${r.receiver}`;
  };
  const rallies = (s: string): RallyLog => s.split('').map((side) => ({ t: 'point', side }) as RallyEvent);

  it('doubles: partners swap courts only when their side scores on its own serve', () => {
    expect(['', 'A', 'AA', 'AAB', 'AABB', 'AABBA'].map((s) => who(rallies(s)))).toEqual([
      'a1>b1', // 0-0
      'a1>b2', // 1-0: a1 keeps serving, now from the left
      'a1>b1', // 2-0
      'b2>a2', // 2-1: B never moved, so b2 is in the left court
      'b2>a1', // 2-2: b2 keeps serving, now from the right
      'a2>b1', // 3-2: B swapped once, so b1 is on the left
    ]);
  });

  it('a new game starts from the listed order, and each pair may pick who starts', () => {
    // A wins game 1 and serves first in game 2 from a1 / b1, whatever the courts were.
    const g1 = rallies('A'.repeat(21));
    expect(who(g1)).toBe('a1>b1');
    expect(who([...g1, { t: 'switchPairServer', side: 'A' }])).toBe('a2>b1');
    expect(who([...g1, { t: 'switchPairServer', side: 'A' }, { t: 'switchPairServer', side: 'B' }])).toBe('a2>b2');
    // Not once the game is under way.
    expect(who([...g1, ...rallies('B'), { t: 'switchPairServer', side: 'A' }])).toBe(who([...g1, ...rallies('B')]));
  });
});

describe('badminton classic 15 - serverOnly scoring, built not stubbed', () => {
  const f = fmtOf('classic_15_sideout');

  it('scores nothing when the receiver wins the rally', () => {
    const s0 = initKernel(f, 'A');
    const r = step(f, s0, { t: 'point', side: 'B' });
    expect(r.state.score[0]).toEqual([0, 0]);
    expect(r.effect.scored).toBeNull();
  });

  it('gives the opening turn one hand, then two thereafter', () => {
    let s = initKernel(f, 'A');
    expect(s.serve.side).toBe('A');
    // A loses as server: opening turn is single-handed, so the serve crosses at once.
    s = step(f, s, { t: 'point', side: 'B' }).state;
    expect(s.serve.side).toBe('B');
    expect(s.serve.serverNo).toBe(1);
    // B loses: now two hands apply, so B's second server takes over.
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(s.serve.side).toBe('B');
    expect(s.serve.serverNo).toBe(2);
    // B loses again: the serve crosses.
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(s.serve.side).toBe('A');
  });

  it('wins a game at 15 with a single point margin; the match is best of 3', () => {
    // Only the server scores, so A must hold serve throughout.
    const r = foldRally(f, points('A', 15), 'A');
    expect(r.state.score[1]).toEqual([1, 0]);
    expect(r.state.ended).toBe(false);
  });
});

describe('tennis serving', () => {
  const f = fmtOf('itf_standard_bo3');
  const rallies = (s: string): RallyLog => s.split('').map((side) => ({ t: 'point', side }) as RallyEvent);
  const st = (log: RallyLog) => foldRally(f, log, 'A');
  // Each side holds serve: A serves games 1, 3, ...; B serves 2, 4, ... - to 6-6.
  const sixAll: RallyLog = Array.from({ length: 12 }, (_, g) => rallies((g % 2 === 0 ? 'A' : 'B').repeat(4))).flat();

  it('serves from the deuce court on an even number of points played, the ad court on odd', () => {
    expect(['', 'A', 'B', 'AB', 'BB'].map((s) => st(rallies(s)).state.serve.courtHalf))
      .toEqual(['right', 'left', 'left', 'right', 'right']); // 0-15 is the ad court
  });

  it('the player who received first in a tie-break serves the next set', () => {
    // A serves the first point of the tie-break, so B opens set 2.
    expect(st([...sixAll, ...rallies('AAAAAAA')]).state.serve.side).toBe('B');
  });

  it('a straight-sets win is two sets to love, not a match without a game lost', () => {
    // B holds the opening game, then A takes the next six: 6-1, twice.
    const set61 = [...rallies('BBBB'), ...Array.from({ length: 6 }, () => rallies('AAAA')).flat()];
    const { sides } = deriveRacquetStats(f, [...set61, ...set61], { firstServer: 'A' });
    expect(sides.A.games_lost).toBe(2);
    expect(sides.A.whitewashes).toBe(1);
    expect(statSpecFor('tennis')!.metrics.find((m) => m.key === 'whitewashes')!.label).toBe('Straight-sets wins');
    expect(statSpecFor('table tennis')!.metrics.find((m) => m.key === 'whitewashes')!.label).toBe('Straight-games wins');
  });

  it('love holds, bagels, a win from a set down and the won/lost rates', () => {
    const game = (s: 'A' | 'B') => rallies(s.repeat(4));
    // Set 1 to B 6-0 (A's holds broken every time), then A 6-0, 6-0: won from a set down.
    const setTo = (s: 'A' | 'B') => Array.from({ length: 6 }, () => game(s)).flat();
    const { sides } = deriveRacquetStats(f, [...setTo('B'), ...setTo('A'), ...setTo('A')], { firstServer: 'A' });
    expect(sides.A).toMatchObject({ won_from_set_down: 1, bagels: 2, sets_won: 2, sets_lost: 1 });
    expect(sides.B).toMatchObject({ bagels: 1 });
    expect(sides.A.love_holds).toBeGreaterThan(0);
    const career = foldCareerStats(statSpecFor('tennis')!, [sides.A]);
    expect(career).toMatchObject({ set_win_pct: 66.7, game_win_pct: 66.7, decider_win_pct: 100 });
  });

  it('a match tie-break won 10-0 is not a bagel, and a one-set win is not "straight sets"', () => {
    const short = fmtOf('itf_short_sets_bo3');
    const set41 = (w: 'A' | 'B') => {
      const l = w === 'A' ? 'B' : 'A';
      return [...rallies(l.repeat(4)), ...Array.from({ length: 4 }, () => rallies(w.repeat(4))).flat()];
    };
    const tbTo10 = rallies('A'.repeat(10));
    const s = deriveRacquetStats(short, [...set41('A'), ...set41('B'), ...tbTo10], { firstServer: 'A' }).sides;
    expect(s.A.wins).toBe(1);
    expect(s.A.bagels ?? 0).toBe(0);

    const proSet = fmtOf('pro_set_8');
    const eightLove = Array.from({ length: 8 }, () => rallies('AAAA')).flat();
    const p = deriveRacquetStats(proSet, eightLove, { firstServer: 'A' }).sides;
    expect(p.A.wins).toBe(1);
    expect(p.A.whitewashes ?? 0).toBe(0);
    expect(statSpecFor('tennis')!.metrics.find((m) => m.key === 'bagels')!.label).toBe('Bagels (sets won to love)');
  });

  it('tennis tiles leave out the side-out and expedite stats it never produces', () => {
    const hidden = new Set(statSpecFor('tennis')!.metrics.filter((m) => m.hidden).map((m) => m.key));
    expect(['side_out_pct', 'points_per_service_turn', 'expedite_matches'].every((k) => hidden.has(k))).toBe(true);
    expect(statSpecFor('table tennis')!.metrics.find((m) => m.key === 'expedite_matches')!.hidden).toBeFalsy();
  });

  it('doubles: aces and double faults stay with the partner who served them', () => {
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const ace = { t: 'point', side: 'A', kind: 'ace' } as RallyEvent;
    const fault = { t: 'fault', side: 'A' } as RallyEvent;
    // a1 holds game 1 with four aces; b1 holds game 2; a2 double-faults in game 3 and is broken.
    const log: RallyLog = [ace, ace, ace, ace, ...rallies('BBBB'), fault, fault, ...rallies('BBB')];
    const { players } = deriveRacquetStats(f, log, { pairing: pair, firstServer: 'A' });
    const of = (id: string) => players.find((x) => x.userId === id)!.stats;
    expect(of('a1')).toMatchObject({ aces: 4, love_holds: 1 });
    expect(of('a1').double_faults ?? 0).toBe(0);
    expect(of('a2')).toMatchObject({ double_faults: 1 });
    expect(of('a2').aces ?? 0).toBe(0);
    expect(of('a2').love_holds ?? 0).toBe(0);
  });

  it('doubles: pairs choose again before a deciding match tie-break', () => {
    const tb = fmtOf('no_ad_match_tb_bo3');
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const setTo = (s: 'A' | 'B') => Array.from({ length: 6 }, () => rallies(s.repeat(4))).flat();
    const oneAll = foldRally(tb, [...setTo('A'), ...setTo('B')], 'A').state;
    expect(oneAll.pointLevel).toBeGreaterThan(0); // the match tie-break runs a level up
    const who = (s: KernelState) => resolveServer(tb, s, pair);
    const swapped = step(tb, oneAll, { t: 'switchPairServer', side: who(oneAll).server === 'a1' || who(oneAll).server === 'a2' ? 'A' : 'B' }).state;
    expect(who(swapped).server).not.toBe(who(oneAll).server);
    const rec = step(tb, oneAll, { t: 'switchReceiver', side: oneAll.serve.side === 'A' ? 'B' : 'A' }).state;
    expect(who(rec).receiver).not.toBe(who(oneAll).receiver);
    // ...but not once the tie-break is under way.
    const underway = step(tb, oneAll, { t: 'point', side: 'A' }).state;
    expect(step(tb, underway, { t: 'switchReceiver', side: 'B' }).state).toBe(underway);
  });

  it('break points faced on your own serve make "saved %" measurable', () => {
    // A serves game 1, goes 0-40 down (three break points), then wins five in a row.
    const { sides } = deriveRacquetStats(f, rallies('BBBAAAAA'), { firstServer: 'A' });
    expect(sides.A).toMatchObject({ break_points_faced: 3, break_points_saved: 3, service_games_won: 1 });
    expect(sides.B).toMatchObject({ break_points_played: 3 });
    expect(foldCareerStats(statSpecFor('tennis')!, [sides.A]).break_point_save_pct).toBe(100);
  });

  it('a set won in an ordinary game hands the serve on once, not twice', () => {
    // Set 1 to A 6-4: B served game 10, so A opens set 2.
    const holds = Array.from({ length: 8 }, (_, g) => rallies((g % 2 === 0 ? 'A' : 'B').repeat(4))).flat();
    const s = st([...holds, ...rallies('AAAA'), ...rallies('AAAA')]).state; // A holds 5-4, breaks to 6-4
    expect(s.score[2]).toEqual([1, 0]);
    expect(s.serve.side).toBe('A');
  });

  it('changes ends every 6 points of a tie-break', () => {
    const r = st([...sixAll, ...rallies('ABABAB')]);
    expect(r.trace[r.trace.length - 1].switchEnds).toBe(true);
    expect(st([...sixAll, ...rallies('ABAB')]).trace.at(-1)!.switchEnds).toBe(false);
  });

  it('doubles partners keep rotating through a tie-break', () => {
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const servers = ['', 'A', 'AA', 'AAA', 'AAAA', 'AAAAA'].map((s) => resolveServer(f, st([...sixAll, ...rallies(s)]).state, pair).server);
    expect(servers).toEqual(['a1', 'b1', 'b1', 'a2', 'a2', 'b2']);
  });

  const fault: RallyEvent = { t: 'fault', side: 'A' };
  const ace: RallyEvent = { t: 'point', side: 'A', kind: 'ace' };

  it('a fault sets up a second serve; a second fault is a double fault, the point to the receiver', () => {
    const one = st([fault]).state;
    expect(one.serve.faults).toBe(1);
    expect(one.score[0]).toEqual([0, 0]);
    const two = st([fault, fault]).state;
    expect(two.score[0]).toEqual([0, 1]);
    expect(two.serve.faults).toBe(0); // the next point starts on a first serve
  });

  it('a let on a second serve is still a second serve; any rally resets to the first', () => {
    expect(st([fault, { t: 'let' }]).state.serve.faults).toBe(1);
    expect(st([fault, ...rallies('A')]).state.serve.faults).toBe(0);
  });

  it('a double fault can end the game, and changes ends like any point', () => {
    const r = st([...rallies('AAA'), fault, fault, ...rallies('BBB'), fault, fault]); // 40-40, then two double faults
    expect(r.state.score[1]).toEqual([0, 1]);
  });

  it('counts aces, double faults and first / second serve - only where serves were recorded', () => {
    // A: ace, then a fault and a point won on the second serve, then a double fault, then a first-serve point lost.
    const log: RallyLog = [ace, fault, ...rallies('A'), fault, fault, ...rallies('B')];
    const { sides } = deriveRacquetStats(f, log, { firstServer: 'A' });
    expect(sides.A).toMatchObject({
      aces: 1, double_faults: 1, serve_points_tracked: 4,
      first_serves_in: 2, first_serve_points_won: 1,
      second_serve_points_played: 2, second_serve_points_won: 1,
    });
    const career = foldCareerStats(statSpecFor('tennis')!, [sides.A]);
    expect(career).toMatchObject({ first_serve_pct: 50, first_serve_win_pct: 50, second_serve_win_pct: 50 });
    // Plain rallies only: no serve figures at all, rather than "100% first serves in".
    expect(deriveRacquetStats(f, rallies('AAAB'), { firstServer: 'A' }).sides.A.first_serves_in).toBeUndefined();
  });

  it('counts service games held and broken, but not tie-breaks', () => {
    // A holds game 1; B serves game 2 and A breaks.
    const { sides } = deriveRacquetStats(f, rallies('AAAA' + 'AAAA'), { firstServer: 'A' });
    expect(sides.A).toMatchObject({ service_games_played: 1, service_games_won: 1, return_games_played: 1, return_games_won: 1 });
    expect(sides.B).toMatchObject({ service_games_played: 1, return_games_played: 1 });
    expect(sides.B.service_games_won ?? 0).toBe(0);
    expect(foldCareerStats(statSpecFor('tennis')!, [sides.A])).toMatchObject({ service_games_held_pct: 100, return_games_won_pct: 100 });
    // 6-6 with every game held, then a tie-break: 6 service games each, the tie-break not among them.
    const tb = deriveRacquetStats(f, [...sixAll, ...rallies('AAAAAAA')], { firstServer: 'A' }).sides;
    expect(tb.A).toMatchObject({ service_games_played: 6, service_games_won: 6 });
  });

  it('doubles receivers hold their courts for the set: deuce on even points, ad on odd', () => {
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const rec = (log: RallyLog) => resolveServer(f, st(log).state, pair).receiver;
    expect(['', 'A', 'AB', 'ABB'].map((s) => rec(rallies(s)))).toEqual(['b1', 'b2', 'b1', 'b2']);
    // B chooses b2 for the deuce court at the start of the set.
    const flip: RallyEvent = { t: 'switchReceiver', side: 'B' };
    expect([rec([flip]), rec([flip, ...rallies('A')])]).toEqual(['b2', 'b1']);
    // Not once the set is under way.
    expect(rec([...rallies('AAAA'), flip])).toBe(rec(rallies('AAAA')));
  });

  it('a new set starts the receiving courts afresh', () => {
    const flip: RallyEvent = { t: 'switchReceiver', side: 'B' };
    const set1 = Array.from({ length: 6 }, () => rallies('AAAA')).flat(); // A wins every point: set 1 to A, 6-0
    expect(st([flip, ...set1]).state.serve.receiveFlip).toBeUndefined();
  });

  it('each pair can name a different first server at the start of a set', () => {
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const server = (log: RallyLog) => resolveServer(f, st(log).state, pair).server;
    const game = rallies('AAAA'); // one game, A winning every point
    // Set 1, listed order: a1, b1, a2, b2. A names a2, B names b2.
    const swapA: RallyEvent = { t: 'switchPairServer', side: 'A' };
    const swapB: RallyEvent = { t: 'switchPairServer', side: 'B' };
    expect([server([swapA]), server([swapA, swapB, ...game])]).toEqual(['a2', 'b2']);
    expect(server([swapA, swapB, ...game, ...game])).toBe('a1');
    // B may still name theirs before their first service game, but not after it.
    expect(server([...game, swapB])).toBe('b2');
    // Game 4 is B's second: b2 in the listed order, and too late to change it.
    expect(server([...game, ...game, ...game, swapB])).toBe('b2');
    // A new set goes back to the listed order, ready to be chosen again.
    const set1 = Array.from({ length: 6 }, () => game).flat();
    expect(st([swapA, ...set1]).state.serve.pairFlip).toBeUndefined();
    expect(server([...set1, swapB, ...game])).toBe('b2');
  });

  it('personal receive points in tennis doubles go to the player in that court', () => {
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const { players } = deriveRacquetStats(f, rallies('AAAA'), { pairing: pair, firstServer: 'A' });
    const of = (id: string) => players.find((x) => x.userId === id)!.stats;
    expect(of('b1').return_points_played).toBe(2); // the two deuce-court points
    expect(of('b2').return_points_played).toBe(2);
  });

  it('calls deuce and advantage in words', () => {
    expect(serveCall(f, st(rallies('AAABBB')).state, false)).toBe('Deuce');
    expect(serveCall(f, st(rallies('AAABBBA')).state, false)).toBe('Ad in');
    expect(serveCall(f, st(rallies('AAABBBB')).state, false)).toBe('Ad out');
    expect(serveCall(fmtOf('no_ad_match_tb_bo3'), foldRally(fmtOf('no_ad_match_tb_bo3'), rallies('AAABBB'), 'A').state, false)).toBe('Deciding point');
  });
});

describe('tennis - the acid test for the nested level array', () => {
  const f = fmtOf('itf_standard_bo3');

  it('models 15/30/40/AD as a level with target 4, not a special case', () => {
    expect(f.levels[0].target).toBe(4);
    expect(f.levels[0].winBy).toBe(2);
    expect(f.levels[0].pointLabels).toEqual(['0', '15', '30', '40', 'AD']);
  });

  it('renders the tennis call from the point labels', () => {
    let s = initKernel(f, 'A');
    expect(serveCall(f, s, false)).toBe('0-0');
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(serveCall(f, s, false)).toBe('15-0');
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(serveCall(f, s, false)).toBe('30-0');
  });

  it('takes a game at 4 points and a set at 6 games', () => {
    const game = (side: Side) => points(side, 4);
    let log: RallyLog = [];
    for (let g = 0; g < 6; g++) log = log.concat(game('A'));
    const r = foldRally(f, log);
    expect(r.state.score[1]).toEqual([0, 0]); // set reset after the win
    expect(r.state.score[2]).toEqual([1, 0]); // one set to A
  });

  it('alternates the serve every game', () => {
    let s = initKernel(f, 'A');
    expect(s.serve.side).toBe('A');
    for (const ev of points('A', 4)) s = step(f, s, ev).state;
    expect(s.serve.side).toBe('B');
    for (const ev of points('B', 4)) s = step(f, s, ev).state;
    expect(s.serve.side).toBe('A');
  });

  it('substitutes a tie-break at 6-6 and gives its winner the set 7-6', () => {
    // Six games each: A takes evens, B takes odds.
    let log: RallyLog = [];
    for (let g = 0; g < 12; g++) log = log.concat(points(g % 2 === 0 ? 'A' : 'B', 4));
    let r = foldRally(f, log);
    expect(r.state.score[1]).toEqual([6, 6]);
    // The unit in force is now the tie-break: first to 7 by 2, not 4 by 2.
    r = foldRally(f, log.concat(points('A', 4)));
    expect(r.state.score[1]).toEqual([6, 6]); // still in the tie-break at 4-0
    r = foldRally(f, log.concat(points('A', 7)));
    // The set is won and its live game count resets; the finished unit carries 7-6.
    const set = r.state.finished.find((u) => u.key === 'set')!;
    expect(set.score).toEqual([7, 6]);
    expect(set.winner).toBe('A');
    expect(r.state.score[2]).toEqual([1, 0]);
    // The tie-break itself is recorded as its own unit, so "tie-breaks won" is real.
    expect(r.state.finished.some((u) => u.key === 'tiebreak' && u.winner === 'A')).toBe(true);
  });

  it('opens the tie-break with a single serve, then twos', () => {
    let log: RallyLog = [];
    for (let g = 0; g < 12; g++) log = log.concat(points(g % 2 === 0 ? 'A' : 'B', 4));
    let s = foldRally(f, log).state;
    const seen: Side[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(s.serve.side);
      s = step(f, s, { t: 'point', side: 'A' }).state;
    }
    // one serve, then two each
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
    expect(seen[3]).toBe(seen[4]);
    expect(seen[1]).not.toBe(seen[3]);
  });

  it('plays a 10-point match tie-break in place of a final set', () => {
    const f5 = fmtOf('no_ad_match_tb_bo3');
    // One set each -> the decider set collapses to raw points to 10.
    let log: RallyLog = [];
    for (let g = 0; g < 4; g++) log = log.concat(points('A', 4)); // A leads 4-0 games
    for (let g = 0; g < 2; g++) log = log.concat(points('A', 4)); // A takes set 1 (6-0)
    for (let g = 0; g < 6; g++) log = log.concat(points('B', 4)); // B takes set 2
    let r = foldRally(f5, log);
    expect(r.state.score[2]).toEqual([1, 1]);
    expect(r.state.pointLevel).toBe(1); // points now land on the set level
    r = foldRally(f5, log.concat(points('A', 10)));
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
  });

  it('no-ad decides the game at 4-3', () => {
    const noad = fmtOf('fast4_bo3');
    const r = foldRally(noad, interleave(3, 3).map((side) => ({ t: 'point', side }) as RallyEvent)
      .concat([{ t: 'point', side: 'A' }]));
    expect(r.state.score[1]).toEqual([1, 0]);
  });
});

describe('pickleball', () => {
  it('opens traditional side-out on server 2 - the 0-0-2 call', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    const s = initKernel(f, 'A');
    expect(s.serve.serverNo).toBe(2);
    expect(serveCall(f, s, true)).toBe('0-0-2');
  });

  it('gives the opening team one service turn, not two', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    let s = initKernel(f, 'A');
    s = step(f, s, { t: 'point', side: 'B' }).state; // A loses as server
    expect(s.serve.side).toBe('B');
    expect(s.serve.serverNo).toBe(1);
    // B now gets two servers.
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(s.serve.side).toBe('B');
    expect(s.serve.serverNo).toBe(2);
  });

  it('scores every rally under rally scoring', () => {
    const f = fmtOf('mlp_rally_21');
    const r = step(f, initKernel(f, 'A'), { t: 'point', side: 'B' });
    expect(r.state.score[0]).toEqual([0, 1]);
    expect(r.state.serve.side).toBe('B');
  });

  it('adds a technical-foul point without moving the serve', () => {
    const f = fmtOf('usap_single_game_15');
    let s = initKernel(f, 'A');
    const before = { ...s.serve };
    s = step(f, s, { t: 'adjust', side: 'B', delta: 1, preserveServe: true, reason: 'technical foul' }).state;
    expect(s.score[0]).toEqual([0, 1]);
    expect(s.serve.side).toBe(before.side);
    expect(s.serve.serverNo).toBe(before.serverNo);
  });

  const rallies = (s: string): RallyLog => s.split('').map((side) => ({ t: 'point', side }) as RallyEvent);
  const dbl = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
  const who = (f: ScoringFormat, s: string) => {
    const st = foldRally(f, rallies(s), 'A').state;
    const r = resolveServer(f, st, dbl);
    return `${serveCall(f, st, true)} ${r.server}@${r.courtHalf}>${r.receiver}`;
  };

  it('side-out doubles: server 1 is the right-court player at each side-out; partners swap on scoring', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    expect(['', 'A', 'AB', 'ABA', 'ABAA', 'ABAAB'].map((s) => who(f, s))).toEqual([
      '0-0-2 a1@right>b1', // the right-court player opens
      '1-0-2 a1@left>b2',  // scored, so a1 and a2 swap; a1 keeps serving
      '0-1-1 b1@right>a2', // side-out: B's right-court player; a2 now stands right
      '0-1-2 b2@left>a1',  // b1 lost: partner serves from where they stand
      '1-0-1 a2@right>b1', // side-out: a2 is in A's right court now
      '1-0-2 a1@left>b2',
    ]);
  });

  it('rally-scoring doubles: the server is whoever stands in the court the score names', () => {
    const f = fmtOf('mlp_rally_21');
    expect(['AAB', 'AABB', 'AABBA'].map((s) => who(f, s))).toEqual([
      '1-2 b2@left>a2',  // B never moved, so b2 is in the left court
      '2-2 b2@right>a1', // b2 scored and switched
      '3-2 a2@left>b1',
    ]);
  });

  it('side-out singles: one server, so the serve crosses on the first lost rally', () => {
    const sgl = { A: ['a1'], B: ['b1'] };
    const f = formatForPairing(fmtOf('usap_tournament_bo3_11'), sgl);
    let s = initKernel(f, 'A');
    expect(s.serve.serverNo).toBe(1); // no 0-0-2 in singles
    s = step(f, s, { t: 'point', side: 'B' }).state;
    expect(s.serve.side).toBe('B');
    s = step(f, s, { t: 'point', side: 'A' }).state; // B loses: straight back to A
    expect(s.serve.side).toBe('A');
    expect(s.score[0]).toEqual([0, 0]);
    // Doubles is left as written.
    const asWritten = fmtOf('usap_tournament_bo3_11');
    expect(formatForPairing(asWritten, dbl)).toBe(asWritten);
  });

  it('counts side-outs won and points per service turn under side-out scoring', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    // A opens (one server): scores 2, loses -> side-out to B. B: s1 loses, s2 loses -> side-out to A.
    const { sides } = deriveRacquetStats(f, rallies('AAB' + 'AA'), {});
    expect(sides.B.side_outs_won).toBe(1);
    expect(sides.A.side_outs_won).toBe(1);
    expect(sides.A.service_turns).toBe(1);
    expect(sides.A.service_turn_points).toBe(2);
    expect(sides.B.service_turns).toBe(1);
    expect(sides.B.service_turn_points ?? 0).toBe(0);
    const career = foldCareerStats(statSpecFor('pickleball')!, [sides.A]);
    expect(career.points_per_service_turn).toBe(2);
    // Rally scoring has no side-outs to count.
    expect(deriveRacquetStats(fmtOf('mlp_rally_21'), rallies('AABB'), {}).sides.A.side_outs_won).toBeUndefined();
  });

  it('side-out %: side-outs won out of the opponents\' service turns faced', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    // A opens and is sided out (B: 1 of 1). B's turn ends with a side-out too (A: 1 of 1).
    const { sides } = deriveRacquetStats(f, rallies('AAB' + 'AA'), {});
    expect(sides.B).toMatchObject({ side_outs_won: 1, service_turns_faced: 1 });
    const career = foldCareerStats(statSpecFor('pickleball')!, [sides.B]);
    expect(career.side_out_pct).toBe(100);
  });

  it('a pickle is a game won with the opponents on 0 - pickleball only', () => {
    const f = fmtOf('mlp_rally_21');
    expect(deriveRacquetStats(f, rallies('A'.repeat(21)), {}).sides.A.pickles).toBe(1);
    expect(deriveRacquetStats(f, rallies('B' + 'A'.repeat(21)), {}).sides.A.pickles).toBeUndefined();
    // A 21-0 in badminton is not a pickle.
    expect(deriveRacquetStats(fmtOf('bwf_official_3x21'), rallies('A'.repeat(21)), {}).sides.A.pickles).toBeUndefined();
  });

  it('misconduct is worded in the sport\'s own terms', () => {
    expect(misconductTerms('pickleball')).toEqual({ warning: 'Technical warning', foul: 'Technical foul', removal: 'Ejection' });
    expect(misconductTerms('badminton').removal).toBe('Black card');
  });

  it('timeouts: 2 a team per game, reset each game; 3 in games to 21', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    const to = (side: Side): RallyEvent => ({ t: 'timeout', side });
    expect(timeoutsLeft(f, [])).toEqual({ A: 2, B: 2 });
    const used = [to('A'), ...rallies('A'), to('A'), to('B')];
    expect(timeoutsLeft(f, used)).toEqual({ A: 0, B: 1 });
    // A timeout changes nothing on the scoreboard.
    expect(foldRally(f, used, 'A').state.score[0]).toEqual(foldRally(f, rallies('A'), 'A').state.score[0]);
    // A wins game 1 (side-out scoring: A serves throughout), so game 2 starts afresh.
    expect(timeoutsLeft(f, [...used, ...rallies('A'.repeat(10))])).toEqual({ A: 2, B: 2 });
    expect(timeoutsLeft(fmtOf('usap_single_game_21'), [])).toEqual({ A: 3, B: 3 });
    // Table tennis: one a match; badminton: none.
    expect(timeoutRules(fmtOf('ittf_bo5_11'))).toMatchObject({ perMatch: 1, perGame: null });
    expect(timeoutRules(fmtOf('bwf_official_3x21'))).toBeNull();
  });

  it('side-out serve and receive stats count rallies, not only points', () => {
    const f = fmtOf('usap_tournament_bo3_11');
    // A serves and wins 1, loses 1 (side-out); B then loses 1 and wins 1.
    const { sides } = deriveRacquetStats(f, rallies('ABAB'), {});
    expect(sides.A.service_points_won).toBeGreaterThan(0);
    expect(sides.A.service_points_won).toBeLessThan(sides.A.service_points_played!);
    expect(sides.B.return_points_won).toBeGreaterThan(0);
  });
});

describe('squash', () => {
  it('English 9 scores only for the server but moves the serve to the rally winner', () => {
    const f = fmtOf('english9_bo5');
    let s = initKernel(f, 'A');
    const r = step(f, s, { t: 'point', side: 'B' });
    expect(r.state.score[0]).toEqual([0, 0]); // receiver scores nothing
    expect(r.state.serve.side).toBe('B');     // but takes the serve
    s = r.state;
    const r2 = step(f, s, { t: 'point', side: 'B' });
    expect(r2.state.score[0]).toEqual([0, 1]); // now B is the server
  });

  it('English best of 5 is a best of 5: a game to 9 is one game, not the match', () => {
    const f = fmtOf('english9_bo5');
    const one = foldRally(f, points('A', 9), 'A').state; // A serves throughout and wins 9-0
    expect(one.ended).toBe(false);
    expect(one.score[1]).toEqual([1, 0]);
    // Three games to A ends it.
    expect(foldRally(f, points('A', 27), 'A').state).toMatchObject({ ended: true, winner: 'A' });
  });

  it('English scoring plays "set two" from 8-8: first to 10', () => {
    const f = fmtOf('english9_bo5');
    // A to 8 (A serves); B wins the serve back and scores 8; A wins the serve back.
    const eightAll: RallyLog = [...points('A', 8), ...points('B', 9), { t: 'point', side: 'A' } as RallyEvent];
    const s = foldRally(f, eightAll, 'A').state;
    expect(s.score[0]).toEqual([8, 8]);
    expect(foldRally(f, [...eightAll, ...points('A', 1)], 'A').state.score[0]).toEqual([9, 8]); // not over at 9-8
    expect(foldRally(f, [...eightAll, ...points('A', 2)], 'A').state.score[1]).toEqual([1, 0]); // 10-8 wins
  });

  it('at 8-8 the receiver may elect "set one": the next point the server wins takes the game', () => {
    const f = fmtOf('english9_bo5');
    const eightAll: RallyLog = [...points('A', 8), ...points('B', 9), { t: 'point', side: 'A' } as RallyEvent];
    const s = foldRally(f, eightAll, 'A').state;
    expect(setChoiceDue(f, s)).toBe(true);
    const one = foldRally(f, [...eightAll, { t: 'setChoice', choice: 'one' }, ...points('A', 1)], 'A').state;
    expect(one.score[1]).toEqual([1, 0]); // 9-8 wins under set one
    // Set two: 9-8 does not end it.
    const two = foldRally(f, [...eightAll, { t: 'setChoice', choice: 'two' }, ...points('A', 1)], 'A').state;
    expect(two.score[0]).toEqual([9, 8]);
    // The election is for that game only, and only at 8-8.
    expect(foldRally(f, [...points('A', 3), { t: 'setChoice', choice: 'one' }], 'A').state.setChoice).toBeUndefined();
    expect(foldRally(f, [...eightAll, { t: 'setChoice', choice: 'one' }, ...points('A', 1)], 'A').state.setChoice).toBeUndefined();
  });

  it('the server chooses the box at the start of each hand, then alternates (WSF 5.7)', () => {
    const f = fmtOf('pars11_bo3');
    const box = (log: RallyLog) => foldRally(f, log, 'A').state.serve.courtHalf;
    const pick: RallyEvent = { t: 'switchBox' };
    expect([box([]), box([pick]), box([pick, ...points('A', 1)])]).toEqual(['right', 'left', 'right']);
    expect(box([...points('A', 1), pick])).toBe(box(points('A', 1))); // not mid-hand
    // A new server chooses afresh: B starts on the right unless they pick otherwise.
    expect(box([pick, ...points('B', 1)])).toBe('right');
  });

  it('uses squash conduct wording', () => {
    expect(misconductTerms('squash')).toEqual({ warning: 'Conduct warning', foul: 'Conduct stroke', removal: 'Conduct match' });
  });

  it('doubles: the serve rotates A1 > B1 > A2 > B2 at each hand-out (WSF doubles 5.2-5.5)', () => {
    const f = fmtOf('doubles_pars11_bo3');
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const server = (s: string) => resolveServer(f, foldRally(f, s.split('').map((side) => ({ t: 'point', side }) as RallyEvent), 'A').state, pair).server;
    expect(['', 'B', 'BA', 'BAB', 'BABA'].map(server)).toEqual(['a1', 'b1', 'a2', 'b2', 'a1']);
    expect(server('AAB')).toBe('b1'); // a1 keeps serving while winning
  });

  it('doubles receivers keep a side: a serve from the right box goes to the left-side receiver', () => {
    const f = fmtOf('doubles_pars11_bo3');
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const rec = (log: RallyLog) => resolveServer(f, foldRally(f, log, 'A').state, pair).receiver;
    // b1 receives on the right, b2 on the left: a1 serves right first, to b2.
    expect([rec([]), rec(points('A', 1))]).toEqual(['b2', 'b1']);
    // At the start of the game B may swap sides.
    expect(rec([{ t: 'switchReceiver', side: 'B' }])).toBe('b1');
  });

  it('PARS 11 scores every rally', () => {
    const f = fmtOf('pars11_bo3');
    const r = step(f, initKernel(f, 'A'), { t: 'point', side: 'B' });
    expect(r.state.score[0]).toEqual([0, 1]);
  });

  it('applies a handicap start to every game', () => {
    const f = fmtOf('handicap_pars11');
    const s = initKernel(f, 'A');
    expect(s.score[0]).toEqual([5, 0]);
    // A needs 6 more; the next game starts at 5-0 again.
    const r = foldRally(f, points('A', 6));
    expect(r.state.score[1]).toEqual([1, 0]);
    expect(r.state.score[0]).toEqual([5, 0]);
  });
});

describe('manual intervention', () => {
  const f = fmtOf('ittf_bo5_11');

  it('undo restores the serve, not just the numbers', () => {
    let log: RallyLog = [{ t: 'point', side: 'A' }, { t: 'point', side: 'A' }];
    const two = foldRally(f, log);
    expect(two.state.serve.side).toBe('B'); // two serves used, handed over
    const back = undo(f, log);
    expect(back.state.score[0]).toEqual([1, 0]);
    expect(back.state.serve.side).toBe('A');
    expect(back.state.serve.turnCount).toBe(1);
  });

  it('a let neither scores nor moves the serve', () => {
    const r = foldRally(f, [{ t: 'let' }, { t: 'let' }]);
    expect(r.state.score[0]).toEqual([0, 0]);
    expect(r.state.serve.side).toBe('A');
    expect(r.state.serve.turnCount).toBe(0);
  });

  it('minus-one floors at zero', () => {
    const r = foldRally(f, [{ t: 'adjust', side: 'A', delta: -1 }]);
    expect(r.state.score[0]).toEqual([0, 0]);
  });

  it('awards a game outright, marking it as awarded', () => {
    const r = foldRally(f, [{ t: 'point', side: 'A' }, { t: 'awardUnit', side: 'B', reason: 'conduct' }]);
    expect(r.state.score[1]).toEqual([0, 1]);
    expect(r.state.finished[0].awarded).toBe(true);
  });

  it('a penalty point advances the serve clock like a rallied point', () => {
    const off = fmtOf('sprint_9_serve3'); // selfScored -> penalties off
    expect(foldRally(off, [{ t: 'penalty', side: 'A' }]).state.score[0]).toEqual([0, 0]);
    const on = fmtOf('ittf_bo5_11'); // officiated -> penalties on
    const r = foldRally(on, [{ t: 'penalty', side: 'A' }]);
    expect(r.state.score[0]).toEqual([1, 0]);
  });

  it('setServe corrects a mis-scored serve without touching the score', () => {
    const r = foldRally(f, [{ t: 'point', side: 'A' }, { t: 'setServe', side: 'B', reason: 'wrong server' }]);
    expect(r.state.score[0]).toEqual([1, 0]);
    expect(r.state.serve.side).toBe('B');
  });

  it('records a retirement with a nullable winner and a reason', () => {
    const r = foldRally(f, [
      ...points('A', 11), ...points('A', 5),
      { t: 'end', outcome: 'win', reason: 'retired', winner: 'A' },
    ]);
    expect(r.state.ended).toBe(true);
    expect(r.state.reason).toBe('retired');
    const env = resultEnvelope(f, r.state);
    expect(env.unitScores[0]).toEqual([11, 0]);
  });
});

describe('a match stopped early', () => {
  const pts = (n: number): RallyLog => Array.from({ length: n }, () => ({ t: 'point', side: 'A' }) as RallyEvent);
  it('reads the reason from the last end event', () => {
    expect(earlyEndOf({ rally: [...pts(3), { t: 'end', outcome: 'win', reason: 'retired', winner: 'A' }] })).toBe('retired');
    expect(earlyEndOf({ rally: [...pts(3), { t: 'end', outcome: 'win', reason: 'disqualified', winner: 'B' }, { t: 'clockPause' }] })).toBe('disqualified');
  });
  it('is nothing for a match played out, a walkover, or an end that Rescore reopened', () => {
    expect(earlyEndOf({ rally: pts(3) })).toBeNull();
    expect(earlyEndOf({ rally: [{ t: 'end', outcome: 'win', reason: 'walkover', winner: 'A' }] })).toBeNull();
    expect(earlyEndOf({ rally: [{ t: 'end', outcome: 'win', reason: 'retired', winner: 'A' }, ...pts(1)] })).toBeNull();
    expect(earlyEndOf({})).toBeNull();
  });
});

describe('misconduct', () => {
  it('a conduct point moves the serve like a rally won: badminton hands it over', () => {
    const f = fmtOf('bwf_official_3x21');
    const s = foldRally(f, [{ t: 'penalty', side: 'B', card: 'red' }], 'A').state;
    expect(s.score[0]).toEqual([0, 1]);
    expect(s.serve.side).toBe('B');
  });

  it('table tennis: a conduct point counts in the 2-serve turn', () => {
    const f = fmtOf('ittf_bo5_11');
    const s = foldRally(f, [{ t: 'penalty', side: 'B' }, { t: 'point', side: 'A' }], 'A').state;
    expect(s.serve.side).toBe('B');
  });

  it('a yellow card changes nothing on the scoreboard', () => {
    const f = fmtOf('bwf_official_3x21');
    const before = foldRally(f, points('A', 3), 'A').state;
    const after = foldRally(f, [...points('A', 3), { t: 'card', card: 'yellow', against: 'B' }], 'A').state;
    expect(after.score).toEqual(before.score);
    expect(after.serve).toEqual(before.serve);
  });

  it('a disqualification ends the match for the other side', () => {
    const f = fmtOf('bwf_official_3x21');
    const s = foldRally(f, [...points('A', 3), { t: 'end', outcome: 'win', reason: 'disqualified', winner: 'B' }], 'A').state;
    expect(s).toMatchObject({ ended: true, winner: 'B', reason: 'disqualified' });
  });
});

describe('the buzzer', () => {
  it('gives a capped game to the leader', () => {
    const f = fmtOf('corp_bo3_11_timecap');
    const r = foldRally(f, [...points('A', 5), ...points('B', 3), { t: 'capFired' }]);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    expect(r.state.reason).toBe('cap');
  });

  it('a side a game up wins at the buzzer, even trailing the game under way', () => {
    const f = fmtOf('corp_bo3_11_timecap');
    const r = foldRally(f, [...points('A', 11), ...points('B', 5), ...points('A', 3), { t: 'capFired' }]);
    expect(r.state).toMatchObject({ ended: true, winner: 'A', reason: 'cap' });
    // The unfinished game is not recorded as won by A from 3-5 down.
    expect(r.state.finished.filter((u) => u.level === 0)).toHaveLength(1);
  });

  it('level on games, the live game decides', () => {
    const f = fmtOf('corp_bo3_11_timecap');
    const r = foldRally(f, [...points('A', 11), ...points('B', 11), ...points('B', 4), ...points('A', 2), { t: 'capFired' }]);
    expect(r.state).toMatchObject({ ended: true, winner: 'B' });
  });

  it('records a draw when the format allows one and the scores are level', () => {
    const f = fmtOf('timecap_10min_game');
    expect(f.endStates.drawsAllowed).toBe(true);
    const r = foldRally(f, [...interleave(4, 4).map((side) => ({ t: 'point', side }) as RallyEvent), { t: 'capFired' }]);
    expect(r.state.outcome).toBe('draw');
    expect(r.state.winner).toBeNull();
  });

  it('plays on for a sudden-death point when draws are not allowed', () => {
    const f = fmtOf('corp_bo3_11_timecap');
    const level = [...interleave(4, 4).map((side) => ({ t: 'point', side }) as RallyEvent), { t: 'capFired' } as RallyEvent];
    const r = foldRally(f, level);
    expect(r.state.ended).toBe(false);
    const settled = foldRally(f, [...level, { t: 'point', side: 'B' }]);
    expect(settled.state.score[0]).toEqual([4, 5]);
  });

  // Kho-kho, kabaddi and the other invasion sports (`decide: 'aggregate'`) are
  // won on the TOTAL across every period played, not on the period in
  // progress. `applyCap` used to compare only `state.score[at]` - the live
  // period's own score - so a side leading 8-0 overall could still lose the
  // match to the buzzer over a 0-2 blip in the period that happened to be
  // running when the whole-match safety clock fired.
  it('gives the whole-match cap to whoever leads the TRUE aggregate, not the live period alone', () => {
    const f = fmtOf('kho_4turns');
    const log: RallyEvent[] = [
      ...Array.from({ length: 8 }, () => ({ t: 'point', side: 'A' }) as RallyEvent),
      { t: 'endPeriod' },
      ...Array.from({ length: 5 }, () => ({ t: 'point', side: 'B' }) as RallyEvent),
      { t: 'endPeriod' },
      // Aggregate so far: A 8, B 5 - A well ahead. This period alone is B's.
      ...Array.from({ length: 2 }, () => ({ t: 'point', side: 'B' }) as RallyEvent),
      { t: 'capFired' },
    ];
    const r = foldRally(f, log);
    expect(aggregateScore(r.state)).toEqual([8, 7]);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    expect(r.state.reason).toBe('cap');
  });

  it('still draws a level aggregate at the cap when the format allows one', () => {
    const f = fmtOf('kho_4turns');
    const log: RallyEvent[] = [
      ...Array.from({ length: 8 }, () => ({ t: 'point', side: 'A' }) as RallyEvent),
      { t: 'endPeriod' },
      ...Array.from({ length: 8 }, () => ({ t: 'point', side: 'B' }) as RallyEvent),
      { t: 'endPeriod' },
      { t: 'capFired' },
    ];
    const r = foldRally(f, log);
    expect(r.state.outcome).toBe('draw');
    expect(r.state.winner).toBeNull();
  });
});

describe('racquet stats derived from the rally log', () => {
  const f = fmtOf('ittf_bo5_11');

  it('splits service and return points without a single extra tap', () => {
    // A serves points 1-2, B serves 3-4, ...
    const log: RallyLog = [
      { t: 'point', side: 'A' }, // A serving, A wins  -> service point won
      { t: 'point', side: 'B' }, // A serving, B wins  -> return point won for B
      { t: 'point', side: 'B' }, // B serving, B wins  -> service point won
      { t: 'point', side: 'A' }, // B serving, A wins  -> return point won for A
    ];
    const { sides } = deriveRacquetStats(f, log, { firstServer: 'A' });
    expect(sides.A.points_won).toBe(2);
    expect(sides.A.service_points_played).toBe(2);
    expect(sides.A.service_points_won).toBe(1);
    expect(sides.A.return_points_played).toBe(2);
    expect(sides.A.return_points_won).toBe(1);
    expect(sides.B.service_points_won).toBe(1);
  });

  it('tracks the longest point streak', () => {
    const { sides } = deriveRacquetStats(f, [...points('A', 5), ...points('B', 2), ...points('A', 3)]);
    expect(sides.A.longest_streak).toBe(5);
    expect(sides.B.longest_streak).toBe(2);
  });

  it('counts deuce points only at or past the margin threshold', () => {
    const { sides } = deriveRacquetStats(f, interleave(10, 10)
      .map((side) => ({ t: 'point', side }) as RallyEvent).concat(points('A', 2)));
    // 10-10 is the threshold; the two points after it are deuce points.
    expect(sides.A.deuce_points_won).toBe(2);
    expect(sides.A.games_won).toBe(1);
  });

  it('flags a comeback win after dropping the opening game', () => {
    const log = [...points('B', 11), ...points('A', 11), ...points('A', 11), ...points('A', 11)];
    const { sides } = deriveRacquetStats(f, log);
    expect(sides.A.wins).toBe(1);
    expect(sides.A.comeback_wins).toBe(1);
    expect(sides.B.losses).toBe(1);
    expect(sides.B.comeback_wins).toBeUndefined();
  });

  it('credits a doubles pair jointly but the serve to the actual server', () => {
    const pair = { A: ['ann', 'amy'], B: ['bob', 'ben'] };
    const { players } = deriveRacquetStats(f, points('A', 6), { pairing: pair, firstServer: 'A' });
    const ann = players.find((p) => p.userId === 'ann')!;
    const amy = players.find((p) => p.userId === 'amy')!;
    // The pair won all six points...
    expect(ann.stats.points_won).toBe(6);
    expect(amy.stats.points_won).toBe(6);
    // ...but the service tallies are personal and sum to the side's total.
    const total = (ann.stats.service_points_played ?? 0) + (amy.stats.service_points_played ?? 0);
    expect(total).toBe(4); // A served points 1-2 and 5-6
    expect(ann.partnerUserId).toBe('amy');
  });

  it('counts tennis break points from the serve state alone', () => {
    const tf = fmtOf('itf_standard_bo3');
    // A serves the first game; B reaches 0-40 and converts.
    const { sides } = deriveRacquetStats(tf, points('B', 4), { firstServer: 'A' });
    expect(sides.B.break_points_played).toBe(1);
    expect(sides.B.break_points_won).toBe(1);
  });

  it('folds a career from match lines, computing rates from totals not averages', () => {
    const spec = statSpecFor('table tennis')!;
    const folded = foldCareerStats(spec, [
      { matches: 1, wins: 1, points_won: 33, points_lost: 20, service_points_won: 10, service_points_played: 16, longest_streak: 5 },
      { matches: 1, wins: 0, points_won: 25, points_lost: 33, service_points_won: 8, service_points_played: 20, longest_streak: 7 },
    ]);
    expect(folded.matches).toBe(2);
    expect(folded.wins).toBe(1);
    expect(folded.points_won).toBe(58);
    expect(folded.point_diff).toBe(5);
    expect(folded.longest_streak).toBe(7); // max, not sum
    expect(folded.win_pct).toBe(50);
    // 18/36 from totals - NOT the mean of 62.5% and 40%.
    expect(folded.service_win_pct).toBe(50);
  });
});

// ---- helpers ---------------------------------------------------------------

/** Alternating winners producing exactly (a, b) - A first. */
function interleave(a: number, b: number): Side[] {
  const out: Side[] = [];
  let x = a; let y = b;
  while (x > 0 || y > 0) {
    if (x > 0) { out.push('A'); x--; }
    if (y > 0) { out.push('B'); y--; }
  }
  return out;
}

describe('an unfinished match must not look like a result', () => {
  // The bug this pins: eight points into a game to 11, an official pressed Sign off.
  // The console completed the fixture with the derived headline - games won, 0-0 -
  // and no winner, so standings read it as a legitimate draw and locking published
  // it. The kernel always knew better; nothing was asking it.
  const f = fmtOf('ittf_bo7_11');

  it('does not report the match as ended part-way through the first game', () => {
    const r = foldRally(f, [...points('A', 5), ...points('B', 3)]);
    expect(r.state.ended).toBe(false);
    expect(r.state.winner).toBeNull();
    const env = resultEnvelope(f, r.state);
    expect(env.ended).toBe(false);
    // The headline IS 0-0 here, and correctly so - no game has been won yet. That is
    // exactly why `ended` has to gate sign-off rather than the score being inspected.
    expect(env.headline).toEqual([0, 0]);
    expect(env.pointsFor).toEqual([5, 3]);
  });

  it('reports ended, with a winner, only when the format is satisfied', () => {
    let log: RallyLog = [];
    for (let g = 0; g < 4; g++) log = log.concat(points('A', 11));
    const r = foldRally(f, log);
    expect(r.state.ended).toBe(true);
    const env = resultEnvelope(f, r.state);
    expect(env.winner).toBe('A');
    expect(env.headline).toEqual([4, 0]);
  });

  it('ends cleanly with a named winner when a side retires mid-game', () => {
    // The legitimate way to finish an unfinishable match, and the reason sign-off
    // does not need to be available before the kernel says it is over.
    const r = foldRally(f, [
      ...points('A', 5), ...points('B', 3),
      { t: 'end', outcome: 'win', reason: 'retired', winner: 'A' },
    ]);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    expect(r.state.reason).toBe('retired');
  });

  it('a draw is only ever produced deliberately, by a cap on a format that allows it', () => {
    const capped = fmtOf('timecap_10min_game');
    const level = interleave(4, 4).map((side) => ({ t: 'point', side }) as RallyEvent);
    // Level scores with no buzzer: still running, NOT a draw.
    expect(foldRally(capped, level).state.outcome).toBeNull();
    // Only the buzzer, on a format with drawsAllowed, produces one.
    expect(foldRally(capped, [...level, { t: 'capFired' }]).state.outcome).toBe('draw');
  });
});

describe('the default a draw gets when nobody chooses', () => {
  it('leads with the format each sport is normally played under, not its longest', () => {
    // defaultFormatFor() takes the first preset, so declaration order IS the default.
    // Table tennis led with the best-of-7 championship format; best of 5 is the ITTF
    // standard and what inter-college and corporate play actually use.
    expect(defaultFormatFor('table tennis')?.presetKey).toBe('ittf_bo5_11');
    expect(defaultFormatFor('table tennis')?.levels[1].target).toBe(3); // 3 games = best of 5
    expect(defaultFormatFor('badminton')?.presetKey).toBe('bwf_official_3x21');
    expect(defaultFormatFor('tennis')?.presetKey).toBe('itf_standard_bo3');
    expect(defaultFormatFor('pickleball')?.presetKey).toBe('usap_tournament_bo3_11');
    expect(defaultFormatFor('squash')?.presetKey).toBe('wsf_pars11_bo5');
  });

  it('gives every racquet sport a real default rather than nothing', () => {
    for (const s of ['table tennis', 'badminton', 'tennis', 'pickleball', 'squash']) {
      const d = defaultFormatFor(s);
      expect(d, s).toBeTruthy();
      // A "real" default means it can actually terminate: a target and a margin.
      expect(d!.levels[0].target, s).toBeGreaterThan(0);
      expect(d!.levels[0].winBy, s).toBeGreaterThan(0);
    }
    expect(defaultFormatFor('cricket')).toBeUndefined();
  });
});

describe('rescoring a finished match', () => {
  const f = fmtOf('ittf_bo5_11');

  it('refuses a further point while the match is over, so the deck must undo first', () => {
    let log: RallyLog = [];
    for (let g = 0; g < 3; g++) log = log.concat(points('A', 11));
    const done = foldRally(f, log);
    expect(done.state.ended).toBe(true);
    // step() returns the previous state untouched - which is why the console
    // disables the rally buttons rather than letting them look live and do nothing.
    const after = foldRally(f, [...log, { t: 'point', side: 'B' }]);
    expect(after.state.score[1]).toEqual([3, 0]);
  });

  it('undo reopens a naturally-finished match and restores the serve with it', () => {
    let log: RallyLog = [];
    for (let g = 0; g < 3; g++) log = log.concat(points('A', 11));
    const back = undo(f, log);
    expect(back.state.ended).toBe(false);
    expect(back.state.winner).toBeNull();
    // The third game is live again at 10-0, and scoring continues from there.
    expect(back.state.score[0]).toEqual([10, 0]);
    expect(back.state.score[1]).toEqual([2, 0]);
    const on = foldRally(f, [...back.log, { t: 'point', side: 'B' }]);
    expect(on.state.score[0]).toEqual([10, 1]);
  });

  it('dropping a terminal end event reopens a retired match without touching the score', () => {
    // This is what Rescore does for a match ended by retirement, walkover or award:
    // pop the `end` and the kernel stops calling it over.
    const played: RallyLog = [...points('A', 11), ...points('A', 5)];
    const retired = foldRally(f, [...played, { t: 'end', outcome: 'win', reason: 'retired', winner: 'A' }]);
    expect(retired.state.ended).toBe(true);

    const reopened = foldRally(f, played);
    expect(reopened.state.ended).toBe(false);
    expect(reopened.state.score[1]).toEqual([1, 0]);  // game one still A's
    expect(reopened.state.score[0]).toEqual([5, 0]);  // game two still 5-0
    // And scoring carries on from exactly there.
    const on = foldRally(f, [...played, { t: 'point', side: 'B' }]);
    expect(on.state.score[0]).toEqual([5, 1]);
  });

  it('a rescored match can reach a different, correct winner', () => {
    // A wins 3-0, then it turns out game three was B's: undo the game and give it
    // to B. The log is the history, so this is arithmetic, not surgery.
    let log: RallyLog = [];
    for (let g = 0; g < 2; g++) log = log.concat(points('A', 11));
    const twoNil = foldRally(f, log);
    expect(twoNil.state.score[1]).toEqual([2, 0]);
    const bTakesTwo = foldRally(f, [...log, ...points('B', 11), ...points('B', 11)]);
    expect(bTakesTwo.state.score[1]).toEqual([2, 2]);
    expect(bTakesTwo.state.ended).toBe(false);
  });
});

describe('change of ends between units', () => {
  /** Does the LAST event of this log prompt a change of ends? */
  const promptsAfter = (f: ScoringFormat, log: RallyLog) => {
    const { state, trace } = foldRally(f, log);
    return changesEndsAfterUnit(f, state, trace[trace.length - 1].unitsWon);
  };

  it('table tennis changes after every game, but not mid-game or once the match is over', () => {
    const f = fmtOf('ittf_bo5_11');
    expect(promptsAfter(f, points('A', 10))).toBe(false);
    expect(promptsAfter(f, points('A', 11))).toBe(true);
    expect(promptsAfter(f, [...points('A', 11), ...points('B', 11)])).toBe(true);
    expect(promptsAfter(f, [...points('A', 11), ...points('A', 11), ...points('A', 11)])).toBe(false);
  });

  it('a format that never changes ends stays silent', () => {
    const f = fmtOf('corp_bo3_11_timecap');
    expect(f.changeEnds).toBe('never');
    expect(promptsAfter(f, points('A', 11))).toBe(false);
  });

  it('tennis changes when the games played in the set are odd, counting a finished set', () => {
    const f = fmtOf('itf_standard_bo3');
    const games = (side: Side, n: number) => points(side, 4 * n);
    expect(promptsAfter(f, games('A', 1))).toBe(true);           // 1-0
    expect(promptsAfter(f, games('A', 2))).toBe(false);          // 2-0
    expect(promptsAfter(f, [...games('B', 3), ...games('A', 6)])).toBe(true);  // set 6-3: 9 games
    expect(promptsAfter(f, [...games('B', 4), ...games('A', 6)])).toBe(false); // set 6-4: 10 games
  });
});

describe('rally timing', () => {
  const f = fmtOf('ittf_bo5_11');
  const at = (sec: number) => new Date(Date.UTC(2026, 9, 4, 10, 0, sec)).toISOString();
  /** Points stamped `gap` seconds apart, starting at `from`. */
  const timed = (side: Side, n: number, from: number, gap: number): RallyLog =>
    Array.from({ length: n }, (_, i) => ({ t: 'point', side, at: at(from + i * gap) }) as RallyEvent);

  it('measures the match and each game from first rally to last, leaving breaks out', () => {
    // Game 1: 11 points 20s apart (200s). A 60s break. Game 2: 11 points 20s apart.
    const log = [...timed('A', 11, 0, 20), ...timed('B', 11, 260, 20)];
    const t = rallyTiming(f, log);
    expect(t.unitMs).toEqual([200_000, 200_000]);
    expect(t.matchMs).toBe(460_000);
  });

  it('reports nothing for a log keyed in after the fact', () => {
    const t = rallyTiming(f, timed('A', 11, 0, 1));
    expect(t.matchMs).toBeNull();
    expect(t.unitMs).toEqual([null]);
  });

  it('reports nothing for an untimed log', () => {
    expect(rallyTiming(f, points('A', 11)).matchMs).toBeNull();
  });
});

describe('table tennis expedite system', () => {
  const f = fmtOf('ittf_bo5_11');
  const exp = (inRally = false): RallyEvent => ({ t: 'expedite', reason: 'time', inRally });
  /** Server of each of the next n points from this log. */
  const servers = (log: RallyLog, n: number): Side[] => {
    let s = foldRally(f, log, 'A').state;
    const out: Side[] = [];
    for (let i = 0; i < n; i++) { out.push(s.serve.side); s = step(f, s, { t: 'point', side: 'A' }).state; }
    return out;
  };

  it('ships on the ITTF standard format and not on self-scored corporate play', () => {
    expect(expediteConfig(f)?.returnsToWinPoint).toBe(13);
    expect(expediteConfig(fmtOf('corp_bo3_11_timecap'))).toBeNull();
  });

  it('between rallies, mid-turn: the previous receiver serves, then one serve each', () => {
    // A has served one of their two. Expedite: B (who received it) serves next.
    expect(servers([...points('A', 1), exp()], 4)).toEqual(['B', 'A', 'B', 'A']);
  });

  it('between rallies, at a fresh turn: the serve stays where it was due', () => {
    expect(servers([...points('A', 2), exp()], 3)).toEqual(['B', 'A', 'B']);
  });

  it('ball in play: the interrupted rally is replayed by the same server', () => {
    expect(servers([...points('A', 1), exp(true)], 3)).toEqual(['A', 'B', 'A']);
  });

  it('stays in force for the rest of the match', () => {
    const s = foldRally(f, [exp(), ...points('A', 11)], 'A').state;
    expect(s.score[1]).toEqual([1, 0]);
    expect(s.expedite).toBe(true);
    expect(servers([exp(), ...points('A', 11)], 3)).toEqual(['B', 'A', 'B']);
  });

  it('is ignored by a format without it, and a second call changes nothing', () => {
    const corp = fmtOf('corp_bo3_11_timecap');
    expect(foldRally(corp, [exp()], 'A').state.expedite).toBe(false);
    expect(servers([...points('A', 1), exp(), exp()], 2)).toEqual(['B', 'A']);
  });

  it('doubles rotation runs through all four players once it is one serve each (10-10)', () => {
    const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
    const tenAll: RallyLog = Array.from({ length: 20 }, (_, i) => ({ t: 'point', side: i % 2 ? 'B' : 'A' }) as RallyEvent);
    let s = foldRally(f, tenAll, 'A').state;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(resolveServer(f, s, pair).server!);
      s = step(f, s, { t: 'point', side: i % 2 ? 'B' : 'A' }).state;
    }
    expect(new Set(seen).size).toBe(4);
  });
});

describe('the unit clock (expedite time limit)', () => {
  const f = fmtOf('ittf_bo5_11');
  const T0 = Date.UTC(2026, 9, 4, 10, 0, 0);
  const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
  const pt = (side: Side, sec: number): RallyEvent => ({ t: 'point', side, at: at(sec) });
  const now = (sec: number) => T0 + sec * 1000;

  it('has not started before the first rally of the game', () => {
    expect(unitClock(f, [], 'A', now(30))).toBeNull();
  });

  it('runs from the first rally', () => {
    expect(unitClock(f, [pt('A', 0)], 'A', now(90))).toEqual({ elapsedMs: 90_000, paused: false });
  });

  it('stops for a towel break and carries on from where it stopped', () => {
    const log: RallyLog = [pt('A', 0), { t: 'clockPause', at: at(60) }];
    expect(unitClock(f, log, 'A', now(500))).toEqual({ elapsedMs: 60_000, paused: true });
    const resumed: RallyLog = [...log, { t: 'clockStart', at: at(120) }];
    expect(unitClock(f, resumed, 'A', now(150))).toEqual({ elapsedMs: 90_000, paused: false });
  });

  it('a rally scored while paused means play is on, so the clock restarts', () => {
    const log: RallyLog = [pt('A', 0), { t: 'clockPause', at: at(60) }, pt('B', 100)];
    expect(unitClock(f, log, 'A', now(130))).toEqual({ elapsedMs: 90_000, paused: false });
  });

  it('starts again for each new game, leaving the break between games out', () => {
    const game1: RallyLog = Array.from({ length: 11 }, (_, i) => pt('A', i * 30));
    const log: RallyLog = [...game1, pt('B', 600)];
    expect(unitClock(f, log, 'A', now(660))).toEqual({ elapsedMs: 60_000, paused: false });
  });
});

describe('expedite is not introduced once 18 points are scored (ITTF 2.15.2)', () => {
  const f = fmtOf('ittf_bo5_11');
  const score = (a: number, b: number) => {
    const log: RallyLog = [];
    for (let i = 0; i < Math.max(a, b); i++) {
      if (i < a) log.push({ t: 'point', side: 'A' });
      if (i < b) log.push({ t: 'point', side: 'B' });
    }
    return foldRally(f, log, 'A').state;
  };

  it('counts the total, not each side', () => {
    expect(expediteAllowed(f, score(10, 7))).toBe(true);   // 17
    expect(expediteAllowed(f, score(10, 8))).toBe(false);  // 18 - one side below 9, still exempt
    expect(expediteAllowed(f, score(9, 9))).toBe(false);
  });

  it('reads a format saved with the old per-side setting as the same total', () => {
    const legacy = { ...f, plugins: { expedite: { enabled: true, afterMinutes: 10, exemptAtScore: 9 } } };
    expect(expediteConfig(legacy)?.exemptAtTotal).toBe(18);
  });
});

describe('who serves and who receives in table tennis doubles', () => {
  const f = fmtOf('ittf_bo5_11');
  const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };

  it('follows A1 > B1 > A2 > B2: each receiver serves next', () => {
    let s = foldRally(f, [], 'A').state;
    const seen: Array<[string | null, string | null]> = [];
    for (let i = 0; i < 8; i++) {
      const r = resolveServer(f, s, pair);
      seen.push([r.server, r.receiver]);
      s = step(f, s, { t: 'point', side: 'A' }).state;
    }
    // Two serves each, so every pair of points shares a server and receiver.
    expect(seen.filter((_, i) => i % 2 === 0)).toEqual([['a1', 'b1'], ['b1', 'a2'], ['a2', 'b2'], ['b2', 'a1']]);
  });

  const who = (log: RallyLog) => {
    const r = resolveServer(f, foldRally(f, log, 'A').state, pair);
    return [r.server, r.receiver];
  };
  // Games alternate A, B, A, B, so game 5 is the decider at 2-2 and A serves first.
  const toDecider: RallyLog = [...points('A', 11), ...points('B', 11), ...points('A', 11), ...points('B', 11)];

  it('game 2: the first receiver is the player who served to the new first server', () => {
    // Game 1 opened a1 > b1, so b1 serving first in game 2 receives from a1.
    expect(who(points('A', 11))).toEqual(['b1', 'a1']);
  });

  it('game 2: choosing the other partner to serve first moves the receiver with it', () => {
    const log: RallyLog = [...points('A', 11), { t: 'switchPairServer' }];
    expect(who(log)).toEqual(['b2', 'a2']);
    // Then "each receiver serves next" carries on: b2 > a2 > b1 > a1.
    expect(who([...log, ...points('B', 2)])).toEqual(['a2', 'b1']);
  });

  it('the partner choice is refused once the game has started', () => {
    expect(who([...points('A', 12), { t: 'switchPairServer' }])).toEqual(who(points('A', 12)));
  });

  it('decider: the receiving pair switches order when a pair reaches 5 (ITTF 2.13.6)', () => {
    // 4-0: a2 serving to b2. The point to 5-0 makes b1 the receiver; b1 then serves to a1.
    expect(who([...toDecider, ...points('A', 4)])).toEqual(['a2', 'b2']);
    expect(who([...toDecider, ...points('A', 5)])).toEqual(['a2', 'b1']);
    expect(who([...toDecider, ...points('A', 6)])).toEqual(['b1', 'a1']);
  });

  it('no switch at 5 in a game that is not the decider', () => {
    expect(who(points('A', 5))).toEqual(['a2', 'b2']);
  });
});

describe('serve and receive points are personal in doubles', () => {
  const f = fmtOf('ittf_bo5_11');
  const pair = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
  // A wins every rally of one game to 11.
  const stats = deriveRacquetStats(f, points('A', 11), { pairing: pair, firstServer: 'A' });
  const of = (id: string) => stats.players.find((p) => p.userId === id)!.stats;

  it('splits receiving between the partners, adding up to the pair', () => {
    const sideReturns = stats.sides.B.return_points_played ?? 0;
    expect((of('b1').return_points_played ?? 0) + (of('b2').return_points_played ?? 0)).toBe(sideReturns);
    expect(of('b1').return_points_played).toBeGreaterThan(0);
    expect(of('b2').return_points_played).toBeGreaterThan(0);
  });

  it('a doubles player gets 0 of their own, never their pair’s figure', () => {
    // A served 6 of the 11 rallies (a1 4, a2 2); B received them, so A received only B's 5.
    expect((of('a1').service_points_played ?? 0) + (of('a2').service_points_played ?? 0)).toBe(stats.sides.A.service_points_played);
    expect(of('a1').return_points_won! + of('a2').return_points_won!).toBe(stats.sides.A.return_points_won);
  });

  it('singles is unchanged: every rally is yours', () => {
    const solo = deriveRacquetStats(f, points('A', 11), { pairing: { A: ['x'], B: ['y'] }, firstServer: 'A' });
    const y = solo.players.find((p) => p.userId === 'y')!.stats;
    expect(y.return_points_played).toBe(solo.sides.B.return_points_played);
  });
});

describe('pair serve and receive points in doubles', () => {
  const f = fmtOf('ittf_bo5_11');
  const doubles = deriveRacquetStats(f, points('A', 11), { pairing: { A: ['a1', 'a2'], B: ['b1', 'b2'] }, firstServer: 'A' });
  const of = (id: string) => doubles.players.find((p) => p.userId === id)!.stats;

  it('both partners carry the pair’s totals, beside their own', () => {
    for (const id of ['a1', 'a2']) {
      expect(of(id).pair_service_points_played).toBe(doubles.sides.A.service_points_played);
      expect(of(id).pair_return_points_played).toBe(doubles.sides.A.return_points_played);
      expect(of(id).pair_service_points_won).toBe(doubles.sides.A.service_points_won);
      expect(of(id).pair_return_points_won).toBe(doubles.sides.A.return_points_won ?? 0);
    }
    expect(of('a1').service_points_played).toBeLessThan(of('a1').pair_service_points_played!);
  });

  it('singles has no pair tiles', () => {
    const solo = deriveRacquetStats(f, points('A', 11), { pairing: { A: ['x'], B: ['y'] }, firstServer: 'A' });
    expect(solo.players[0].stats.pair_service_points_played).toBeUndefined();
  });
});

describe('expedite system stats', () => {
  const f = fmtOf('ittf_bo5_11');
  // A wins a point, expedite comes in between rallies (B now serves), A survives 13
  // returns for the next point, then A takes the match 3-0.
  const log: RallyLog = [
    ...points('A', 1),
    { t: 'expedite', reason: 'time', inRally: false },
    { t: 'point', side: 'A', kind: 'expedite_returns' },
    ...points('A', 31),
  ];
  const stats = deriveRacquetStats(f, log, { pairing: { A: ['x'], B: ['y'] }, firstServer: 'A' });

  it('counts the match, the win, and the points played under it', () => {
    expect(stats.sides.A).toMatchObject({ expedite_matches: 1, expedite_wins: 1, expedite_points_played: 32, expedite_points_won: 32 });
    expect(stats.sides.B).toMatchObject({ expedite_matches: 1, expedite_points_played: 32 });
    expect(stats.sides.B.expedite_wins).toBeUndefined();
  });

  it('credits 13 returns to the receiver and charges the server', () => {
    expect(stats.sides.A.expedite_return_wins).toBe(1);
    expect(stats.players.find((p) => p.userId === 'y')!.stats.expedite_return_losses).toBe(1);
  });

  it('a match expedite never came into has no expedite stats at all', () => {
    const plain = deriveRacquetStats(f, points('A', 33), { pairing: { A: ['x'], B: ['y'] }, firstServer: 'A' });
    expect(Object.keys(plain.sides.A).filter((k) => k.startsWith('expedite'))).toEqual([]);
  });
});

describe('presets that play as their names say', () => {
  const games = (seq: string) => [...seq].flatMap((c) => points(c as Side, 4));
  const fold = (key: string, log: RallyLog) => foldRally(fmtOf(key), log, 'A').state;

  it('Grand Slam: the fifth set is a full set, with a 10-point tie-break at 6-6', () => {
    const twoAll = [...games('AAAAAA'), ...games('BBBBBB'), ...games('AAAAAA'), ...games('BBBBBB')];
    // Four points in the fifth is one game, not 4-0 in a tie-break.
    expect(fold('grand_slam_bo5', [...twoAll, ...points('A', 4)]).score[1]).toEqual([1, 0]);
    const sixAll = [...twoAll, ...games('ABABABABABAB')];
    // 7-0 in the fifth-set tie-break is not enough; 10-0 wins the match.
    expect(fold('grand_slam_bo5', [...sixAll, ...points('A', 7)]).ended).toBe(false);
    const won = fold('grand_slam_bo5', [...sixAll, ...points('A', 10)]);
    expect(won).toMatchObject({ ended: true, winner: 'A' });
    // Earlier sets keep the 7-point tie-break.
    expect(fold('grand_slam_bo5', [...games('ABABABABABAB'), ...points('A', 7)]).score[2]).toEqual([1, 0]);
  });

  it('squash Flash plays all three games, then the side with more wins', () => {
    const g7 = (s: Side) => points(s, 7);
    expect(fold('flash_bo3_to_7', [...g7('A'), ...g7('A')]).ended).toBe(false);
    expect(fold('flash_bo3_to_7', [...g7('A'), ...g7('A'), ...g7('B')])).toMatchObject({ ended: true, winner: 'A' });
    expect(fold('flash_bo3_to_7', [...g7('A'), ...g7('B'), ...g7('B')])).toMatchObject({ ended: true, winner: 'B' });
  });

  it('badminton Classic 15 is best of 3 games', () => {
    // Side-out: A serving and winning every rally takes a game, then the match at 2-0.
    let log: RallyLog = [];
    let s = fold('classic_15_sideout', log);
    for (let i = 0; i < 500 && !s.ended; i++) { log = [...log, { t: 'point', side: 'A' }]; s = fold('classic_15_sideout', log); }
    expect(s).toMatchObject({ ended: true, winner: 'A' });
    expect(resultEnvelope(fmtOf('classic_15_sideout'), s).headline).toEqual([2, 0]);
  });
});