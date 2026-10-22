import type { Prisma as PrismaNS } from '@prisma/client';
import type { Db } from '../../infra/prisma.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { allowedAwardTypes, type AwardTypeView } from './award-types.service.js';
import { toAwardRows, type MatchAwardInput, type MatchSides } from './match-awards.service.js';

// Awards above match level. Three scopes, each saved as its own replace-all set:
//
//   tournament_sport  one sport within a tournament   (Best Raider - Kabaddi U14)
//   tournament        a whole tournament, every sport (Player of the Tournament)
//   championship      the whole event                 (Best Athlete of the Games)
//
// A type is offered when it is given at that level and is all-sports or mapped to
// a sport in the scope. The recipient must have taken part in the scope: a team
// entered in it, or an active member of such a team.

export type ChampionshipAwardLevel = 'tournament_sport' | 'tournament' | 'championship';

export interface ScopeInput {
  level: ChampionshipAwardLevel;
  tournament_id?: string | null;
  tournament_sport_id?: string | null;
}

export interface AwardScope {
  level: ChampionshipAwardLevel;
  championshipId: string;
  tournamentId: string | null;
  tournamentSportId: string | null;
  sportIds: string[];
  /** How messages name the scope: "this sport", "this tournament", "this event". */
  where: string;
}

export interface ChampionshipAwardInput extends MatchAwardInput {
  notes?: string | null;
}

/** Entries that are out of the event don't make anybody eligible. */
const LIVE_ENTRY = { status: { notIn: ['rejected', 'withdrawn'] } };

/** Checks the scope belongs to this championship and works out its sports. */
export async function resolveAwardScope(db: Db, championshipId: string, s: ScopeInput): Promise<AwardScope> {
  const tournaments = await db.tournaments.findMany({
    where: { championship_id: championshipId },
    select: { id: true, tournament_sports: { select: { id: true, sport_id: true } } },
  });
  if (s.level === 'championship') {
    if (s.tournament_id || s.tournament_sport_id) throw new ValidationError('An event award is not tied to a tournament or sport');
    return {
      level: s.level, championshipId, tournamentId: null, tournamentSportId: null,
      sportIds: [...new Set(tournaments.flatMap((t) => t.tournament_sports.map((ts) => ts.sport_id)))],
      where: 'this event',
    };
  }
  if (s.level === 'tournament') {
    if (s.tournament_sport_id) throw new ValidationError('A tournament award is not tied to one sport');
    const t = tournaments.find((x) => x.id === s.tournament_id);
    if (!t) throw new NotFoundError('Tournament in this championship');
    return {
      level: s.level, championshipId, tournamentId: t.id, tournamentSportId: null,
      sportIds: [...new Set(t.tournament_sports.map((ts) => ts.sport_id))],
      where: 'this tournament',
    };
  }
  const t = tournaments.find((x) => x.tournament_sports.some((ts) => ts.id === s.tournament_sport_id));
  if (!t) throw new NotFoundError('Sport in this championship');
  if (s.tournament_id && s.tournament_id !== t.id) throw new ValidationError('That sport belongs to another tournament');
  const ts = t.tournament_sports.find((x) => x.id === s.tournament_sport_id)!;
  return {
    level: s.level, championshipId, tournamentId: t.id, tournamentSportId: ts.id,
    sportIds: [ts.sport_id],
    where: 'this sport',
  };
}

/** The rows of `championship_awards` that make up one scope. */
export const scopeWhere = (scope: AwardScope): PrismaNS.championship_awardsWhereInput => ({
  championship_id: scope.championshipId,
  level: scope.level,
  tournament_id: scope.tournamentId,
  tournament_sport_id: scope.tournamentSportId,
});

export interface ScopeTeam {
  id: string; name: string; organization: string | null; sport: string | null;
  organization_id: string; sport_id: string;
}
export interface ScopePlayer { id: string; name: string; team_id: string; team: string }

/** Teams entered in the scope and their active players - who can receive an award. */
export async function scopeParticipants(db: Db, scope: AwardScope): Promise<{ teams: ScopeTeam[]; players: ScopePlayer[] }> {
  const disciplineFilter: PrismaNS.team_entriesWhereInput =
    scope.level === 'tournament_sport' ? { tournament_disciplines: { tournament_sport_id: scope.tournamentSportId! } }
      : scope.level === 'tournament' ? { tournament_disciplines: { tournament_sports: { tournament_id: scope.tournamentId! } } }
        : {};
  const entries = await db.team_entries.findMany({
    where: { championship_id: scope.championshipId, ...LIVE_ENTRY, ...disciplineFilter },
    select: {
      teams: {
        select: {
          id: true, name: true, organization_id: true, sport_id: true,
          organizations: { select: { name: true } }, sports: { select: { name: true } },
        },
      },
    },
  });
  const teams = new Map<string, ScopeTeam>();
  for (const e of entries) {
    if (!teams.has(e.teams.id)) {
      teams.set(e.teams.id, {
        id: e.teams.id, name: e.teams.name, organization: e.teams.organizations?.name ?? null, sport: e.teams.sports?.name ?? null,
        organization_id: e.teams.organization_id, sport_id: e.teams.sport_id,
      });
    }
  }
  const members = teams.size
    ? await db.team_members.findMany({
      where: { team_id: { in: [...teams.keys()] }, is_active: true },
      select: { team_id: true, users: { select: { id: true, name: true } } },
    })
    : [];
  const players = new Map<string, ScopePlayer>();
  for (const m of members) {
    if (!players.has(m.users.id)) {
      players.set(m.users.id, { id: m.users.id, name: m.users.name, team_id: m.team_id, team: teams.get(m.team_id)?.name ?? '' });
    }
  }
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return { teams: [...teams.values()].sort(byName), players: [...players.values()].sort(byName) };
}

/** Award types offered in the scope. */
export const scopeAwardTypes = (db: Db, scope: AwardScope): Promise<AwardTypeView[]> =>
  allowedAwardTypes(db, { level: scope.level, sportIds: scope.sportIds, championshipId: scope.championshipId });

/** Validates a scope's save and returns the rows to write. */
export function toChampionshipAwardRows(
  awards: ChampionshipAwardInput[],
  types: AwardTypeView[],
  participants: { teams: ScopeTeam[]; players: ScopePlayer[] },
  scope: AwardScope,
) {
  const sides: MatchSides = { teamIds: participants.teams.map((t) => t.id), playerIds: new Set(participants.players.map((p) => p.id)) };
  return toAwardRows(awards, types, sides, scope.where).map(({ input, ...row }) => ({
    ...row,
    notes: input.notes?.trim() || null,
    level: scope.level,
    championship_id: scope.championshipId,
    tournament_id: scope.tournamentId,
    tournament_sport_id: scope.tournamentSportId,
  }));
}
