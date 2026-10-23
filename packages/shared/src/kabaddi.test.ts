import { describe, expect, it } from 'vitest';
import { kabaddiStatus } from './kabaddi.js';
import { foldRally, type RallyEvent } from './rally-kernel.js';
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
