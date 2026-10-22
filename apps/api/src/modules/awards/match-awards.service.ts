import type { Db } from '../../infra/prisma.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { allowedAwardTypes, type AwardTypeView } from './award-types.service.js';

// Turns what the scorer sent for a match into award rows, or refuses with a reason.
// Every award must be a type offered for the fixture's sport at match level (or one
// of this event's own extras), given to the kind of recipient the type says, and the
// recipient must be in this match: a player on either roster, or one of the two teams.

export interface MatchAwardInput {
  award_type_id: string;
  recipient_user_id?: string | null;
  recipient_team_id?: string | null;
}

export interface MatchAwardRow {
  award_type_id: string;
  award_name: string;
  recipient_user_id: string | null;
  recipient_team_id: string | null;
}

export interface MatchSides {
  teamIds: string[];
  playerIds: Set<string>;
}

/** Why this award can't be saved, or null. `where` names the scope in messages
 *  ("this match", "this tournament"). Pure, so tested without a database. */
export function awardProblem(a: MatchAwardInput, type: AwardTypeView | undefined, sides: MatchSides, where = 'this match'): string | null {
  if (!type) return `This award is not offered here`;
  if (type.recipient_kind === 'team') {
    if (!a.recipient_team_id) return `"${type.label}" goes to a team`;
    if (!sides.teamIds.includes(a.recipient_team_id)) return `"${type.label}" must go to a team in ${where}`;
  } else {
    if (!a.recipient_user_id) return `"${type.label}" goes to a player`;
    if (!sides.playerIds.has(a.recipient_user_id)) return `"${type.label}" must go to a player in ${where}`;
  }
  return null;
}

/** Validates a whole save and returns the rows to write. */
export function toAwardRows<T extends MatchAwardInput>(awards: T[], types: AwardTypeView[], sides: MatchSides, where = 'this match'): Array<MatchAwardRow & { input: T }> {
  const byId = new Map(types.map((t) => [t.id, t]));
  const seen = new Set<string>();
  return awards.map((a) => {
    const type = byId.get(a.award_type_id);
    const problem = awardProblem(a, type, sides, where);
    if (problem) throw new ValidationError(problem);
    const team = type!.recipient_kind === 'team';
    const key = `${type!.id}|${team ? a.recipient_team_id : a.recipient_user_id}`;
    if (seen.has(key)) throw new ValidationError(`"${type!.label}" is listed twice for the same recipient`);
    seen.add(key);
    return {
      input: a,
      award_type_id: type!.id,
      award_name: type!.label.slice(0, 120),
      recipient_user_id: team ? null : a.recipient_user_id!,
      recipient_team_id: team ? a.recipient_team_id! : null,
    };
  });
}

export const toMatchAwardRows = (awards: MatchAwardInput[], types: AwardTypeView[], sides: MatchSides): MatchAwardRow[] =>
  toAwardRows(awards, types, sides).map(({ input: _input, ...row }) => row);

/** Loads the fixture's sport, event and both sides, then validates the save. */
export async function resolveMatchAwards(db: Db, fixtureId: string, awards: MatchAwardInput[]): Promise<MatchAwardRow[]> {
  const fx = await db.fixtures.findUnique({
    where: { id: fixtureId },
    select: {
      home_team_id: true,
      away_team_id: true,
      tournament_disciplines: { select: { tournament_sports: { select: { sport_id: true, tournaments: { select: { championship_id: true } } } } } },
    },
  });
  if (!fx) throw new NotFoundError('Fixture');
  if (awards.length === 0) return [];

  const ts = fx.tournament_disciplines?.tournament_sports;
  const teamIds = [fx.home_team_id, fx.away_team_id].filter((x): x is string => !!x);
  const [types, members] = await Promise.all([
    allowedAwardTypes(db, { level: 'match', sportId: ts?.sport_id ?? null, championshipId: ts?.tournaments?.championship_id ?? null }),
    teamIds.length ? db.team_members.findMany({ where: { team_id: { in: teamIds } }, select: { user_id: true } }) : [],
  ]);
  return toMatchAwardRows(awards, types, { teamIds, playerIds: new Set(members.map((m) => m.user_id)) });
}
