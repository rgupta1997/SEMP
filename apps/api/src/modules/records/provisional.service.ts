import type { Db } from '../../infra/prisma.js';
import { deriveRecords, type DerivableParticipant } from './derive.js';
import { FIXTURE_FOR_RECORDS, toDerivableAwards, toDerivableFixture } from './records.service.js';

// The provisional half of a player's timeline.
//
// A record built only from locked results is the correct promise, and on its own
// it is also a bad page: until an organiser gets into the habit of locking, a
// player who has played all season opens their record to nothing. So the timeline
// shows both, and the badge is what separates them - Verified for a locked
// result, Provisional for one that has been played but not made official.
//
// The key property: a provisional row is produced by the SAME pure derivation
// that writes the permanent one. Same title, same chips, same wording. Locking
// changes the badge and nothing else, so a player never sees the sentence
// describing their match quietly change underneath them.
//
// Nothing here is written. These rows are computed on read and vanish the moment
// the fixture locks (the real row takes over), which is why they can never be
// mistaken for the record: they have no id in `lifetime_entries` at all.

export interface ProvisionalEntry {
  id: string;
  date: Date;
  kind: string;
  title: string;
  detail: Record<string, unknown>;
  organization_id: string | null;
  championship_id: string | null;
  fixture_id: string;
  sport_id: string | null;
  verified: false;
}

// A fixture counts as played once it has an outcome, not merely a date.
//
// Kept inside an explicit `AND` rather than spread alongside the team clause:
// two sibling `OR` keys in one Prisma where silently overwrite each other, and
// the survivor here would have been "any played fixture", returning the whole
// platform's results on every player's profile.
const PLAYED = {
  OR: [
    { status: { in: ['completed', 'walkover', 'bye'] } },
    { home_score: { not: null } },
    { away_score: { not: null } },
  ],
};

/**
 * Everything this person has played that is not yet official.
 *
 * Team matches only, deliberately. A ranking-event competitor is linked to their
 * result by a phone number inside `live_state` JSON, and matching that on a hot
 * profile read would mean scanning every unlocked event fixture on the platform.
 * Their results appear the moment the scorecard is locked, which is when that
 * match is done properly, once, inside the lock transaction (J4-E1-S3).
 */
export async function provisionalEntriesFor(db: Db, userId: string, limit = 200): Promise<ProvisionalEntry[]> {
  const memberships = await db.team_members.findMany({
    where: { user_id: userId, is_active: true },
    select: { team_id: true, teams: { select: { organization_id: true } }, users: { select: { name: true } } },
  });
  if (memberships.length === 0) return [];

  const teamIds = memberships.map((m) => m.team_id);
  const orgOfTeam = new Map(memberships.map((m) => [m.team_id, m.teams?.organization_id ?? null]));
  const name = memberships[0]?.users?.name ?? '';

  const fixtures = await db.fixtures.findMany({
    where: {
      scorecard_status: { not: 'locked' },
      AND: [
        { OR: [{ home_team_id: { in: teamIds } }, { away_team_id: { in: teamIds } }] },
        PLAYED,
      ],
    },
    orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    take: limit,
    ...FIXTURE_FOR_RECORDS,
  });
  if (fixtures.length === 0) return [];

  // One query for every award across every fixture - the alternative is one per
  // fixture, and a season is a lot of fixtures.
  const awardRows = await db.fixture_awards.findMany({
    where: { fixture_id: { in: fixtures.map((f) => f.id) }, recipient_user_id: userId },
    select: { fixture_id: true, recipient_user_id: true, award_name: true, award_type_id: true },
  });
  const awards = await toDerivableAwards(db, awardRows);
  const awardsByFixture = new Map<string, typeof awards>();
  awardRows.forEach((row, i) => {
    awardsByFixture.set(row.fixture_id, [...(awardsByFixture.get(row.fixture_id) ?? []), awards[i]]);
  });

  const out: ProvisionalEntry[] = [];
  for (const row of fixtures) {
    const fx = toDerivableFixture(row);
    // Must be a team of THEIRS on one side or the other. Falling back to the
    // away team when neither matches would file someone else's match on this
    // player's record - the query should never return one, but a record that
    // depends on a where clause staying correct is not a record.
    const teamId = teamIds.includes(fx.home_team_id ?? '') ? fx.home_team_id
      : teamIds.includes(fx.away_team_id ?? '') ? fx.away_team_id
        : null;
    if (!teamId) continue;

    const participant: DerivableParticipant = {
      user_id: userId,
      team_id: teamId,
      organization_id: orgOfTeam.get(teamId) ?? null,
      competitor_id: null,
      name,
    };

    // Only the timeline entry is taken. The achievements this WOULD produce are
    // deliberately discarded: an unlocked final must not put a gold medal on
    // anybody's honours list or into a countable total.
    const { entries } = deriveRecords({
      fixture: fx,
      participants: [participant],
      awards: awardsByFixture.get(fx.id) ?? [],
    });
    const entry = entries[0];
    if (!entry) continue;

    out.push({
      // Prefixed so a client can never confuse it with a `lifetime_entries` id,
      // and so React keys stay stable as rows flip to verified.
      id: `provisional:${fx.id}`,
      date: fx.occurred_on,
      kind: entry.kind,
      title: entry.title,
      // Chips are stripped, not merely left unwritten. `deriveRecords` bakes the
      // medal it derived straight into `detail.chips`, so discarding the
      // `achievements` array is NOT enough - without this line a won final that
      // no organiser has locked shows a gold medal on the player's profile.
      detail: { ...entry.detail, chips: [] },
      organization_id: entry.organization_id,
      championship_id: fx.championship_id,
      fixture_id: fx.id,
      sport_id: fx.sport_id,
      verified: false,
    });
  }
  return out;
}
