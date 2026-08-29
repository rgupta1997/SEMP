import type { Db } from '../../infra/prisma.js';
import type { FixtureParticipants } from '../fixtures/participants.js';
import { deriveRecords, type DerivableAward, type DerivableFixture, type DerivableParticipant } from './derive.js';


// Writing the permanent record, inside the lock's transaction (J4-E2, J4-E4).
//
// `derive.ts` decides WHAT a locked result means; this file is the only part that
// touches the database. Both halves run on the transaction client the lock hands
// down, so a medal that cannot be written is a lock that did not happen.
//
// THE CORRECTION MODEL, which is the part worth being careful about:
//
//   lock v0    → write entries + achievements stamped lock_version = 0
//   unlock     → supersede everything from v0; the card returns to `submitted`
//   relock v1  → write a fresh set stamped lock_version = 1
//
// Nothing is ever deleted. A superseded row keeps its `superseded_at` stamp and
// stays queryable, so "this player's bronze was withdrawn after a protest" is a
// fact the database still holds rather than an absence nobody can explain. Every
// read filters `superseded_at is null`.
//
// Writes are also made idempotent at the schema level - a partial unique index
// per (subject, fixture, kind, title) over live rows only. Two organisers hitting
// Lock at the same moment collide on the index instead of quietly doubling
// somebody's medal count, and the loser's transaction rolls back whole.

/** Everything the derivation needs, in one query. */
export const FIXTURE_FOR_RECORDS = {
  select: {
    id: true, round: true, status: true, scheduled_at: true, updated_at: true,
    home_team_id: true, away_team_id: true, home_score: true, away_score: true,
    winner_team_id: true, live_state: true, lock_version: true,
    teams_fixtures_home_team_idToteams: { select: { name: true } },
    teams_fixtures_away_team_idToteams: { select: { name: true } },
    tournament_disciplines: {
      select: {
        format_config: true,
        disciplines: { select: { name: true } },
        tournament_sports: {
          select: {
            sports: { select: { id: true, name: true } },
            tournaments: { select: { championship_id: true, championships: { select: { name: true } } } },
          },
        },
      },
    },
  },
} as const;

/**
 * The date a record says it happened on.
 *
 * A permanent record must not be dated "whenever the organiser got round to
 * locking it" - a tournament locked three weeks late would otherwise scatter a
 * player's timeline. The fixture's own schedule is the truth; the lock time is
 * only the fallback when it never had one.
 */
export function occurredOn(fx: { scheduled_at: Date | null; updated_at: Date | null }): Date {
  const d = fx.scheduled_at ?? fx.updated_at ?? new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Flatten a fixture row selected with `FIXTURE_FOR_RECORDS` into the shape the
 * derivation takes.
 *
 * Exported because the provisional view runs the SAME derivation over fixtures
 * that are not locked yet. That is what makes a provisional row and the verified
 * row that replaces it word-for-word identical - locking changes the badge, not
 * the sentence.
 */
export function toDerivableFixture(fx: any): DerivableFixture {
  const ts = fx.tournament_disciplines?.tournament_sports;
  return {
    id: fx.id,
    round: fx.round,
    status: fx.status,
    home_team_id: fx.home_team_id,
    away_team_id: fx.away_team_id,
    home_team_name: fx.teams_fixtures_home_team_idToteams?.name ?? null,
    away_team_name: fx.teams_fixtures_away_team_idToteams?.name ?? null,
    home_score: fx.home_score,
    away_score: fx.away_score,
    winner_team_id: fx.winner_team_id,
    occurred_on: occurredOn(fx),
    lock_version: fx.lock_version,
    championship_id: ts?.tournaments?.championship_id ?? null,
    championship_name: ts?.tournaments?.championships?.name ?? null,
    sport_id: ts?.sports?.id ?? null,
    sport_name: ts?.sports?.name ?? null,
    discipline_name: fx.tournament_disciplines?.disciplines?.name ?? null,
    format_config: fx.tournament_disciplines?.format_config ?? null,
    live_state: fx.live_state,
  };
}

/** Resolve award rows to catalogue labels in one round trip. */
export async function toDerivableAwards(
  db: Db,
  rows: Array<{ recipient_user_id: string; award_name: string; award_type_id: string | null }>,
): Promise<DerivableAward[]> {
  const typeIds = [...new Set(rows.map((a) => a.award_type_id).filter((x): x is string => !!x))];
  const types = typeIds.length
    ? await db.award_types.findMany({ where: { id: { in: typeIds } }, select: { id: true, code: true, label: true } })
    : [];
  const typeById = new Map(types.map((t) => [t.id, t]));
  return rows.map((a) => {
    const t = a.award_type_id ? typeById.get(a.award_type_id) : undefined;
    return {
      recipient_user_id: a.recipient_user_id,
      award_name: a.award_name,
      award_type_code: t?.code ?? null,
      award_type_label: t?.label ?? null,
    };
  });
}

async function snapshot(db: Db, fixtureId: string): Promise<{ fixture: DerivableFixture; awards: DerivableAward[] } | null> {
  const fx = await db.fixtures.findUnique({ where: { id: fixtureId }, ...FIXTURE_FOR_RECORDS });
  if (!fx) return null;

  const awardRows = await db.fixture_awards.findMany({
    where: { fixture_id: fixtureId },
    select: { recipient_user_id: true, award_name: true, award_type_id: true },
  });

  return {
    fixture: toDerivableFixture(fx),
    awards: await toDerivableAwards(db, awardRows),
  };
}

const asDerivable = (p: FixtureParticipants['resolved'][number]): DerivableParticipant => ({
  user_id: p.user_id,
  team_id: p.team_id,
  organization_id: p.organization_id,
  competitor_id: p.competitor_id,
  name: p.name,
});

/**
 * Retire the live rows one table holds for a fixture.
 *
 * Used on unlock (retire what the corrected version said) and defensively at the
 * head of a fresh write. `lockVersion` narrows it to one generation when the
 * caller knows which; without it every live row for the fixture is retired -
 * which is what makes re-locking safe whatever state a previous half-finished
 * attempt left behind.
 */
const supersedeWhere = (fixtureId: string, lockVersion?: number) => ({
  fixture_id: fixtureId,
  superseded_at: null,
  ...(lockVersion == null ? {} : { lock_version: lockVersion }),
});

export async function supersedeLifetimeEntries(db: Db, fixtureId: string, lockVersion?: number): Promise<void> {
  await db.lifetime_entries.updateMany({
    where: supersedeWhere(fixtureId, lockVersion),
    data: { superseded_at: new Date() },
  });
}

export async function supersedeAchievements(db: Db, fixtureId: string, lockVersion?: number): Promise<void> {
  await db.achievements.updateMany({
    where: supersedeWhere(fixtureId, lockVersion),
    data: { superseded_at: new Date() },
  });
}

/**
 * Derive both halves of the record from the fixture as it stands right now.
 *
 * Called once per table rather than once per lock, on purpose. The two writers
 * stay independently failure-injectable - which is what the lock's atomicity
 * tests actually assert - and the extra cost is one fixture read inside a
 * transaction that is already reading it. Determinism is what keeps the two
 * calls in agreement: `deriveRecords` is pure, and inside one transaction both
 * calls see the same snapshot, so the chip on a timeline entry and the
 * achievement row it mirrors are computed from identical inputs.
 */
async function derive(db: Db, fixtureId: string, participants: FixtureParticipants) {
  const snap = await snapshot(db, fixtureId);
  if (!snap) return null;
  return {
    fixture: snap.fixture,
    ...deriveRecords({
      fixture: snap.fixture,
      participants: participants.resolved.map(asDerivable),
      awards: snap.awards,
    }),
  };
}

/** Columns every record carries, whichever table it lands in. */
const commonOf = (fixture: DerivableFixture) => ({
  championship_id: fixture.championship_id,
  fixture_id: fixture.id,
  sport_id: fixture.sport_id,
  occurred_on: fixture.occurred_on,
  source: 'locked_result',
  lock_version: fixture.lock_version,
});

/** The timeline for a fixture that has just been locked (J4-E2). */
export async function writeLifetimeEntriesFor(db: Db, fixtureId: string, participants: FixtureParticipants): Promise<void> {
  const derived = await derive(db, fixtureId, participants);
  if (!derived || derived.entries.length === 0) return;

  // Retire anything still live from an earlier attempt before writing. An unlock
  // has already done this for its own version; this covers the cases where it
  // did not (an interrupted deploy, a hand-run backfill) so a relock repairs the
  // record instead of colliding with it.
  await supersedeLifetimeEntries(db, fixtureId);

  await db.lifetime_entries.createMany({
    data: derived.entries.map((e) => ({
      ...commonOf(derived.fixture),
      organization_id: e.organization_id,
      user_id: e.user_id,
      kind: e.kind,
      title: e.title,
      detail: e.detail as object,
    })),
  });
}

/**
 * The typed, countable medals / placements / awards (J4-E4).
 *
 * Returns who should be told about a new achievement, rather than notifying
 * here directly - this runs inside the scorecard lock's transaction (which
 * Prisma caps at 5s), and notify() is its own handful of sequential queries
 * per recipient. Firing it here was what actually pushed a real lock over
 * that timeout, not connection flakiness - lock.service.ts is the one place
 * that knows when the transaction has ACTUALLY committed, and this file's own
 * notifyParticipants already does exactly that for the same reason: "a
 * notification sent inside the transaction would survive a failure that undid
 * the very thing it announces."
 */
export async function writeAchievementsFor(
  db: Db, fixtureId: string, participants: FixtureParticipants,
): Promise<Array<{ user_id: string; title: string }>> {
  const derived = await derive(db, fixtureId, participants);
  if (!derived || derived.achievements.length === 0) return [];

  await supersedeAchievements(db, fixtureId);

  await db.achievements.createMany({
    data: derived.achievements.map((a) => ({
      ...commonOf(derived.fixture),
      organization_id: a.organization_id,
      user_id: a.user_id,
      team_id: a.team_id,
      kind: a.kind,
      medal: a.medal,
      title: a.title,
      detail: a.detail as object,
    })),
  });

  return derived.achievements
    .filter((a): a is typeof a & { user_id: string } => !!a.user_id)
    .map((a) => ({ user_id: a.user_id, title: a.title }));
}
