import type { Prisma } from '../../infra/prisma.js';

// One screen showing everything happening right now (J2-E6-S1).
//
// Built as its own narrow query rather than a filter over
// `listChampionshipFixtures`: that helper loads every fixture of the
// championship with its full join tree, and a page that polls every few seconds
// must not drag a thousand rows across the pooler each time. This reads the
// handful that are actually live, plus a short list of what is coming next.
//
// The "what's next" half is not decoration. An organiser who opens the Live tab
// between sessions needs to be told what to expect and when, and an empty state
// that says only "nothing live" reads as a broken page during the quiet hour
// after lunch.

const LIVE_SELECT = {
  id: true, round: true, status: true, scheduled_at: true, live_started_at: true,
  home_score: true, away_score: true, live_state: true,
  teams_fixtures_home_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true } } } },
  teams_fixtures_away_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true } } } },
  venue_grounds: { select: { name: true, venues: { select: { name: true } } } },
  users: { select: { id: true, name: true } },
  tournament_disciplines: {
    select: {
      disciplines: { select: { name: true } },
      tournament_sports: { select: { sports: { select: { name: true, icon: true } } } },
    },
  },
} as const;

const inChampionship = (championshipId: string) => ({
  tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } },
});

/**
 * Minutes since kick-off (J2-E6-S2).
 *
 * Deliberately elapsed-since-kickoff and not a match clock: no halves, no
 * stoppages, no injury time. A real clock is a per-sport rabbit hole, and this
 * is what the PRD mockup shows. Named `elapsed_minutes` rather than `clock` so
 * nobody later mistakes it for one.
 */
const elapsedMinutes = (startedAt: Date | null, now: number): number | null =>
  startedAt ? Math.max(0, Math.floor((now - startedAt.getTime()) / 60_000)) : null;

// Beyond this, "live" stopped being true and became an unclosed match. No sport
// here runs six hours, so a fixture past it was almost certainly finished on the
// pitch and never marked completed.
//
// The dev database has fixtures sitting in 'live' since June, which is how this
// surfaced: the card rendered "74950′". Showing a stale flag rather than a
// six-figure minute count is both honest and useful - on a run-the-day screen,
// an unclosed match is a job, not a scoreline.
const STALE_AFTER_MINUTES = 6 * 60;

const teamLabel = (t: any): string | null =>
  t ? (t.organizations?.short_name ? `${t.name} (${t.organizations.short_name})` : t.name) : null;

function view(f: any, now: number) {
  const ts = f.tournament_disciplines?.tournament_sports;
  const elapsed = elapsedMinutes(f.live_started_at, now);
  const stale = elapsed != null && elapsed > STALE_AFTER_MINUTES;
  return {
    id: f.id,
    status: f.status,
    round: f.round,
    sport: ts?.sports?.name ?? null,
    sport_icon: ts?.sports?.icon ?? null,
    discipline: f.tournament_disciplines?.disciplines?.name ?? null,
    home_team: teamLabel(f.teams_fixtures_home_team_idToteams),
    away_team: teamLabel(f.teams_fixtures_away_team_idToteams),
    home_score: f.home_score,
    away_score: f.away_score,
    venue: f.venue_grounds
      ? [f.venue_grounds.venues?.name, f.venue_grounds.name].filter(Boolean).join(' · ')
      : null,
    // The official's NAME only - never their contact details. This payload is
    // shaped so it could be served to a public follower unchanged.
    official: f.users?.name ?? null,
    scheduled_at: f.scheduled_at,
    started_at: f.live_started_at,
    // Suppressed once stale: a six-figure minute count is worse than no clock,
    // and `stale` is the thing the organiser can actually act on.
    elapsed_minutes: stale ? null : elapsed,
    stale,
  };
}

export async function championshipLiveView(prisma: Prisma, championshipId: string, now = Date.now()) {
  const where = inChampionship(championshipId);

  const [live, next] = await Promise.all([
    prisma.fixtures.findMany({
      where: { ...where, status: 'live' },
      select: LIVE_SELECT,
      orderBy: [{ live_started_at: 'asc' }, { scheduled_at: 'asc' }],
      take: 100,
    }),
    // What's next: scheduled fixtures from an hour ago onward, so a match that
    // was due at 10:00 and has not been started yet is still listed at 10:20
    // rather than vanishing exactly when someone starts asking where it is.
    prisma.fixtures.findMany({
      where: {
        ...where,
        status: 'scheduled',
        OR: [{ scheduled_at: { gte: new Date(now - 60 * 60_000) } }, { scheduled_at: null }],
      },
      select: LIVE_SELECT,
      orderBy: [{ scheduled_at: 'asc' }],
      take: 10,
    }),
  ]);

  return {
    live: live.map((f) => view(f, now)),
    next: next.map((f) => view(f, now)),
    // Stamped by the server so a client polling every few seconds can show
    // "updated 3s ago" without trusting its own clock.
    as_of: new Date(now).toISOString(),
  };
}
