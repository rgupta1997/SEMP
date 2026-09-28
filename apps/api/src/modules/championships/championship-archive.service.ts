import type { RequestHandler } from 'express';
import { ARCHIVE_RETENTION_DAYS, ARCHIVED_READ_ONLY_MESSAGE, type ChampionshipRemovalMode } from '@semp/shared';
import type { Db, Prisma } from '../../infra/prisma.js';
import { BusinessRuleError } from '../../shared/errors.js';

// Removing a championship: archive once it has results, delete only while it has none.
//
// "Results" is anything a player or a certificate already points at - a completed
// status, a played or locked match, or an issued certificate. Deleting those would
// strand certificates and leave profiles citing an event that no longer exists, so
// they are archived instead and purged after ARCHIVE_RETENTION_DAYS.

// A walkover is a result; a bye is a slot the draw filled, not a match anyone played.
const PLAYED_FIXTURE_STATUSES = ['completed', 'walkover'];

export interface RemovalInfo {
  mode: ChampionshipRemovalMode;
  /** Why it is archive-only, in words the settings screen can show. */
  reasons: string[];
  archived_at: Date | null;
}

export async function removalInfo(prisma: Prisma, championshipId: string): Promise<RemovalInfo | null> {
  const champ = await prisma.championships.findUnique({
    where: { id: championshipId }, select: { status: true, archived_at: true },
  });
  if (!champ) return null;
  const inEvent = { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } } };
  const [played, locked, certificates] = await Promise.all([
    prisma.fixtures.count({ where: { ...inEvent, status: { in: PLAYED_FIXTURE_STATUSES } } }),
    prisma.fixtures.count({ where: { ...inEvent, scorecard_status: 'locked' } }),
    prisma.certificates.count({ where: { championship_id: championshipId } }),
  ]);
  const reasons = [
    ...(champ.status === 'completed' ? ['the championship is completed'] : []),
    ...(played ? [`${played} match${played === 1 ? ' has' : 'es have'} been played`] : []),
    ...(locked ? [`${locked} scorecard${locked === 1 ? ' is' : 's are'} locked`] : []),
    ...(certificates ? [`${certificates} certificate${certificates === 1 ? ' has' : 's have'} been issued`] : []),
  ];
  return { mode: reasons.length ? 'archive' : 'delete', reasons, archived_at: champ.archived_at };
}

/**
 * Permanently remove a championship and everything that hangs off it.
 *
 * Certificates are DETACHED, not deleted: each carries its own frozen payload (name,
 * result, event name), so it keeps verifying after its event is gone. Players'
 * achievements, timeline and career stats are left as they are - they reference the
 * event by id only, with no foreign key, and stay as history.
 */
export async function hardDeleteChampionship(prisma: Prisma, id: string): Promise<void> {
  const inEvent = { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: id } } } };
  await prisma.$transaction([
    prisma.certificates.updateMany({ where: { OR: [{ championship_id: id }, { fixtures: inEvent }] }, data: { championship_id: null, fixture_id: null } }),
    // Fixtures sit at the bottom - they reference teams, grounds and disciplines.
    prisma.fixtures.deleteMany({ where: inEvent }),
    // Rosters are cross-championship now, so only their entries for this
    // championship are removed - the teams + members survive for other events.
    prisma.team_entries.deleteMany({ where: { championship_id: id } }),
    prisma.tournament_disciplines.deleteMany({ where: { tournament_sports: { tournaments: { championship_id: id } } } }),
    prisma.tournament_sports.deleteMany({ where: { tournaments: { championship_id: id } } }),
    prisma.tournaments.deleteMany({ where: { championship_id: id } }),
    prisma.venue_grounds.deleteMany({ where: { venues: { championship_id: id } } }),
    prisma.venues.deleteMany({ where: { championship_id: id } }),
    prisma.championship_organizations.deleteMany({ where: { championship_id: id } }),
    prisma.user_championship_roles.deleteMany({ where: { championship_id: id } }),
    prisma.championships.delete({ where: { id } }),
  ]);
}

/**
 * Permanently delete every archived championship past its retention date.
 *
 * There is no scheduler (the API is a Lambda), so this runs lazily from the reads
 * that list archived events, and from a super-admin endpoint as the safety net - the
 * same shape as the billing sweep. One failing event is logged and skipped, never
 * allowed to stop the rest.
 */
export async function purgeDueArchivedChampionships(prisma: Prisma): Promise<{ purged: string[] }> {
  const cutoff = new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.championships.findMany({
    where: { archived_at: { not: null, lte: cutoff } }, select: { id: true }, take: 25,
  });
  const purged: string[] = [];
  for (const { id } of due) {
    try {
      await hardDeleteChampionship(prisma, id);
      purged.push(id);
    } catch (err) {
      console.error(`[archive] purge failed for championship ${id}:`, err);
    }
  }
  return { purged };
}

// ---- An archived event is read-only -----------------------------------------

/** Refuse a change to an archived championship, naming the way out. */
export async function assertNotArchived(db: Db, championshipId: string | null | undefined): Promise<void> {
  if (!championshipId) return;
  const champ = await db.championships.findUnique({ where: { id: championshipId }, select: { archived_at: true } });
  if (champ?.archived_at) throw new BusinessRuleError(ARCHIVED_READ_ONLY_MESSAGE);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Archiving and retrieving are the only changes an archived event accepts.
const ALLOWED_WHILE_ARCHIVED = /^\/(archive|retrieve)\/?$/;

/**
 * Mounted on /championships/:id ahead of every event router, so invitations, roles,
 * officials and every other write under an event are refused in one place - rather
 * than each route remembering to ask.
 */
export function blockWritesToArchived(prisma: Prisma): RequestHandler {
  return blockArchivedWritesVia(async (id) => id, { allow: ALLOWED_WHILE_ARCHIVED }, prisma);
}

/**
 * The same guard for a resource that belongs to an event without living under its
 * URL - a fixture, a draw. `championshipOf` maps the route's :id to its event.
 */
export function blockArchivedWritesVia(
  championshipOf: (id: string) => Promise<string | null | undefined>,
  opts: { allow?: RegExp },
  prisma: Prisma,
): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const id = req.params.id;
    if (!id || !UUID.test(id) || opts.allow?.test(req.path)) return next();
    championshipOf(id).then((championshipId) => assertNotArchived(prisma, championshipId)).then(() => next(), next);
  };
}

/** Every write to a fixture - scoring, the live console, results, lock and unlock. */
export function blockFixtureWritesToArchived(prisma: Prisma): RequestHandler {
  return blockArchivedWritesVia(async (id) => (await prisma.fixtures.findUnique({
    where: { id },
    select: { tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } } } },
  }))?.tournament_disciplines?.tournament_sports?.tournaments?.championship_id, {}, prisma);
}

/** Every write to a draw - generating, regenerating and configuring its stages. */
export function blockDrawWritesToArchived(prisma: Prisma): RequestHandler {
  return blockArchivedWritesVia(async (id) => (await prisma.tournament_disciplines.findUnique({
    where: { id },
    select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } },
  }))?.tournament_sports?.tournaments?.championship_id, {}, prisma);
}
