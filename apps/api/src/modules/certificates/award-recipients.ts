import type { Db } from '../../infra/prisma.js';
import type { AwardLevel } from '@semp/shared';

// Who gets a Special awards certificate.
//
// Two sources, both read from the awards themselves rather than from achievements
// (achievements only know about match awards to a person, and only after the lock):
//   - match awards on LOCKED fixtures - a match award is official once its result is
//   - sport / tournament / event awards from championship_awards - the organiser
//     gives these by hand, and generating is the moment they choose to certify them
//
// A team award certifies every active member of the team, with the team named on
// the certificate. Each certificate is for ONE award: `awardRef` names it, and is
// what the dedup index keys on (rds-migrations/018).

export interface AwardRecipientFilters {
  sportId?: string;
  tournamentDisciplineId?: string;
  teamId?: string;
  level?: AwardLevel;
}

export interface AwardCandidate {
  userId: string;
  name: string;
  title: string;
  fixtureId: string | null;
  sportName: string | null;
  lockVersion?: number | null;
  awardRef: string;
  /** Where it was won - "Riders vs Blasters · Quarter-final", "Kabaddi · Main", "Whole event". */
  scope: string;
  /** The team, for a team award. */
  team: string | null;
  level: AwardLevel;
}

/** One award, before a team award is expanded to its members. */
export interface GivenAward {
  awardRef: string;
  title: string;
  level: AwardLevel;
  scope: string;
  sportName: string | null;
  fixtureId: string | null;
  lockVersion: number | null;
  recipientUserId: string | null;
  recipientTeamId: string | null;
}

/** Turns awards into one candidate per person. Pure. */
export function expandAwards(
  awards: GivenAward[],
  users: Map<string, string>,
  teams: Map<string, { name: string; members: Array<{ id: string; name: string }> }>,
  teamFilter?: string,
): AwardCandidate[] {
  const out: AwardCandidate[] = [];
  const seen = new Set<string>();
  const push = (a: GivenAward, userId: string, name: string, team: string | null) => {
    const key = `${userId}|${a.awardRef}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      userId, name, title: a.title, fixtureId: a.fixtureId, sportName: a.sportName, lockVersion: a.lockVersion,
      awardRef: a.awardRef, scope: a.scope, team, level: a.level,
    });
  };
  for (const a of awards) {
    if (a.recipientTeamId) {
      if (teamFilter && a.recipientTeamId !== teamFilter) continue;
      const t = teams.get(a.recipientTeamId);
      for (const m of t?.members ?? []) push(a, m.id, m.name, t!.name);
    } else if (a.recipientUserId) {
      if (teamFilter && !teams.get(teamFilter)?.members.some((m) => m.id === a.recipientUserId)) continue;
      push(a, a.recipientUserId, users.get(a.recipientUserId) ?? 'Unknown', null);
    }
  }
  return out;
}

const vs = (home?: string | null, away?: string | null) => [home, away].filter(Boolean).join(' vs ');

export async function awardCandidates(db: Db, championshipId: string, f: AwardRecipientFilters, limit: number): Promise<AwardCandidate[]> {
  const wantMatch = !f.level || f.level === 'match';
  // Discipline is a match-only notion; a sport filter narrows the sport-level awards too.
  const wantHigher = !f.tournamentDisciplineId && (!f.level || f.level !== 'match')
    // A sport filter can only match awards given for a sport.
    && !(f.sportId && f.level && f.level !== 'tournament_sport');

  const [matchRows, higherRows] = await Promise.all([
    wantMatch
      ? db.fixture_awards.findMany({
        where: {
          fixtures: {
            locked_at: { not: null },
            ...(f.tournamentDisciplineId ? { tournament_discipline_id: f.tournamentDisciplineId } : {}),
            tournament_disciplines: {
              tournament_sports: { tournaments: { championship_id: championshipId }, ...(f.sportId ? { sport_id: f.sportId } : {}) },
            },
          },
        },
        select: {
          fixture_id: true, award_type_id: true, award_name: true, recipient_user_id: true, recipient_team_id: true,
          fixtures: {
            select: {
              round: true, lock_version: true,
              teams_fixtures_home_team_idToteams: { select: { name: true } },
              teams_fixtures_away_team_idToteams: { select: { name: true } },
              tournament_disciplines: { select: { tournament_sports: { select: { sports: { select: { name: true } } } } } },
            },
          },
        },
        orderBy: { created_at: 'asc' },
        take: limit,
      })
      : [],
    wantHigher
      ? db.championship_awards.findMany({
        where: {
          championship_id: championshipId,
          ...(f.level ? { level: f.level } : {}),
          ...(f.sportId ? { level: 'tournament_sport', tournament_sports: { sport_id: f.sportId } } : {}),
        },
        select: {
          level: true, championship_id: true, tournament_id: true, tournament_sport_id: true, award_type_id: true, award_name: true,
          recipient_user_id: true, recipient_team_id: true,
          tournaments: { select: { name: true } },
          tournament_sports: { select: { sports: { select: { name: true } } } },
        },
        orderBy: { created_at: 'asc' },
        take: limit,
      })
      : [],
  ]);

  const given: GivenAward[] = [
    ...matchRows.map((r): GivenAward => {
      const fx = r.fixtures;
      const match = vs(fx.teams_fixtures_home_team_idToteams?.name, fx.teams_fixtures_away_team_idToteams?.name);
      return {
        awardRef: `match:${r.fixture_id}:${r.award_type_id ?? `name:${r.award_name.trim().toLowerCase()}`}`,
        title: r.award_name,
        level: 'match',
        scope: [match || null, fx.round].filter(Boolean).join(' · ') || 'Match',
        sportName: fx.tournament_disciplines?.tournament_sports?.sports?.name ?? null,
        fixtureId: r.fixture_id,
        lockVersion: fx.lock_version ?? null,
        recipientUserId: r.recipient_user_id,
        recipientTeamId: r.recipient_team_id,
      };
    }),
    ...higherRows.map((r): GivenAward => {
      const sport = r.tournament_sports?.sports?.name ?? null;
      const scopeId = r.tournament_sport_id ?? r.tournament_id ?? r.championship_id;
      return {
        awardRef: `championship:${r.level}:${scopeId}:${r.award_type_id}`,
        title: r.award_name,
        level: r.level as AwardLevel,
        scope: r.level === 'tournament_sport' ? [sport, r.tournaments?.name].filter(Boolean).join(' · ')
          : r.level === 'tournament' ? r.tournaments?.name ?? 'Tournament'
            : 'Whole event',
        sportName: sport,
        fixtureId: null,
        lockVersion: null,
        recipientUserId: r.recipient_user_id,
        recipientTeamId: r.recipient_team_id,
      };
    }),
  ];
  if (!given.length) return [];

  const userIds = [...new Set(given.map((a) => a.recipientUserId).filter((x): x is string => !!x))];
  const teamIds = [...new Set([...given.map((a) => a.recipientTeamId), f.teamId].filter((x): x is string => !!x))];
  const [users, teamRows] = await Promise.all([
    userIds.length ? db.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    teamIds.length
      ? db.teams.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true, team_members: { where: { is_active: true }, select: { users: { select: { id: true, name: true } } } } },
      })
      : [],
  ]);
  const teams = new Map(teamRows.map((t) => [t.id, { name: t.name, members: t.team_members.map((m) => m.users) }]));
  return expandAwards(given, new Map(users.map((u) => [u.id, u.name])), teams, f.teamId).slice(0, limit);
}
