import { describe, expect, it } from 'vitest';
import { defaultGroupRanking, findTieResolution, groupRankingFor, inheritRanking, rankingFamily, tiebreakerLabel, tiebreakerOptions, type TieResolution } from './standings-ranking.js';
import {
  DEFAULT_RANKING_RULE, DEFAULT_TITLE_PLACING, eventTitleIn, groupsForTitle, isRankingEvent, isRankingFormatName, placementRuleSchema, rankingRuleSchema, sportTitles, sportTitlesSchema, titlePlacingFor,
} from './schemas.js';
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
    expect(rankingRuleSchema.parse({ scheme: 'ranking', places: [5, 3, 1], participation: 0 })).toEqual({ scheme: 'ranking', places: [5, 3, 1], participation: 0 });
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

describe('sport titles, set once per sport', () => {
  const SW = 'aaaaaaaa-0000-4000-8000-000000000001', PL = 'aaaaaaaa-0000-4000-8000-000000000002';
  const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const swim = [
    { id: id(1), name: '50m Free (Men)', sport: 'Swimming', sportId: SW },
    { id: id(2), name: '50m Free (Women)', sport: 'Swimming', sportId: SW },
    { id: id(3), name: 'Mixed Relay', sport: 'Swimming', sportId: SW },
  ];
  const lift = [{ id: id(4), name: '74kg', sport: 'Powerlifting', sportId: PL }, { id: id(5), name: '83kg', sport: 'Powerlifting', sportId: PL }];
  const cfg = (c: object) => sportTitlesSchema.parse(c);

  it('a half-each choice feeds both gender titles at half', () => {
    expect(groupsForTitle('both')).toEqual([{ name: 'Men', share: 0.5 }, { name: 'Women', share: 0.5 }]);
    expect(groupsForTitle('mixed')).toEqual([{ name: 'Mixed', share: 1 }]);
  });

  it('switched off or never saved: no titles at all', () => {
    expect(sportTitles([...swim, ...lift], () => null)).toEqual([]);
    expect(sportTitles(swim, () => cfg({ enabled: false, events: { [id(1)]: 'men' } }))).toEqual([]);
  });

  it('switched on with nothing chosen: every event counts to one whole-sport title', () => {
    const [pl] = sportTitles(lift, () => cfg({ enabled: true }));
    expect(pl.titles.map((t) => [t.label, t.events])).toEqual([['Whole sport', ['74kg', '83kg']]]);
    expect(pl.mixed).toBe(false);
  });

  it('gender titles list their events; a half-each event sits in both', () => {
    const [sw] = sportTitles(swim, () => cfg({ enabled: true, events: { [id(1)]: 'men', [id(2)]: 'women', [id(3)]: 'both' } }));
    expect(sw.mixed).toBe(false);
    expect(sw.titles.map((t) => [t.label, t.events])).toEqual([["Men's", ['50m Free (Men)', 'Mixed Relay']], ["Women's", ['50m Free (Women)', 'Mixed Relay']]]);
  });

  it('a mixed event can be its own Mixed title, with no warning', () => {
    const [sw] = sportTitles(swim, () => cfg({ enabled: true, events: { [id(1)]: 'men', [id(2)]: 'women', [id(3)]: 'mixed' } }));
    expect(sw.mixed).toBe(false);
    expect(sw.titles.map((t) => [t.label, t.events])).toEqual([["Men's", ['50m Free (Men)']], ["Women's", ['50m Free (Women)']], ['Mixed', ['Mixed Relay']]]);
  });

  it('an event left on whole sport beside gender titles is flagged', () => {
    const [sw] = sportTitles(swim, () => cfg({ enabled: true, events: { [id(1)]: 'men', [id(2)]: 'women' } }));
    expect(sw.mixed).toBe(true);
    expect(sw.titles.find((t) => t.group === 'overall')?.events).toEqual(['Mixed Relay']);
    expect(eventTitleIn(null, id(3))).toBe('sport');
  });

  it('title points read by name, case-insensitively, else the default', () => {
    const c = cfg({ enabled: true, titles: { Men: { places: [10, 7, 4], participation: 1 } } });
    expect(titlePlacingFor(c, 'men')).toEqual({ places: [10, 7, 4], participation: 1 });
    expect(titlePlacingFor(c, 'Women')).toEqual(DEFAULT_TITLE_PLACING);
    expect(titlePlacingFor(null, 'Overall')).toEqual(DEFAULT_TITLE_PLACING);
  });

  it('an older event rule that carried its own title setup still parses, without it', () => {
    const rule = rankingRuleSchema.parse({ scheme: 'ranking', places: [5, 3, 1], convert: { groups: [{ name: 'Men', share: 1 }], places: [12, 9], participation: 2 } });
    expect(rule).toEqual({ scheme: 'ranking', places: [5, 3, 1], participation: 0 });
  });
});

describe('ranking events take only their own rule', () => {
  it('a ranking sport or a Rankings format is a ranking event', () => {
    expect(isRankingEvent('Swimming', null)).toBe(true);
    expect(isRankingEvent('Squash', 'Rankings')).toBe(true);
    expect(isRankingEvent('Kabaddi', 'Groups + Knockout')).toBe(false);
    expect(isRankingFormatName('Rankings')).toBe(true);
    expect(isRankingFormatName('Knockout')).toBe(false);
  });
  it('with no rule of its own it scores 5/3/1', () => {
    expect(DEFAULT_RANKING_RULE).toEqual({ scheme: 'ranking', places: [5, 3, 1], participation: 0 });
  });
});

describe('group tie-breakers: a stage only overrides the Point System when someone chose its order', () => {
  const rule = { scheme: 'placement', points: { winner: 10 }, participation: 0, ranking: { win: 2, draw: 0, loss: 0, tiebreakers: ['points', 'score_diff', 'head_to_head'] } } as any;
  it('a stage left on the built-in order uses the Point System order', () => {
    expect(groupRankingFor(rule, 'Table Tennis', { tiebreakers: ['points', 'wins', 'lost'] }).tiebreakers).toEqual(['points', 'score_diff', 'head_to_head']);
  });
  it("a stage left on the sport's default order uses the Point System order", () => {
    const sportOrder = defaultGroupRanking('Table Tennis').tiebreakers;
    expect(groupRankingFor(rule, 'Table Tennis', { tiebreakers: sportOrder }).tiebreakers).toEqual(['points', 'score_diff', 'head_to_head']);
  });
  it('an order picked in Configure stages still wins', () => {
    expect(groupRankingFor(rule, 'Table Tennis', { tiebreakers: ['points', 'head_to_head', 'wins'] }).tiebreakers).toEqual(['points', 'head_to_head', 'wins']);
  });
  it('with no Point System order, the sport default applies', () => {
    expect(groupRankingFor(null, 'Table Tennis', { tiebreakers: ['points', 'wins', 'lost'] }).tiebreakers).toEqual(defaultGroupRanking('Table Tennis').tiebreakers);
  });
});
