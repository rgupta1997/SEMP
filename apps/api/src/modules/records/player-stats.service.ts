import {
  canonicalRacquetSport, chessLineStats, competitionTier, cricketCareerBag, deriveRacquetStats, type ChessGame,
  deriveTeamStats, effectiveEventSpec, eventTemplateFor, foldCricketCareer, isChessSport, isCricketSport,
  parseStoredFormat, playedContests, rankSubEvent, resolveFormat, seatIn, statSpecFor,
  type PlayedContest,
  type BattingRow, type BowlingRow, type EventSpec, type EventState, type FieldingRow,
  type FormatTemplate, type MatchOutcome, type Pairing, type RallyEvent, type RallyLog, type ScoringFormat, type Side,
} from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { writeCategoryLines, type CategoryLineInput } from './category-lines.service.js';
import type { FixtureParticipants } from '../fixtures/participants.js';
// ============================================================================
// Player match statistics.
//
// One row per person per fixture in `player_match_stats`, holding both the
// APPEARANCE (did they play) and the STAT LINE (what they did). They are one table
// on purpose: same question at two depths, written at the same moment by the same
// code, sharing one lifecycle. Split, they would permit a person with two goals and
// no appearance.
//
// RECOMPUTE, NEVER INCREMENT - the discipline career-stats.service.ts already
// states. Everything here is rebuilt from the rally log at lock time, so a metric
// added later backfills across every match already played, and a correction upstream
// repairs everything downstream with no manual adjustment.
//
// Written with $executeRaw rather than the Prisma client because the columns land in
// 20260903000000 and the generated client only learns about them after a
// `prisma db pull`. The queries are parameterised; nothing is interpolated.
// ============================================================================

/** What the writer needs about one fixture. Hand-written, mirroring records/derive.ts. */
interface StatFixture {
  id: string;
  round: string | null;
  stage_sequence: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  live_state: unknown;
  lock_version: number;
  scheduled_at: Date | null;
  winner_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  scoring_format_id?: string | null;
  tournament_disciplines: {
    scoring_format_id?: string | null;
    round_formats?: unknown;
    format_config?: unknown;
    discipline_id?: string | null;
    disciplines?: { name: string; entry_type?: string | null } | null;
    tournament_sports: { sport_id: string; sports: { name: string } | null } | null;
  } | null;
}

export interface PlayerStatRow {
  fixture_id: string;
  user_id: string;
  team_id: string | null;
  organization_id: string | null;
  sport_id: string | null;
  rubber_key: string | null;
  partner_user_id: string | null;
  /** Who they played against in this contest - the source of head-to-head records. */
  opponent_user_ids: string[] | null;
  position: string | null;
  role: string;
  played: boolean;
  outcome: MatchOutcome | null;
  stats: Record<string, number>;
  occurred_on: Date;
  lock_version: number;
}

const rallyOf = (liveState: unknown): RallyLog => {
  const raw = (liveState as { rally?: unknown } | null)?.rally;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is RallyEvent => !!e && typeof e === 'object' && typeof (e as RallyEvent).t === 'string');
};

const firstServerOf = (liveState: unknown): Side =>
  ((liveState as { firstServer?: unknown } | null)?.firstServer === 'B' ? 'B' : 'A');

/**
 * Build the stat rows for one fixture. Pure apart from the two reads, so the shape
 * can be asserted in a test without a database.
 */
export async function buildPlayerStatRows(
  db: Db, fixtureId: string, participants: FixtureParticipants,
): Promise<PlayerStatRow[]> {
  const fx = await db.fixtures.findUnique({
    where: { id: fixtureId },
    select: {
      id: true, round: true, stage_sequence: true, home_team_id: true, away_team_id: true,
      live_state: true, lock_version: true, scheduled_at: true, winner_team_id: true,
      home_score: true, away_score: true,
      tournament_disciplines: {
        select: {
          format_config: true, discipline_id: true,
          disciplines: { select: { name: true, entry_type: true } },
          tournament_sports: { select: { sport_id: true, sports: { select: { name: true } } } },
        },
      },
    },
  }) as StatFixture | null;
  if (!fx) return [];

  const sportName = fx.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
  const sportId = fx.tournament_disciplines?.tournament_sports?.sport_id ?? null;
  const occurred = fx.scheduled_at ?? new Date();

  // A ranking event has no home/away side, so the two-team machinery below has
  // nothing to attach to - every resolved competitor still gets a bare
  // appearance row (it's what makes "matches played" answerable).
  if (!fx.home_team_id && !fx.away_team_id) {
    // The detailed console's marks, keyed by competitor row id. Empty for the
    // simple "Team ranking" console, which never writes a per-athlete mark.
    const eventParticipants = (
      (fx.live_state as { event?: { participants?: unknown } } | null)?.event?.participants
      ?? (fx.live_state as { participants?: unknown } | null)?.participants
      ?? []
    ) as Array<{ id: string; marks?: Record<string, number | null> }>;
    const marksOf = new Map(eventParticipants.map((c) => [c.id, c.marks ?? {}]));
    const state: EventState = { participants: eventParticipants.map((c) => ({ id: c.id, name: '', marks: c.marks ?? {} })) };

    // Same resolution as derive.ts's eventMedals(): stored template wins,
    // else the sport's seeded one, narrowed to the discipline's own category.
    const storedSpec = (fx.tournament_disciplines?.format_config as { scoring?: FormatTemplate } | null)?.scoring?.event;
    const rawSpec: EventSpec | null = storedSpec ?? eventTemplateFor(sportName)?.event ?? null;
    const spec = rawSpec
      ? effectiveEventSpec(rawSpec, {
        id: fx.tournament_disciplines?.discipline_id ?? null,
        name: fx.tournament_disciplines?.disciplines?.name ?? null,
      })
      : null;
    const rankCache = new Map<string, Map<string, number>>();
    const rankOf = (competitorId: string | null, category: string | null): number | null => {
      if (!spec || !competitorId || !category) return null;
      let ranks = rankCache.get(category);
      if (!ranks) { ranks = rankSubEvent(spec, state, category); rankCache.set(category, ranks); }
      return ranks.get(competitorId) ?? null;
    };
    // A whole-sport session can leave one person with marks in several
    // disciplines - a time AND a distance, not comparable as raw numbers the
    // way two weight classes are. RANK is comparable regardless of what was
    // measured (1st is 1st), so the entry representing this appearance is
    // chosen by best rank, not by raw mark. A tied rank falls back to that
    // category's own winnerIs, which only meaningfully resolves a same-unit tie.
    const winnerIsOf = (category: string): 'min' | 'max' =>
      spec?.subEvents.find((se) => se.key === category)?.winnerIs ?? spec?.result.winnerIs ?? 'max';
    const betterOf = (
      a: { category: string; mark: number; rank: number | null },
      b: { category: string; mark: number; rank: number | null },
    ) => {
      if (a.rank == null) return b;
      if (b.rank == null) return a;
      if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
      return winnerIsOf(a.category) === 'min' ? (b.mark < a.mark ? b : a) : (b.mark > a.mark ? b : a);
    };

    return participants.resolved.map((p) => {
      const marks = p.competitor_id ? marksOf.get(p.competitor_id) ?? {} : {};
      const entries = Object.entries(marks).filter((e): e is [string, number] => typeof e[1] === 'number');
      let stats: Record<string, number> = {};
      if (entries.length) {
        const ranked = entries.map(([category, mark]) => ({ category, mark, rank: rankOf(p.competitor_id, category) }));
        const best = ranked.reduce(betterOf);
        // `measured`/`podium` are unit-free counts, so unlike `mark` they stay
        // meaningful summed across categories that don't share a unit.
        stats = { mark: best.mark, measured: 1 };
        if (best.rank != null) { stats.rank = best.rank; if (best.rank <= 3) stats.podium = 1; }
      }
      return {
        fixture_id: fx.id,
        user_id: p.user_id,
        team_id: p.team_id,
        organization_id: p.organization_id,
        sport_id: sportId,
        rubber_key: null,
        partner_user_id: null,
        opponent_user_ids: null,
        position: null,
        role: 'player',
        played: true,
        outcome: null,
        stats,
        occurred_on: occurred,
        lock_version: fx.lock_version,
      };
    });
  }

  // Only racquet sports derive stats from a rally log. Everything else gets its
  // appearance row (which is still worth having - it is what makes "matches played"
  // answerable) and an empty stat bag until its own family lands.
  const canonical = canonicalRacquetSport(sportName);

  // Team members grouped by side, so a doubles pair can be attributed and a partner
  // recorded. Only people on one of the two teams in THIS fixture.
  const sideOf = new Map<string, Side>();
  for (const p of participants.resolved) {
    if (p.team_id && p.team_id === fx.home_team_id) sideOf.set(p.user_id, 'A');
    else if (p.team_id && p.team_id === fx.away_team_id) sideOf.set(p.user_id, 'B');
  }

  const people = participants.resolved.filter((p) => sideOf.has(p.user_id));
  // The PAIRING is a racquet concept: a rubber is contested by one or two named
  // people a side, and the rest of the squad is watching. Everywhere else the whole
  // team sheet takes the field, so slicing to two silently denied nine cricketers
  // an appearance - `played` was true for 4 of 22, and "matches played" was wrong
  // for every team sport on the platform. Caught by driving a real championship
  // through the API and reading the rows back.
  const onSide = (side: Side) => people.filter((p) => sideOf.get(p.user_id) === side).map((p) => p.user_id);
  const pairing: Pairing = canonical
    ? { A: onSide('A').slice(0, 2), B: onSide('B').slice(0, 2) }
    : { A: onSide('A'), B: onSide('B') };

  /** Which side won, as the kernel names sides. Null for a draw or no result. */
  const winnerSide = (): Side | null => {
    if (!fx.winner_team_id) return null;
    if (fx.winner_team_id === fx.home_team_id) return 'A';
    if (fx.winner_team_id === fx.away_team_id) return 'B';
    return null;
  };

  // Where we know who played (a named racquet match, or a tie's rubbers), each player
  // gets one line per contest they played - the same contests derive.ts files results for.
  const played = playedContests({
    liveState: fx.live_state,
    sportName,
    entryType: fx.tournament_disciplines?.disciplines?.entry_type ?? null,
    roster: { A: onSide('A'), B: onSide('B') },
    matchWinner: winnerSide(),
  });
  if (played.kind === 'contests') {
    return contestRows(fx, played.contests, people, sideOf, {
      sportId, occurred, racquet: !!canonical, chess: isChessSport(sportName),
      singleOutcome: (side) => outcomeForFixture(fx, side),
    });
  }

  // ---- the stat line, per family --------------------------------------------
  //
  // Racquet folds the rally log THROUGH THE KERNEL, because crediting a service
  // point to the right person in doubles needs the serve resolver, and that needs
  // the state as it was before each rally.
  //
  // Every other team sport folds the same log by ATTRIBUTION instead: the console
  // records "goal, by Aarav, assisted by Kabir" and the registry says what metrics
  // that produces. Without this branch the taps were captured and then dropped -
  // `stats` stayed empty for twenty-one sports, every column of their typed detail
  // table stayed at zero, and a player's own match page said nothing was recorded.
  let statOf: (userId: string) => Record<string, number> = () => ({});
  let format: ScoringFormat | null = null;
  const log = rallyOf(fx.live_state);

  if (canonical) {
    const frozen = parseStoredFormat((fx.live_state as { format?: unknown } | null)?.format);
    format = frozen ?? resolveFormat(
      { round: fx.round, stage_sequence: fx.stage_sequence, frozen_format: frozen },
      { sport: sportName },
    ).format;
    if (format && log.length > 0) {
      const derived = deriveRacquetStats(format, log, { pairing, firstServer: firstServerOf(fx.live_state) });
      statOf = (userId) => derived.players.find((x) => x.userId === userId)?.stats ?? {};
    }
  } else {
    // The scoreline goes in too, because seven sports record no per-player actions
    // and their statistic IS the result. `roster` is everybody on the two team
    // sheets, so each of them gets a line rather than only whoever was tapped.
    const derived = deriveTeamStats(sportName, log, {
      sideOf,
      result: { home: fx.home_score, away: fx.away_score, winner: winnerSide() },
      roster: people.map((p) => ({ userId: p.user_id, side: sideOf.get(p.user_id)! })),
    });
    statOf = (userId) => derived.players.find((x) => x.userId === userId)?.stats ?? {};
    // Chess: every game of the match, each with its colour and ending - so a three-game
    // match is three results in the career, not one. The line's single `colour` is
    // only set for a one-game match, where there is one colour to name.
    const raw = (fx.live_state as { chess?: { games?: unknown } } | null)?.chess?.games;
    const games = isChessSport(sportName) && Array.isArray(raw)
      ? (raw as ChessGame[]).filter((g) => g && (g.result === 'A' || g.result === 'B' || g.result === 'draw'))
      : [];
    if (games.length) {
      const base = statOf;
      const white = games.length === 1 ? games[0].white : null;
      statOf = (userId) => {
        const side = sideOf.get(userId);
        if (!side) return base(userId);
        return {
          ...base(userId),
          ...chessLineStats(games, side),
          ...(white === 'A' || white === 'B' ? { [side === white ? 'as_white' : 'as_black']: 1 } : {}),
        };
      };
    }
  }

  const outcomeFor = (side: Side) => outcomeForFixture(fx, side);

  const rows: PlayerStatRow[] = [];
  for (const p of people) {
    const side = sideOf.get(p.user_id)!;
    const mates = pairing[side];
    // A PARTNER is a doubles concept. Now that `pairing` holds the whole team sheet
    // for a team sport, "more than one mate" is true for every footballer - so this
    // has to be gated on the sport, or an arbitrary team-mate would be recorded as
    // somebody's doubles partner.
    const partner = canonical && mates.length > 1
      ? (mates.find((m) => m !== p.user_id) ?? null)
      : null;
    rows.push({
      fixture_id: fx.id,
      user_id: p.user_id,
      team_id: p.team_id,
      organization_id: p.organization_id,
      sport_id: sportId,
      rubber_key: null,
      partner_user_id: partner,
      opponent_user_ids: null,
      // singles/doubles describes a RUBBER. A football team sheet has neither, and
      // labelling eleven players "singles" was simply false.
      position: canonical ? (mates.length > 1 ? 'doubles' : 'singles') : null,
      role: 'player',
      // A person on the roster who took no part in a RUBBER has not played - without
      // this every squad member would collect an appearance for a match they
      // watched, and every per-match average would be wrong.
      //
      // For a team sport the team sheet IS the appearance record, because the
      // platform has no lineup or substitution data to say otherwise. Stated rather
      // than implied: if lineups arrive later, this is the line that narrows.
      played: mates.includes(p.user_id),
      outcome: outcomeFor(side),
      stats: statOf(p.user_id),
      occurred_on: occurred,
      lock_version: fx.lock_version,
    });
  }
  return rows;
}

/** The fixture's result for one side. Prefers the persisted winner; falls back to the score. */
function outcomeForFixture(fx: StatFixture, side: Side): MatchOutcome | null {
  const teamId = side === 'A' ? fx.home_team_id : fx.away_team_id;
  if (fx.winner_team_id) return fx.winner_team_id === teamId ? 'won' : 'lost';
  if (fx.home_score != null && fx.away_score != null) {
    if (fx.home_score === fx.away_score) return 'drew';
    const homeWon = fx.home_score > fx.away_score;
    return (side === 'A') === homeWon ? 'won' : 'lost';
  }
  return null;
}

/**
 * One line per player per contest they played, plus a bare "did not play" line for
 * the rest of the squad. A tie rubber carries its key, so a player in two rubbers has
 * two lines - the (fixture, user, rubber) unique index was built for exactly this.
 */
function contestRows(
  fx: StatFixture,
  contests: PlayedContest[],
  people: FixtureParticipants['resolved'],
  sideOf: Map<string, Side>,
  opts: { sportId: string | null; occurred: Date; racquet: boolean; chess?: boolean; singleOutcome: (side: Side) => MatchOutcome | null },
): PlayerStatRow[] {
  // A chess board's line IS its result: half-points doubled (2 win, 1 draw, 0 loss),
  // the board it was played on, and the colour when the tie recorded one.
  const chessStats = (c: PlayedContest, side: Side): Record<string, number> => {
    const won = c.winner === side;
    // A board is one game: the same per-game counters a single match writes.
    const stats: Record<string, number> = {
      result_points_x2: c.drawn ? 1 : won ? 2 : 0,
      ...chessLineStats([{ result: c.drawn ? 'draw' : c.winner!, white: c.white, ending: c.ending }], side),
    };
    if (c.order) stats.board_no = c.order;
    if (c.white) stats[c.white === side ? 'as_white' : 'as_black'] = 1;
    return stats;
  };
  const byUser = new Map(people.map((p) => [p.user_id, p]));
  const rows: PlayerStatRow[] = [];
  const playedSomething = new Set<string>();

  for (const c of contests) {
    // Racquet stats come from the contest's own rally log, through the kernel, with
    // the named players as the pairing - so service points land on the right person.
    const derived = opts.racquet && c.format && c.log.length
      ? deriveRacquetStats(c.format, c.log, { pairing: c.lineup, firstServer: c.firstServer })
      : null;
    for (const userId of [...c.lineup.A, ...c.lineup.B]) {
      const p = byUser.get(userId);
      const seat = seatIn(c, userId);
      if (!p || !seat) continue;
      playedSomething.add(userId);
      rows.push({
        fixture_id: fx.id,
        user_id: userId,
        team_id: p.team_id,
        organization_id: p.organization_id,
        sport_id: opts.sportId,
        rubber_key: c.rubberKey,
        partner_user_id: seat.partner,
        opponent_user_ids: seat.opponents,
        position: seat.position,
        role: 'player',
        played: true,
        outcome: c.rubberKey === null
          ? opts.singleOutcome(seat.side)
          : c.winner ? (c.winner === seat.side ? 'won' : 'lost') : c.drawn ? 'drew' : null,
        stats: opts.chess && (c.winner || c.drawn)
          ? chessStats(c, seat.side)
          : derived?.players.find((x) => x.userId === userId)?.stats ?? {},
        occurred_on: opts.occurred,
        lock_version: fx.lock_version,
      });
    }
  }

  // The rest of the squad was there but did not play: an appearance-free line, so the
  // squad stays visible without anyone collecting a result they did not earn.
  for (const p of people) {
    if (playedSomething.has(p.user_id) || !sideOf.has(p.user_id)) continue;
    rows.push({
      fixture_id: fx.id, user_id: p.user_id, team_id: p.team_id, organization_id: p.organization_id,
      sport_id: opts.sportId, rubber_key: null, partner_user_id: null, opponent_user_ids: null,
      position: null, role: 'player', played: false, outcome: null, stats: {},
      occurred_on: opts.occurred, lock_version: fx.lock_version,
    });
  }
  return rows;
}

/**
 * Replace this fixture's stat lines. Delete-then-insert rather than upsert: after a
 * correction that removes a player, an upsert would leave their row behind, and a
 * stat line for somebody who did not play reads as a bug.
 */
export async function writePlayerMatchStats(
  db: Db, fixtureId: string, participants: FixtureParticipants,
): Promise<number> {
  const rows = await buildPlayerStatRows(db, fixtureId, participants);
  // The detail rows cascade from the spine, so deleting the spine clears them too -
  // no separate cleanup, and no window in which detail outlives its parent.
  await db.$executeRaw`delete from player_match_stats where fixture_id = ${fixtureId}::uuid`;

  const sportName = rows.length ? await sportNameOf(db, fixtureId) : null;
  const details: CategoryLineInput[] = [];

  for (const r of rows) {
    // `returning id` rather than a second lookup: the typed detail row hangs off
    // this exact spine row, and re-finding it by (fixture, user, rubber) would
    // depend on a uniqueness Postgres cannot enforce over a nullable rubber_key.
    const [inserted] = await db.$queryRaw<Array<{ id: string }>>`
      insert into player_match_stats
        (fixture_id, user_id, team_id, organization_id, sport_id, rubber_key,
         partner_user_id, opponent_user_ids, position, role, played, outcome, stats, occurred_on,
         source, lock_version)
      values
        (${r.fixture_id}::uuid, ${r.user_id}::uuid, ${r.team_id}::uuid,
         ${r.organization_id}::uuid, ${r.sport_id}::uuid, ${r.rubber_key},
         ${r.partner_user_id}::uuid, ${r.opponent_user_ids}::uuid[], ${r.position}, ${r.role}, ${r.played},
         ${r.outcome}, ${JSON.stringify(r.stats)}::jsonb, ${r.occurred_on}::date,
         'locked_result', ${r.lock_version})
      returning id`;
    // Only somebody who actually played gets a detail row. A row of zeroes for a
    // substitute who never came on is indistinguishable from a bad one.
    if (inserted && r.played) {
      details.push({
        lineId: inserted.id,
        sport: sportName,
        stats: r.stats,
        extra: { rubber_key: r.rubber_key, partner_user_id: r.partner_user_id, position: r.position },
      });
    }
  }

  // The typed rows are the truth and `stats` is the cache over them, so the cache
  // is written first and the truth second: if this throws, the next lock repairs it.
  if (details.length) await writeCategoryLines(db, details);
  return rows.length;
}

/** The sport this fixture belongs to, for routing a stat bag to its detail table. */
async function sportNameOf(db: Db, fixtureId: string): Promise<string | null> {
  const fx = await db.fixtures.findUnique({
    where: { id: fixtureId },
    select: {
      tournament_disciplines: {
        select: { tournament_sports: { select: { sports: { select: { name: true } } } } },
      },
    },
  });
  return fx?.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
}

/**
 * Unlock: retire what this lock version said rather than deleting it, mirroring
 * supersedeLifetimeEntries. A withdrawn result is a fact the record keeps.
 */
export async function supersedePlayerMatchStats(
  db: Db, fixtureId: string, lockVersion: number,
): Promise<void> {
  await db.$executeRaw`
    update player_match_stats
    set superseded_at = now()
    where fixture_id = ${fixtureId}::uuid
      and superseded_at is null
      and (lock_version is null or lock_version <= ${lockVersion})`;
}

// ---- career fold -----------------------------------------------------------

/**
 * Fold a person's live stat lines into career_stats.stats, per (sport, grain). Runs
 * beside the existing recompute rather than inside it, so the three typed grains
 * career-stats.service.ts already writes stay exactly as they are.
 */
/**
 * How many MATCHES a cricketer has played at one tier, and their per-innings lines.
 *
 * Read straight from the typed tables rather than from `player_match_stats.stats`,
 * which holds a per-match summary. An average of averages is not an average, and a
 * career strike rate has to come from total runs over total balls or it is a
 * different number entirely - so the whole career is refolded from source every time.
 *
 * The tier filter is `entry_level`: entries that are whole organisations are
 * inter-institution, anything else is intra. Absent counts as inter, which is what an
 * ordinary championship is.
 */
async function writeCricketCareerBag(
  db: Db, userId: string, organizationId: string, sportId: string, tier: string,
): Promise<number> {
  const wantIntra = tier === 'intra';
  const anyTier = tier === 'all';

  // One statement per table, each scoped to this person, this sport and this tier.
  // `$queryRaw` with a boolean guard rather than string-built SQL: the tier is ours,
  // but building predicates by concatenation is how a safe query stops being one.
  const lines = await db.$queryRaw<Array<{
    kind: 'bat' | 'bowl' | 'field'; fixture_id: string; innings: number;
    a: number; b: number; c: number; d: number; e: number; f: number; g: string | null;
  }>>`
    with mine as (
      select m.id, m.fixture_id,
             coalesce(ch.entry_level, 'organization') = 'organization' as is_inter
      from player_match_stats m
      join fixtures f on f.id = m.fixture_id
      join tournament_disciplines td on td.id = f.tournament_discipline_id
      join tournament_sports ts on ts.id = td.tournament_sport_id
      join tournaments t on t.id = ts.tournament_id
      join championships ch on ch.id = t.championship_id
      where m.user_id = ${userId}::uuid
        and m.organization_id = ${organizationId}::uuid
        and m.sport_id = ${sportId}::uuid
        and m.superseded_at is null
        and m.played = true
    ), scoped as (
      select * from mine
      where ${anyTier} or is_inter = ${!wantIntra}
    )
    select 'bat' as kind, s.fixture_id, b.innings,
           b.runs as a, b.balls_faced as b, b.fours as c, b.sixes as d,
           0 as e, 0 as f, b.dismissal as g
    from scoped s join cricket_batting_lines b on b.line_id = s.id
    union all
    select 'bowl', s.fixture_id, w.innings,
           w.balls_bowled, w.maidens, w.runs_conceded, w.wickets, 0, 0, null
    from scoped s join cricket_bowling_lines w on w.line_id = s.id
    union all
    select 'field', s.fixture_id, l.innings,
           l.catches, l.stumpings, l.run_outs, 0, 0, 0, null
    from scoped s join cricket_fielding_lines l on l.line_id = s.id`;

  if (!lines.length) return 0;

  const batting: BattingRow[] = [];
  const bowling: BowlingRow[] = [];
  const fielding: FieldingRow[] = [];
  const fixtures = new Set<string>();

  for (const r of lines) {
    fixtures.add(r.fixture_id);
    if (r.kind === 'bat') {
      batting.push({
        userId, innings: r.innings, batPosition: 0,
        runs: r.a, ballsFaced: r.b, fours: r.c, sixes: r.d,
        dismissal: (r.g ?? 'not_out') as BattingRow['dismissal'],
        bowlerId: null, fielderId: null,
      });
    } else if (r.kind === 'bowl') {
      bowling.push({
        userId, innings: r.innings, ballsBowled: r.a, maidens: r.b,
        runsConceded: r.c, wickets: r.d, wides: 0, noBalls: 0, dots: 0,
      });
    } else {
      fielding.push({ userId, innings: r.innings, catches: r.a, stumpings: r.b, runOuts: r.c, drops: 0 });
    }
  }

  // MATCHES, not innings. A Test appearance is two innings of each and one match,
  // and the fold is told the count rather than guessing it from the rows.
  const career = foldCricketCareer(fixtures.size, batting, bowling, fielding);

  return db.$executeRaw`
    update career_stats
    set stats = ${JSON.stringify(cricketCareerBag(career))}::jsonb
    where user_id = ${userId}::uuid
      and organization_id = ${organizationId}::uuid
      and sport_id = ${sportId}::uuid
      and grain = 'sport'
      and tier = ${tier}`;
}

export async function recomputeCareerStatBags(
  db: Db, userId: string, organizationId: string,
): Promise<number> {
  // The championship's entry_level travels with each row, because it is what decides
  // the TIER - a hundred against another institution and a hundred in an
  // inter-department game are not the same hundred, and adding them together is the
  // one thing a career record must not do.
  const rows = await db.$queryRaw<Array<{
    sport_id: string | null; sport: string | null; stats: unknown; entry_level: string | null; position: string | null;
  }>>`
    select p.sport_id, s.name as sport, p.stats, c.entry_level, p.position
    from player_match_stats p
    left join sports s on s.id = p.sport_id
    left join fixtures f on f.id = p.fixture_id
    left join tournament_disciplines td on td.id = f.tournament_discipline_id
    left join tournament_sports ts on ts.id = td.tournament_sport_id
    left join tournaments t on t.id = ts.tournament_id
    left join championships c on c.id = t.championship_id
    where p.user_id = ${userId}::uuid
      and p.organization_id = ${organizationId}::uuid
      and p.superseded_at is null
      and p.played = true
    limit 5000`;

  // Keyed by sport AND tier. Each row also goes into the 'all' rollup, which is
  // stored rather than summed on read so no consumer has to re-implement it.
  // A singles or doubles line also folds into its own position bucket (the career's
  // singles / doubles split), beside the whole-sport one.
  type BagBucket = { sportId: string; sport: string | null; tier: string; position: string | null; bags: Record<string, number>[] };
  const buckets = new Map<string, BagBucket>();
  for (const r of rows) {
    if (!r.sport_id) continue;
    const bag = (r.stats ?? {}) as Record<string, number>;
    const position = r.position === 'singles' || r.position === 'doubles' ? r.position : null;
    for (const tier of [competitionTier(r.entry_level), 'all']) {
      for (const pos of position ? [null, position] : [null]) {
        const k = `${r.sport_id}|${tier}|${pos ?? ''}`;
        const e = buckets.get(k) ?? { sportId: r.sport_id, sport: r.sport, tier, position: pos, bags: [] };
        e.bags.push(bag);
        buckets.set(k, e);
      }
    }
  }

  let written = 0;
  const { foldCareerStats } = await import('@semp/shared');
  for (const { sportId, sport, tier, position, bags } of buckets.values()) {
    if (position) {
      const spec = statSpecFor(sport);
      if (!spec) continue;
      written += await db.$executeRaw`
        update career_stats
        set stats = ${JSON.stringify(foldCareerStats(spec, bags))}::jsonb
        where user_id = ${userId}::uuid
          and organization_id = ${organizationId}::uuid
          and sport_id = ${sportId}::uuid
          and grain = 'position'
          and position = ${position}
          and tier = ${tier}`;
      continue;
    }
    // CRICKET HAS NO STAT SPEC, and correctly so: its figures come from three typed
    // tables rather than from an attributed event log, so there is no event->metric
    // mapping to fold. Without this branch `statSpecFor` returned undefined and the
    // loop skipped it - every cricket career row had an empty bag, and a batter with
    // a hundred to their name saw a profile carrying no runs, no average and no
    // strike rate at all.
    if (isCricketSport(sport)) {
      written += await writeCricketCareerBag(db, userId, organizationId, sportId, tier);
      continue;
    }
    const spec = statSpecFor(sport);
    if (!spec) continue;
    const folded = foldCareerStats(spec, bags);
    // Only the 'sport' grain carries the bag: discipline and format grains would
    // fragment a career total into slices nobody has asked for yet, and an empty
    // jsonb on every row is noise.
    const n = await db.$executeRaw`
      update career_stats
      set stats = ${JSON.stringify(folded)}::jsonb
      where user_id = ${userId}::uuid
        and organization_id = ${organizationId}::uuid
        and sport_id = ${sportId}::uuid
        and grain = 'sport'
        and tier = ${tier}`;
    written += n;
  }
  return written;
}
