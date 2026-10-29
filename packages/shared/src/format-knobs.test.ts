import { describe, expect, it } from 'vitest';
import {
  applyKnobs, describeKnobs, isEditable, knobsFor, readKnobs, KNOB_SPECS,
} from './format-knobs.js';
import { presetByKey } from './racquet-presets.js';
import { teamPresetsFor } from './team-presets.js';
import { scoringFormatSchema, type Side } from './scoring-rules.js';
import { foldRally, initKernel, step, timeoutRules, timeoutsAllowedNow, timeoutsLeft, type RallyEvent, type RallyLog } from './rally-kernel.js';

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

  it('reads squash English 9 as server-only scoring, "set two" at 8-8', () => {
    const k = readKnobs(fmt('english9_bo5'));
    expect(k.pointScoring).toBe('serverOnly');
    // First to 9 by two, capped at 10: from 8-8 it is first to 10.
    expect(k.winBy).toBe(2);
    expect(k.cap).toBe(10);
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

describe('chess formats in the editor', () => {
  const blitz = teamPresetsFor('chess').find((f) => f.presetKey === 'blitz_bo5')!;

  it('offers the games, the time control and how it is run - nothing about targets or serves', () => {
    const keys = knobsFor(readKnobs(blitz)).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['unitsToWin', 'timeBaseMinutes', 'timeIncrementSeconds', 'drawsAllowed']));
    expect(keys).not.toContain('target');
    expect(keys).not.toContain('movement');
    expect(keys).not.toContain('changeEnds');
  });

  it('reads and writes the time control on the rules sheet', () => {
    const k = readKnobs(blitz);
    expect([k.timeBaseMinutes, k.timeIncrementSeconds]).toEqual([3, 2]);
    const rapid = applyKnobs(blitz, { ...k, timeBaseMinutes: 15, timeIncrementSeconds: 10 });
    expect(rapid.rulesSheet?.timeControl).toBe('15+10');
    expect(describeKnobs(readKnobs(rapid))).toBe('5-game match · 15+10');
  });
});

describe('describeKnobs', () => {
  it('says what the format actually does', () => {
    expect(describeKnobs(readKnobs(fmt('sprint_9_serve3'))))
      .toBe('best of 3 to 9 · win by 2 · cap 11 · serve every 3 · 1 timeout a match (60s)');
    expect(describeKnobs(readKnobs(fmt('english9_bo5'))))
      .toContain('server scores only');
  });
});

describe('period-shaped formats (kho-kho, kabaddi...)', () => {
  it('flags kho-kho as period-shaped, and a racquet preset as not', () => {
    expect(readKnobs(fmt('kho_4turns')).periodShaped).toBe(true);
    expect(readKnobs(fmt('bwf_official_3x21')).periodShaped).toBe(false);
  });

  it('hides every racquet-only knob (shape, serve, ends) and offers only "number of periods"', () => {
    const k = readKnobs(fmt('kho_4turns'));
    const shown = new Set<string>(knobsFor(k).map((s) => s.key));
    for (const hidden of [
      'target', 'winBy', 'capEnabled', 'cap', 'deciderEnabled', 'deciderTarget',
      'handicapEnabled', 'handicapHome', 'handicapAway',
      'pointScoring', 'movement', 'serveEvery', 'collapseAt', 'serversPerSide', 'firstTurnSingle',
      'changeEnds', 'switchEndsAt', 'letsEnabled', 'penaltiesEnabled',
    ]) expect(shown.has(hidden), hidden).toBe(false);
    expect(shown.has('unitsToWin')).toBe(true);
    // Time cap and "how it is run" still apply - a kho-kho turn genuinely has a
    // clock, and someone still decides who scores and whether a draw stands.
    for (const stillShown of ['clockEnabled', 'clockMinutes', 'clockAction', 'clockTieRule', 'officiatingMode', 'drawsAllowed']) {
      expect(shown.has(stillShown), stillShown).toBe(true);
    }
  });

  it('describes itself by periods, not by an invented "game"', () => {
    // The per-period figure is shown alongside the total for exactly the reason
    // this whole knob split exists: a period-shaped match's clock is one
    // whole-match total, and typing that without seeing what it works out to
    // per period is how a 4-period match quietly gets a 1-minute period.
    expect(describeKnobs(readKnobs(fmt('kho_4turns')))).toBe('4 turns · 36 min cap (9/period) · minimum chase');
    expect(describeKnobs(readKnobs(fmt('kho_2x9')))).toBe('2 turns · 18 min cap (9/period) · minimum chase');
  });

  it('offers "Minutes per period" instead of "Minutes" for a period-shaped format, and round-trips through the total it actually stores', () => {
    const k = readKnobs(fmt('kho_4turns')); // 4 periods, 36 min total
    const shown = knobsFor(k);
    expect(shown.find((s) => s.key === 'clockMinutes' && s.label === 'Minutes per period')).toBeTruthy();
    expect(shown.find((s) => s.key === 'clockMinutes' && s.label === 'Minutes')).toBeFalsy();

    const spec = KNOB_SPECS.find((s) => s.key === 'clockMinutes' && s.label === 'Minutes per period')!;
    // The stored total (36) reads as 9 per period, and typing 9 back writes the
    // same total - the organiser never has to do that division themselves.
    expect(spec.toDisplay!(k.clockMinutes, k)).toBe(9);
    expect(spec.fromDisplay!(9, k)).toBe(36);

    // Bump periods 4 -> 6 without touching minutes at all: the STORED total is
    // untouched (nothing silently rewrote it), but the number the organiser sees
    // recalculates on its own - so a pace that quietly got thinner is visible
    // immediately instead of being buried in a total nobody re-divided.
    const morePerods = { ...k, unitsToWin: 6 };
    expect(spec.toDisplay!(morePerods.clockMinutes, morePerods)).toBe(6);
  });

  it("round-trips the match level's decide:'aggregate' through applyKnobs", () => {
    // This is the correctness bug, not just the UI one: rebuilding the match
    // level from a bare literal silently dropped `decide`, which is what tells
    // the kernel this format is won on total score rather than turns won.
    const base = fmt('kho_4turns');
    const roundTripped = applyKnobs(base, readKnobs(base));
    expect(roundTripped.levels[roundTripped.levels.length - 1].decide).toBe('aggregate');

    // Changing the one knob it actually offers - how many periods - still
    // preserves it.
    const changed = applyKnobs(base, { ...readKnobs(base), unitsToWin: 2 });
    const top = changed.levels[changed.levels.length - 1];
    expect(top.decide).toBe('aggregate');
    expect(top.target).toBe(2);
  });
});

/**
 * THE SETTLEMENT CHAIN, THROUGH THE EDITOR.
 *
 * `tieBreak` has now been dropped silently in two separate places on its way to a
 * fixture - the preset builder, which listed its fields by hand, and the zod schema,
 * which drops unknown keys. Both failed with green tests and no error; the second
 * one only surfaced as a knockout stuck on "Half 2 of 2". These are the guards, so
 * the third place does not get to do it too.
 */
describe('extra time and the shoot-out are editable, and survive the editor', () => {
  const ko = fmt('fest_2x10_ko');

  it('reads the chain off the format', () => {
    const k = readKnobs(ko);
    expect(k.extraTimeEnabled).toBe(true);
    expect(k.extraTimePeriods).toBe(2);
    expect(k.extraTimeMinutes).toBe(5);
    expect(k.shootoutEnabled).toBe(true);
    expect(k.shootoutKicks).toBe(5);
  });

  it('defaults to two halves of five and five kicks when a format declares none', () => {
    const league = fmt('fifa_2x45');
    const k = readKnobs({ ...league, tieBreak: null });
    expect(k.extraTimeEnabled).toBe(false);
    expect(k.shootoutEnabled).toBe(false);
    // Off, but pre-filled - turning it on must not also require deciding how long.
    expect(k.extraTimePeriods).toBe(2);
    expect(k.extraTimeMinutes).toBe(5);
    expect(k.shootoutKicks).toBe(5);
  });

  it('round-trips the chain unchanged through the editor', () => {
    const again = applyKnobs(ko, readKnobs(ko));
    expect(again.tieBreak).toEqual(ko.tieBreak);
  });

  it('SURVIVES THE ZOD SCHEMA, which strips what it does not declare', () => {
    const parsed = scoringFormatSchema.parse(ko);
    expect(parsed.tieBreak).toEqual({
      extraTime: { periods: 2, minutes: 5 },
      penalties: { kicks: 5 },
    });
  });

  it('writes an organiser edit back', () => {
    const k = readKnobs(ko);
    const longer = applyKnobs(ko, { ...k, extraTimeMinutes: 7, shootoutKicks: 3 });
    expect(longer.tieBreak?.extraTime).toEqual({ periods: 2, minutes: 7 });
    expect(longer.tieBreak?.penalties).toEqual({ kicks: 3 });
    // And the edit is still there after a save/load through zod.
    expect(scoringFormatSchema.parse(longer).tieBreak?.extraTime?.minutes).toBe(7);
  });

  it('turns each half of the chain off independently', () => {
    const k = readKnobs(ko);
    const kicksOnly = applyKnobs(ko, { ...k, extraTimeEnabled: false });
    expect(kicksOnly.tieBreak?.extraTime).toBeNull();
    expect(kicksOnly.tieBreak?.penalties).toEqual({ kicks: 5 });

    const etOnly = applyKnobs(ko, { ...k, shootoutEnabled: false });
    expect(etOnly.tieBreak?.penalties).toBeNull();

    const neither = applyKnobs(ko, { ...k, extraTimeEnabled: false, shootoutEnabled: false });
    expect(neither.tieBreak).toBeNull();
  });

  // A drawable match never reaches any of it, so asking an organiser to configure
  // it would be asking about something that cannot happen.
  it('hides the whole group while draws are allowed', () => {
    const keysFor = (drawsAllowed: boolean) =>
      knobsFor({ ...readKnobs(ko), drawsAllowed }).map((x) => x.key);
    expect(keysFor(true)).not.toContain('extraTimeEnabled');
    expect(keysFor(true)).not.toContain('shootoutKicks');
    expect(keysFor(false)).toContain('extraTimeEnabled');
    expect(keysFor(false)).toContain('shootoutEnabled');
  });

  it('hides the lengths until the thing they describe is switched on', () => {
    const k = { ...readKnobs(ko), drawsAllowed: false, extraTimeEnabled: false };
    expect(knobsFor(k).map((x) => x.key)).not.toContain('extraTimeMinutes');
    expect(knobsFor({ ...k, extraTimeEnabled: true }).map((x) => x.key)).toContain('extraTimeMinutes');
  });
});

describe('the expedite system knob', () => {
  it('reads on for ITTF standard and is offered for an officiated serve-every-N format', () => {
    const k = readKnobs(fmt('ittf_bo5_11'));
    expect(k.expediteEnabled).toBe(true);
    expect(k.expediteMinutes).toBe(10);
    expect(knobsFor(k).map((s) => s.key)).toContain('expediteEnabled');
  });

  it('is not offered where nobody can count returns, or where the serve does not run on a count', () => {
    expect(knobsFor(readKnobs(fmt('corp_bo3_11_timecap'))).map((s) => s.key)).not.toContain('expediteEnabled');
    expect(knobsFor(readKnobs(fmt('bwf_official_3x21'))).map((s) => s.key)).not.toContain('expediteEnabled');
  });

  it('writes the time limit, turns off cleanly, and keeps other plugins', () => {
    const base = fmt('ittf_bo7_11');
    const k = readKnobs(base);
    const twelve = applyKnobs(base, { ...k, expediteMinutes: 12 });
    expect((twelve.plugins?.expedite as { afterMinutes: number }).afterMinutes).toBe(12);
    const off = applyKnobs({ ...base, plugins: { ...base.plugins, other: 1 } }, { ...k, expediteEnabled: false });
    expect(off.plugins?.expedite).toBeUndefined();
    expect(off.plugins?.other).toBe(1);
    const selfScored = applyKnobs(base, { ...k, officiatingMode: 'selfScored' });
    expect(selfScored.plugins?.expedite).toBeUndefined();
  });
});

// Timeouts: a setting for racquet formats, the sport's own rule until someone changes it.
describe('timeout knobs', () => {
  it('the Inter-IIM squash preset gives each player one 90-second timeout a match', () => {
    const f = fmt('iim_pars11_bo3_cap21');
    expect(timeoutRules(f)).toEqual({ perGame: null, perMatch: 1, seconds: 90 });
    expect(timeoutsLeft(f, [{ t: 'timeout', side: 'A' }])).toEqual({ A: 0, B: 1 });
    expect(describeKnobs(readKnobs(f))).toContain('1 timeout a match (90s)');
  });

  it('are offered for racquet sports only', () => {
    const shown = (f: Parameters<typeof readKnobs>[0]) => knobsFor(readKnobs(f)).some((s) => s.key === 'timeoutsEnabled');
    expect(shown(fmt('iim_pars11_bo3_cap21'))).toBe(true);
    expect(shown(fmt('ittf_bo5_11'))).toBe(true);
    expect(shown(teamPresetsFor('football')[0])).toBe(false);
  });

  it('saving untouched keeps the sport rule instead of writing it down', () => {
    const tt = fmt('ittf_bo5_11');
    expect(applyKnobs(tt, readKnobs(tt)).rulesSheet?.timeouts).toBeUndefined();
    // Pickleball's allowance still follows the game target after a save.
    const pb = fmt('usap_single_game_15');
    expect(applyKnobs(pb, readKnobs(pb)).rulesSheet?.timeouts).toBeUndefined();
  });

  it('an organiser can change, count per game, or switch them off', () => {
    const sq = fmt('iim_pars11_bo3_cap21');
    const perGame = applyKnobs(sq, { ...readKnobs(sq), timeoutsCount: 2, timeoutsPer: 'game', timeoutSeconds: 60 });
    expect(timeoutRules(perGame)).toEqual({ perGame: 2, perMatch: null, seconds: 60 });
    const off = applyKnobs(sq, { ...readKnobs(sq), timeoutsEnabled: false });
    expect(timeoutRules(off)).toBeNull();
    expect(readKnobs(off).timeoutsEnabled).toBe(false);
    // Turning table tennis's built-in timeout off is written down, so it sticks.
    const tt = fmt('ittf_bo5_11');
    expect(timeoutRules(applyKnobs(tt, { ...readKnobs(tt), timeoutsEnabled: false }))).toBeNull();
  });
});

// Volleyball: 2 timeouts of 30 seconds a set (FIVB and Inter-IIM), counted on the team console.
describe('volleyball timeouts', () => {
  const vb = fmt('vb_bo3_25_all');
  it('every volleyball format gets 2 a set by default, starting again each set', () => {
    expect(timeoutRules(vb)).toEqual({ perGame: 2, perMatch: null, seconds: 30 });
    const twoA: RallyLog = [{ t: 'timeout', side: 'A' }, { t: 'timeout', side: 'A' }];
    expect(timeoutsLeft(vb, twoA)).toEqual({ A: 0, B: 2 });
    const setWon: RallyLog = Array.from({ length: 25 }, () => ({ t: 'point', side: 'A' } as RallyEvent));
    expect(timeoutsLeft(vb, [...twoA, ...setWon])).toEqual({ A: 2, B: 2 });
  });

  it('the editor offers them, says "a set", and can change them', () => {
    const k = readKnobs(vb);
    expect(knobsFor(k).some((s) => s.key === 'timeoutsEnabled')).toBe(true);
    expect(describeKnobs(k)).toContain('2 timeouts a set (30s)');
    expect(applyKnobs(vb, k).rulesSheet?.timeouts).toBeUndefined();
    expect(timeoutRules(applyKnobs(vb, { ...k, timeoutsCount: 1, timeoutSeconds: 60 }))).toEqual({ perGame: 1, perMatch: null, seconds: 60 });
    expect(timeoutRules(applyKnobs(vb, { ...k, timeoutsEnabled: false }))).toBeNull();
  });
});

// Throwball 2 a set, kabaddi 2 a half (Inter-IIM); kabaddi's clock stops for one.
describe('throwball and kabaddi timeouts', () => {
  it('throwball: 2 a set, starting again each set', () => {
    const tb = fmt('tb_bo3_25_all');
    expect(timeoutRules(tb)).toEqual({ perGame: 2, perMatch: null, seconds: 30 });
    const setWon: RallyLog = Array.from({ length: 25 }, () => ({ t: 'point', side: 'B' } as RallyEvent));
    expect(timeoutsLeft(tb, [{ t: 'timeout', side: 'B' }])).toEqual({ A: 2, B: 1 });
    expect(timeoutsLeft(tb, [{ t: 'timeout', side: 'B' }, ...setWon])).toEqual({ A: 2, B: 2 });
    expect(describeKnobs(readKnobs(tb))).toContain('2 timeouts a set (30s)');
  });

  it('kabaddi: 2 a half, starting again at half-time, on every kabaddi format', () => {
    for (const key of ['pkl_2x20', 'kabaddi_ko_2x20_et']) {
      const kb = fmt(key);
      expect(timeoutRules(kb)).toEqual({ perGame: 2, perMatch: null, seconds: 30 });
      const used: RallyLog = [{ t: 'timeout', side: 'A' }, { t: 'timeout', side: 'A' }];
      expect(timeoutsLeft(kb, used)).toEqual({ A: 0, B: 2 });
      expect(timeoutsLeft(kb, [...used, { t: 'endPeriod' }])).toEqual({ A: 2, B: 2 });
    }
    const k = readKnobs(fmt('pkl_2x20'));
    expect(knobsFor(k).some((s) => s.key === 'timeoutsEnabled')).toBe(true);
    expect(describeKnobs(k)).toContain('2 timeouts a half (30s)');
  });

  it('other team sports have none and are not offered the setting', () => {
    for (const key of ['football9_2x20', 'hockey5_4x8', 'futsal_2x10']) {
      expect(timeoutRules(fmt(key))).toBeNull();
      expect(knobsFor(readKnobs(fmt(key))).some((s) => s.key === 'timeoutsEnabled')).toBe(false);
    }
  });
});

// Frisbee: the Inter-IIM presets carry one 1-minute timeout a match; other formats can turn it on.
describe('frisbee timeouts', () => {
  it('the IIMK presets give each team one a match', () => {
    for (const key of ['ultimate_2x20', 'ultimate_final_2x20']) {
      const f = fmt(key);
      expect(timeoutRules(f)).toEqual({ perGame: null, perMatch: 1, seconds: 60 });
      // Half-time does not give it back.
      expect(timeoutsLeft(f, [{ t: 'timeout', side: 'B' }, { t: 'endPeriod' }])).toEqual({ A: 1, B: 0 });
      expect(describeKnobs(readKnobs(f))).toContain('1 timeout a match (60s)');
    }
  });

  it('another frisbee format has none until the organiser turns them on', () => {
    const other = fmt('ultimate_to_15');
    expect(timeoutRules(other)).toBeNull();
    const k = readKnobs(other);
    expect(knobsFor(k).some((s) => s.key === 'timeoutsEnabled')).toBe(true);
    const on = applyKnobs(other, { ...k, timeoutsEnabled: true, timeoutsCount: 2, timeoutsPer: 'match', timeoutSeconds: 75 });
    expect(timeoutRules(on)).toEqual({ perGame: null, perMatch: 2, seconds: 75 });
  });
});

// Inter-IIM basketball: 1 a quarter, 2 in the 4th, 1 per overtime. FIBA's own preset is untouched.
describe('basketball timeouts', () => {
  const basket = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side, pts: 2 });
  const quarter: RallyLog = [basket('A'), basket('B'), { t: 'endPeriod' }];
  const quarters = (n: number): RallyLog => Array.from({ length: n }, () => quarter).flat();

  it('1 a quarter, 2 in the 4th, 1 in each overtime, on both Inter-IIM presets', () => {
    for (const key of ['iim_4x10', 'basketball_4x8']) {
      const f = fmt(key);
      expect(timeoutsAllowedNow(f, [])).toBe(1);
      expect(timeoutsLeft(f, [{ t: 'timeout', side: 'A' }])).toEqual({ A: 0, B: 1 });
      // A new quarter gives it back.
      expect(timeoutsLeft(f, [{ t: 'timeout', side: 'A' }, { t: 'endPeriod' }])).toEqual({ A: 1, B: 1 });
      // The 4th quarter: 2 each.
      expect(timeoutsAllowedNow(f, quarters(3))).toBe(2);
      expect(timeoutsLeft(f, [...quarters(3), { t: 'timeout', side: 'B' }])).toEqual({ A: 2, B: 1 });
      // Level after four: overtime, 1 each, and again in a second overtime.
      expect(timeoutsAllowedNow(f, quarters(4))).toBe(1);
      expect(timeoutsAllowedNow(f, quarters(5))).toBe(1);
      expect(describeKnobs(readKnobs(f))).toContain('1 timeout a quarter (60s), 2 in the last');
    }
  });

  it('FIBA 4 x 10 has no timeouts set; the editor can add per-quarter ones', () => {
    const fiba = fmt('fiba_4x10');
    expect(timeoutRules(fiba)).toBeNull();
    const k = readKnobs(fiba);
    const keys = knobsFor({ ...k, timeoutsEnabled: true, timeoutsPer: 'game' }).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['timeoutsLastPeriod', 'timeoutsExtraTime']));
    const on = applyKnobs(fiba, { ...k, timeoutsEnabled: true, timeoutsPer: 'game', timeoutsCount: 1, timeoutSeconds: 60, timeoutsLastPeriod: 2, timeoutsExtraTime: 1 });
    expect(timeoutRules(on)).toEqual({ perGame: 1, perMatch: null, seconds: 60, lastPeriod: 2 });
    // A different overtime allowance is kept, and counted once the quarters are played.
    const ot2 = applyKnobs(fiba, { ...k, timeoutsEnabled: true, timeoutsPer: 'game', timeoutsCount: 2, timeoutSeconds: 60, timeoutsLastPeriod: 3, timeoutsExtraTime: 1 });
    expect(timeoutRules(ot2)).toEqual({ perGame: 2, perMatch: null, seconds: 60, lastPeriod: 3, extraTime: 1 });
    expect(timeoutsAllowedNow(ot2, quarters(4))).toBe(1);
    expect(describeKnobs(readKnobs(ot2))).toContain('2 timeouts a quarter (60s), 3 in the last, 1 per extra period');
    // Saving the Inter-IIM preset untouched keeps its rule exactly.
    const iim = fmt('iim_4x10');
    expect(timeoutRules(applyKnobs(iim, readKnobs(iim)))).toEqual(timeoutRules(iim));
  });
});
