import { describe, expect, it } from 'vitest';
import { racquetInsights, type InsightInput } from './insights.js';
import { presetByKey } from './racquet-presets.js';
import type { RallyEvent, RallyLog } from './rally-kernel.js';
import type { Side } from './scoring-rules.js';
import { deriveRacquetStats } from './stat-registry.js';

const ittf = presetByKey('ittf_bo5_11')!;
const pts = (side: Side, n: number): RallyLog => Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);

describe('pressure stats', () => {
  // Game 1: B leads 5-0, A wins 11-5. Games 2 and 3: A 11-0, the last at match point.
  const log: RallyLog = [...pts('B', 5), ...pts('A', 11), ...pts('A', 11), ...pts('A', 11)];
  const s = deriveRacquetStats(ittf, log, { firstServer: 'A' }).sides;

  it('counts game points converted and faced, one per game here', () => {
    expect(s.A).toMatchObject({ game_points_played: 3, game_points_won: 3 });
    expect(s.B).toMatchObject({ game_points_faced: 3 });
    expect(s.B.game_points_saved).toBeUndefined();
  });

  it('counts the match point', () => {
    expect(s.A).toMatchObject({ match_points_played: 1, match_points_won: 1 });
    expect(s.B.match_points_faced).toBe(1);
  });

  it('a game won from 5 down is a game won from behind', () => {
    expect(s.A.comeback_games).toBe(1);
  });

  it('a saved game point is the holder failing to convert it', () => {
    const saved = deriveRacquetStats(ittf, [...pts('A', 10), ...pts('B', 1)], { firstServer: 'A' }).sides;
    expect(saved.A).toMatchObject({ game_points_played: 1 });
    expect(saved.A.game_points_won).toBeUndefined();
    expect(saved.B.game_points_saved).toBe(1);
  });
});

describe('racquetInsights', () => {
  const base: InsightInput = {
    career: {
      service_points_played: 100, service_points_won: 63,
      return_points_played: 100, return_points_won: 33,
      points_won: 96, points_lost: 104,
      deuce_points_played: 5, deuce_points_won: 1,
      deciders_won: 3, deciders_lost: 1,
    },
    recent: { service_points_played: 40, service_points_won: 30, return_points_played: 40, return_points_won: 13 },
    earlier: { service_points_played: 60, service_points_won: 33, return_points_played: 60, return_points_won: 20 },
    recentMatches: 5,
    careerMatches: 12,
    results: ['won', 'won', 'won', 'lost', 'won'],
  };

  it('says nothing until there are enough results', () => {
    const r = racquetInsights({ ...base, results: ['won'] });
    expect(r.enoughData).toBe(false);
    expect(r.strengths).toEqual([]);
  });

  // Serve 63%, receive 33%: a 30-point gap.
  const field = (typical: number, players = 8) => ({ field: { gap: { typical, players } } });

  it('says nothing about serve vs receive without other players to compare the gap with', () => {
    const r = racquetInsights(base);
    expect([...r.strengths, ...r.weaknesses].map((i) => i.key)).not.toContain('receive');
  });

  it('a gap that is normal for the sport is not a weakness', () => {
    const r = racquetInsights({ ...base, ...field(28) });
    expect(r.weaknesses.map((i) => i.key)).not.toContain('receive');
  });

  it('a gap well beyond the typical one is named, with the typical gap as evidence', () => {
    const r = racquetInsights({ ...base, ...field(14) });
    const recv = r.weaknesses.find((i) => i.key === 'receive')!;
    expect(recv.text).toContain('most players drop about 14');
    expect(recv.evidence!.facts.map((f) => f.value)).toEqual(expect.arrayContaining([
      '63 of 100 points (63%)', '33 of 100 points (33%)', '+14 points, across 8 other players',
    ]));
  });

  it('a gap well below the typical one makes a strong receiver', () => {
    const r = racquetInsights({ ...base, career: { ...base.career, return_points_won: 60 }, ...field(14) });
    expect(r.strengths.find((i) => i.key === 'receive')!.text).toContain('A strong receiver');
  });

  it('every insight carries its counts and its rule', () => {
    const r = racquetInsights({ ...base, ...field(14) });
    for (const i of [...r.strengths, ...r.weaknesses, ...r.trends]) {
      expect(i.evidence?.facts.length).toBeGreaterThan(0);
      expect(i.evidence?.rule).toBeTruthy();
    }
  });

  it('reads pressure: weak at deuce, strong in deciders', () => {
    const r = racquetInsights(base);
    expect(r.weaknesses.map((i) => i.key)).toContain('deuce');
    expect(r.strengths.map((i) => i.key)).toContain('deciders');
  });

  it('spots a rising serve and a winning run', () => {
    const r = racquetInsights(base);
    expect(r.trends.find((t) => t.key === 'serve')).toMatchObject({ tone: 'up' });
    expect(r.trends[0]).toMatchObject({ key: 'streak', tone: 'up' });
    expect(r.form).toEqual(['W', 'W', 'W', 'L', 'W']);
  });

  describe('sport-specific', () => {
    const ranked = (key: string, pct: number) => ({ field: { percentiles: { [key]: pct }, sizes: { [key]: 8 }, group: 'tennis players on Sportagon' } });
    const tennis = { ...base, career: { ...base.career, service_games_played: 40, service_games_won: 34, return_games_played: 40, return_games_won: 6 } };

    it('names tennis hold % in place of serve points, against other players', () => {
      const r = racquetInsights({ ...tennis, field: { ...ranked('service_games_held_pct', 88).field, percentiles: { service_games_held_pct: 88, service_win_pct: 90 }, sizes: { service_games_held_pct: 8, service_win_pct: 8 } } });
      const serve = r.strengths.filter((i) => i.key === 'serve');
      expect(serve).toHaveLength(1);
      expect(serve[0].text).toBe('Hard to break: you hold 85% of your service games - better than 88% of tennis players on Sportagon.');
      expect(serve[0].evidence!.facts[0].value).toBe('34 of 40 service games (85%)');
    });

    it('flags a low break %, worded as the pair\'s in doubles', () => {
      const r = racquetInsights({ ...tennis, ...ranked('return_games_won_pct', 20), pressure: { bag: tennis.career, matches: 6, pair: true } });
      expect(r.weaknesses.find((i) => i.key === 'receive')!.text).toBe('Breaking serve: you and your partners win 15% of return games - lower than most tennis players on Sportagon.');
    });

    it('reads pickleball side-outs as the receiving skill', () => {
      const pb = { ...base, career: { ...base.career, side_outs_won: 30, service_turns_faced: 50 } };
      const r = racquetInsights({ ...pb, ...ranked('side_out_pct', 80) });
      expect(r.strengths.find((i) => i.key === 'receive')!.text).toContain('side out on 60% of the other side\'s service turns');
    });

    it('says nothing with too few games or too few other players', () => {
      const thin = { ...base, career: { ...base.career, service_games_played: 8, service_games_won: 8 } };
      expect(racquetInsights({ ...thin, ...ranked('service_games_held_pct', 95) }).strengths.map((i) => i.text).join()).not.toContain('hold');
      const r = racquetInsights({ ...tennis, field: { percentiles: { service_games_held_pct: 95 }, sizes: { service_games_held_pct: 4 } } });
      expect(r.strengths.map((i) => i.text).join()).not.toContain('hold');
    });
  });

  it('needs 3 earlier matches before naming a trend', () => {
    const keys = (careerMatches: number) => racquetInsights({ ...base, careerMatches }).trends.map((t) => t.key);
    expect(keys(6)).not.toContain('serve');
    expect(keys(7)).not.toContain('serve');
    expect(keys(8)).toContain('serve');
  });

  it('a slump is measured against the matches before it, and career strengths stay', () => {
    const r = racquetInsights({
      ...base,
      recent: { service_points_played: 40, service_points_won: 20 },
      earlier: { service_points_played: 60, service_points_won: 43 },
      results: ['lost', 'lost', 'lost', 'won', 'won'],
      field: { percentiles: { service_win_pct: 82 }, sizes: { service_win_pct: 6 } },
    });
    const serve = r.trends.find((t) => t.key === 'serve')!;
    expect(serve).toMatchObject({ tone: 'down' });
    expect(serve.text).toContain('50% in your last 5 matches, 72% before that');
    expect(r.strengths.map((i) => i.key)).toContain('serve');
  });

  it('uses other players as the yardstick when given', () => {
    const r = racquetInsights({ ...base, field: { percentiles: { service_win_pct: 82 }, sizes: { service_win_pct: 6 } } });
    const serve = r.strengths.find((i) => i.key === 'serve')!;
    expect(serve.text).toContain('better than 82% of players');
    expect(serve.evidence!.facts.find((f) => f.label === 'Compared with')!.value).toBe('Above 5 of 6 other players (82%)');
  });

  it('makes no comparison with too few other players', () => {
    const r = racquetInsights({ ...base, field: { percentiles: { service_win_pct: 90 }, sizes: { service_win_pct: 3 } } });
    expect(r.strengths.map((i) => i.key)).not.toContain('serve');
  });

  it('names a winning partnership and a rival never beaten', () => {
    const r = racquetInsights({
      ...base,
      partners: [{ name: 'Neha', played: 6, won: 5, lost: 1 }],
      opponents: [{ name: 'Rohit', played: 3, won: 0, lost: 3 }],
    });
    expect(r.strengths.some((i) => i.text.includes('Neha'))).toBe(true);
    expect(r.weaknesses.some((i) => i.text.includes('Rohit'))).toBe(true);
  });

  it('never calls a serve strong when most players serve better', () => {
    const r = racquetInsights({ ...base, field: { percentiles: { service_win_pct: 10, return_win_pct: 5 }, sizes: { service_win_pct: 6, return_win_pct: 6 } } });
    expect(r.strengths.map((i) => i.key)).not.toContain('serve');
    expect(r.weaknesses.find((i) => i.key === 'serve')!.text).toContain('lower than most players');
  });

  it('never lists the same thing as a strength and a weakness', () => {
    // An unusual gap, but a receive better than most players' - so not a weakness.
    const r = racquetInsights({
      ...base,
      field: { percentiles: { service_win_pct: 90, return_win_pct: 85 }, sizes: { service_win_pct: 6, return_win_pct: 6 }, gap: { typical: 14, players: 6 } },
    });
    expect(r.weaknesses.map((i) => i.key)).not.toContain('receive');
    expect(r.strengths.map((i) => i.key)).toEqual(expect.arrayContaining(['serve', 'receive']));
  });

  it('says "all other players" at the top', () => {
    const r = racquetInsights({ ...base, field: { percentiles: { service_win_pct: 100 }, sizes: { service_win_pct: 6 } } });
    expect(r.strengths.find((i) => i.key === 'serve')!.text).toContain('better than all other players');
  });

  it('names who the comparison is with', () => {
    const r = racquetInsights({
      ...base,
      field: { percentiles: { service_win_pct: 82 }, sizes: { service_win_pct: 6 }, group: 'table tennis players on Sportagon' },
    });
    const serve = r.strengths.find((i) => i.key === 'serve')!;
    expect(serve.text).toContain('better than 82% of table tennis players on Sportagon');
    expect(serve.evidence!.facts.find((f) => f.label === 'Compared with')!.value)
      .toBe('Above 5 of 6 other table tennis players on Sportagon (82%)');
  });

  it('a partnership is not crowded out by the other strengths', () => {
    const r = racquetInsights({
      ...base,
      career: { ...base.career, comeback_games: 4, match_points_saved: 3, game_points_saved: 9, game_points_faced: 10 },
      partners: [{ name: 'Neha', played: 5, won: 4, lost: 1 }],
    });
    expect(r.strengths[0].key).toBe('partner');
  });

  it('judges pressure against other players when there are enough of them', () => {
    // Converts 58%: below a fixed 65% line, but normal where players typically convert 60%.
    const gp = { ...base.career, game_points_played: 69, game_points_won: 40 };
    const fixed = racquetInsights({ ...base, career: gp });
    expect(fixed.weaknesses.find((i) => i.key === 'closing')!.evidence!.rule).toContain('too few other players');
    const relative = racquetInsights({ ...base, career: gp, field: { typical: { game_point_conversion: { pct: 60, players: 9 } } } });
    expect(relative.weaknesses.map((i) => i.key)).not.toContain('closing');
    // ...and named once it is 10+ points below what others manage.
    const low = racquetInsights({ ...base, career: gp, field: { typical: { game_point_conversion: { pct: 72, players: 9 } } } });
    const closing = low.weaknesses.find((i) => i.key === 'closing')!;
    expect(closing.evidence!.facts.find((f) => f.label === 'Typical')!.value).toBe('72% across 9 other players');
  });

  it('pressure comes from singles, and a doubles source is said to be shared', () => {
    const r = racquetInsights({
      ...base,
      pressure: { bag: { deciders_won: 3, deciders_lost: 0, comeback_games: 2 }, matches: 6, pair: true },
    });
    expect(r.strengths.find((i) => i.key === 'comebacks')!.evidence!.facts.find((f) => f.label === 'From')!.value)
      .toBe('6 doubles matches (shared with your partners)');
    expect(r.strengths.find((i) => i.key === 'deciders')).toBeDefined();
  });

  it('marks an insight built on little data as an early sign', () => {
    // 2 deciding games is an early sign; the base player's 4 (3 won, 1 lost) is enough.
    const early = racquetInsights({ ...base, career: { ...base.career, deciders_won: 2, deciders_lost: 0 } });
    expect(early.strengths.find((i) => i.key === 'deciders')!.early).toBe(true);
    const settled = racquetInsights(base);
    expect(settled.strengths.find((i) => i.key === 'deciders')!.early).toBeUndefined();
  });

  it('keeps each list short', () => {
    const r = racquetInsights({ ...base, partners: [{ name: 'N', played: 9, won: 9, lost: 0 }], career: { ...base.career, comeback_games: 4, match_points_saved: 3 } });
    expect(r.strengths.length).toBeLessThanOrEqual(3);
  });
});
