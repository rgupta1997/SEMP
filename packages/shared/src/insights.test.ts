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

  it('names a serve stronger than the receive, and the receive as the weakness', () => {
    const r = racquetInsights(base);
    expect(r.strengths.map((i) => i.key)).toContain('serve');
    expect(r.weaknesses.map((i) => i.key)).toContain('receive');
    expect(r.weaknesses.find((i) => i.key === 'receive')!.text).toContain('33%');
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

  it('a slump is measured against the matches before it, and career strengths stay', () => {
    const r = racquetInsights({
      ...base,
      recent: { service_points_played: 40, service_points_won: 20 },
      earlier: { service_points_played: 60, service_points_won: 43 },
      results: ['lost', 'lost', 'lost', 'won', 'won'],
    });
    const serve = r.trends.find((t) => t.key === 'serve')!;
    expect(serve).toMatchObject({ tone: 'down' });
    expect(serve.text).toContain('50% in your last 5 matches, 72% before that');
    expect(r.strengths.map((i) => i.key)).toContain('serve');
  });

  it('uses other players as the yardstick when given', () => {
    const r = racquetInsights({ ...base, percentiles: { service_win_pct: 82 } });
    expect(r.strengths.find((i) => i.key === 'serve')!.text).toContain('better than 82% of players');
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
    const r = racquetInsights({ ...base, percentiles: { service_win_pct: 10, return_win_pct: 5 } });
    expect(r.strengths.map((i) => i.key)).not.toContain('serve');
    expect(r.weaknesses.find((i) => i.key === 'serve')!.text).toContain('lower than most players');
  });

  it('never lists the same thing as a strength and a weakness', () => {
    // Receive is 30 below serve, but better than most players' - so not a weakness.
    const r = racquetInsights({ ...base, percentiles: { service_win_pct: 90, return_win_pct: 85 } });
    expect(r.weaknesses.map((i) => i.key)).not.toContain('receive');
    expect(r.strengths.map((i) => i.key)).toEqual(expect.arrayContaining(['serve', 'receive']));
  });

  it('says "every other player" at the top, and nothing at the bottom', () => {
    expect(racquetInsights({ ...base, percentiles: { service_win_pct: 100 } }).strengths[0].text).toContain('better than every other player');
  });

  it('a partnership is not crowded out by the other strengths', () => {
    const r = racquetInsights({
      ...base,
      career: { ...base.career, comeback_games: 4, match_points_saved: 3, game_points_saved: 9, game_points_faced: 10 },
      partners: [{ name: 'Neha', played: 5, won: 4, lost: 1 }],
    });
    expect(r.strengths[0].key).toBe('partner');
  });

  it('keeps each list short', () => {
    const r = racquetInsights({ ...base, partners: [{ name: 'N', played: 9, won: 9, lost: 0 }], career: { ...base.career, comeback_games: 4, match_points_saved: 3 } });
    expect(r.strengths.length).toBeLessThanOrEqual(3);
  });
});
