import { TBD_LABEL } from '@semp/shared';
// Shared shape helpers for the deeply-nested fixture rows returned by
// GET /me/officiating, so the Official screens read cleanly.
export function homeTeam(f: any) { return f.teams_fixtures_home_team_idToteams; }
export function awayTeam(f: any) { return f.teams_fixtures_away_team_idToteams; }
export function teamLabel(t: any): string { return t?.name ?? t?.organizations?.name ?? TBD_LABEL; }
/** The team's short code ("BUFM") for tight spots on a phone; the full name when it has none. */
export function teamShort(t: any): string { return t?.short_name?.trim() || teamLabel(t); }
// Ranking events (powerlifting/swimming/athletics) have no head-to-head matchup -
// every competitor is ranked together - so the generator emits one team-less fixture
// with round 'Event'. There's no opponent to decide, so showing "TBD vs TBD" is wrong;
// callers show the discipline name instead.
export function isRankingEvent(f: any): boolean { return f?.round === 'Event' && !homeTeam(f) && !awayTeam(f); }
// Organization sub-heading for a team (short name preferred), '' when unaffiliated.
export function orgLabel(t: any): string { return t?.organizations?.short_name || t?.organizations?.name || ''; }

/** Longest organisation name a scoreboard header shows in full; longer ones use the short name. */
const ORG_TITLE_MAX = 28;
// Organization as a headline: the full name where it fits, the short name otherwise.
export function orgTitle(t: any): string {
  const full = t?.organizations?.name || '';
  const short = t?.organizations?.short_name || '';
  return full && (full.length <= ORG_TITLE_MAX || !short) ? full : short;
}

export function sportName(f: any): string | null {
  return f.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
}
export function sportIdOf(f: any): string | null {
  const ts = f.tournament_disciplines?.tournament_sports;
  return ts?.sport_id ?? ts?.sports?.id ?? null;
}
export function championshipIdOf(f: any): string | null {
  const t = f.tournament_disciplines?.tournament_sports?.tournaments;
  return t?.championship_id ?? t?.championships?.id ?? null;
}
export function disciplineLabel(f: any): string {
  const sport = sportName(f);
  const disc = f.tournament_disciplines?.disciplines?.name;
  return [sport, disc].filter(Boolean).join(' · ') || 'Match';
}
export function eventLabel(f: any): string {
  return eventInfo(f)?.name ?? '';
}
export function eventInfo(f: any): { id: string; name: string } | null {
  const ev = f.tournament_disciplines?.tournament_sports?.tournaments?.championships;
  return ev?.id ? { id: ev.id, name: ev.name ?? 'Championship' } : null;
}
export function venueLabel(f: any): string {
  const g = f.venue_grounds;
  if (!g) return 'Venue TBD';
  return [g.venues?.name, g.name].filter(Boolean).join(' · ');
}
