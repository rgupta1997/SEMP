import { describe, expect, it } from 'vitest';
import { attributesEvents, deriveTeamStats } from './team-stats.js';
import { TEAM_STAT_SPECS, statSpecFor } from './stat-registry.js';
import { lineFamilyFor, toCategoryRow } from './category-lines.js';
import type { RallyLog } from './rally-kernel.js';

const pt = (o: Record<string, unknown>): any => ({ t: 'point', side: 'A', ...o });

describe('crediting an attributed event', () => {
  it('gives a goal to the scorer and the assist to the other person', () => {
    // ONE TAP, TWO PEOPLE. An assist recorded as a separate tap is an assist that
    // never gets recorded.
    const log: RallyLog = [pt({ kind: 'goal', pts: 1, playerId: 'p1', secondId: 'p2' })];
    const r = deriveTeamStats('football', log);
    expect(r.players.find((x) => x.userId === 'p1')!.stats).toMatchObject({ goals: 1 });
    expect(r.players.find((x) => x.userId === 'p2')!.stats).toMatchObject({ assists: 1 });
    // And the assister is not credited with the goal.
    expect(r.players.find((x) => x.userId === 'p2')!.stats.goals).toBeUndefined();
  });

  it('files the second person on the SAME side as the primary', () => {
    // An assist comes from a team-mate, never from the opposition.
    const r = deriveTeamStats('football', [pt({ side: 'B', kind: 'goal', playerId: 'p1', secondId: 'p2' })]);
    expect(r.players.every((x) => x.side === 'B')).toBe(true);
  });

  it('counts a penalty as both a penalty and a goal, once', () => {
    const r = deriveTeamStats('football', [pt({ kind: 'pen_scored', pts: 1, playerId: 'p1' })]);
    expect(r.players[0].stats).toMatchObject({ pens_scored: 1, goals: 1 });
  });

  it('keeps an own goal off the scorer\'s goals', () => {
    const r = deriveTeamStats('football', [pt({ kind: 'own_goal', playerId: 'p1' })]);
    expect(r.players[0].stats).toMatchObject({ own_goals: 1 });
    expect(r.players[0].stats.goals).toBeUndefined();
  });

  it('sums the SIDE score from the scoreboard magnitude', () => {
    // A 3-pointer is three points, and the side total is the one number a scoreline
    // can be checked against.
    const r = deriveTeamStats('basketball', [
      pt({ kind: 'fg3', pts: 3, playerId: 'p1' }),
      pt({ kind: 'fg2', pts: 2, playerId: 'p1' }),
      pt({ side: 'B', kind: 'fg1', pts: 1, playerId: 'q1' }),
    ]);
    expect(r.sides.A.points_scored).toBe(5);
    expect(r.sides.B.points_scored).toBe(1);
  });

  it('takes a magnitude for a metric declared as a value', () => {
    // A kabaddi raid is worth however many it took out.
    const spec = statSpecFor('kabaddi')!;
    const valued = spec.events.find((e) => Object.values(e.metrics).includes('value'));
    expect(valued, 'kabaddi should have a value-carrying event').toBeTruthy();
    const key = Object.entries(valued!.metrics).find(([, v]) => v === 'value')![0];
    const r = deriveTeamStats('kabaddi', [pt({ kind: valued!.key, pts: 3, value: 3, playerId: 'p1' })]);
    expect(r.players[0].stats[key]).toBe(3);
  });
});

describe('what it refuses to invent', () => {
  it('credits nobody when the tap named nobody', () => {
    // An unattributed tap moves the scoreboard and belongs to no person. Guessing
    // would put somebody's name on a goal they did not score.
    const r = deriveTeamStats('football', [pt({ kind: 'goal', pts: 1 })]);
    expect(r.players).toEqual([]);
    expect(r.sides.A.points_scored).toBe(1);
  });

  it('still credits the scoreboard when the action is unrecognised', () => {
    // A console tap the registry does not name would otherwise lose a basketball
    // player's points entirely.
    const r = deriveTeamStats('basketball', [pt({ kind: 'no_such_action', pts: 2, playerId: 'p1' })]);
    expect(r.players[0].stats).toMatchObject({ points_scored: 2 });
  });

  it('ignores an assist on an event that has no assist', () => {
    const r = deriveTeamStats('football', [pt({ kind: 'save', playerId: 'p1', secondId: 'p2' })]);
    expect(r.players.map((x) => x.userId)).toEqual(['p1']);
  });

  it('returns nothing for a sport with no spec, rather than throwing', () => {
    expect(deriveTeamStats('quidditch', [pt({ playerId: 'p1' })]).players).toEqual([]);
    expect(deriveTeamStats(null, []).players).toEqual([]);
  });

  it('ignores every event that is not a point', () => {
    const r = deriveTeamStats('football', [
      { t: 'endPeriod' } as any,
      { t: 'let' } as any,
      pt({ kind: 'goal', playerId: 'p1' }),
    ]);
    expect(r.players).toHaveLength(1);
  });
});

describe('the whole chain, per family', () => {
  // The point of the fold is that the numbers REACH a typed column. A metric that
  // derives correctly and then has nowhere to land is still a metric thrown away -
  // which is exactly the bug this file was written to fix.
  const families = [...new Set(TEAM_STAT_SPECS.map((s) => s.family))];

  it.each(families)('%s: a derived metric lands in a real column', (family) => {
    // Pick a sport in this family that ACTUALLY records actions. Seven sports record
    // none - chess, boxing, judo, wrestling, taekwondo, arm wrestling, tug of war -
    // and those are covered by the result-derived tests below instead.
    const spec = TEAM_STAT_SPECS.find((s) => s.family === family && s.events.length > 0)!;
    expect(spec, `no ${family} sport records any action`).toBeTruthy();
    const event = spec.events[0];

    const r = deriveTeamStats(spec.sport, [pt({ kind: event.key, pts: 1, value: 1, playerId: 'p1' })]);
    expect(r.players, `${spec.sport} credited nobody`).toHaveLength(1);

    const mapped = toCategoryRow(spec.sport, r.players[0].stats);
    expect(mapped, `${spec.sport} has no detail table`).toBeTruthy();
    // Nothing derived may be left unmapped, and something must actually be written.
    expect(mapped!.unmapped, `${spec.sport}: ${mapped!.unmapped.join(', ')}`).toEqual([]);
    expect(Object.keys(mapped!.row).length, `${spec.sport} produced an empty row`).toBeGreaterThan(0);
  });

  it('every team sport has a detail table to write into', () => {
    const orphans = TEAM_STAT_SPECS.filter((s) => lineFamilyFor(s.sport) === null).map((s) => s.sport);
    expect(orphans).toEqual([]);
  });

  it('every loggable action of every team sport produces at least one metric', () => {
    // An action with no metrics is a tap that only ever becomes a timeline entry.
    const empty: string[] = [];
    for (const spec of TEAM_STAT_SPECS) {
      for (const e of spec.events) {
        if (!Object.keys(e.metrics).length) empty.push(`${spec.sport}/${e.key}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('and every metric an action produces maps to a column', () => {
    const lost: string[] = [];
    for (const spec of TEAM_STAT_SPECS) {
      for (const e of spec.events) {
        const bag: Record<string, number> = {};
        for (const k of Object.keys(e.metrics)) bag[k] = 1;
        for (const k of Object.keys(e.secondPlayerMetrics ?? {})) bag[k] = 1;
        const mapped = toCategoryRow(spec.sport, bag);
        for (const u of mapped?.unmapped ?? []) lost.push(`${spec.sport}/${e.key}: ${u}`);
      }
    }
    expect(lost).toEqual([]);
  });
});

describe('minutes come from the team sheet', () => {
  it('are attached when supplied, and absent otherwise', () => {
    // A log cannot know how long somebody was on the field.
    const log: RallyLog = [pt({ kind: 'goal', playerId: 'p1' })];
    expect(deriveTeamStats('football', log).players[0].stats.minutes).toBeUndefined();
    const withMins = deriveTeamStats('football', log, { minutes: new Map([['p1', 90]]) });
    expect(withMins.players[0].stats.minutes).toBe(90);
  });
});

describe('telling an empty line from an impossible one', () => {
  it('knows which sports attribute events at all', () => {
    expect(attributesEvents('football')).toBe(true);
    expect(attributesEvents('kabaddi')).toBe(true);
    expect(attributesEvents('quidditch')).toBe(false);
  });
});

describe('the sports where the RESULT is the statistic', () => {
  // Seven of the twenty-seven record no per-player actions, and that is correct -
  // there is nothing to attribute in a bout between two people. Their typed columns
  // were nonetheless empty, so a boxer who had just won 3-0 was told no statistics
  // were recorded.
  const roster = [{ userId: 'p1', side: 'A' as const }, { userId: 'q1', side: 'B' as const }];

  it('reads a bout scoreline as rounds won and lost', () => {
    const r = deriveTeamStats('boxing', [], {
      roster, result: { home: 3, away: 0, winner: 'A' },
    });
    expect(r.players.find((x) => x.userId === 'p1')!.stats)
      .toMatchObject({ bouts: 1, rounds_won: 3, rounds_lost: 0 });
    expect(r.players.find((x) => x.userId === 'q1')!.stats)
      .toMatchObject({ bouts: 1, rounds_won: 0, rounds_lost: 3 });
  });

  it('reads a chess result as a point, with a draw as half of one', () => {
    // Doubled so the half stays an integer: 2 win, 1 draw, 0 loss.
    const won = deriveTeamStats('chess', [], { roster, result: { home: 1, away: 0, winner: 'A' } });
    expect(won.players.find((x) => x.userId === 'p1')!.stats.result_points_x2).toBe(2);
    expect(won.players.find((x) => x.userId === 'q1')!.stats.result_points_x2).toBe(0);
    const drawn = deriveTeamStats('chess', [], { roster, result: { home: 1, away: 1, winner: null } });
    expect(drawn.players.every((x) => x.stats.result_points_x2 === 1)).toBe(true);
  });

  it('counts boards and frames into one pair of columns', () => {
    // The BAG carries the metric keys; the mapping folds carrom boards and snooker
    // frames into the single `units_won` / `units_lost` column pair.
    const line = deriveTeamStats('carrom', [], { roster, result: { home: 3, away: 1, winner: 'A' } })
      .players.find((x) => x.userId === 'p1')!.stats;
    expect(line).toMatchObject({ boards_won: 3, boards_lost: 1 });
    expect(toCategoryRow('carrom', line)!.row).toMatchObject({ units_won: 3, units_lost: 1 });
    expect(toCategoryRow('pool/snooker', { frames_won: 4, frames_lost: 2 })!.row)
      .toMatchObject({ units_won: 4, units_lost: 2 });
  });

  it('invents NOTHING individual for a sport that records actions', () => {
    // A bare football scoreline belongs to the side, not to any one player - naming
    // eleven people as having scored 2 goals each would be a lie.
    const r = deriveTeamStats('football', [], { roster, result: { home: 2, away: 1, winner: 'A' } });
    expect(r.players).toEqual([]);
  });

  it('never overrides a log that DID credit people', () => {
    const r = deriveTeamStats('boxing', [pt({ kind: 'x', pts: 1, playerId: 'p1' })], {
      roster, result: { home: 3, away: 0, winner: 'A' },
    });
    expect(r.players).toHaveLength(1);
    expect(r.players[0].stats.bouts).toBeUndefined();
  });

  it('does nothing without a score, rather than writing zeroes', () => {
    expect(deriveTeamStats('boxing', [], { roster, result: { home: null, away: null, winner: null } })
      .players).toEqual([]);
  });

  it('every result-derived metric also lands in a real column', () => {
    for (const sport of ['boxing', 'judo', 'wrestling', 'taekwondo', 'arm wrestling', 'tug of war', 'chess']) {
      const r = deriveTeamStats(sport, [], { roster, result: { home: 2, away: 1, winner: 'A' } });
      expect(r.players.length, `${sport} produced no line`).toBeGreaterThan(0);
      const mapped = toCategoryRow(sport, r.players[0].stats);
      expect(mapped, `${sport} has no detail table`).toBeTruthy();
      expect(mapped!.unmapped, `${sport}: ${mapped!.unmapped.join(', ')}`).toEqual([]);
      expect(Object.keys(mapped!.row).length, `${sport} produced an empty row`).toBeGreaterThan(0);
    }
  });
});
