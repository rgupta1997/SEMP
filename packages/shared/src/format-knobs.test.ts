import { describe, expect, it } from 'vitest';
import {
  applyKnobs, describeKnobs, isEditable, knobsFor, readKnobs, KNOB_SPECS,
} from './format-knobs.js';
import { presetByKey } from './racquet-presets.js';
import { scoringFormatSchema, type Side } from './scoring-rules.js';
import { foldRally, initKernel, step, type RallyEvent, type RallyLog } from './rally-kernel.js';

const fmt = (k: string) => presetByKey(k)!;
const points = (side: Side, n: number): RallyLog =>
  Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);

/** Alternating winners, so a game reaches (n, n) without either side clinching. */
const level = (n: number): RallyLog =>
  Array.from({ length: n * 2 }, (_, i) => ({ t: 'point', side: i % 2 === 0 ? 'A' : 'B' }) as RallyEvent);

describe('reading a format into knobs', () => {
  it('round-trips a preset unchanged', () => {
    for (const key of ['ittf_bo5_11', 'bwf_official_3x21', 'pars11_bo3', 'usap_single_game_15', 'sprint_9_serve3']) {
      const f = fmt(key);
      const back = applyKnobs(f, readKnobs(f));
      expect(scoringFormatSchema.safeParse(back).success, key).toBe(true);
      // The rules that decide a match must survive the trip.
      expect(back.levels[0].target, key).toBe(f.levels[0].target);
      expect(back.levels[0].winBy, key).toBe(f.levels[0].winBy);
      expect(back.levels[0].cap, key).toBe(f.levels[0].cap);
      expect(back.serve.movement, key).toBe(f.serve.movement);
      expect(back.serve.pointScoring, key).toBe(f.serve.pointScoring);
      expect(back.serve.every, key).toBe(f.serve.every);
    }
  });

  it('reads the badminton decider and the 30 cap', () => {
    const k = readKnobs(fmt('bwf_official_3x21'));
    expect(k.target).toBe(21);
    expect(k.capEnabled).toBe(true);
    expect(k.cap).toBe(30);
    expect(k.unitsToWin).toBe(2); // best of 3
    expect(k.movement).toBe('rallyWinner');
  });

  it('reads the Sprint format the brief asked for', () => {
    const k = readKnobs(fmt('sprint_9_serve3'));
    expect(k.target).toBe(9);
    expect(k.serveEvery).toBe(3);
    expect(k.collapseAt).toBe(8);
  });

  it('reads squash English 9 as server-only scoring', () => {
    const k = readKnobs(fmt('english9_bo5'));
    expect(k.pointScoring).toBe('serverOnly');
    expect(k.winBy).toBe(1);
  });

  it('reads a handicap start', () => {
    const k = readKnobs(fmt('handicap_pars11'));
    expect(k.handicapEnabled).toBe(true);
    expect(k.handicapHome).toBe(5);
  });
});

describe('only offering knobs that can apply', () => {
  it('hides serves-per-turn unless the serve runs on a count', () => {
    const rally = knobsFor(readKnobs(fmt('bwf_official_3x21'))).map((s) => s.key);
    expect(rally).not.toContain('serveEvery');
    const tt = knobsFor(readKnobs(fmt('ittf_bo5_11'))).map((s) => s.key);
    expect(tt).toContain('serveEvery');
    expect(tt).toContain('collapseAt');
  });

  it('hides the pickleball opening exception unless two servers are in play', () => {
    const sideOut = knobsFor(readKnobs(fmt('usap_single_game_15'))).map((s) => s.key);
    expect(sideOut).toContain('serversPerSide');
    expect(sideOut).toContain('firstTurnSingle');
    const rally = knobsFor(readKnobs(fmt('mlp_rally_21'))).map((s) => s.key);
    expect(rally).not.toContain('firstTurnSingle');
  });

  it('hides the ceiling value and the decider until they are switched on', () => {
    const k = { ...readKnobs(fmt('ittf_bo5_11')), capEnabled: false, deciderEnabled: false };
    const keys = knobsFor(k).map((s) => s.key);
    expect(keys).not.toContain('cap');
    expect(keys).not.toContain('deciderTarget');
    expect(knobsFor({ ...k, capEnabled: true }).map((s) => s.key)).toContain('cap');
  });

  it('hides the decider entirely for a single-game format', () => {
    const k = readKnobs(fmt('corp_single_21_capped'));
    expect(k.unitsToWin).toBe(1);
    expect(knobsFor(k).map((s) => s.key)).not.toContain('deciderEnabled');
  });

  it('every knob is reachable from some real format', () => {
    // A knob nothing can ever show is a knob nobody can ever set.
    const seen = new Set<string>();
    for (const key of ['ittf_bo5_11', 'bwf_official_3x21', 'usap_single_game_15', 'handicap_pars11',
      'corp_bo3_11_timecap', 'english9_bo5', 'corp_single_21_capped']) {
      for (const s of knobsFor(readKnobs(fmt(key)))) seen.add(s.key);
    }
    for (const s of KNOB_SPECS) {
      if (s.applies) continue; // conditional knobs are covered by the cases above
      expect(seen.has(s.key), s.key).toBe(true);
    }
  });
});

describe('a format built entirely from user input', () => {
  it('scores exactly as configured - 9 points, serve every 3, cap 11', () => {
    // Built by hand off a plain badminton preset, NOT derived from the TT one, so
    // this proves the knobs alone produce the behaviour.
    const base = fmt('bwf_official_3x21');
    const custom = applyKnobs(base, {
      ...readKnobs(base),
      target: 9, winBy: 2, capEnabled: true, cap: 11, unitsToWin: 2,
      movement: 'everyN', serveEvery: 3, collapseAt: 8, pointScoring: 'rally',
      deciderEnabled: false,
    }, 'Our house rules');
    expect(scoringFormatSchema.safeParse(custom).success).toBe(true);
    expect(custom.name).toBe('Our house rules');

    // The serve changes every third point...
    let s = initKernel(custom, 'A');
    const seen: Side[] = [];
    for (let i = 0; i < 6; i++) { seen.push(s.serve.side); s = step(custom, s, { t: 'point', side: 'A' }).state; }
    expect(seen).toEqual(['A', 'A', 'A', 'B', 'B', 'B']);

    // ...9 wins by two...
    expect(foldRally(custom, points('A', 9)).state.score[1]).toEqual([1, 0]);
    // ...and the ceiling ends it at 11-10 where win-by-2 never would. Ten straight
    // points would already have won a game to 9, so this has to be alternated.
    const tenAll = foldRally(custom, level(10));
    expect(tenAll.state.score[0]).toEqual([10, 10]);
    expect(tenAll.state.score[1]).toEqual([0, 0]);
    const capped = foldRally(custom, [...level(10), { t: 'point', side: 'A' }]);
    expect(capped.state.score[1]).toEqual([1, 0]);
  });

  it('turns deuce off, so the target wins outright', () => {
    const base = fmt('ittf_bo5_11');
    const sudden = applyKnobs(base, { ...readKnobs(base), winBy: 1, capEnabled: false, unitsToWin: 1 });
    // 10-10 is unreachable at target 11 win-by-1 (11 ends it), so check the target
    // itself decides: A takes 11 straight with no margin requirement.
    const r = foldRally(sudden, points('A', 11));
    expect(r.state.ended).toBe(true);
    expect(r.state.winner).toBe('A');
    // And a one-point lead at the target is enough, which win-by-2 would refuse.
    const close = foldRally(sudden, [...level(10), { t: 'point', side: 'A' }]);
    expect(close.state.ended).toBe(true);
  });

  it('adds a decider without inheriting an oversized ceiling', () => {
    const base = fmt('bwf_official_3x21'); // 21, cap 30
    const out = applyKnobs(base, { ...readKnobs(base), deciderEnabled: true, deciderTarget: 11 });
    // A game to 11 must not carry a 30-point ceiling.
    expect(out.levels[0].deciderOverride?.target).toBe(11);
    expect(out.levels[0].deciderOverride?.cap).toBe(20);
  });

  it('clamps a ceiling set below the target rather than saving an unfinishable game', () => {
    const base = fmt('ittf_bo5_11');
    const out = applyKnobs(base, { ...readKnobs(base), target: 21, capEnabled: true, cap: 5 });
    expect(out.levels[0].cap).toBe(21);
  });

  it('keeps the serve resolver and the rules sheet - a custom format is a variant, not a blank slate', () => {
    const base = fmt('bwf_official_3x21');
    const out = applyKnobs(base, { ...readKnobs(base), target: 15 });
    // Still names the right partner to serve in doubles.
    expect(out.serve.resolver).toBe('bwfSingleServer');
    expect(out.serve.courtModel).toBe('parity');
    expect(out.rulesSheet).toEqual(base.rulesSheet);
  });

  it('never leaves conduct points on for self-scored play', () => {
    const base = fmt('ittf_bo5_11');
    const out = applyKnobs(base, { ...readKnobs(base), officiatingMode: 'selfScored', penaltiesEnabled: true });
    expect(out.penaltyEvents).toBe('off');
    expect(out.entryMode).toBe('unitScoresOnly');
  });

  it('builds a clocked format that can end level', () => {
    const base = fmt('pars11_bo3');
    const out = applyKnobs(base, {
      ...readKnobs(base), unitsToWin: 1, clockEnabled: true, clockMinutes: 10,
      clockAction: 'leaderWins', clockTieRule: 'draw', drawsAllowed: true,
    });
    const r = foldRally(out, [...level(4), { t: 'capFired' }]);
    expect(r.state.outcome).toBe('draw');
  });

  it('switches a rally format to server-only scoring and the kernel obeys', () => {
    const base = fmt('pars11_bo3');
    const out = applyKnobs(base, { ...readKnobs(base), pointScoring: 'serverOnly' });
    // The receiver winning a rally now takes the serve and no point.
    const r = step(out, initKernel(out, 'A'), { t: 'point', side: 'B' });
    expect(r.state.score[0]).toEqual([0, 0]);
    expect(r.state.serve.side).toBe('B');
  });
});

describe('formats the flat knobs cannot describe', () => {
  it('refuses tennis rather than flattening a set away', () => {
    expect(isEditable(fmt('itf_standard_bo3'))).toBe(false);
    expect(isEditable(fmt('no_ad_match_tb_bo3'))).toBe(false);
    // Everything else in the racquet family is a two-level format and is editable.
    for (const key of ['ittf_bo5_11', 'bwf_official_3x21', 'pars11_bo3', 'usap_single_game_15']) {
      expect(isEditable(fmt(key)), key).toBe(true);
    }
  });
});

describe('describeKnobs', () => {
  it('says what the format actually does', () => {
    expect(describeKnobs(readKnobs(fmt('sprint_9_serve3'))))
      .toBe('best of 3 to 9 · win by 2 · cap 11 · serve every 3');
    expect(describeKnobs(readKnobs(fmt('english9_bo5'))))
      .toContain('server scores only');
  });
});
