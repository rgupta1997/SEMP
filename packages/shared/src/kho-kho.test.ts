import { describe, expect, it } from 'vitest';
import { applyKnobs, readKnobs, knobsFor } from './format-knobs.js';
import {
  addAdt, adtOf, chaserOfTurn, emptyAdt, formatChaseTime, khoMatchAdt, khoStatus, khoTurnLines, minChaseEnd, minChaseState, parseChaseTime,
} from './kho-kho.js';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { statSpecFor } from './stat-registry.js';
import { tieProgress } from './tie-break.js';
import { deriveTeamStats } from './team-stats.js';
import { toCategoryRow } from './category-lines.js';
import type { Side } from './scoring-rules.js';

const f = presetByKey('kho_4turns')!;
const pts = (side: Side, n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side, pts: 1 }) as RallyEvent);
const end = (ms?: number): RallyEvent => ({ t: 'endPeriod', ...(ms ? { clockMs: ms } : {}) });
const status = (log: RallyEvent[]) => khoStatus(f, log, foldRally(f, log).state);

describe('kho kho presets', () => {
  it('lead with two innings of 9-minute turns, allow no draw and settle by minimum chase', () => {
    expect(f.name).toBe('Two innings - 9-minute turns');
    expect(f.levels[1]).toMatchObject({ target: 4, decide: 'aggregate' });
    expect(f.clock?.minutes).toBe(36);
    expect(f.endStates.drawsAllowed).toBe(false);
    expect(f.tieBreak?.minimumChase).toBe(true);
    expect(presetByKey('kho_2x7')!.clock?.minutes).toBe(28);
    // The old "Two innings of 9 minutes" was two turns: it now says so.
    expect(presetByKey('kho_2x9')!.name).toBe('One innings - 9-minute turns');
  });

  it('offer kho kho actions, not kabaddi ones', () => {
    const keys = statSpecFor('kho-kho')!.events.map((e) => e.key);
    expect(keys).toContain('kho_touch');
    expect(keys).toContain('kho_late_entry');
    expect(keys).not.toContain('raid');
    expect(keys).not.toContain('tackle');
  });
});

describe('who chases', () => {
  it('alternates from the toss, the same order in both innings', () => {
    expect([0, 1, 2, 3].map((i) => chaserOfTurn(i, 'B', null))).toEqual(['B', 'A', 'B', 'A']);
  });

  it('is unknown until the toss is recorded, then follows the turns', () => {
    expect(status([]).chaser).toBeNull();
    expect(status([{ t: 'chaseFirst', side: 'B' }]).chaser).toBe('B');
    expect(status([{ t: 'chaseFirst', side: 'B' }, ...pts('B', 3), end()]).chaser).toBe('A');
  });

  it('a follow-on sends the trailing side in to chase again', () => {
    expect([2, 3].map((i) => chaserOfTurn(i, 'A', 'A'))).toEqual(['B', 'A']);
  });
});

describe('follow-on', () => {
  const innings1 = (a: number, b: number): RallyEvent[] => [
    { t: 'chaseFirst', side: 'A' }, ...pts('A', a), end(), ...pts('B', b), end(),
  ];

  it('is offered at the end of the first innings when the lead is 9 or more', () => {
    expect(status(innings1(12, 3)).followOnOffer).toEqual({ leader: 'A', lead: 9, compulsory: false });
    expect(status(innings1(11, 3)).followOnOffer).toBeNull();
  });

  // Sheet KK03: optional at the follow-on lead, compulsory past a limit when the format says so.
  it("is the leader's choice unless the format makes a bigger lead compulsory", async () => {
    const { applyKnobs, knobsFor, readKnobs } = await import('./format-knobs.js');
    const k = readKnobs(f);
    expect(k).toMatchObject({ followOnLead: 9, followOnCompulsoryEnabled: false, followOnCompulsoryAbove: 9 });
    expect(knobsFor({ ...k, followOnCompulsoryEnabled: true }).map((s) => s.key))
      .toEqual(expect.arrayContaining(['followOnLead', 'followOnCompulsoryEnabled', 'followOnCompulsoryAbove']));
    const iim = applyKnobs(f, { ...k, followOnCompulsoryEnabled: true, followOnCompulsoryAbove: 9 });
    const st = (log: RallyEvent[]) => khoStatus(iim, log, foldRally(iim, log).state);
    expect(st(innings1(12, 3)).followOnOffer).toEqual({ leader: 'A', lead: 9, compulsory: false });
    expect(st(innings1(13, 3)).followOnOffer).toEqual({ leader: 'A', lead: 10, compulsory: true });
    // Switched back off: never compulsory.
    const off = applyKnobs(iim, { ...readKnobs(iim), followOnCompulsoryEnabled: false });
    expect(khoStatus(off, innings1(15, 3), foldRally(off, innings1(15, 3)).state).followOnOffer?.compulsory).toBe(false);
    // The follow-on lead itself is a setting too.
    const at6 = applyKnobs(f, { ...k, followOnLead: 6 });
    expect(khoStatus(at6, innings1(9, 3), foldRally(at6, innings1(9, 3)).state).followOnOffer?.lead).toBe(6);
  });

  it('is not offered once the third turn has started', () => {
    expect(status([...innings1(12, 3), ...pts('A', 1)]).followOnOffer).toBeNull();
  });

  it('ends the match "by an innings" when the follow-on side is still behind', () => {
    const log: RallyEvent[] = [...innings1(12, 3), { t: 'followOn', side: 'A' }, ...pts('B', 4), end()];
    const s = status(log);
    expect(s.followOnBy).toBe('A');
    expect(s.wonByInnings).toBe('A');
  });

  it('plays the fourth turn when the follow-on side has caught up', () => {
    const log: RallyEvent[] = [...innings1(12, 3), { t: 'followOn', side: 'A' }, ...pts('B', 10), end()];
    const s = status(log);
    expect(s.wonByInnings).toBeNull();
    expect(s.chaser).toBe('A');
  });
});

describe('minimum chase', () => {
  const level: RallyEvent[] = [
    { t: 'chaseFirst', side: 'A' }, ...pts('A', 5), end(), ...pts('B', 5), end(),
    ...pts('A', 4), end(), ...pts('B', 4), end(),
  ];

  it('starts when the match is level after the last turn', () => {
    const st = foldRally(f, level).state;
    expect(st.ended).toBe(false);
    expect(tieProgress(f, st, [9, 9]).phase).toBe('minimumChase');
  });

  it('the faster first out wins, and the limit is the time to beat plus 30 s', () => {
    const one = minChaseState([...level, { t: 'minChase', side: 'A', ms: 62_000 }], 'A');
    expect(one.next).toBe('B');
    expect(one.limitMs).toBe(92_000);
    const two = minChaseState([...level, { t: 'minChase', side: 'A', ms: 62_000 }, { t: 'minChase', side: 'B', ms: 48_500 }], 'A');
    expect(two.winner).toBe('B');
  });

  it('goes again when both take as long, or neither gets an out', () => {
    const log: RallyEvent[] = [...level, { t: 'minChase', side: 'A', ms: null }, { t: 'minChase', side: 'B', ms: null }];
    const st = minChaseState(log, 'A');
    expect(st.winner).toBeNull();
    expect(st.next).toBe('A');
    expect(minChaseState([...log, { t: 'minChase', side: 'A', ms: 70_000 }, { t: 'minChase', side: 'B', ms: null }], 'A').winner).toBe('A');
  });

  it('closes the match with the score still level', () => {
    const r = foldRally(f, [...level, { t: 'minChase', side: 'A', ms: 1 }, { t: 'minChase', side: 'B', ms: 2 }, minChaseEnd('A')]);
    expect(r.state).toMatchObject({ ended: true, winner: 'A', reason: 'minimum_chase' });
  });

  it('reads and writes chase times', () => {
    expect(parseChaseTime('1:23.4')).toBe(83_400);
    expect(parseChaseTime('83.4')).toBe(83_400);
    expect(parseChaseTime('abc')).toBeNull();
    expect(formatChaseTime(83_400)).toBe('1:23.4');
    expect(formatChaseTime(null)).toBe('no out');
  });
});

describe('the turn record', () => {
  it('lists each turn with who chased, what they scored and how long it ran', () => {
    const log: RallyEvent[] = [{ t: 'chaseFirst', side: 'B' }, ...pts('B', 6), end(540_000), ...pts('A', 2), end(301_000)];
    expect(khoTurnLines(f, log, foldRally(f, log).state)).toEqual([
      { turn: 1, chaser: 'B', points: 6, ms: 540_000 },
      { turn: 2, chaser: 'A', points: 2, ms: 301_000 },
    ]);
  });
});

describe('player stats', () => {
  it('a defender out scores for the chasers, counts against the defender and credits the chaser', () => {
    const log: RallyEvent[] = [
      { t: 'chaseFirst', side: 'A' },
      // Tapped on the DEFENDING side (B): the point goes to A, the chaser is A's.
      { t: 'point', side: 'A', pts: 1, kind: 'kho_pole_dive', playerId: 'def1', secondId: 'ch1' },
      { t: 'point', side: 'A', pts: 1, kind: 'kho_late_entry', playerId: 'def2' },
      { t: 'point', side: 'A', pts: 0, kind: 'kho_foul', playerId: 'ch1' },
    ];
    const s = deriveTeamStats('kho-kho', log);
    const bag = (id: string) => s.players.find((x) => x.userId === id)?.stats ?? {};
    expect(bag('ch1')).toMatchObject({ touch_points: 1, pole_dive_outs: 1, kho_fouls: 1 });
    expect(bag('def1')).toMatchObject({ times_out: 1 });
    expect(bag('def2')).toMatchObject({ times_out: 1, late_entries: 1 });
    expect(foldRally(f, log).state.score[0]).toEqual([2, 0]);
  });

  it('every kho kho stat has a column to land in', () => {
    const row = toCategoryRow('kho-kho', { touch_points: 2, pole_dive_outs: 1, dive_outs: 1, sudden_attack_outs: 1,
      times_out: 3, out_of_field_outs: 1, late_entries: 1, kho_fouls: 2, yellows: 1, reds: 0 });
    expect(row?.table).toBe('raid_match_lines');
    expect(row?.unmapped).toEqual([]);
  });
});

describe('format editor', () => {
  it('offers the minimum chase instead of a shoot-out, and keeps it on save', () => {
    const k = readKnobs(f);
    const keys = knobsFor(k).map((x) => x.key);
    expect(keys).toContain('minimumChaseEnabled');
    expect(keys).not.toContain('shootoutEnabled');
    expect(applyKnobs(f, k).tieBreak?.minimumChase).toBe(true);
    expect(applyKnobs(f, { ...k, minimumChaseEnabled: false }).tieBreak).toBeNull();
  });
});

// Sheet KK01: an extra inning before the minimum chase, set in the editor.
describe('extra inning before minimum chase', () => {
  it('the editor offers it for kho kho in kho kho words, off by default', async () => {
    const { applyKnobs, describeKnobs, knobsFor, readKnobs } = await import('./format-knobs.js');
    const f = presetByKey('kho_2x7')!;
    const k = readKnobs(f);
    expect(k.extraTimeEnabled).toBe(false);
    const labels = knobsFor({ ...k, extraTimeEnabled: true }).filter((s) => s.group === 'tieBreak').map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Extra inning before minimum chase', 'Extra turns', 'Minutes per extra turn', 'Minimum chase']));
    expect(labels).not.toContain('Play extra time');
    const withInning = applyKnobs(f, { ...k, extraTimeEnabled: true, extraTimePeriods: 2, extraTimeMinutes: 7 });
    expect(withInning.tieBreak).toMatchObject({ extraTime: { periods: 2, minutes: 7, label: 'Extra turn' }, minimumChase: true });
    expect(describeKnobs(readKnobs(withInning))).toContain('extra inning (2 x 7 min turns) then minimum chase');
  });

  it('level after four turns plays the extra turns, then the minimum chase', () => {
    const base = presetByKey('kho_2x7')!;
    const f = { ...base, tieBreak: { extraTime: { periods: 2, minutes: 7, label: 'Extra turn' }, minimumChase: true } };
    const t = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'touch' } as RallyEvent);
    const end: RallyEvent = { t: 'endPeriod' };
    const level: RallyEvent[] = [{ t: 'chaseFirst', side: 'A' } as RallyEvent, t('A'), end, t('B'), end, end, end];
    expect(tieProgress(f, foldRally(f, level).state, [1, 1]).phase).toBe('extraTime');
    expect(tieProgress(f, foldRally(f, [...level, end, end]).state, [1, 1]).phase).toBe('minimumChase');
    expect(foldRally(f, [...level, t('A'), end, end]).state).toMatchObject({ ended: true, winner: 'A' });
  });
});

// Sheet KK02: average difference time from the turn records.
describe('average difference time', () => {
  const f = presetByKey('kho_2x7')!; // 4 turns of 7 minutes
  const out = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'touch' } as RallyEvent);
  const endAt = (min: number): RallyEvent => ({ t: 'endPeriod', clockMs: min * 60_000 } as RallyEvent);
  // A chases turns 1 and 3, B turns 2 and 4.
  const log: RallyEvent[] = [
    { t: 'chaseFirst', side: 'A' } as RallyEvent,
    out('A'), out('A'), out('A'), endAt(7),    // A gets 3 out in 420 s
    out('B'), out('B'), endAt(7),             // B gets 2 out in 420 s
    out('A'), out('A'), out('A'), endAt(7),   // A 3 more
    out('B'), out('B'), endAt(7),             // B 2 more
  ];

  it('works out each side from the regulation turns', () => {
    const m = khoMatchAdt(f, log)!;
    expect(m.A).toMatchObject({ attackMs: 840_000, attackOuts: 6, defendMs: 840_000, defendOuts: 4, estimated: false });
    // A: 840/4 - 840/6 = 210 - 140 = 70. B: 840/6 - 840/4 = -70.
    expect(adtOf(m.A)).toBe(70);
    expect(adtOf(m.B)).toBe(-70);
  });

  it('adds up over matches, and a turn with no clock counts at full length', () => {
    const noClock = log.map((e) => (e.t === 'endPeriod' ? ({ t: 'endPeriod' } as RallyEvent) : e));
    const m = khoMatchAdt(f, noClock)!;
    expect(m.A).toMatchObject({ attackMs: 840_000, estimated: true });
    const both = addAdt(addAdt(emptyAdt(), khoMatchAdt(f, log)!.A), m.A);
    expect(both).toMatchObject({ attackOuts: 12, defendOuts: 8, estimated: true });
  });

  it('leaves out extra turns and returns nothing before the toss', () => {
    const extra = { ...f, tieBreak: { extraTime: { periods: 2, minutes: 7 }, minimumChase: true } };
    const level: RallyEvent[] = [{ t: 'chaseFirst', side: 'A' } as RallyEvent, out('A'), endAt(7), out('B'), endAt(7), endAt(7), endAt(7), out('A'), endAt(7), endAt(7)];
    expect(khoMatchAdt(extra, level)!.A.attackMs).toBe(4 * 7 * 60_000 / 2);
    expect(khoMatchAdt(f, [out('A')])).toBeNull();
    expect(adtOf({ defendMs: 420_000, defendOuts: 0, attackMs: 0, attackOuts: 0, estimated: false })).toBe(420);
  });
});
