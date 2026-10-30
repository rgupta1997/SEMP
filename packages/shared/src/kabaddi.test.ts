import { describe, expect, it } from 'vitest';
import { kabaddiStatus } from './kabaddi.js';
import { goldenTossEnd, khoSettlementOf } from './kho-kho.js';
import { tieProgress } from './tie-break.js';
import { aggregateScore, foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { statSpecFor } from './stat-registry.js';
import { deriveTeamStats } from './team-stats.js';
import { toCategoryRow } from './category-lines.js';

const f = presetByKey('pkl_2x20')!;
const status = (log: RallyEvent[]) => kabaddiStatus(log, foldRally(f, log).state);
// What the console records: a raid of n is a point event worth n, carrying n as its value.
const raid = (side: 'A' | 'B', n: number, extra: Partial<Extract<RallyEvent, { t: 'point' }>> = {}): RallyEvent =>
  ({ t: 'point', side, pts: n, value: n, kind: 'raid', ...extra });
const empty = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side, pts: 0, kind: 'empty_raid' });

describe('kabaddi actions', () => {
  it('a raid declares its points as the score, and all-out is a team action', () => {
    const events = statSpecFor('kabaddi')!.events;
    expect(events.find((e) => e.key === 'raid')).toMatchObject({ scoresValue: true, value: { min: 1, max: 7 } });
    expect(events.find((e) => e.key === 'allout')?.perPlayer).toBe(false);
    expect(events.find((e) => e.key === 'technical')?.perPlayer).toBe(false);
  });

  it('a 3-point raid puts 3 on the board', () => {
    expect(foldRally(f, [raid('A', 3)]).state.score[0]).toEqual([3, 0]);
  });

  it('offers the women and juniors format', () => {
    expect(presetByKey('kabaddi_2x15')!.clock?.minutes).toBe(30);
  });
});

describe('whose raid', () => {
  it('starts with the toss and alternates on every raid that ends', () => {
    expect(status([]).raider).toBeNull();
    expect(status([{ t: 'raidFirst', side: 'B' }]).raider).toBe('B');
    expect(status([{ t: 'raidFirst', side: 'B' }, raid('B', 1)]).raider).toBe('A');
    // A tackle ends the raid too, though it is tapped (and scored) on the defending side.
    expect(status([{ t: 'raidFirst', side: 'B' }, raid('B', 1), { t: 'point', side: 'B', pts: 1, kind: 'tackle' }]).raider).toBe('B');
  });

  it('a bonus added to a raid does not end it', () => {
    expect(status([{ t: 'raidFirst', side: 'A' }, { t: 'point', side: 'A', pts: 1, kind: 'bonus' }]).raider).toBe('A');
  });

  it('the other team raids first in the second half', () => {
    expect(status([{ t: 'raidFirst', side: 'A' }, raid('A', 1), { t: 'endPeriod' }]).raider).toBe('B');
  });

  it('an official can correct whose raid it is', () => {
    expect(status([{ t: 'raidFirst', side: 'A' }, { t: 'raidTurn', side: 'B' }]).raider).toBe('B');
  });
});

describe('do-or-die', () => {
  const twoEmpty: RallyEvent[] = [
    { t: 'raidFirst', side: 'A' }, empty('A'), raid('B', 1), empty('A'), raid('B', 1),
  ];

  it('is the third raid after two empty raids in a row by the same team', () => {
    const s = status(twoEmpty);
    expect(s.raider).toBe('A');
    expect(s.doOrDie).toBe(true);
  });

  it('resets once the team scores in a raid', () => {
    expect(status([...twoEmpty, raid('A', 1), raid('B', 1)]).doOrDie).toBe(false);
  });

  it('a failed do-or-die puts the raider out and scores for the defence', () => {
    const log = [...twoEmpty, { t: 'point', side: 'B', pts: 1, kind: 'dod_failed', playerId: 'r1' } as RallyEvent];
    expect(foldRally(f, log).state.score[0]).toEqual([0, 3]);
    expect(deriveTeamStats('kabaddi', log).players.find((x) => x.userId === 'r1')?.stats).toMatchObject({ raids: 1, times_out: 1 });
  });
});

describe('raider and defender stats', () => {
  it('raid points, super raids and do-or-die wins', () => {
    const log: RallyEvent[] = [
      raid('A', 3, { playerId: 'r1' }),
      raid('A', 1, { playerId: 'r1', flags: ['dod'] }),
      { t: 'point', side: 'A', pts: 0, kind: 'empty_raid', playerId: 'r1' },
    ];
    expect(deriveTeamStats('kabaddi', log).players.find((x) => x.userId === 'r1')?.stats).toMatchObject({
      raid_points: 4, raids: 3, successful_raids: 2, super_raids: 1, do_or_die_won: 1,
    });
  });

  it('a tackle credits the defender, and files the tackled raider on the raiding team', () => {
    const log: RallyEvent[] = [{ t: 'point', side: 'B', pts: 2, kind: 'super_tackle', playerId: 'd1', secondId: 'r1' }];
    const s = deriveTeamStats('kabaddi', log);
    expect(s.players.find((x) => x.userId === 'd1')).toMatchObject({ side: 'B', stats: { tackle_points: 2, super_tackles: 1 } });
    expect(s.players.find((x) => x.userId === 'r1')).toMatchObject({ side: 'A', stats: { raids: 1, times_out: 1 } });
  });

  it('every kabaddi stat has a column to land in', () => {
    const row = toCategoryRow('kabaddi', {
      raid_points: 5, raids: 4, successful_raids: 2, super_raids: 1, do_or_die_won: 1, tackle_points: 2,
      tackles: 1, super_tackles: 1, bonus_points: 1, times_out: 2, all_outs: 1, yellows: 1, reds: 0,
    });
    expect(row?.table).toBe('raid_match_lines');
    expect(row?.unmapped).toEqual([]);
  });
});

// Sheet KB02: a raid whose only point came from a defender stepping out.
describe('defender out, raid ends', () => {
  // Fired from the defending side (B) for a raid by A: the point goes to A.
  const outRaid = (raiders: 'A' | 'B'): RallyEvent => ({ t: 'point', side: raiders, pts: 1, kind: 'defender_out_raid', playerId: 'd1' });

  it('gives the raiders the point, ends the raid and is not an empty raid', () => {
    const log: RallyEvent[] = [{ t: 'raidFirst', side: 'A' }, empty('A'), raid('B', 1), empty('A'), raid('B', 1)];
    expect(status(log)).toMatchObject({ raider: 'A', doOrDie: true });
    const after = [...log, outRaid('A')];
    expect(foldRally(f, after).state.score[0]).toEqual([1, 2]);
    // The do-or-die raid scored, so the count resets and B raids next.
    expect(status(after)).toMatchObject({ raider: 'B', emptyStreak: 0 });
    expect(status([...after, raid('B', 1)])).toMatchObject({ raider: 'A', doOrDie: false, emptyStreak: 0 });
  });

  it('a plain defender out still leaves the raid open', () => {
    const log: RallyEvent[] = [{ t: 'raidFirst', side: 'A' }, { t: 'point', side: 'A', pts: 1, kind: 'defender_out' }];
    expect(status(log).raider).toBe('A');
  });

  it('counts as a time out for the defender', () => {
    const spec = statSpecFor('kabaddi')!;
    expect(spec.events.find((e) => e.key === 'defender_out_raid')).toMatchObject({ forOpponent: true, role: 'defend', points: 1 });
    expect(spec.metrics.find((m) => m.key === 'times_out')?.fromEvents).toContain('defender_out_raid');
  });
});

// Sheet KB03: Inter-IIM semi-finals and finals.
describe('the kabaddi knockout preset', () => {
  const ko = presetByKey('kabaddi_ko_2x20_et')!;
  const half: RallyEvent = { t: 'endPeriod' };

  it('plays two halves of 20 with no draw and 3 + 3 of extra time', () => {
    expect(ko.clock?.minutes).toBe(40);
    expect(ko.endStates.drawsAllowed).toBe(false);
    expect(ko.tieBreak?.extraTime).toEqual({ periods: 2, minutes: 3 });
  });

  it('level after both halves goes to extra time, and the leader after it wins', () => {
    const level: RallyEvent[] = [raid('A', 2), half, raid('B', 2), half];
    expect(foldRally(ko, level).state.ended).toBe(false);
    const st = foldRally(ko, [...level, raid('A', 1), half, half]).state;
    expect(st).toMatchObject({ ended: true, winner: 'A' });
  });

  it('the editor offers extra time with any length, and no kicks, universal point or win score', async () => {
    const { knobsFor, readKnobs, applyKnobs } = await import('./format-knobs.js');
    const keys = knobsFor(readKnobs(ko)).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['extraTimeEnabled', 'extraTimePeriods', 'extraTimeMinutes']));
    expect(keys).not.toContain('shootoutEnabled');
    expect(keys).not.toContain('universalPointEnabled');
    expect(keys).not.toContain('firstTo');
    const five = applyKnobs(ko, { ...readKnobs(ko), extraTimeMinutes: 5 });
    expect(five.tieBreak?.extraTime).toMatchObject({ periods: 2, minutes: 5 });
    // A league format turns into a knockout one in the editor too.
    const league = presetByKey('pkl_2x20')!;
    const turned = applyKnobs(league, { ...readKnobs(league), drawsAllowed: false, extraTimeEnabled: true, extraTimePeriods: 2, extraTimeMinutes: 4 });
    expect(turned.tieBreak?.extraTime).toMatchObject({ periods: 2, minutes: 4 });
  });
});

// Sheet KB04: still level after extra time - a golden raid each, then a toss.
describe('golden raid', () => {
  const ko = presetByKey('kabaddi_ko_2x20_et')!;
  const half: RallyEvent = { t: 'endPeriod' };
  // Level after both halves and both extra-time halves.
  const levelAfterExtra: RallyEvent[] = [{ t: 'raidFirst', side: 'A' }, raid('A', 2), half, raid('B', 2), half, half, half];
  const gs = (log: RallyEvent[]) => kabaddiStatus(log, foldRally(ko, log).state);

  it('the knockout preset turns it on, after extra time', () => {
    expect(ko.tieBreak?.goldenRaid).toBe(true);
    const st = foldRally(ko, levelAfterExtra).state;
    expect(st.ended).toBe(false);
    expect(tieProgress(ko, st, [2, 2]).phase).toBe('goldenRaid');
    expect(gs(levelAfterExtra)).toMatchObject({ goldenStarted: false, goldenTossDue: false });
  });

  it('the toss winner raids; a scoring raid wins the match on golden raid', () => {
    const log = [...levelAfterExtra, { t: 'goldenRaid', side: 'B' } as RallyEvent];
    expect(gs(log)).toMatchObject({ goldenStarted: true, raider: 'B', goldenRaids: 0 });
    const won = [...log, raid('B', 1)];
    expect(foldRally(ko, won).state).toMatchObject({ ended: true, winner: 'B', reason: 'golden_raid' });
    expect(khoSettlementOf({ rally: won })).toEqual({ reason: 'golden_raid', winner: 'B' });
  });

  it('a tackle on the golden raid wins it for the defenders', () => {
    const log = [...levelAfterExtra, { t: 'goldenRaid', side: 'B' } as RallyEvent, { t: 'point', side: 'A', pts: 1, kind: 'tackle' } as RallyEvent];
    expect(foldRally(ko, log).state).toMatchObject({ ended: true, winner: 'A' });
    expect(khoSettlementOf({ rally: log })?.reason).toBe('golden_raid');
  });

  it('an empty golden raid passes it to the other team; both empty, a toss decides', () => {
    const one = [...levelAfterExtra, { t: 'goldenRaid', side: 'A' } as RallyEvent, empty('A')];
    expect(gs(one)).toMatchObject({ raider: 'B', goldenRaids: 1, goldenTossDue: false, doOrDie: false });
    const both = [...one, empty('B')];
    expect(gs(both)).toMatchObject({ goldenRaids: 2, goldenTossDue: true });
    const tossed = [...both, goldenTossEnd('B')];
    expect(foldRally(ko, tossed).state).toMatchObject({ ended: true, winner: 'B', reason: 'toss' });
    expect(khoSettlementOf({ rally: tossed })).toEqual({ reason: 'toss', winner: 'B' });
  });

  it('a plain win is not read as a golden raid', () => {
    expect(khoSettlementOf({ rally: [raid('A', 3), half, half] })).toBeNull();
  });

  it('the editor shows it for kabaddi knockouts only', async () => {
    const { knobsFor, readKnobs, applyKnobs, describeKnobs } = await import('./format-knobs.js');
    const k = readKnobs(ko);
    expect(k.goldenRaidEnabled).toBe(true);
    expect(knobsFor(k).map((s) => s.key)).toContain('goldenRaidEnabled');
    expect(knobsFor(readKnobs(f)).map((s) => s.key)).not.toContain('goldenRaidEnabled');
    expect(knobsFor(readKnobs(presetByKey('ultimate_2x20')!)).map((s) => s.key)).not.toContain('goldenRaidEnabled');
    expect(applyKnobs(ko, { ...k, goldenRaidEnabled: false }).tieBreak?.goldenRaid).toBeUndefined();
    expect(describeKnobs(k)).toContain('ET 2x3 min then golden raid');
  });
});

// A golden raid is decided when the raid ENDS, on the points it scored for either side.
describe('golden raid decided at the end of the raid', () => {
  const ko = presetByKey('kabaddi_ko_2x20_et')!;
  const half: RallyEvent = { t: 'endPeriod' };
  const levelAfterExtra: RallyEvent[] = [{ t: 'raidFirst', side: 'A' }, raid('A', 2), half, raid('B', 2), half, half, half];
  const golden = (...evs: RallyEvent[]) => [...levelAfterExtra, { t: 'goldenRaid', side: 'A' } as RallyEvent, ...evs];
  const bonus = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'bonus' });
  const tackle = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'tackle' });
  const play = (log: RallyEvent[]) => foldRally(ko, log).state;

  it('a bonus alone does not end it: the raid is still on', () => {
    const st = play(golden(bonus('A')));
    expect(st.ended).toBe(false);
    expect(kabaddiStatus(golden(bonus('A')), st)).toMatchObject({ raider: 'A', goldenRaids: 0 });
  });

  it('bonus then caught is 1-1: still level, and the other team gets its golden raid', () => {
    const log = golden(bonus('A'), tackle('B'));
    const st = play(log);
    expect(st.ended).toBe(false);
    expect(kabaddiStatus(log, st)).toMatchObject({ raider: 'B', goldenRaids: 1, goldenTossDue: false });
    // B's golden raid scores: B win.
    expect(play([...log, raid('B', 1)])).toMatchObject({ ended: true, winner: 'B', reason: 'golden_raid' });
  });

  it('bonus then a 2-point touch wins it 3-0, with all 3 on the board', () => {
    const st = play(golden(bonus('A'), raid('A', 2)));
    expect(st).toMatchObject({ ended: true, winner: 'A', reason: 'golden_raid' });
    // Level 2-2 after extra time, then 3 from the golden raid.
    expect(aggregateScore(st)).toEqual([5, 2]);
  });

  it('bonus, then back safely recorded as an empty raid, still wins on the bonus', () => {
    expect(play(golden(bonus('A'), empty('A')))).toMatchObject({ ended: true, winner: 'A', reason: 'golden_raid' });
  });

  it('a single bonus raid or a single raid point still wins at once', () => {
    expect(play(golden({ t: 'point', side: 'A', pts: 1, kind: 'bonus_raid' }))).toMatchObject({ ended: true, winner: 'A' });
    expect(play(golden(raid('A', 1)))).toMatchObject({ ended: true, winner: 'A' });
  });
});
