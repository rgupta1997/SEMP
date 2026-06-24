import type { Prisma } from '../../infra/prisma.js';

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
  return fixtures.map((f) => ({
    id: f.id,
    status: f.status,
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
