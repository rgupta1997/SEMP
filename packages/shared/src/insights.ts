import type { StatBag } from './stat-registry.js';

// ============================================================================
// Plain-language insights from a player's racquet numbers.
//
// A grid of twenty figures does not tell anyone what to work on. This turns them
// into a few sentences - strengths, weaknesses, trends - by comparing the player
// with their own recent matches and with other players. Pure: the API gathers the
// numbers, this decides what they mean, and the thresholds live in one place.
// ============================================================================

export type InsightTone = 'strength' | 'weakness' | 'up' | 'down';

export interface Insight {
  key: string;
  tone: InsightTone;
  text: string;
}

export interface InsightPerson {
  name: string;
  played: number;
  won: number;
  lost: number;
}

export interface InsightInput {
  /** The career stat bag for this sport, all matches scored point by point. */
  career: StatBag;
  /** The same, over the most recent `recentMatches` of them. */
  recent: StatBag;
  /** The matches before the recent ones, so a trend reads "then vs now". */
  earlier: StatBag;
  recentMatches: number;
  careerMatches: number;
  /** Results, newest first, including ones entered as a final score only. */
  results: Array<'won' | 'lost' | 'drew'>;
  singles?: { played: number; won: number };
  doubles?: { played: number; won: number };
  partners?: InsightPerson[];
  opponents?: InsightPerson[];
  /** Where this player sits among others in the sport, 0-100, keyed by rate. */
  percentiles?: Partial<Record<InsightRate, number>>;
}

export type InsightRate = 'service_win_pct' | 'return_win_pct' | 'point_win_pct';

export interface InsightReport {
  enoughData: boolean;
  strengths: Insight[];
  weaknesses: Insight[];
  trends: Insight[];
  /** Newest first: W / L / D, at most five. */
  form: Array<'W' | 'L' | 'D'>;
  streak: { kind: 'W' | 'L'; length: number } | null;
}

/** Every threshold the rules use - tune here, nowhere else. */
export const INSIGHT_RULES = {
  minResults: 3,          // results before anything is said
  minPoints: 20,          // rallies behind a serve / receive / point rate
  minRecentPoints: 15,
  minDeucePoints: 4,
  minGamePoints: 5,
  minExpeditePoints: 10,
  gapPp: 10,              // serve vs receive difference worth naming
  trendPp: 8,             // recent vs earlier change worth naming
  minRecentMatches: 3,
  recentMatches: 5,
  strongPercentile: 70,
  weakPercentile: 30,
  minPartnerMatches: 3,
  minRivalMatches: 2,
  minSplitMatches: 3,
  splitGapPp: 20,
  minStreak: 3,
  maxPerList: 3,
} as const;

const R = INSIGHT_RULES;

function pct(bag: StatBag, won: string, of: string, min: number): number | null {
  const d = bag[of] ?? 0;
  return d >= min ? Math.round(((bag[won] ?? 0) / d) * 100) : null;
}

function pointPct(bag: StatBag, min: number): number | null {
  const w = bag.points_won ?? 0;
  const l = bag.points_lost ?? 0;
  return w + l >= min ? Math.round((w / (w + l)) * 100) : null;
}

// Only ever said of a strength, so a below-the-middle figure is left unsaid.
const better = (p?: number) =>
  p === undefined || p < 50 ? '' : p >= 100 ? ' - better than every other player' : ` - better than ${p}% of players`;

/**
 * Which insights win the few places on each list. People and format come first: they
 * are the most personal, and they used to be found last and cut by the cap.
 */
const PRIORITY: Record<'strength' | 'weakness', string[]> = {
  strength: ['partner', 'format', 'serve', 'receive', 'points', 'deciders', 'closing', 'saving', 'deuce', 'comebacks', 'mp_saved', 'expedite'],
  weakness: ['rival', 'serve', 'receive', 'deciders', 'closing', 'deuce', 'expedite'],
};
const byPriority = (tone: 'strength' | 'weakness') => (a: Insight, b: Insight) => {
  const order = PRIORITY[tone];
  const at = (k: string) => (order.indexOf(k) < 0 ? order.length : order.indexOf(k));
  return at(a.key) - at(b.key);
};

export function racquetInsights(input: InsightInput): InsightReport {
  const { career, recent } = input;
  const form = input.results.slice(0, 5).map((r) => (r === 'won' ? 'W' : r === 'lost' ? 'L' : 'D') as 'W' | 'L' | 'D');
  const streak = streakOf(input.results);
  const enoughData = input.results.length >= R.minResults;
  const out: InsightReport = { enoughData, strengths: [], weaknesses: [], trends: [], form, streak };
  if (!enoughData) return out;

  // One thing is never both a strength and a weakness: the first verdict on a key stands.
  const add = (tone: 'strength' | 'weakness', key: string, text: string) => {
    const list = tone === 'strength' ? out.strengths : out.weaknesses;
    const other = tone === 'strength' ? out.weaknesses : out.strengths;
    if (!list.some((i) => i.key === key) && !other.some((i) => i.key === key)) list.push({ key, tone, text });
  };
  const p = input.percentiles ?? {};
  // Compared with other players, where that comparison exists: in the bottom or top half.
  const notBelowField = (q?: number) => q === undefined || q >= 50;
  const notAboveField = (q?: number) => q === undefined || q < 50;

  // Serve and receive: against each other first, then against everybody else. The
  // first is only a player against themselves, so it never contradicts the field - a
  // serve better than your receive but worse than most players' is not "strong".
  const serve = pct(career, 'service_points_won', 'service_points_played', R.minPoints);
  const recv = pct(career, 'return_points_won', 'return_points_played', R.minPoints);
  if (serve !== null && recv !== null && serve - recv >= R.gapPp) {
    if (notBelowField(p.service_win_pct)) add('strength', 'serve', `Strong server: you win ${serve}% of points on your serve${better(p.service_win_pct)}.`);
    if (notAboveField(p.return_win_pct)) add('weakness', 'receive', `Receiving: you win ${recv}% of points when receiving, ${serve - recv} points below your serve.`);
  } else if (serve !== null && recv !== null && recv - serve >= R.gapPp) {
    if (notBelowField(p.return_win_pct)) add('strength', 'receive', `Strong receiver: you win ${recv}% of points when receiving${better(p.return_win_pct)}.`);
    if (notAboveField(p.service_win_pct)) add('weakness', 'serve', `Your serve: you win ${serve}% of points on it, ${recv - serve} points below your receive.`);
  }
  if (serve !== null && (p.service_win_pct ?? 50) >= R.strongPercentile) add('strength', 'serve', `Strong server: ${serve}% of points won on your serve${better(p.service_win_pct)}.`);
  if (serve !== null && (p.service_win_pct ?? 50) <= R.weakPercentile) add('weakness', 'serve', `Your serve wins ${serve}% of points - lower than most players.`);
  if (recv !== null && (p.return_win_pct ?? 50) >= R.strongPercentile) add('strength', 'receive', `Strong receiver: ${recv}% of points won when receiving${better(p.return_win_pct)}.`);
  if (recv !== null && (p.return_win_pct ?? 50) <= R.weakPercentile) add('weakness', 'receive', `Receiving wins you ${recv}% of points - lower than most players.`);

  const points = pointPct(career, R.minPoints);
  if (points !== null && (p.point_win_pct ?? 50) >= R.strongPercentile) add('strength', 'points', `You win ${points}% of all points played${better(p.point_win_pct)}.`);

  // Pressure.
  const deuce = pct(career, 'deuce_points_won', 'deuce_points_played', R.minDeucePoints);
  if (deuce !== null && deuce >= 60) add('strength', 'deuce', `Calm at deuce: you win ${deuce}% of deuce points.`);
  if (deuce !== null && deuce <= 40) add('weakness', 'deuce', `Deuce points: you win only ${deuce}% of them.`);

  const convert = pct(career, 'game_points_won', 'game_points_played', R.minGamePoints);
  if (convert !== null && convert >= 85) add('strength', 'closing', `A closer: you convert ${convert}% of your game points.`);
  if (convert !== null && convert <= 65) add('weakness', 'closing', `Finishing games: you convert ${convert}% of your game points.`);

  const save = pct(career, 'game_points_saved', 'game_points_faced', R.minGamePoints);
  if (save !== null && save >= 40) add('strength', 'saving', `A fighter: you save ${save}% of game points against you.`);

  const dw = career.deciders_won ?? 0;
  const dl = career.deciders_lost ?? 0;
  if (dw + dl >= 2 && dw / (dw + dl) >= 0.67) add('strength', 'deciders', `Strong when it goes the distance: ${dw} of ${dw + dl} deciding games won.`);
  if (dw + dl >= 2 && dw / (dw + dl) <= 0.33) add('weakness', 'deciders', `Deciding games: ${dw} of ${dw + dl} won.`);

  if ((career.comeback_games ?? 0) >= 2) add('strength', 'comebacks', `Never out of it: ${career.comeback_games} games won from 3 or more points down.`);
  if ((career.match_points_saved ?? 0) >= 2) add('strength', 'mp_saved', `${career.match_points_saved} match points saved against you.`);

  const exp = pct(career, 'expedite_points_won', 'expedite_points_played', R.minExpeditePoints);
  if (exp !== null && exp >= 55) add('strength', 'expedite', `Steady in long rallies: ${exp}% of points won under the expedite system.`);
  if (exp !== null && exp <= 45) add('weakness', 'expedite', `Long rallies: ${exp}% of points won under the expedite system.`);

  // Singles or doubles.
  const s = input.singles;
  const d = input.doubles;
  if (s && d && s.played >= R.minSplitMatches && d.played >= R.minSplitMatches) {
    const sp = Math.round((s.won / s.played) * 100);
    const dp = Math.round((d.won / d.played) * 100);
    if (sp - dp >= R.splitGapPp) add('strength', 'format', `Singles is your game: ${sp}% won, against ${dp}% in doubles.`);
    if (dp - sp >= R.splitGapPp) add('strength', 'format', `Doubles is your game: ${dp}% won, against ${sp}% in singles.`);
  }

  // People.
  const partner = (input.partners ?? [])
    .filter((x) => x.played >= R.minPartnerMatches && x.won / x.played >= 0.6)
    .sort((a, b) => b.won - a.won)[0];
  if (partner) add('strength', 'partner', `Best partnership: with ${partner.name}, ${partner.won}W ${partner.lost}L.`);
  const rival = (input.opponents ?? [])
    .filter((x) => x.played >= R.minRivalMatches && x.won === 0)
    .sort((a, b) => b.lost - a.lost)[0];
  if (rival) add('weakness', 'rival', `Toughest opponent: ${rival.name}, ${rival.won}W ${rival.lost}L so far.`);

  // Trends: the last few matches against the ones before them, so a slump is not
  // diluted by being part of its own baseline.
  if (input.recentMatches >= R.minRecentMatches && input.careerMatches > input.recentMatches) {
    const { earlier } = input;
    const trend = (key: string, label: string, now: number | null, then: number | null) => {
      if (now === null || then === null || Math.abs(now - then) < R.trendPp) return;
      out.trends.push({
        key, tone: now > then ? 'up' : 'down',
        text: `${label} ${now > then ? 'up' : 'down'}: ${now}% in your last ${input.recentMatches} matches, ${then}% before that.`,
      });
    };
    trend('serve', 'Serve win %',
      pct(recent, 'service_points_won', 'service_points_played', R.minRecentPoints),
      pct(earlier, 'service_points_won', 'service_points_played', R.minPoints));
    trend('receive', 'Receive win %',
      pct(recent, 'return_points_won', 'return_points_played', R.minRecentPoints),
      pct(earlier, 'return_points_won', 'return_points_played', R.minPoints));
    trend('points', 'Points won', pointPct(recent, R.minRecentPoints), pointPct(earlier, R.minPoints));
  }
  if (streak && streak.length >= R.minStreak) {
    out.trends.unshift(streak.kind === 'W'
      ? { key: 'streak', tone: 'up', text: `On a ${streak.length}-match winning run.` }
      : { key: 'streak', tone: 'down', text: `${streak.length} defeats in a row - worth a look at the weaknesses below.` });
  }

  out.strengths = out.strengths.sort(byPriority('strength')).slice(0, R.maxPerList);
  out.weaknesses = out.weaknesses.sort(byPriority('weakness')).slice(0, R.maxPerList);
  out.trends = out.trends.slice(0, R.maxPerList);
  return out;
}

/** The run of identical results at the newest end; a draw ends it. */
function streakOf(results: Array<'won' | 'lost' | 'drew'>): InsightReport['streak'] {
  const first = results[0];
  if (first !== 'won' && first !== 'lost') return null;
  let n = 0;
  while (n < results.length && results[n] === first) n += 1;
  return { kind: first === 'won' ? 'W' : 'L', length: n };
}
