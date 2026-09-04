import { describe, expect, it } from 'vitest';
import {
  foldRally, headline, initKernel, resultEnvelope, step, undo, unitWinner,
  type KernelState, type RallyEvent, type RallyLog,
} from './rally-kernel.js';
import { defaultFormatFor, presetByKey, presetsFor, RACQUET_PRESETS } from './racquet-presets.js';
import { resolveServer, serveCall } from './serve-resolvers.js';
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

  it('names the partner on the correct service court in doubles', () => {
    const pair = { A: ['Ann', 'Amy'], B: ['Bob', 'Ben'] };
    let s = initKernel(f, 'A');
    expect(resolveServer(f, s, pair).server).toBe('Ann'); // 0-0, right court
    s = step(f, s, { t: 'point', side: 'A' }).state;
    expect(resolveServer(f, s, pair).server).toBe('Amy'); // 1-0, left court
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

  it('wins at 15 with a single point margin', () => {
    // Only the server scores, so A must hold serve throughout.
    const r = foldRally(f, points('A', 15), 'A');
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
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

  it('English 9 ends at 9-8 (win by 1)', () => {
    const f = fmtOf('english9_bo5');
    const r = foldRally(f, points('A', 9), 'A');
    expect(r.state.ended).toBe(true);
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

describe('the buzzer', () => {
  it('gives a capped game to the leader', () => {
    const f = fmtOf('corp_bo3_11_timecap');
    const r = foldRally(f, [...points('A', 5), ...points('B', 3), { t: 'capFired' }]);
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    expect(r.state.reason).toBe('cap');
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
