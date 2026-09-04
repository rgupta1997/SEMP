import {
  canonicalRacquetSport, deriveRacquetStats, diffStats, isReconstructable,
  parseStoredFormat, rallyLogToRows, readFirstServer, readRallyLog, resolveFormat,
  rowsToRallyLog, statSpecFor, type Pairing, type ScoringFormat, type Side,
} from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import type { FixtureParticipants } from '../fixtures/participants.js';

// ============================================================================
// The fact table, and how to check the stats against it.
//
// `fixture_events` has existed since 20260627000000 and never had a writer - its own
// migration header promised "a small writer (mirror live_log -> fixture_events on
// sign-off) lands with the wiring", and it did not. So the event-by-event record
// lived only in `fixtures.live_state.rally`: one jsonb blob per fixture, from which
// the stats were derived directly.
//
// THREE LAYERS, ONE OF WHICH IS AUTHORITATIVE:
//
//   fixture_events        the facts. One row per action. Typed, indexed, QUERYABLE.
//   player_match_stats    derived per person per match. jsonb, recomputable.
//   career_stats.stats    derived per person. jsonb, recomputable.
//
// jsonb is right for the derived layers precisely BECAUSE they are derived: a bag
// rebuilt from facts is a cache, and a wrong cache is repaired by recomputing.
// jsonb for the FACTS would be unverifiable - which is what this closes.
//
// `verifyPlayerStats` is the payoff and the answer to "how do we check this later":
// rebuild the log from the ROWS, re-derive through the same kernel, and compare with
// what was stored. Two independent paths to the same numbers. Against a blob there
// is nothing to compare against.
// ============================================================================

interface EventFixture {
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

/** The format a fixture was PLAYED under - frozen at first score, never re-resolved. */
function formatOf(fx: EventFixture): ScoringFormat | null {
  const sportName = fx.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
  const frozen = parseStoredFormat((fx.live_state as { format?: unknown } | null)?.format);
  return frozen ?? resolveFormat({ frozen_format: frozen }, { sport: sportName }).format;
}

/** Who played for which side, from the participants the lock already resolved. */
function pairingOf(fx: EventFixture, participants: FixtureParticipants): Pairing {
  const A: string[] = [];
  const B: string[] = [];
  for (const p of participants.resolved) {
    if (p.team_id && p.team_id === fx.home_team_id) { if (A.length < 2) A.push(p.user_id); }
    else if (p.team_id && p.team_id === fx.away_team_id) { if (B.length < 2) B.push(p.user_id); }
  }
  return { A, B };
}

/**
 * Mirror the rally log into `fixture_events`.
 *
 * REPLACE-ALL per fixture, so a re-submission or a correction is idempotent rather
 * than doubling the match.
 *
 * TWO SOURCES, one table. The racquet family folds its rally log, which IS the
 * whole record of what happened. Every other family reads the console's attributed
 * events - a goal, a raid, a card - because no amount of folding a score can say
 * WHICH PERSON scored it.
 */
export async function writeFixtureEvents(
  db: Db, fixtureId: string, participants: FixtureParticipants,
): Promise<number> {
  const fx = await db.fixtures.findUnique({
    where: { id: fixtureId },
    select: { ...FIXTURE_SELECT, live_log: true },
  }) as (EventFixture & { live_log: unknown }) | null;
  // Clear first regardless: a match rescored down to nothing must not keep the rows
  // from the version before it.
  await db.$executeRaw`delete from fixture_events where fixture_id = ${fixtureId}::uuid`;
  if (!fx) return 0;

  const sportName = fx.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
  const rows = canonicalRacquetSport(sportName)
    ? racquetRows(fx, participants)
    // Every other family: the facts come from the console's attributed EVENTS
    // (a goal, a raid, a card) rather than from a rally log.
    : eventRows(fx, sportName, participants);
  if (!rows.length) return 0;

  for (const r of rows) {
    await db.$executeRaw`
      insert into fixture_events
        (fixture_id, rubber_key, team_side, event_key, label, points,
         player_user_id, second_user_id, segment, period_no, seq, metric_value, meta)
      values
        (${fixtureId}::uuid, ${r.rubber_key}, ${r.team_side}, ${r.event_key}, ${r.label},
         ${r.points}, ${r.player_user_id}::uuid, ${r.second_user_id}::uuid,
         ${r.segment}, ${r.period_no}, ${r.seq}, ${r.metric_value},
         ${JSON.stringify(r.meta)}::jsonb)`;
  }
  return rows.length;
}

/** Racquet family: fold the rally log, which IS the record of what happened. */
function racquetRows(fx: EventFixture, participants: FixtureParticipants) {
  const log = readRallyLog(fx.live_state);
  const format = formatOf(fx);
  if (!log.length || !format) return [];
  return rallyLogToRows(format, log, {
    pairing: pairingOf(fx, participants),
    firstServer: readFirstServer(fx.live_state),
  });
}

/** One entry of the console's human-readable timeline, as engine.ts writes it. */
interface TimelineEntry {
  t?: string;
  team?: Side;
  txt?: string;
  player?: string;
  playerId?: string;
  secondId?: string;
  secondName?: string;
  value?: number;
  kind?: string;
}

/**
 * Every other family: turn the console's attributed events into facts.
 *
 * Only entries carrying a `playerId` become rows, and that is the whole point -
 * `engine.ts` resolved the acting person to a real user id and then dropped it
 * before writing the log, so nothing here had anything to attribute. With the id
 * carried through, a kabaddi raid or a football goal is a queryable fact.
 *
 * An entry with no `kind` is narrative (a period change, a plain +1 tap) and is
 * deliberately skipped: a fact table of "something happened" answers nothing.
 */
function eventRows(fx: EventFixture & { live_log: unknown }, sportName: string | null, participants: FixtureParticipants) {
  const spec = statSpecFor(sportName);
  if (!spec) return [];
  const log = Array.isArray(fx.live_log) ? (fx.live_log as TimelineEntry[]) : [];
  if (!log.length) return [];

  // Only people actually on one of the two sides. An id from a stale roster must
  // not be written as though they played.
  const eligible = new Set(participants.resolved.map((p) => p.user_id));
  const byKey = new Map(spec.events.map((e) => [e.key, e]));

  // The console prepends (newest first); facts read forward in play order.
  const forward = [...log].reverse();
  const rows = [];
  let seq = 0;
  for (const e of forward) {
    if (!e.kind) continue;
    const ev = byKey.get(e.kind);
    if (!ev) continue;
    const player = e.playerId && eligible.has(e.playerId) ? e.playerId : null;
    // An event this sport declares as per-player, with nobody attributed, is
    // recorded anyway - "3 of 5 goals attributed" is a fixable state, and dropping
    // it would silently lose the goal itself.
    rows.push({
      rubber_key: null,
      team_side: e.team ?? null,
      event_key: e.kind,
      label: ev.label,
      points: ev.points ?? 0,
      player_user_id: player,
      second_user_id: e.secondId && eligible.has(e.secondId) ? e.secondId : null,
      segment: e.t ?? null,
      period_no: null,
      seq: seq++,
      metric_value: e.value ?? null,
      meta: {
        scored: (ev.points ?? 0) > 0 ? (e.team ?? null) : null,
        serverSide: null,
        serverNo: 1,
        courtHalf: null,
        atDeuce: false,
        inDecider: false,
        switchEnds: false,
        scoreAfter: [0, 0] as [number, number],
        unitsAfter: [0, 0] as [number, number],
        unitsWon: [],
        ...(e.player ? { reason: e.player } : {}),
      },
    });
  }
  return rows;
}

export interface StatVerification {
  fixtureId: string;
  /** Rows in the fact table. 0 means there is nothing to verify against. */
  events: number;
  /** False when the log holds a manual correction the rows cannot model. */
  reconstructable: boolean;
  /** Per-person drift between the stored stat line and a fresh recompute. */
  drift: Array<{
    userId: string;
    diffs: Array<{ metric: string; expected: number | undefined; actual: number | undefined }>;
  }>;
  ok: boolean;
  note?: string;
}

/**
 * Re-verify a fixture's statistics against the fact table.
 *
 * Rebuilds the rally log from `fixture_events`, re-derives the stats through the
 * same kernel, and compares field by field with `player_match_stats`. If they
 * disagree the stat line has drifted from the facts, and a recompute repairs it.
 */
export async function verifyPlayerStats(db: Db, fixtureId: string): Promise<StatVerification> {
  const out: StatVerification = { fixtureId, events: 0, reconstructable: true, drift: [], ok: true };

  const rows = await db.$queryRaw<Array<{
    event_key: string; team_side: Side | null; seq: number; meta: unknown;
  }>>`
    select event_key, team_side, seq, meta
    from fixture_events where fixture_id = ${fixtureId}::uuid order by seq asc`;
  out.events = rows.length;
  if (!rows.length) { out.note = 'No facts recorded for this fixture.'; return out; }

  const fx = await db.fixtures.findUnique({ where: { id: fixtureId }, select: FIXTURE_SELECT }) as EventFixture | null;
  const format = fx ? formatOf(fx) : null;
  if (!fx || !format) { out.note = 'No scoring format to verify against.'; return out; }

  const log = rowsToRallyLog(rows.map((r) => ({
    event_key: r.event_key, team_side: r.team_side, seq: r.seq, meta: (r.meta ?? {}) as never,
  })));
  out.reconstructable = isReconstructable(log);

  const stored = await db.$queryRaw<Array<{ user_id: string; team_id: string | null; stats: unknown }>>`
    select user_id, team_id, stats from player_match_stats
    where fixture_id = ${fixtureId}::uuid and superseded_at is null`;
  if (!stored.length) { out.note = 'No stat lines recorded for this fixture.'; return out; }

  // Sides come from the STORED lines, not re-derived: a roster change since the lock
  // must not silently move somebody between sides and manufacture a drift.
  const pairing: Pairing = { A: [], B: [] };
  for (const s of stored) {
    const side: Side = s.team_id === fx.away_team_id ? 'B' : 'A';
    if (pairing[side].length < 2) pairing[side].push(s.user_id);
  }

  const fresh = deriveRacquetStats(format, log, {
    pairing, firstServer: readFirstServer(fx.live_state),
  });
  for (const s of stored) {
    const line = fresh.players.find((x) => x.userId === s.user_id);
    if (!line) continue;
    const diffs = diffStats(line.stats, (s.stats ?? {}) as Record<string, number>);
    if (diffs.length) out.drift.push({ userId: s.user_id, diffs });
  }
  out.ok = out.drift.length === 0;
  if (!out.ok) out.note = 'Stored statistics disagree with the recorded facts - re-lock to recompute.';
  return out;
}
