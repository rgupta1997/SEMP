import type { Prisma as PrismaNS } from '@prisma/client';
import type { Db, Prisma } from '../../infra/prisma.js';
import { recomputeCareerStats } from '../records/career-stats.service.js';
import { scopeParticipants, scopeWhere, type AwardScope } from './championship-awards.service.js';

// Sport / tournament / event awards become achievements, so they count on a
// player's honours list and in career stats exactly as match awards do.
//
// Match awards get there through the scorecard lock. These have no lock: the
// organiser's save IS the moment they become true, so every save of a scope
// supersedes what that scope said before and writes what it says now
// (source 'organiser_award', rds-migrations/019).
//
// Career stats are filed per person, per organisation, per sport. An event award
// has no sport of its own, so each row borrows the sport and organisation of the
// team the person played for in that scope.

export const AWARD_ACHIEVEMENT_SOURCE = 'organiser_award';

/** Identifies one scope's rows in achievements.detail, for superseding. */
export const scopeKey = (scope: AwardScope) =>
  `${scope.level}:${scope.tournamentSportId ?? scope.tournamentId ?? scope.championshipId}`;

export interface ScopeAward {
  award_type_code: string;
  award_name: string;
  recipient_user_id: string | null;
  recipient_team_id: string | null;
  notes: string | null;
  /** When the organiser gave it - the achievement's date. */
  given_at: Date;
}

export interface ScopeTeamInfo {
  id: string;
  name: string;
  organization_id: string;
  sport_id: string;
  member_ids: string[];
}

export interface AwardAchievementRow {
  user_id: string;
  organization_id: string | null;
  sport_id: string | null;
  title: string;
  detail: Record<string, unknown>;
  occurred_on: Date;
}

/** One achievement per person an award reaches. Pure. */
export function awardAchievementRows(
  awards: ScopeAward[],
  teams: ScopeTeamInfo[],
  scope: AwardScope,
  scopeLabel: string,
): AwardAchievementRow[] {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamOfPlayer = new Map<string, ScopeTeamInfo>();
  for (const t of teams) for (const id of t.member_ids) if (!teamOfPlayer.has(id)) teamOfPlayer.set(id, t);

  const rows: AwardAchievementRow[] = [];
  for (const a of awards) {
    const team = a.recipient_team_id ? teamById.get(a.recipient_team_id) : undefined;
    const people = team ? team.member_ids : a.recipient_user_id ? [a.recipient_user_id] : [];
    for (const userId of people) {
      const t = team ?? teamOfPlayer.get(userId);
      rows.push({
        user_id: userId,
        organization_id: t?.organization_id ?? null,
        sport_id: t?.sport_id ?? null,
        title: `${a.award_name} - ${scopeLabel}`,
        detail: {
          award_type_code: a.award_type_code,
          award_name: a.award_name,
          award_level: scope.level,
          award_scope: scopeKey(scope),
          ...(team ? { team_award: true, award_team_id: team.id, team_name: team.name } : {}),
          ...(a.notes ? { notes: a.notes } : {}),
        },
        occurred_on: a.given_at,
      });
    }
  }
  return rows;
}

const liveScopeRows = (scope: AwardScope): PrismaNS.achievementsWhereInput => ({
  source: AWARD_ACHIEVEMENT_SOURCE,
  championship_id: scope.championshipId,
  superseded_at: null,
  detail: { path: ['award_scope'], equals: scopeKey(scope) },
});

/** Re-derives one scope's achievements; returns who they touched, before and after. */
export async function syncScopeAchievements(db: Db, scope: AwardScope): Promise<Array<{ user_id: string; organization_id: string }>> {
  const [awards, participants, before, champ, tournament, ts] = await Promise.all([
    db.championship_awards.findMany({
      where: scopeWhere(scope),
      select: { award_name: true, recipient_user_id: true, recipient_team_id: true, notes: true, created_at: true, award_types: { select: { code: true } } },
      orderBy: { created_at: 'asc' },
    }),
    scopeParticipants(db, scope),
    db.achievements.findMany({ where: liveScopeRows(scope), select: { user_id: true, organization_id: true } }),
    db.championships.findUnique({ where: { id: scope.championshipId }, select: { name: true } }),
    scope.tournamentId ? db.tournaments.findUnique({ where: { id: scope.tournamentId }, select: { name: true } }) : null,
    scope.tournamentSportId
      ? db.tournament_sports.findUnique({ where: { id: scope.tournamentSportId }, select: { sports: { select: { name: true } } } })
      : null,
  ]);

  const members = participants.teams.length
    ? await db.team_members.findMany({ where: { team_id: { in: participants.teams.map((t) => t.id) }, is_active: true }, select: { team_id: true, user_id: true } })
    : [];
  const teams: ScopeTeamInfo[] = participants.teams.map((t) => ({
    id: t.id, name: t.name, organization_id: t.organization_id, sport_id: t.sport_id,
    member_ids: members.filter((m) => m.team_id === t.id).map((m) => m.user_id),
  }));

  const scopeLabel = [ts?.sports?.name, scope.level === 'championship' ? null : tournament?.name, champ?.name].filter(Boolean).join(' · ');
  const rows = awardAchievementRows(
    // Dated the day it was given, the same date the player's awards list shows.
    awards.map(({ award_types, created_at, ...a }) => ({ ...a, award_type_code: award_types.code, given_at: created_at })),
    teams, scope, scopeLabel,
  );

  await db.achievements.updateMany({ where: liveScopeRows(scope), data: { superseded_at: new Date() } });
  if (rows.length) {
    await db.achievements.createMany({
      data: rows.map((r) => ({
        ...r,
        detail: r.detail as PrismaNS.InputJsonValue,
        championship_id: scope.championshipId,
        fixture_id: null,
        team_id: null,
        kind: 'award',
        medal: null,
        source: AWARD_ACHIEVEMENT_SOURCE,
      })),
    });
  }

  const touched = new Map<string, { user_id: string; organization_id: string }>();
  for (const r of [...before, ...rows]) {
    if (r.user_id && r.organization_id) touched.set(`${r.user_id}|${r.organization_id}`, { user_id: r.user_id, organization_id: r.organization_id });
  }
  return [...touched.values()];
}

/** Career stats for everyone a save touched. Best-effort, after the commit. */
export async function refreshAwardCareerStats(prisma: Prisma, people: Array<{ user_id: string; organization_id: string }>): Promise<void> {
  for (const p of people) {
    try {
      await recomputeCareerStats(prisma, p.user_id, p.organization_id);
    } catch (err) {
      console.error(`[awards] career stats refresh failed for ${p.user_id}:`, err);
    }
  }
}
