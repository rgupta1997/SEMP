import type { Db } from '../../infra/prisma.js';

// Recipients step (Games, Disciplines, Teams -> six categories).
//
// Winners and Special awards still come from locked achievements, exactly as before.
// The other four are read straight from the roster/role tables that already exist for
// other reasons - none of them needed new schema, only a new query:
//   - Participation: everyone active on a roster-locked team entry, no win required.
//   - Organising team & volunteers: a championship's "Organiser" role assignments.
//   - Officials & referees: championship_officials (the event_officials table).
//   - Coaches & mentors: teams.coach_user_id, one per team.
//
// Organising team and Officials are genuinely event-wide - neither table has a sport,
// discipline or team column - so Game/Discipline/Team filters never apply to them.

export type RecipientCategory = 'winners' | 'awards' | 'participation' | 'organising' | 'officials' | 'coaches';

export const RECIPIENT_CATEGORIES: RecipientCategory[] = [
  'winners', 'awards', 'participation', 'organising', 'officials', 'coaches',
];

/** Categories scoped by fixture (one certificate per match a person won).
 *  Everything else is scoped by championship (one per person per event). */
export const isFixtureScoped = (c: RecipientCategory) => c === 'winners' || c === 'awards';

export interface RecipientFilters {
  sportId?: string;
  tournamentDisciplineId?: string;
  teamId?: string;
}

export interface Candidate {
  userId: string;
  name: string;
  /** Basic certificate wording for the category - refine later, not final copy. */
  title: string;
  /** null for the four event-scoped categories. */
  fixtureId: string | null;
  sportName: string | null;
  achievementId?: string;
  lockVersion?: number | null;
}

const WINNER_KINDS = ['medal', 'placement', 'record', 'selection', 'honour'];

async function lockedFixtureIds(prisma: Db, championshipId: string, filters: RecipientFilters) {
  const rows = await prisma.fixtures.findMany({
    where: {
      locked_at: { not: null },
      ...(filters.tournamentDisciplineId ? { tournament_discipline_id: filters.tournamentDisciplineId } : {}),
      tournament_disciplines: {
        tournament_sports: {
          tournaments: { championship_id: championshipId },
          ...(filters.sportId ? { sport_id: filters.sportId } : {}),
        },
      },
    },
    select: { id: true },
  });
  return rows.map((f) => f.id);
}

async function winnersAndAwards(
  prisma: Db, championshipId: string, category: 'winners' | 'awards', filters: RecipientFilters, limit: number,
): Promise<Candidate[]> {
  const lockedIds = await lockedFixtureIds(prisma, championshipId, filters);
  if (!lockedIds.length) return [];

  const achievements = await prisma.achievements.findMany({
    where: {
      championship_id: championshipId,
      superseded_at: null, user_id: { not: null },
      kind: { in: category === 'awards' ? ['award'] : WINNER_KINDS },
      fixture_id: { in: lockedIds },
      ...(filters.teamId ? { team_id: filters.teamId } : {}),
    },
    select: { id: true, user_id: true, fixture_id: true, title: true, sport_id: true, lock_version: true },
    orderBy: { occurred_on: 'asc' },
    take: limit,
  });
  if (!achievements.length) return [];

  const userIds = [...new Set(achievements.map((a) => a.user_id!))];
  const sportIds = [...new Set(achievements.map((a) => a.sport_id).filter((s): s is string => !!s))];
  const [users, sports] = await Promise.all([
    prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    sportIds.length ? prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const sportName = new Map(sports.map((s) => [s.id, s.name]));

  return achievements.map((a) => ({
    userId: a.user_id!,
    name: userName.get(a.user_id!) ?? 'Unknown',
    title: a.title,
    fixtureId: a.fixture_id,
    sportName: a.sport_id ? sportName.get(a.sport_id) ?? null : null,
    achievementId: a.id,
    lockVersion: a.lock_version ?? null,
  }));
}

async function participation(prisma: Db, championshipId: string, filters: RecipientFilters, limit: number): Promise<Candidate[]> {
  const entries = await prisma.team_entries.findMany({
    where: {
      championship_id: championshipId,
      status: 'roster_locked',
      ...(filters.tournamentDisciplineId ? { tournament_discipline_id: filters.tournamentDisciplineId } : {}),
      ...(filters.teamId ? { team_id: filters.teamId } : {}),
      ...(filters.sportId ? { teams: { sport_id: filters.sportId } } : {}),
    },
    select: {
      teams: {
        select: {
          sport_id: true,
          team_members: { where: { is_active: true }, select: { user_id: true, users: { select: { id: true, name: true } } } },
        },
      },
    },
    take: limit,
  });

  const sportIds = [...new Set(entries.map((e) => e.teams.sport_id))];
  const sports = sportIds.length ? await prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } }) : [];
  const sportName = new Map(sports.map((s) => [s.id, s.name]));

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const e of entries) {
    const sName = sportName.get(e.teams.sport_id) ?? null;
    for (const m of e.teams.team_members) {
      // The same person can sit on several matching team entries (e.g. two disciplines
      // in the same sport) - one certificate per person per event, so only the first.
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      out.push({ userId: m.user_id, name: m.users.name, title: `Participation in ${sName ?? 'the event'}`, fixtureId: null, sportName: sName });
    }
  }
  return out;
}

async function coaches(prisma: Db, championshipId: string, filters: RecipientFilters, limit: number): Promise<Candidate[]> {
  const entries = await prisma.team_entries.findMany({
    where: {
      championship_id: championshipId,
      ...(filters.tournamentDisciplineId ? { tournament_discipline_id: filters.tournamentDisciplineId } : {}),
      ...(filters.teamId ? { team_id: filters.teamId } : {}),
      teams: { coach_user_id: { not: null }, ...(filters.sportId ? { sport_id: filters.sportId } : {}) },
    },
    select: { teams: { select: { coach_user_id: true, sport_id: true, users: { select: { id: true, name: true } } } } },
    take: limit,
  });

  const sportIds = [...new Set(entries.map((e) => e.teams.sport_id))];
  const sports = sportIds.length ? await prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } }) : [];
  const sportName = new Map(sports.map((s) => [s.id, s.name]));

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const e of entries) {
    const coachId = e.teams.coach_user_id;
    // One certificate per coach per event, however many teams/disciplines they coach.
    if (!coachId || seen.has(coachId) || !e.teams.users) continue;
    seen.add(coachId);
    out.push({ userId: coachId, name: e.teams.users.name, title: 'Coach & Mentor', fixtureId: null, sportName: sportName.get(e.teams.sport_id) ?? null });
  }
  return out;
}

async function organising(prisma: Db, championshipId: string, limit: number): Promise<Candidate[]> {
  const rows = await prisma.user_championship_roles.findMany({
    where: { championship_id: championshipId, roles: { name: 'Organiser' } },
    select: { user_id: true, users_user_championship_roles_user_idTousers: { select: { name: true } } },
    take: limit,
  });
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    out.push({ userId: r.user_id, name: r.users_user_championship_roles_user_idTousers.name, title: 'Organising Committee Member', fixtureId: null, sportName: null });
  }
  return out;
}

async function officials(prisma: Db, championshipId: string, limit: number): Promise<Candidate[]> {
  const rows = await prisma.championship_officials.findMany({
    where: { championship_id: championshipId, is_active: true },
    select: { user_id: true, users_championship_officials_user_idTousers: { select: { name: true } } },
    take: limit,
  });
  return rows.map((r) => ({
    userId: r.user_id, name: r.users_championship_officials_user_idTousers.name,
    title: 'Match Official', fixtureId: null, sportName: null,
  }));
}

/** The pool a category+filters resolves to, before Review-step include/exclude. */
export async function candidatesFor(
  prisma: Db, championshipId: string, category: RecipientCategory, filters: RecipientFilters, limit = 500,
): Promise<Candidate[]> {
  switch (category) {
    case 'winners': return winnersAndAwards(prisma, championshipId, 'winners', filters, limit);
    case 'awards': return winnersAndAwards(prisma, championshipId, 'awards', filters, limit);
    case 'participation': return participation(prisma, championshipId, filters, limit);
    case 'coaches': return coaches(prisma, championshipId, filters, limit);
    // Event-wide by construction - filters have nothing to match against for these two.
    case 'organising': return organising(prisma, championshipId, limit);
    case 'officials': return officials(prisma, championshipId, limit);
    default: return [];
  }
}

/** A candidate's dedup key, matching whichever partial unique index applies to its
 *  category (fixture-scoped for winners/awards, championship-scoped otherwise). */
export const candidateKey = (c: Pick<Candidate, 'userId' | 'fixtureId'>) => `${c.userId}:${c.fixtureId ?? ''}`;

/** Who, in this category, already holds a live certificate for this run's scope -
 *  so the Review step can default them to excluded rather than let the generate
 *  call surface them only as a same-request skip. */
export async function alreadyIssued(
  prisma: Db, organizationId: string, championshipId: string, category: RecipientCategory,
): Promise<Set<string>> {
  const rows = await prisma.certificates.findMany({
    where: { organization_id: organizationId, championship_id: championshipId, recipient_category: category, revoked_at: null, superseded_at: null },
    select: { user_id: true, fixture_id: true },
  });
  return new Set(rows.map((r) => `${r.user_id}:${r.fixture_id ?? ''}`));
}
