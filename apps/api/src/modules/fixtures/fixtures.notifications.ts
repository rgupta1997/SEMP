import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';

// Notification logic for fixtures.routes.ts that isn't already covered by
// lock.service.ts (the scorecard-lock triggers) or match-audience.ts (the
// generic match_* schedule/venue/cancel family). Kept out of the route file so
// "who gets told, and under what condition" is answered here, not inline in an
// Express handler, and is testable without one.

export interface AwardInput {
  award_name: string;
  award_type_id?: string | null;
  recipient_user_id: string;
}

// Which of this save's awards are genuinely NEW. The awards route replaces the
// whole list on every save, so a re-save of an unchanged award must not
// re-notify its recipient - only what wasn't already recorded (by recipient +
// name + type) counts. MUST be called before the awards are replaced.
export async function newlyAwarded(
  prisma: Prisma, fixtureId: string, awards: AwardInput[],
): Promise<AwardInput[]> {
  const existing = await prisma.fixture_awards.findMany({
    where: { fixture_id: fixtureId },
    select: { recipient_user_id: true, award_name: true, award_type_id: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.recipient_user_id}|${e.award_name}|${e.award_type_id ?? ''}`));
  return awards.filter((a) => !existingKeys.has(`${a.recipient_user_id}|${a.award_name}|${a.award_type_id ?? ''}`));
}

// Best-effort: the awards are already committed by the time this runs. Player of
// the Match gets its own type; every other award type (or untyped free text) is a
// tournament_award - see the registry for why they share this one route. Each
// award gets its own try/catch: one recipient's notify() failing must not skip
// every award queued after it in the same batch.
export async function notifyNewAwards(
  prisma: Prisma, fixtureId: string, newAwards: AwardInput[], senderId: string,
): Promise<void> {
  if (newAwards.length === 0) return;
  try {
    const typeIds = [...new Set(newAwards.map((a) => a.award_type_id).filter((id): id is string => !!id))];
    const types = typeIds.length
      ? await prisma.award_types.findMany({ where: { id: { in: typeIds } }, select: { id: true, code: true } })
      : [];
    const codeById = new Map(types.map((t) => [t.id, t.code]));
    const withNames = await prisma.fixtures.findUnique({
      where: { id: fixtureId },
      select: {
        teams_fixtures_home_team_idToteams: { select: { name: true } },
        teams_fixtures_away_team_idToteams: { select: { name: true } },
        tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } } },
      },
    });
    const championshipId = withNames?.tournament_disciplines?.tournament_sports?.tournaments?.championship_id ?? undefined;
    const home = withNames?.teams_fixtures_home_team_idToteams?.name ?? 'TBD';
    const away = withNames?.teams_fixtures_away_team_idToteams?.name ?? 'TBD';
    const label = `${home} vs ${away}`;
    for (const a of newAwards) {
      const code = a.award_type_id ? codeById.get(a.award_type_id) : null;
      try {
        await notify(prisma, {
          type: code === 'player_of_the_match' ? 'player_of_the_match' : 'tournament_award',
          championshipId,
          userId: a.recipient_user_id,
          senderId,
          data: { label, awardName: a.award_name },
        });
      } catch (err) {
        console.error(`[fixtures] award notification failed for ${a.recipient_user_id} on fixture ${fixtureId}:`, err);
      }
    }
  } catch (err) {
    console.error(`[fixtures] award notifications setup failed for fixture ${fixtureId}:`, err);
  }
}

export interface OfficialAssignmentFixture {
  id: string;
  official_id: string | null;
  scheduled_at: Date | string | null;
  teams_fixtures_home_team_idToteams?: { name: string } | null;
  teams_fixtures_away_team_idToteams?: { name: string } | null;
  venue_grounds?: { name: string; venues?: { name: string } | null } | null;
  tournament_disciplines?: {
    disciplines?: { name: string } | null;
    tournament_sports?: { sports?: { name: string } | null } | null;
  } | null;
}

// Tells the newly-assigned official they're on this match, and - if someone else
// held it before - tells that PREVIOUS official they've been reassigned away
// (the generic 'manual' type: a courtesy heads-up, not a named journey). Best-
// effort: the assignment (fx.official_id -> newOfficialId) has already committed
// by the time this runs. `fx` is the fixture as it was BEFORE that update - its
// own official_id is who is being replaced.
export async function notifyOfficialAssignment(
  prisma: Prisma,
  fx: OfficialAssignmentFixture,
  championshipId: string | null,
  newOfficialId: string | null,
  senderId: string,
): Promise<void> {
  const home = fx.teams_fixtures_home_team_idToteams?.name ?? 'TBD';
  const away = fx.teams_fixtures_away_team_idToteams?.name ?? 'TBD';
  const sport = [fx.tournament_disciplines?.tournament_sports?.sports?.name, fx.tournament_disciplines?.disciplines?.name]
    .filter(Boolean).join(' · ');
  const where = fx.venue_grounds ? [fx.venue_grounds.venues?.name, fx.venue_grounds.name].filter(Boolean).join(' · ') : null;
  const when = fx.scheduled_at ? new Date(fx.scheduled_at).toISOString() : null;
  const label = [`${home} vs ${away}`, sport].filter(Boolean).join(' — ');

  if (newOfficialId) {
    const details = [when ? `Scheduled for ${when}.` : 'Not scheduled yet.', where ? `At ${where}.` : null]
      .filter(Boolean).join(' ');
    try {
      await notify(prisma, {
        type: 'match_official_assigned',
        championshipId: championshipId ?? undefined,
        userId: newOfficialId,
        senderId,
        data: { label, details },
      });
    } catch (err) {
      console.error(`[officials] assignment notification failed for fixture ${fx.id}:`, err);
    }
  }

  // The previous official's queue silently loses a match otherwise, which is how
  // a match ends up with nobody at it.
  if (fx.official_id && fx.official_id !== newOfficialId) {
    try {
      await notify(prisma, {
        type: 'manual',
        championshipId: championshipId ?? undefined,
        userId: fx.official_id,
        senderId,
        data: {
          title: `No longer officiating ${label}`,
          body: 'The organiser has reassigned this match, so it has left your Officiating queue.',
        },
      });
    } catch (err) {
      console.error(`[officials] assignment notification failed for fixture ${fx.id}:`, err);
    }
  }
}
