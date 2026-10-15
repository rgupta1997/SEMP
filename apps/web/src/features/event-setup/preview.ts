import type { EventSetupBlueprint, SetupMatchSide } from '@semp/shared';

// What the blueprint will build, flattened into rows a person can read: squads by
// name rather than key, matches with their grounds and sides resolved.

export interface SquadPreviewRow {
  key: string;
  name: string;
  shortName: string;
  draw: string;
  competitor: string;
  section: string;
  members: number;
  captain: string;
}

export type SidePreview = { kind: 'squad'; name: string } | { kind: 'winner'; matchId: string };

export interface MatchPreviewRow {
  key: string;
  draw: string;
  matchId: string;
  date: string;
  kickoff: string;
  ground: string;
  home: SidePreview;
  away: SidePreview;
}

const drawLabel = (bp: EventSetupBlueprint, drawKey: string) => {
  const d = bp.draws.find((x) => x.key === drawKey);
  return d ? `${d.sport} · ${d.discipline}` : drawKey;
};

export function squadPreviewRows(bp: EventSetupBlueprint): SquadPreviewRow[] {
  const competitors = new Map(bp.competitors.map((c) => [c.key, c.name]));
  const people = new Map(bp.people.map((p) => [p.key, p.name]));
  return bp.squads.map((s) => {
    const captain = s.members.find((m) => m.role === 'captain');
    return {
      key: s.key,
      name: s.name,
      shortName: s.shortName,
      draw: drawLabel(bp, s.drawKey),
      competitor: competitors.get(s.competitorKey) ?? s.competitorKey,
      section: s.section ?? '',
      members: s.members.length,
      captain: captain ? (people.get(captain.personKey) ?? captain.personKey) : '',
    };
  });
}

export function matchPreviewRows(bp: EventSetupBlueprint): MatchPreviewRow[] {
  const squads = new Map(bp.squads.map((s) => [s.key, s.name]));
  const grounds = new Map(bp.venue.grounds.map((g) => [g.key, g.name]));
  const side = (s: SetupMatchSide): SidePreview =>
    ('winnerOf' in s
      ? { kind: 'winner', matchId: s.winnerOf }
      : { kind: 'squad', name: squads.get(s.squadKey) ?? s.squadKey });
  const rows: MatchPreviewRow[] = [];
  for (const f of bp.fixtures) {
    if (f.kind !== 'knockout-rows') continue;
    const draw = drawLabel(bp, f.drawKey);
    for (const r of f.rows) {
      rows.push({
        key: `${f.drawKey}:${r.matchId}`,
        draw,
        matchId: r.matchId,
        date: r.date,
        kickoff: r.kickoff,
        ground: grounds.get(r.groundKey) ?? r.groundKey,
        home: side(r.home),
        away: side(r.away),
      });
    }
  }
  return rows.sort((a, b) =>
    a.date.localeCompare(b.date) || a.kickoff.localeCompare(b.kickoff) || a.ground.localeCompare(b.ground, undefined, { numeric: true }));
}

/** Draws whose fixtures the product will generate rather than read from the sheet. */
export function generatedDraws(bp: EventSetupBlueprint): Array<{ draw: string; squads: number }> {
  return bp.fixtures
    .filter((f) => f.kind === 'generate')
    .map((f) => ({ draw: drawLabel(bp, f.drawKey), squads: bp.squads.filter((s) => s.drawKey === f.drawKey).length }));
}

export interface PeopleCounts {
  people: number;
  withMobile: number;
  withEmail: number;
  withMemberCode: number;
  staff: number;
  organisers: number;
  officials: number;
  pocs: number;
}

export function peopleCounts(bp: EventSetupBlueprint): PeopleCounts {
  return {
    people: bp.people.length,
    withMobile: bp.people.filter((p) => !!p.phone).length,
    withEmail: bp.people.filter((p) => !!p.email).length,
    withMemberCode: bp.people.filter((p) => !!p.memberCode).length,
    staff: bp.staff.length,
    organisers: bp.staff.filter((s) => s.eventRole === 'organiser').length,
    officials: bp.staff.filter((s) => s.eventRole === 'official').length,
    pocs: bp.staff.filter((s) => s.eventRole === 'poc').length,
  };
}
