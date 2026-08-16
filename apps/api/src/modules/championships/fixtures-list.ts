import type { Prisma } from '../../infra/prisma.js';
import { AUDIT_ACTIONS } from '../iam/audit.service.js';

// All fixtures across a championship, flattened with team / org / ground / sport
// names. Shared by the authed Schedule view and the public share page (no contact
// data is included, so it's safe for unauthenticated viewers).
export async function listChampionshipFixtures(prisma: Prisma, championshipId: string) {
  const fixtures = await prisma.fixtures.findMany({
    where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } } },
    include: {
      teams_fixtures_home_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true, name: true } } } },
      teams_fixtures_away_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true, name: true } } } },
      venue_grounds: { select: { id: true, name: true, venues: { select: { name: true } } } },
      tournament_disciplines: {
        select: {
          entry_type: true,
          disciplines: { select: { name: true } },
          tournament_sports: {
            select: {
              sports: { select: { name: true, icon: true } },
              tournaments: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
  });

  // A corrected result has to say so wherever it appears (J6-E4-S4), and saying so
  // needs a date. `lock_version > 0` is what "has been unlocked at least once" means.
  // The date the correction landed is the re-lock for a card that is official again;
  // while the correction is still open there is no re-lock yet, so the unlock itself
  // is the honest date and that only exists on the audit trail. Hence the lookup is
  // skipped entirely unless a correction is actually in progress - which is rare.
  const openCorrections = fixtures.filter((f) => f.lock_version > 0 && !f.locked_at);
  const unlockedAt = new Map<string, Date>();
  if (openCorrections.length > 0) {
    const rows = await prisma.audit_log.findMany({
      where: {
        championship_id: championshipId,
        action: AUDIT_ACTIONS.fixtureUnlocked,
        target_id: { in: openCorrections.map((f) => f.id) },
      },
      select: { target_id: true, at: true },
      orderBy: { at: 'desc' },
    });
    // Most recent first, so the first row seen for a fixture is the latest unlock.
    for (const r of rows) if (r.target_id && !unlockedAt.has(r.target_id)) unlockedAt.set(r.target_id, r.at);
  }

  return fixtures.map((f) => ({
    id: f.id,
    status: f.status,
    // Where the paperwork has got to, as opposed to where the match has got to.
    // 'locked' is what the Verified badge means - everything else is provisional,
    // on this page and on the public share page alike.
    scorecard_status: f.scorecard_status,
    submitted_at: f.submitted_at,
    locked_at: f.locked_at,
    lock_version: f.lock_version,
    // Set only once a result has actually been corrected. Audit writes are
    // best-effort by design, so fall back to the fixture's own updated_at rather
    // than dropping the notice - an undated correction still has to be visible.
    amended_at: f.lock_version > 0 ? (f.locked_at ?? unlockedAt.get(f.id) ?? f.updated_at) : null,
    round: f.round,
    scheduled_at: f.scheduled_at,
    duration_minutes: f.duration_minutes,
    tournament_discipline_id: f.tournament_discipline_id,
    entry_type: f.tournament_disciplines?.entry_type ?? null,
    home_score: f.home_score,
    away_score: f.away_score,
    winner_team_id: f.winner_team_id,
    home_team_id: f.home_team_id,
    away_team_id: f.away_team_id,
    venue_ground_id: f.venue_ground_id,
    official_id: f.official_id,
    pool_number: f.pool_number,
    bracket_position: f.bracket_position,
    ground: f.venue_grounds ? { id: f.venue_grounds.id, name: f.venue_grounds.name, venue: f.venue_grounds.venues?.name ?? null } : null,
    sport: f.tournament_disciplines?.tournament_sports?.sports?.name ?? null,
    sport_icon: f.tournament_disciplines?.tournament_sports?.sports?.icon ?? null,
    tournament: f.tournament_disciplines?.tournament_sports?.tournaments ?? null,
    discipline: f.tournament_disciplines?.disciplines?.name ?? null,
    // Optional external full-scorecard link (e.g. CrickHeroes) set by the scorer.
    scorecard_url: (f.live_state as any)?.scorecard_url ?? null,
    home: f.teams_fixtures_home_team_idToteams,
    away: f.teams_fixtures_away_team_idToteams,
  }));
}
