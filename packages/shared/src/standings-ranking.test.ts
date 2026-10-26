import { describe, expect, it } from 'vitest';
import { defaultGroupRanking, findTieResolution, groupRankingFor, inheritRanking, rankingFamily, tiebreakerLabel, tiebreakerOptions, type TieResolution } from './standings-ranking.js';
import { EVENT_TITLES, groupsForTitle, placementRuleSchema, rankingRuleSchema, titleFromName, titleOfGroups } from './schemas.js';
import { isKnockoutRound, knockoutRoundLabel, knockoutRoundSize } from './enums.js';

describe('per-sport group ranking defaults', () => {
  it('uses each sport family\'s match points', () => {
    expect(defaultGroupRanking('Football')).toMatchObject({ win: 3, draw: 1, loss: 0 });
    expect(defaultGroupRanking('Basketball')).toMatchObject({ win: 2, draw: 1, loss: 0 });
    expect(defaultGroupRanking('Kho Kho')).toMatchObject({ win: 2 });
    expect(defaultGroupRanking('Chess')).toMatchObject({ win: 2, draw: 1 });
    expect(defaultGroupRanking('Cricket').tiebreakers).toEqual(['points', 'wins', 'score_diff', 'head_to_head']);
    expect(defaultGroupRanking('Something new')).toMatchObject({ win: 3, draw: 1, loss: 0 });
  });

  it('names tie-breakers in the sport\'s terms', () => {
    expect(rankingFamily('Football')).toBe('goals');
    expect(tiebreakerLabel('score_diff', 'Football')).toBe('Goal difference');
    expect(tiebreakerLabel('score_diff', 'Volleyball')).toBe('Set difference');
    expect(tiebreakerLabel('score_for', 'Cricket')).toBe('Runs scored');
    expect(tiebreakerLabel('head_to_head', 'Football')).toBe('Head-to-head');
    expect(tiebreakerLabel('score_diff', 'Badminton', 'individual')).toBe('Game difference');
    expect(tiebreakerLabel('score_for', 'Table Tennis', 'doubles')).toBe('Games won');
    expect(tiebreakerLabel('score_diff', 'Badminton', 'team')).toBe('Matches won (net)');
    expect(tiebreakerLabel('score_diff', 'Carrom', 'individual')).toBe('Score difference');
  });
});

describe('score for is offered only where rulebooks use it', () => {
  it('drops it for games, sets, frames and runs sports', () => {
    expect(defaultGroupRanking('Badminton').tiebreakers).toEqual(['points', 'score_diff', 'head_to_head']);
    expect(defaultGroupRanking('Volleyball').tiebreakers).not.toContain('score_for');
    expect(tiebreakerOptions('Table Tennis', 'individual')).not.toContain('score_for');
    expect(tiebreakerOptions('Cricket')).not.toContain('score_for');
  });
  it('keeps it for goals, points and chess sports, and on general rows', () => {
    expect(defaultGroupRanking('Football').tiebreakers).toContain('score_for');
    expect(tiebreakerOptions('Basketball')).toContain('score_for');
    expect(defaultGroupRanking('Chess').tiebreakers).toContain('score_for');
    expect(tiebreakerOptions(null)).toContain('score_for');
  });
});

describe('groupRankingFor', () => {
  const placement = placementRuleSchema.parse({ scheme: 'placement' });

  it('a stage wins, then the discipline ranking, then the sport default', () => {
    expect(groupRankingFor(placement, 'Basketball')).toMatchObject({ win: 2 });
    const own = { ...placement, ranking: { win: 4, draw: 2, loss: 1, tiebreakers: ['points' as const] } };
    expect(groupRankingFor(own, 'Basketball')).toMatchObject({ win: 4 });
    expect(groupRankingFor(own, 'Basketball', { tiebreakers: ['points', 'wins'] })).toEqual({ win: 4, draw: 2, loss: 1, tiebreakers: ['points', 'wins'] });
    expect(groupRankingFor(own, 'Basketball', { tiebreakers: ['points'], points: { win: 1, draw: 0, loss: 0 } })).toMatchObject({ win: 1 });
  });

  it('a match-points rule ranks by its own W/D/L', () => {
    expect(groupRankingFor({ scheme: 'league_points', win: 3, draw: 1, loss: 0, participation: 0, tiebreakers: ['points', 'wins', 'lost'] }, 'Basketball'))
      .toEqual({ win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'wins', 'lost'] });
  });
});

describe('saved rules stay valid', () => {
  it('old placement and ranking rules parse unchanged', () => {
    const old = { scheme: 'placement', points: { winner: 10, runner_up: 7 }, participation: 1 };
    expect(placementRuleSchema.parse(old)).toEqual(old);
    expect(rankingRuleSchema.parse({ scheme: 'ranking', places: [5, 3, 1], participation: 0 }).convert).toBeUndefined();
  });
});

describe('tie resolutions', () => {
  const r: TieResolution = { scope: 'pool', stage: 1, pool: 2, order: ['b', 'a'], reason: 'Coin toss', by: null, at: '' };
  it('match the same set of teams in the same pool only', () => {
    expect(findTieResolution([r], 'pool', 1, 2, ['a', 'b'])).toBe(r);
    expect(findTieResolution([r], 'pool', 1, 1, ['a', 'b'])).toBeUndefined();
    expect(findTieResolution([r], 'pool', 1, 2, ['a', 'b', 'c'])).toBeUndefined();
  });
});

describe('isKnockoutRound', () => {
  it('reads the generator round names', () => {
    expect(['Final', 'SF', 'QF', 'R16', '3rd Place'].every(isKnockoutRound)).toBe(true);
    expect(['Round 1', 'Pool A - Match 2', 'Added', null].some(isKnockoutRound)).toBe(false);
  });
  it('labels and sizes rounds from one source', () => {
    expect([2, 4, 8, 16].map(knockoutRoundLabel)).toEqual(['Final', 'SF', 'QF', 'R16']);
    expect(['Final', 'SF', 'QF', 'R32', '3rd Place', 'Round 2'].map(knockoutRoundSize)).toEqual([2, 4, 8, 32, 0, 0]);
  });
});

describe('championship / format level match points', () => {
  const base = placementRuleSchema.parse({ scheme: 'placement' });
  const champ = { ...base, ranking: { win: 4, draw: 2, loss: 0 } };

  it("W/D/L without tie-breakers keeps each sport's order", () => {
    expect(groupRankingFor(champ, 'Cricket')).toEqual({ win: 4, draw: 2, loss: 0, tiebreakers: defaultGroupRanking('Cricket').tiebreakers });
  });

  it("a discipline with no ranking inherits the format's, then the default's", () => {
    const format = { ...base, ranking: { win: 1, draw: 0, loss: 0 } };
    expect(groupRankingFor(inheritRanking(base, format, champ), 'Football')).toMatchObject({ win: 1 });
    expect(groupRankingFor(inheritRanking(base, undefined, champ), 'Football')).toMatchObject({ win: 4 });
    const own = { ...base, ranking: { win: 5, draw: 0, loss: 0 } };
    expect(inheritRanking(own, format, champ)).toBe(own);
  });
});

describe('event titles (what a race counts toward)', () => {
  it('each choice maps to piles and back', () => {
    for (const t of EVENT_TITLES) expect(titleOfGroups(groupsForTitle(t))).toBe(t);
    expect(groupsForTitle('both')).toEqual([{ name: 'Men', share: 0.5 }, { name: 'Women', share: 0.5 }]);
  });
  it('rules saved with typed names still map, odd ones stay as they were', () => {
    expect(titleOfGroups([{ name: 'overall ', share: 1 }])).toBe('sport');
    expect(titleOfGroups([{ name: 'Mixed', share: 0.5 }])).toBeNull();
  });
  it('the discipline name suggests the title', () => {
    expect(titleFromName('50m Freestyle Women')).toBe('women');
    expect(titleFromName("Men's 100m Butterfly")).toBe('men');
    expect(titleFromName('4x50 Mixed Relay')).toBe('both');
    expect(titleFromName('100m Freestyle')).toBe('sport');
  });
});
