import {
  cricketScorecard, defaultCricketFormat, foldCricket, foldCricketCareer, isCricketSport,
  parseCricketFormat,
  type CricketEvent, type CricketFormat, type CricketLog, type CricketScorecard,
} from '@semp/shared';
import type { Db } from '../../infra/prisma.js';

// ============================================================================
// Cricket's three tables, written from the ball log.
//
// WHY THIS IS NOT category-lines.service.ts. Every other family writes ONE detail
// row per person per fixture, so the spine row and the detail row are one-to-one and
// the writer can insert them together. Cricket's grain is PER INNINGS: a person bats
// in the second and bowls in the first, and in a Test does both twice. So the detail
// is one-to-many over the spine, and the rows have to be hung off spine rows that
// already exist rather than created alongside them.
//
// That ordering is deliberate and load-bearing: `writePlayerMatchStats` has already
// established who played and what the result was, from the participant set the lock
// resolved. This writer only adds detail, and only for people who already have a
// spine row - so a ball log naming somebody who is not on either team sheet cannot
// manufacture an appearance.
//
// `cricket_innings` is the exception: it is TEAM-level, keyed by fixture, and holds
// the itemised extras. Those belong to nobody's batting line - a total is runs off
// the bat plus wides, no-balls, byes and leg-byes - so a scorecard without them
// cannot be made to balance.
// ============================================================================

interface CricketFixture {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  live_state: unknown;
  tournament_disciplines: {
    tournament_sports: { sports: { name: string } | null } | null;
  } | null;
}

const FIXTURE_SELECT = {
  id: true, home_team_id: true, away_team_id: true, live_state: true,
  tournament_disciplines: {
    select: { tournament_sports: { select: { sports: { select: { name: true } } } } },
  },
} as const;

/** The ball log, defensively: a hand-edited live_state must not throw at lock time. */
export function readCricketLog(liveState: unknown): CricketLog {
  const raw = (liveState as { cricket?: unknown } | null)?.cricket;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is CricketEvent =>
    !!e && typeof e === 'object' && typeof (e as CricketEvent).t === 'string');
}

/**
 * The format this match was played under.
 *
 * The FROZEN snapshot wins, exactly as it does for the rally kernel: once a ball has
 * been bowled the match is reproducible only against the rules it was scored by, and
 * a preset edited afterwards must not retroactively change a completed scorecard.
 */
export function readCricketFormat(liveState: unknown, sport: string | null): CricketFormat | null {
  const frozen = parseCricketFormat((liveState as { format?: unknown } | null)?.format);
  return frozen ?? defaultCricketFormat(sport ?? 'cricket') ?? null;
}

/**
 * The team-level totals a SUMMARY-entered match leaves behind.
 *
 * `entryMode: 'summary'` is a real format setting - a corporate fifteen-over game
 * nobody can staff declares it - and such a match has no ball log at all. It still
 * has a scoreboard, though: the manual form records each side's runs, wickets and
 * overs, and those are exactly the columns `cricket_innings` holds.
 *
 * So a summary match gets its innings rows and NO player detail, which is the honest
 * outcome: nobody recorded who did what, so there is nothing to attribute. Inventing
 * a batting line for the whole team's runs would be worse than having none.
 */
export interface CricketSummary {
  runsA: number; wktA: number; ballsA: number;
  runsB: number; wktB: number; ballsB: number;
}

export function readCricketSummary(liveState: unknown): CricketSummary | null {
  const s = liveState as Record<string, unknown> | null;
  if (!s) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  // Only a state that actually carries a side's runs counts as a summary; an empty
  // fixture would otherwise write two 0/0 innings and look like a scored 0-0 draw,
  // which is the bug that put a phantom draw in the standings once already.
  if (typeof s.runsA !== 'number' && typeof s.runsB !== 'number') return null;
  return {
    runsA: n(s.runsA), wktA: n(s.wktA), ballsA: n(s.ballsA),
    runsB: n(s.runsB), wktB: n(s.wktB), ballsB: n(s.ballsB),
  };
}

export interface CricketWriteResult {
  batting: number;
  bowling: number;
  fielding: number;
  innings: number;
  /** People named in the log with no spine row - i.e. not on either team sheet. */
  unknownPlayers: string[];
  /** Which path produced these rows. 'none' means there was nothing to write. */
  mode: 'ballByBall' | 'summary' | 'none';
}

const EMPTY: CricketWriteResult = {
  batting: 0, bowling: 0, fielding: 0, innings: 0, unknownPlayers: [], mode: 'none',
};

/**
 * Write every cricket detail row for one fixture. Idempotent: the detail is deleted
 * per spine row first, and `cricket_innings` is replaced per fixture, so a re-lock
 * repairs rather than duplicates.
 */
export async function writeCricketLines(db: Db, fixtureId: string): Promise<CricketWriteResult> {
  const fx = await db.fixtures.findUnique({
    where: { id: fixtureId }, select: FIXTURE_SELECT,
  }) as CricketFixture | null;
  if (!fx) return EMPTY;

  const sport = fx.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
  if (!isCricketSport(sport)) return EMPTY;

  const log = readCricketLog(fx.live_state);
  const format = readCricketFormat(fx.live_state, sport);
  if (!format) return EMPTY;

  // No ball log: either the format asked for summary entry, or an official typed a
  // final scorecard over a match nobody scored live. Both leave the same thing
  // behind, and it is worth keeping.
  if (log.length === 0) {
    const summary = readCricketSummary(fx.live_state);
    if (!summary) return EMPTY;
    await writeSummaryInnings(db, fixtureId, fx, summary);
    return { ...EMPTY, innings: 2, mode: 'summary' };
  }

  const { state } = foldCricket(format, log);
  const card = cricketScorecard(state);

  // Spine rows first: they decide who is allowed a detail row at all.
  const spine = await db.$queryRaw<Array<{ id: string; user_id: string }>>`
    select id, user_id from player_match_stats
    where fixture_id = ${fixtureId}::uuid and superseded_at is null`;
  const lineOf = new Map(spine.map((s) => [s.user_id, s.id]));
  if (lineOf.size === 0) return EMPTY;

  const unknown = new Set<string>();
  const resolve = (userId: string): string | null => {
    const id = lineOf.get(userId);
    if (!id) unknown.add(userId);
    return id ?? null;
  };

  // Clear this fixture's detail. Per spine row rather than per fixture, because
  // that is the only key these tables carry.
  const ids = [...lineOf.values()];
  for (const table of ['cricket_batting_lines', 'cricket_bowling_lines', 'cricket_fielding_lines']) {
    await db.$executeRawUnsafe(
      `delete from ${table} where line_id = any($1::uuid[])`, ids);
  }

  const out: CricketWriteResult = { ...EMPTY, unknownPlayers: [] };

  for (const b of card.batting) {
    const lineId = resolve(b.userId);
    if (!lineId) continue;
    // A bowler/fielder named in the log who is not on this side's team sheet is
    // resolved to null rather than refused: the dismissal is still a fact.
    const bowlerId = b.bowlerId && lineOf.has(b.bowlerId) ? b.bowlerId : null;
    const fielderId = b.fielderId && lineOf.has(b.fielderId) ? b.fielderId : null;
    await db.$executeRaw`
      insert into cricket_batting_lines
        (line_id, innings, bat_position, runs, balls_faced, fours, sixes,
         dismissal, bowler_id, fielder_id)
      values
        (${lineId}::uuid, ${b.innings}, ${b.batPosition}, ${b.runs}, ${b.ballsFaced},
         ${b.fours}, ${b.sixes}, ${b.dismissal}, ${bowlerId}::uuid, ${fielderId}::uuid)`;
    out.batting += 1;
  }

  for (const b of card.bowling) {
    const lineId = resolve(b.userId);
    if (!lineId) continue;
    await db.$executeRaw`
      insert into cricket_bowling_lines
        (line_id, innings, balls_bowled, maidens, runs_conceded, wickets, wides, no_balls, dots)
      values
        (${lineId}::uuid, ${b.innings}, ${b.ballsBowled}, ${b.maidens}, ${b.runsConceded},
         ${b.wickets}, ${b.wides}, ${b.noBalls}, ${b.dots})`;
    out.bowling += 1;
  }

  for (const f of card.fielding) {
    const lineId = resolve(f.userId);
    if (!lineId) continue;
    await db.$executeRaw`
      insert into cricket_fielding_lines
        (line_id, innings, catches, stumpings, run_outs, drops)
      values
        (${lineId}::uuid, ${f.innings}, ${f.catches}, ${f.stumpings}, ${f.runOuts}, ${f.drops})`;
    out.fielding += 1;
  }

  // ---- the team-level scoreboard ----
  await db.$executeRaw`delete from cricket_innings where fixture_id = ${fixtureId}::uuid`;
  for (const inn of card.innings) {
    const battingTeam = inn.battingSide === 'A' ? fx.home_team_id : fx.away_team_id;
    const bowlingTeam = inn.battingSide === 'A' ? fx.away_team_id : fx.home_team_id;
    await db.$executeRaw`
      insert into cricket_innings
        (fixture_id, innings, batting_team_id, bowling_team_id, runs, wickets, balls,
         wides, no_balls, byes, leg_byes, penalty_runs, ended_by, target)
      values
        (${fixtureId}::uuid, ${inn.innings}, ${battingTeam}::uuid, ${bowlingTeam}::uuid,
         ${inn.runs}, ${inn.wickets}, ${inn.balls}, ${inn.wides}, ${inn.noBalls},
         ${inn.byes}, ${inn.legByes}, ${inn.penaltyRuns}, ${inn.endedBy}, ${inn.target})`;
    out.innings += 1;
  }

  // ---- refresh the spine's cache from the typed rows just written ----
  await writeCricketStatCache(db, card, lineOf);

  out.mode = 'ballByBall';
  out.unknownPlayers = [...unknown];
  if (out.unknownPlayers.length) {
    console.warn('[cricket-lines] log names people with no appearance:', out.unknownPlayers.join(', '));
  }
  return out;
}

/**
 * Write the two innings rows a summary-entered match knows about.
 *
 * Deliberately does NOT touch the player detail tables or the spine's stat cache: a
 * summary carries no attribution, and a zeroed batting line for everybody on the
 * team sheet would read as "eleven people scored nothing" rather than "nobody
 * recorded it". Extras are left at zero for the same reason - the form never asked.
 */
async function writeSummaryInnings(
  db: Db, fixtureId: string, fx: CricketFixture, s: CricketSummary,
): Promise<void> {
  await db.$executeRaw`delete from cricket_innings where fixture_id = ${fixtureId}::uuid`;
  const sides = [
    { innings: 1, bat: fx.home_team_id, bowl: fx.away_team_id, runs: s.runsA, wkt: s.wktA, balls: s.ballsA },
    { innings: 2, bat: fx.away_team_id, bowl: fx.home_team_id, runs: s.runsB, wkt: s.wktB, balls: s.ballsB },
  ];
  for (const i of sides) {
    await db.$executeRaw`
      insert into cricket_innings
        (fixture_id, innings, batting_team_id, bowling_team_id, runs, wickets, balls, ended_by)
      values
        (${fixtureId}::uuid, ${i.innings}, ${i.bat}::uuid, ${i.bowl}::uuid,
         ${i.runs}, ${Math.min(10, i.wkt)}, ${i.balls}, null)`;
  }
}

/**
 * Fill `player_match_stats.stats` for each cricketer from their own typed rows.
 *
 * This is the cache, not the truth - which is exactly why it is computed from the
 * scorecard here rather than tallied separately. A leaderboard reading `stats` and a
 * scorecard reading the typed rows then cannot disagree, because one is a projection
 * of the other.
 */
async function writeCricketStatCache(
  db: Db, card: CricketScorecard, lineOf: Map<string, string>,
): Promise<void> {
  for (const [userId, lineId] of lineOf) {
    const batting = card.batting.filter((b) => b.userId === userId);
    const bowling = card.bowling.filter((b) => b.userId === userId);
    const fielding = card.fielding.filter((f) => f.userId === userId);
    if (!batting.length && !bowling.length && !fielding.length) continue;

    // One match, however many innings it contained.
    const c = foldCricketCareer(1, batting, bowling, fielding);
    const bag: Record<string, number> = {
      innings_batted: c.inningsBatted, runs: c.runs, balls_faced: c.ballsFaced,
      not_outs: c.notOuts, fours: c.fours, sixes: c.sixes,
      fifties: c.fifties, hundreds: c.hundreds, ducks: c.ducks, high_score: c.highScore,
      innings_bowled: c.inningsBowled, balls_bowled: c.ballsBowled,
      runs_conceded: c.runsConceded, wickets: c.wickets, maidens: c.maidens,
      five_wicket_hauls: c.fiveWicketHauls,
      catches: c.catches, stumpings: c.stumpings, run_outs: c.runOuts,
    };
    await db.$executeRaw`
      update player_match_stats set stats = ${JSON.stringify(bag)}::jsonb
      where id = ${lineId}::uuid`;
  }
}

// ---- verification ----------------------------------------------------------

export interface CricketVerification {
  fixtureId: string;
  balls: number;
  ok: boolean;
  drift: Array<{ what: string; stored: number; derived: number }>;
  note?: string;
}

/**
 * Re-derive from the log and compare with what was stored - the answer to "how do we
 * check this later". The innings totals are the right thing to check because they
 * are the one number a scorecard must balance to: runs off the bat plus every
 * itemised extra plus penalties. If that agrees, the rows beneath it were folded
 * from the same log.
 */
export async function verifyCricketLines(db: Db, fixtureId: string): Promise<CricketVerification> {
  const out: CricketVerification = { fixtureId, balls: 0, ok: true, drift: [] };

  const fx = await db.fixtures.findUnique({
    where: { id: fixtureId }, select: FIXTURE_SELECT,
  }) as CricketFixture | null;
  if (!fx) { out.note = 'Fixture not found.'; return out; }

  const sport = fx.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
  if (!isCricketSport(sport)) { out.note = 'Not a cricket fixture.'; return out; }

  const log = readCricketLog(fx.live_state);
  const format = readCricketFormat(fx.live_state, sport);
  if (!format || !log.length) {
    // A summary-entered match cannot be re-derived, because there is nothing to
    // re-derive FROM. Saying so is the honest answer; comparing the stored innings
    // against an empty fold would report drift on every one of them.
    out.note = readCricketSummary(fx.live_state)
      ? 'Entered as a final scorecard, so there is no ball log to re-derive from. The totals are as recorded.'
      : 'No ball log recorded for this fixture.';
    return out;
  }

  const { state } = foldCricket(format, log);
  const card = cricketScorecard(state);
  out.balls = log.filter((e) => e.t === 'ball').length;

  const stored = await db.$queryRaw<Array<{
    innings: number; runs: number; wickets: number; balls: number;
    wides: number; no_balls: number; byes: number; leg_byes: number; penalty_runs: number;
  }>>`
    select innings, runs, wickets, balls, wides, no_balls, byes, leg_byes, penalty_runs
    from cricket_innings where fixture_id = ${fixtureId}::uuid order by innings asc`;
  if (!stored.length) { out.note = 'No innings recorded for this fixture.'; return out; }

  for (const s of stored) {
    const derived = card.innings.find((i) => i.innings === s.innings);
    if (!derived) {
      out.drift.push({ what: `innings ${s.innings} exists in storage only`, stored: s.runs, derived: 0 });
      continue;
    }
    const pairs: Array<[string, number, number]> = [
      ['runs', s.runs, derived.runs],
      ['wickets', s.wickets, derived.wickets],
      ['balls', s.balls, derived.balls],
      ['wides', s.wides, derived.wides],
      ['no_balls', s.no_balls, derived.noBalls],
      ['byes', s.byes, derived.byes],
      ['leg_byes', s.leg_byes, derived.legByes],
      ['penalty_runs', s.penalty_runs, derived.penaltyRuns],
    ];
    for (const [what, a, b] of pairs) {
      if (a !== b) out.drift.push({ what: `innings ${s.innings} ${what}`, stored: a, derived: b });
    }
  }

  out.ok = out.drift.length === 0;
  if (!out.ok) out.note = 'Stored scorecard disagrees with the ball log - re-lock to recompute.';
  return out;
}
