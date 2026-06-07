// Shared shape helpers for the deeply-nested fixture rows returned by
// GET /me/officiating, so the Official screens read cleanly.
export function homeTeam(f: any) { return f.teams_fixtures_home_team_idToteams; }
export function awayTeam(f: any) { return f.teams_fixtures_away_team_idToteams; }
export function teamLabel(t: any): string { return t?.name ?? t?.institutions?.name ?? 'TBD'; }

export function sportName(f: any): string | null {
  return f.tournament_disciplines?.tournament_sports?.sports?.name ?? null;
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
  const ev = f.tournament_disciplines?.tournament_sports?.tournaments?.events;
  return ev?.id ? { id: ev.id, name: ev.name ?? 'Event' } : null;
}
export function venueLabel(f: any): string {
  const g = f.venue_grounds;
  if (!g) return 'Venue TBD';
  return [g.venues?.name, g.name].filter(Boolean).join(' · ');
}
