import type { StatBag } from './stat-registry.js';

// ============================================================================
// Plain-language insights from a player's racquet numbers.
//
// A grid of twenty figures does not tell anyone what to work on. This turns them
// into a few sentences - strengths, weaknesses, trends - by comparing the player
// with their own recent matches and with other players. Pure: the API gathers the
// numbers, this decides what they mean, and the thresholds live in one place.
//
// Every insight carries its EVIDENCE: the counts behind it and the rule that made
// it a strength or a weakness, so a player (or a coach, or a client) can check the
// claim rather than take it on trust.
// ============================================================================

export type InsightTone = 'strength' | 'weakness' | 'up' | 'down';

/** How an insight was worked out: the counts behind it, and the rule applied. */
export interface InsightEvidence {
  /** Label / value pairs: "Won on your serve" / "256 of 412 points (62%)". */
  facts: Array<{ label: string; value: string }>;
  /** Why it counts as a strength, a weakness or a trend, in plain words. */
  rule: string;
}

export interface Insight {
  key: string;
  tone: InsightTone;
  text: string;
  evidence?: InsightEvidence;
  /** Based on little data: shown, but marked as an early sign rather than a settled fact. */
  early?: boolean;
}

/** Pressure rates other players are measured on, so "low" means low for the sport. */
export type TypicalKey = 'game_point_conversion' | 'game_point_save' | 'deuce';

export interface InsightPerson {
  name: string;
  played: number;
  won: number;
  lost: number;
}

export type InsightRate = 'service_win_pct' | 'return_win_pct' | 'point_win_pct';

/** What other players in the sport look like, for comparisons that are fair to the sport. */
export interface InsightField {
  /** This player's place among others, 0-100, keyed by rate. */
  percentiles?: Partial<Record<InsightRate, number>>;
  /** How many other players each percentile was measured against. */
  sizes?: Partial<Record<InsightRate, number>>;
  /**
   * The typical serve-minus-receive gap among other players (median, in points of
   * percentage) and how many players it comes from. In table tennis nearly everyone
   * wins more on serve; this is what "more than usual" is measured against.
   */
  gap?: { typical: number; players: number };
  /** The typical (median) pressure rates among other players, and how many players each is from. */
  typical?: Partial<Record<TypicalKey, { pct: number; players: number }>>;
  /**
   * Who "other players" are, said in the text so nobody reads a platform-wide comparison
   * as an in-house one: "table tennis players on Sportagon". Defaults to "players".
   */
  group?: string;
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
  field?: InsightField;
  /**
   * Where pressure figures (deuce, game points, deciders, comebacks) come from. In
   * doubles they belong to the pair, so singles is used whenever there is enough of
   * it; `pair` says the figures are a doubles pair's, and the wording says so.
   * Absent: the career bag, worded as the player's own.
   */
  pressure?: { bag: StatBag; matches: number; pair: boolean };
}

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
  gapPp: 10,              // a serve-receive gap this far from the typical one is worth naming
  minFieldPlayers: 5,     // others needed before any comparison with them is made
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
  // Pressure rates are judged against other players where there are enough of them:
  // this far above / below the typical figure is a strength / something to work on.
  relativePp: 10,
  // Below these, an insight is still shown but marked an early sign.
  earlyPoints: 60,
  earlyGamePoints: 15,
  earlyDeucePoints: 10,
  earlyDeciders: 4,
  earlyComebacks: 4,
} as const;

const R = INSIGHT_RULES;

/** A rate as counts and a rounded %, or null when there is too little behind it. */
interface Rate { won: number; of: number; pct: number }
function rate(bag: StatBag, won: string, of: string | [string, string], min: number): Rate | null {
  const w = bag[won] ?? 0;
  const d = typeof of === 'string' ? (bag[of] ?? 0) : (bag[of[0]] ?? 0) + (bag[of[1]] ?? 0);
  return d >= min ? { won: w, of: d, pct: Math.round((w / d) * 100) } : null;
}
const POINTS: [string, string] = ['points_won', 'points_lost'];
const counted = (r: Rate, noun = 'points') => `${r.won} of ${r.of} ${noun} (${r.pct}%)`;

// Only ever said of a strength, so a below-the-middle figure is left unsaid.
const betterThan = (group: string) => (p?: number) =>
  p === undefined || p < 50 ? '' : p >= 100 ? ` - better than all other ${group}` : ` - better than ${p}% of ${group}`;

/** "Above 5 of 6 other table tennis players on Sportagon" - the percentile, as the people it came from. */
const rankedAmong = (group: string) => (p: number, n: number) => `Above ${Math.round((p / 100) * n)} of ${n} other ${group} (${p}%)`;

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
  const { career, recent, earlier } = input;
  const form = input.results.slice(0, 5).map((r) => (r === 'won' ? 'W' : r === 'lost' ? 'L' : 'D') as 'W' | 'L' | 'D');
  const streak = streakOf(input.results);
  const enoughData = input.results.length >= R.minResults;
  const out: InsightReport = { enoughData, strengths: [], weaknesses: [], trends: [], form, streak };
  if (!enoughData) return out;

  const from = { label: 'From', value: `${input.careerMatches} match${input.careerMatches === 1 ? '' : 'es'} scored point by point` };
  // One thing is never both a strength and a weakness: the first verdict on a key stands.
  const add = (tone: 'strength' | 'weakness', key: string, text: string, evidence: InsightEvidence, early = false) => {
    const list = tone === 'strength' ? out.strengths : out.weaknesses;
    const other = tone === 'strength' ? out.weaknesses : out.strengths;
    if (!list.some((i) => i.key === key) && !other.some((i) => i.key === key)) {
      list.push({ key, tone, text, evidence, ...(early ? { early: true } : {}) });
    }
  };
  const p = input.field?.percentiles ?? {};
  const n = input.field?.sizes ?? {};
  const group = input.field?.group ?? 'players';
  const better = betterThan(group);
  const ranked = rankedAmong(group);

  // ---- Serve and receive -------------------------------------------------------
  const serve = rate(career, 'service_points_won', 'service_points_played', R.minPoints);
  const recv = rate(career, 'return_points_won', 'return_points_played', R.minPoints);

  // Against other players: only where there are enough of them to compare with.
  const vsField = (key: 'serve' | 'receive', r: Rate | null, which: InsightRate, noun: string) => {
    const q = p[which];
    const size = n[which] ?? 0;
    if (!r || q === undefined || size < R.minFieldPlayers) return;
    const facts = [{ label: `Won ${noun}`, value: counted(r) }, { label: 'Compared with', value: ranked(q, size) }, from];
    const early = r.of < R.earlyPoints;
    if (q >= R.strongPercentile) {
      add('strength', key, key === 'serve'
        ? `Strong server: you win ${r.pct}% of points on your serve${better(q)}.`
        : `Strong receiver: you win ${r.pct}% of points when receiving${better(q)}.`,
      { facts, rule: `A strength when your ${key} win % is in the top ${100 - R.strongPercentile}% of players with ${R.minPoints}+ points.` }, early);
    } else if (q <= R.weakPercentile) {
      add('weakness', key, key === 'serve'
        ? `Your serve wins ${r.pct}% of points - lower than most ${group}.`
        : `Receiving wins you ${r.pct}% of points - lower than most ${group}.`,
      { facts, rule: `Flagged when your ${key} win % is in the bottom ${R.weakPercentile}% of players with ${R.minPoints}+ points.` }, early);
    }
  };
  vsField('serve', serve, 'service_win_pct', 'on your serve');
  vsField('receive', recv, 'return_win_pct', 'when receiving');

  // Serve against receive, measured against the gap OTHER players have. Most players
  // win more on serve (in table tennis by a wide margin), so a gap is only worth naming
  // when it is unusual - comparing a player with themselves told everybody the same thing.
  const gap = input.field?.gap;
  if (serve && recv && gap && gap.players >= R.minFieldPlayers) {
    const mine = serve.pct - recv.pct;
    const facts = [
      { label: 'Won on your serve', value: counted(serve) },
      { label: 'Won when receiving', value: counted(recv) },
      { label: 'Your gap', value: `${mine > 0 ? '+' : ''}${mine} points (serve minus receive)` },
      { label: 'Typical gap', value: `${gap.typical > 0 ? '+' : ''}${gap.typical} points, across ${gap.players} other ${group}` },
      from,
    ];
    const rule = `Named when your serve-receive gap is ${R.gapPp}+ points away from the typical gap of other players.`;
    const early = Math.min(serve.of, recv.of) < R.earlyPoints;
    if (mine - gap.typical >= R.gapPp) {
      add('weakness', 'receive', `Receiving is your weak spot: you win ${mine} points fewer receiving than serving, where most players drop about ${gap.typical}.`, { facts, rule }, early);
    } else if (gap.typical - mine >= R.gapPp) {
      add('strength', 'receive', `A strong receiver: you lose only ${Math.max(0, mine)} points from serve to receive, where most players drop about ${gap.typical}.`, { facts, rule }, early);
    }
  }

  const points = rate(career, 'points_won', POINTS, R.minPoints);
  if (points && p.point_win_pct !== undefined && (n.point_win_pct ?? 0) >= R.minFieldPlayers && p.point_win_pct >= R.strongPercentile) {
    add('strength', 'points', `You win ${points.pct}% of all points played${better(p.point_win_pct)}.`, {
      facts: [{ label: 'Points won', value: counted(points) }, { label: 'Compared with', value: ranked(p.point_win_pct, n.point_win_pct!) }, from],
      rule: `A strength when your share of points won is in the top ${100 - R.strongPercentile}% of players.`,
    }, points.of < R.earlyPoints);
  }

  // ---- Pressure -----------------------------------------------------------------
  // In doubles these are the PAIR's figures, so singles is the source whenever there is
  // enough of it; doubles-only players are told the figures are shared with partners.
  const pressure = input.pressure ?? { bag: career, matches: input.careerMatches, pair: false };
  const P = pressure.bag;
  const you = pressure.pair ? 'you and your partners' : 'you';
  const You = pressure.pair ? 'You and your partners' : 'You';
  const pFrom = {
    label: 'From',
    value: input.pressure
      ? `${pressure.matches} ${pressure.pair ? 'doubles' : 'singles'} match${pressure.matches === 1 ? '' : 'es'}${pressure.pair ? ' (shared with your partners)' : ''}`
      : from.value,
  };

  /**
   * A pressure rate judged against OTHER players when there are enough of them - "low"
   * then means low for the sport - and against a fixed line otherwise. The evidence
   * says which yardstick was used.
   */
  const pressureRate = (opts: {
    key: string; r: Rate | null; typicalKey: TypicalKey; label: string; noun: string; early: boolean;
    fixed: { high?: number; low?: number };
    strong?: string; weak?: string;
  }) => {
    const { r } = opts;
    if (!r) return;
    const t = input.field?.typical?.[opts.typicalKey];
    const relative = !!t && t.players >= R.minFieldPlayers;
    const facts = [
      { label: opts.label, value: counted(r, opts.noun) },
      ...(relative ? [{ label: 'Typical', value: `${t!.pct}% across ${t!.players} other ${group}` }] : []),
      pFrom,
    ];
    const high = relative ? r.pct >= t!.pct + R.relativePp : opts.fixed.high !== undefined && r.pct >= opts.fixed.high;
    const low = relative ? r.pct <= t!.pct - R.relativePp : opts.fixed.low !== undefined && r.pct <= opts.fixed.low;
    const rule = (dir: 'above' | 'below', fixedLine?: number) => (relative
      ? `Named when you are ${R.relativePp}+ points ${dir} the typical ${t!.pct}% of other players.`
      : `Named at ${fixedLine}% or ${dir === 'above' ? 'more' : 'less'} (too few other players to compare with yet).`);
    if (high && opts.strong) add('strength', opts.key, opts.strong, { facts, rule: rule('above', opts.fixed.high) }, opts.early);
    if (low && opts.weak) add('weakness', opts.key, opts.weak, { facts, rule: rule('below', opts.fixed.low) }, opts.early);
  };

  const deuce = rate(P, 'deuce_points_won', 'deuce_points_played', R.minDeucePoints);
  pressureRate({
    key: 'deuce', r: deuce, typicalKey: 'deuce', label: 'Deuce points won', noun: 'points',
    early: !!deuce && deuce.of < R.earlyDeucePoints, fixed: { high: 60, low: 40 },
    strong: deuce ? `Calm at deuce: ${you} win ${deuce.pct}% of deuce points.` : undefined,
    weak: deuce ? `Deuce points: ${you} win only ${deuce.pct}% of them.` : undefined,
  });

  const convert = rate(P, 'game_points_won', 'game_points_played', R.minGamePoints);
  pressureRate({
    key: 'closing', r: convert, typicalKey: 'game_point_conversion', label: 'Game points converted', noun: 'game points',
    early: !!convert && convert.of < R.earlyGamePoints, fixed: { high: 85, low: 65 },
    strong: convert ? `A closer: ${you} convert ${convert.pct}% of game points.` : undefined,
    weak: convert ? `Finishing games: ${you} convert ${convert.pct}% of game points.` : undefined,
  });

  const save = rate(P, 'game_points_saved', 'game_points_faced', R.minGamePoints);
  pressureRate({
    key: 'saving', r: save, typicalKey: 'game_point_save', label: 'Game points saved', noun: 'game points faced',
    early: !!save && save.of < R.earlyGamePoints, fixed: { high: 40 },
    strong: save ? `A fighter: ${you} save ${save.pct}% of game points against you.` : undefined,
  });

  const dw = P.deciders_won ?? 0;
  const dl = P.deciders_lost ?? 0;
  if (dw + dl >= 2) {
    const ev = (rule: string) => ({ facts: [{ label: 'Deciding games', value: `${dw} won, ${dl} lost` }, pFrom], rule });
    const early = dw + dl < R.earlyDeciders;
    if (dw / (dw + dl) >= 0.67) add('strength', 'deciders', `Strong when it goes the distance: ${you} won ${dw} of ${dw + dl} deciding games.`, ev('A strength when two-thirds or more of deciding games are won, with 2+ played.'), early);
    if (dw / (dw + dl) <= 0.33) add('weakness', 'deciders', `Deciding games: ${you} won ${dw} of ${dw + dl}.`, ev('Flagged when a third or fewer of deciding games are won, with 2+ played.'), early);
  }

  if ((P.comeback_games ?? 0) >= 2) {
    add('strength', 'comebacks', `Never out of it: ${you} won ${P.comeback_games} games from 3 or more points down.`, {
      facts: [{ label: 'Games won from 3+ down', value: String(P.comeback_games) }, pFrom],
      rule: 'A strength once 2+ games are won after trailing by 3 or more points in them.',
    }, (P.comeback_games ?? 0) < R.earlyComebacks);
  }
  if ((P.match_points_saved ?? 0) >= 2) {
    add('strength', 'mp_saved', `${You} saved ${P.match_points_saved} match points against you.`, {
      facts: [{ label: 'Match points saved', value: String(P.match_points_saved) }, pFrom],
      rule: 'A strength once 2+ match points against you are saved.',
    }, (P.match_points_saved ?? 0) < R.earlyComebacks);
  }

  const exp = rate(career, 'expedite_points_won', 'expedite_points_played', R.minExpeditePoints);
  if (exp) {
    const ev = (rule: string) => ({ facts: [{ label: 'Points under expedite', value: counted(exp) }, from], rule });
    if (exp.pct >= 55) add('strength', 'expedite', `Steady in long rallies: ${exp.pct}% of points won under the expedite system.`, ev(`A strength at 55%+ of expedite points won, with ${R.minExpeditePoints}+ played.`));
    if (exp.pct <= 45) add('weakness', 'expedite', `Long rallies: ${exp.pct}% of points won under the expedite system.`, ev(`Flagged at 45% or less of expedite points won, with ${R.minExpeditePoints}+ played.`));
  }

  // ---- Singles or doubles -------------------------------------------------------
  const s = input.singles;
  const d = input.doubles;
  if (s && d && s.played >= R.minSplitMatches && d.played >= R.minSplitMatches) {
    const sp = Math.round((s.won / s.played) * 100);
    const dp = Math.round((d.won / d.played) * 100);
    const evidence = {
      facts: [{ label: 'Singles', value: `${s.won} won of ${s.played} (${sp}%)` }, { label: 'Doubles', value: `${d.won} won of ${d.played} (${dp}%)` }],
      rule: `Named when one win rate is ${R.splitGapPp}+ points higher, with ${R.minSplitMatches}+ matches of each.`,
    };
    if (sp - dp >= R.splitGapPp) add('strength', 'format', `Singles is your game: ${sp}% won, against ${dp}% in doubles.`, evidence);
    if (dp - sp >= R.splitGapPp) add('strength', 'format', `Doubles is your game: ${dp}% won, against ${sp}% in singles.`, evidence);
  }

  // ---- People -------------------------------------------------------------------
  const partner = (input.partners ?? [])
    .filter((x) => x.played >= R.minPartnerMatches && x.won / x.played >= 0.6)
    .sort((a, b) => b.won - a.won)[0];
  if (partner) {
    add('strength', 'partner', `Best partnership: with ${partner.name}, ${partner.won}W ${partner.lost}L.`, {
      facts: [{ label: `Together with ${partner.name}`, value: `${partner.played} matches: ${partner.won} won, ${partner.lost} lost` }],
      rule: `Your partner with the most wins, among partners with ${R.minPartnerMatches}+ matches together and 60%+ won.`,
    });
  }
  const rival = (input.opponents ?? [])
    .filter((x) => x.played >= R.minRivalMatches && x.won === 0)
    .sort((a, b) => b.lost - a.lost)[0];
  if (rival) {
    add('weakness', 'rival', `Toughest opponent: ${rival.name}, ${rival.won}W ${rival.lost}L so far.`, {
      facts: [{ label: `Against ${rival.name}`, value: `${rival.played} singles matches, none won` }],
      rule: `A singles opponent you have played ${R.minRivalMatches}+ times and never beaten.`,
    });
  }

  // ---- Trends: the last few matches against the ones before them -----------------
  if (input.recentMatches >= R.minRecentMatches && input.careerMatches > input.recentMatches) {
    const before = input.careerMatches - input.recentMatches;
    const trend = (key: string, label: string, now: Rate | null, then: Rate | null) => {
      if (!now || !then || Math.abs(now.pct - then.pct) < R.trendPp) return;
      const up = now.pct > then.pct;
      out.trends.push({
        key, tone: up ? 'up' : 'down',
        // Thin on either side of the comparison: few points now, or few matches before.
        ...(now.of < R.earlyPoints || before < R.minRecentMatches ? { early: true } : {}),
        text: `${label} ${up ? 'up' : 'down'}: ${now.pct}% in your last ${input.recentMatches} matches, ${then.pct}% before that.`,
        evidence: {
          facts: [
            { label: `Last ${input.recentMatches} matches`, value: counted(now) },
            { label: `The ${before} before`, value: counted(then) },
          ],
          rule: `Shown when the change is ${R.trendPp}+ points, comparing your last ${R.recentMatches} matches with the ones before them.`,
        },
      });
    };
    trend('serve', 'Serve win %',
      rate(recent, 'service_points_won', 'service_points_played', R.minRecentPoints),
      rate(earlier, 'service_points_won', 'service_points_played', R.minPoints));
    trend('receive', 'Receive win %',
      rate(recent, 'return_points_won', 'return_points_played', R.minRecentPoints),
      rate(earlier, 'return_points_won', 'return_points_played', R.minPoints));
    trend('points', 'Points won', rate(recent, 'points_won', POINTS, R.minRecentPoints), rate(earlier, 'points_won', POINTS, R.minPoints));
  }
  if (streak && streak.length >= R.minStreak) {
    const evidence = {
      facts: [{ label: 'Latest results', value: input.results.slice(0, Math.min(streak.length + 1, 10)).map((r) => (r === 'won' ? 'W' : r === 'lost' ? 'L' : 'D')).join(' ') }],
      rule: `Shown for ${R.minStreak}+ results in a row, newest first.`,
    };
    out.trends.unshift(streak.kind === 'W'
      ? { key: 'streak', tone: 'up', text: `On a ${streak.length}-match winning run.`, evidence }
      : { key: 'streak', tone: 'down', text: `${streak.length} defeats in a row - worth a look at the weaknesses below.`, evidence });
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
