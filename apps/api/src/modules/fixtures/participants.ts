import type { Db } from '../../infra/prisma.js';
import { phoneLast10 } from '../iam/users.helpers.js';

// Who a result belongs to (J4-E1-S3).
//
// Two very different shapes of fixture end up in the same place:
//
//   team matches   - the people are `team_members` of the two sides
//   ranking events - the people exist only as JSON inside `fixtures.live_state`,
//                    with a name and (usually) a phone number
//
// The second is why this file exists. A swimmer's result is currently invisible to
// their own record: nothing links that JSON row to a user. Matching on phone at lock
// time - the moment the result becomes canonical - turns a whole category of results
// into real player history, and it is the only moment worth doing it, because before
// the lock the data can still change and after it never can.
//
// Unmatched competitors are RECORDED, not dropped: an organiser who can see "3 of 14
// competitors aren't linked to an account" can fix it. Silently keeping 11 is how a
// lifetime record quietly becomes wrong.

export interface ResolvedParticipant {
  user_id: string;
  /** Present for team matches; null for individual competitors in a ranking event. */
  team_id: string | null;
  /**
   * Who they represented in THIS fixture - the team's organisation, or the
   * competitor's entered org. Denormalised onto every permanent record they earn,
   * because "who they played for at the time" must not change when they later
   * transfer, graduate, or the org is deleted (J4-E2-S3).
   */
  organization_id: string | null;
  /**
   * The `live_state` competitor row this account matched, for ranking events.
   * It is the only handle those competitors have, and per-competitor medals are
   * ranked by it (J4-E4-S1).
   */
  competitor_id: string | null;
  name: string;
}

export interface UnmatchedCompetitor {
  name: string;
  /** Masked - this is written to the fixture, which many people can read. */
  phone_hint: string | null;
}

export interface FixtureParticipants {
  resolved: ResolvedParticipant[];
  unmatched: UnmatchedCompetitor[];
}

const maskPhoneHint = (phone?: string | null): string | null => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : null;
};

// Runs INSIDE the lock transaction (hence Db), so what it resolves and what the lock
// publishes cannot disagree.
export async function resolveFixtureParticipants(db: Db, fixtureId: string): Promise<FixtureParticipants> {
  const fixture = await db.fixtures.findUnique({
    where: { id: fixtureId },
    select: { home_team_id: true, away_team_id: true, live_state: true },
  });
  if (!fixture) return { resolved: [], unmatched: [] };

  const resolved = new Map<string, ResolvedParticipant>();
  const unmatched: UnmatchedCompetitor[] = [];

  // ---- team matches -------------------------------------------------------
  const teamIds = [fixture.home_team_id, fixture.away_team_id].filter((id): id is string => !!id);
  if (teamIds.length) {
    const members = await db.team_members.findMany({
      where: { team_id: { in: teamIds }, is_active: true },
      select: {
        user_id: true, team_id: true,
        users: { select: { name: true } },
        teams: { select: { organization_id: true } },
      },
    });
    for (const m of members) {
      resolved.set(m.user_id, {
        user_id: m.user_id,
        team_id: m.team_id,
        organization_id: m.teams?.organization_id ?? null,
        competitor_id: null,
        name: m.users?.name ?? '',
      });
    }
  }

  // ---- ranking events: competitors held as JSON ---------------------------
  const competitors = (fixture.live_state as any)?.event?.participants
    ?? (fixture.live_state as any)?.participants
    ?? [];

  if (Array.isArray(competitors) && competitors.length) {
    // One query for all of them rather than one per competitor: a heat can hold
    // dozens, and this runs inside a transaction holding a pooled connection.
    const byLast10 = new Map<string, { name: string; phone: string | null }>();
    for (const c of competitors) {
      const key = phoneLast10(c?.phone);
      if (key.length === 10) byLast10.set(key, { name: c?.name ?? '', phone: c?.phone ?? null });
    }

    const users = byLast10.size
      ? await db.$queryRawUnsafe<Array<{ id: string; name: string; phone: string | null }>>(
        `select id, name, phone from users
         where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = any($1::text[])`,
        [...byLast10.keys()],
      )
      : [];

    const found = new Map(users.map((u) => [phoneLast10(u.phone), u]));
    for (const c of competitors) {
      const key = phoneLast10(c?.phone);
      const user = key.length === 10 ? found.get(key) : undefined;
      if (user) {
        // A competitor already counted as a team member stays as they are - the
        // team_id is the more specific fact. But the competitor row id is still
        // recorded on them, because that is what per-competitor medals rank by
        // and losing it would cost them the medal.
        const already = resolved.get(user.id);
        if (already) {
          already.competitor_id ??= c?.id ?? null;
        } else {
          resolved.set(user.id, {
            user_id: user.id,
            team_id: null,
            organization_id: typeof c?.orgId === 'string' ? c.orgId : null,
            competitor_id: c?.id ?? null,
            name: user.name,
          });
        }
      } else {
        unmatched.push({ name: c?.name ?? 'Unnamed competitor', phone_hint: maskPhoneHint(c?.phone) });
      }
    }
  }

  return { resolved: [...resolved.values()], unmatched };
}
