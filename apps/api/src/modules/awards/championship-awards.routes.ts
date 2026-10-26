import { Router } from 'express';
import { awardTypeSchema, championshipAwardScopeSchema, championshipAwardsSchema, updateAwardTypeSchema } from '@semp/shared';
import { notify } from '@semp/notifications/server/notify.js';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { refreshAwardCareerStats, syncScopeAchievements } from './award-achievements.service.js';
import { awardTypeInclude, awardTypeUsage, awardTypeView, setAwardTypeSports } from './award-types.service.js';
import {
  resolveAwardScope, scopeAwardTypes, scopeParticipants, scopeWhere, toChampionshipAwardRows,
  type AwardScope, type ChampionshipAwardInput, type ScopeInput,
} from './championship-awards.service.js';

// Organiser awards for one championship (mounted under /championships):
//   - awards given for a sport within a tournament, a whole tournament, or the event
//   - the event's own award types, on top of the super admin's global list
// Everything here is the championship's organisers' (or a super admin's).
export function makeChampionshipAwardsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const manager = guards.championshipManager(async (req) => req.params.id);
  // Reads are the whole organising team's, sport organisers included.
  const viewer = guards.championshipViewer(async (req) => req.params.id);

  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const scopeFromQuery = (q: Record<string, unknown>): ScopeInput => {
    const parsed = championshipAwardScopeSchema.safeParse({
      level: q.level, tournament_id: str(q.tournament_id), tournament_sport_id: str(q.tournament_sport_id),
    });
    if (!parsed.success) throw new ValidationError('Pass level (tournament_sport, tournament or championship) and its scope');
    return parsed.data;
  };

  const awardInclude = {
    recipient: { select: { name: true } },
    teams: { select: { name: true } },
    award_types: { select: { code: true, recipient_kind: true } },
    tournaments: { select: { name: true } },
    tournament_sports: { select: { sports: { select: { name: true } } } },
  } as const;

  type AwardRowWithNames = Awaited<ReturnType<typeof prisma.championship_awards.findMany<{ include: typeof awardInclude }>>>[number];
  const awardView = (a: AwardRowWithNames) => ({
    id: a.id,
    level: a.level,
    tournament_id: a.tournament_id,
    tournament_sport_id: a.tournament_sport_id,
    tournament_name: a.tournaments?.name ?? null,
    sport_name: a.tournament_sports?.sports?.name ?? null,
    award_type_id: a.award_type_id,
    award_type_code: a.award_types.code,
    award_name: a.award_name,
    recipient_kind: a.award_types.recipient_kind as 'player' | 'team',
    recipient_user_id: a.recipient_user_id,
    recipient_team_id: a.recipient_team_id,
    recipient_name: a.recipient?.name ?? a.teams?.name ?? null,
    notes: a.notes,
  });

  // The event's honours board, for everyone who can see its results: the awards above
  // match level, and every match's awards by fixture. Read-only, like standings.
  router.get('/:id/awards/board', asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const [event, match] = await Promise.all([
      prisma.championship_awards.findMany({
        where: { championship_id: championshipId },
        include: awardInclude,
        orderBy: [{ level: 'asc' }, { created_at: 'asc' }],
      }),
      prisma.fixture_awards.findMany({
        where: { fixtures: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } } } },
        select: {
          id: true, fixture_id: true, award_name: true, recipient_team_id: true,
          users: { select: { name: true } }, teams: { select: { name: true } },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    res.json({
      event: event.map(awardView),
      match: match.map((a) => ({
        id: a.id,
        fixture_id: a.fixture_id,
        award_name: a.award_name,
        recipient_name: a.users?.name ?? a.teams?.name ?? null,
        team_award: !!a.recipient_team_id,
      })),
    });
  }));

  // Everything this event has given, every scope.
  router.get('/:id/awards', viewer, asyncHandler(async (req, res) => {
    const rows = await prisma.championship_awards.findMany({
      where: { championship_id: req.params.id },
      include: awardInclude,
      orderBy: [{ level: 'asc' }, { created_at: 'asc' }],
    });
    res.json(rows.map(awardView));
  }));

  // The event's tournaments and their sports - the scopes an award can be given in.
  router.get('/:id/awards/scopes', viewer, asyncHandler(async (req, res) => {
    const tournaments = await prisma.tournaments.findMany({
      where: { championship_id: req.params.id },
      select: {
        id: true, name: true,
        tournament_sports: {
          select: { id: true, sport_id: true, sports: { select: { name: true } } },
          orderBy: { display_order: 'asc' },
        },
      },
      orderBy: { created_at: 'asc' },
    });
    res.json(tournaments.map((t) => ({
      id: t.id,
      name: t.name,
      sports: t.tournament_sports.map((ts) => ({ id: ts.id, sport_id: ts.sport_id, name: ts.sports?.name ?? '' })),
    })));
  }));

  // What can be given in one scope, and to whom.
  router.get('/:id/awards/options', viewer, asyncHandler(async (req, res) => {
    const scope = await resolveAwardScope(prisma, req.params.id, scopeFromQuery(req.query));
    const [types, participants] = await Promise.all([scopeAwardTypes(prisma, scope), scopeParticipants(prisma, scope)]);
    res.json({ types, ...participants });
  }));

  // Replace one scope's awards.
  router.put('/:id/awards', manager, validateBody(championshipAwardsSchema), asyncHandler(async (req, res) => {
    const { awards, ...scopeInput } = req.body as ReturnType<typeof championshipAwardsSchema.parse>;
    const scope = await resolveAwardScope(prisma, req.params.id, scopeInput);
    const [types, participants] = await Promise.all([scopeAwardTypes(prisma, scope), scopeParticipants(prisma, scope)]);
    const rows = toChampionshipAwardRows(awards as ChampionshipAwardInput[], types, participants, scope);

    const key = (r: { award_type_id: string; recipient_user_id: string | null; recipient_team_id: string | null }) =>
      `${r.award_type_id}|${r.recipient_user_id ?? ''}|${r.recipient_team_id ?? ''}`;
    const before = new Set((await prisma.championship_awards.findMany({ where: scopeWhere(scope) })).map(key));

    // The awards and the achievements they make are one change: both or neither.
    const touched = await prisma.$transaction(async (tx) => {
      await tx.championship_awards.deleteMany({ where: scopeWhere(scope) });
      if (rows.length) await tx.championship_awards.createMany({ data: rows.map((r) => ({ ...r, awarded_by: req.user!.id })) });
      return syncScopeAchievements(tx, scope);
    });
    await refreshAwardCareerStats(prisma, touched);

    await notifyNewChampionshipAwards(prisma, scope, rows.filter((r) => !before.has(key(r))), req.user!.id);

    const saved = await prisma.championship_awards.findMany({ where: scopeWhere(scope), include: awardInclude, orderBy: { created_at: 'asc' } });
    res.json(saved.map(awardView));
  }));

  // ---- The event's own award types ----

  const loadOwnType = async (championshipId: string, typeId: string) => {
    const row = await prisma.award_types.findFirst({ where: { id: typeId, championship_id: championshipId }, include: awardTypeInclude });
    if (!row) throw new NotFoundError('Award type for this event');
    return row;
  };
  // An event's own type can only be mapped to sports the event actually runs.
  const assertEventSports = async (championshipId: string, sportIds: string[] | undefined) => {
    if (!sportIds?.length) return;
    const scope = await resolveAwardScope(prisma, championshipId, { level: 'championship' });
    const foreign = sportIds.filter((id) => !scope.sportIds.includes(id));
    if (foreign.length) throw new ValidationError('Map it only to sports in this event');
  };

  router.get('/:id/award-types', viewer, asyncHandler(async (req, res) => {
    const rows = await prisma.award_types.findMany({
      where: { championship_id: req.params.id },
      include: awardTypeInclude,
      orderBy: [{ sort_order: 'asc' }, { label: 'asc' }],
    });
    res.json(await Promise.all(rows.map(async (r) => ({ ...awardTypeView(r), usage: await awardTypeUsage(prisma, r.id) }))));
  }));

  router.post('/:id/award-types', manager, validateBody(awardTypeSchema), asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const { sport_ids, ...data } = req.body as ReturnType<typeof awardTypeSchema.parse>;
    await assertEventSports(championshipId, data.all_sports ? [] : sport_ids);
    const clash = await prisma.award_types.findFirst({ where: { code: data.code, championship_id: championshipId } });
    if (clash) throw new ConflictError(`This event already has an award with code "${data.code}"`);
    const id = await prisma.$transaction(async (tx) => {
      const created = await tx.award_types.create({ data: { ...data, championship_id: championshipId, created_by: req.user!.id } });
      await setAwardTypeSports(tx, created.id, data.all_sports, sport_ids);
      return created.id;
    });
    const row = await loadOwnType(championshipId, id);
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeCreated,
      championshipId,
      target: { type: 'award_types', id, label: row.label },
      summary: `Added the event award "${row.label}"`,
    });
    res.status(201).json(awardTypeView(row));
  }));

  router.patch('/:id/award-types/:typeId', manager, validateBody(updateAwardTypeSchema), asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const before = await loadOwnType(championshipId, req.params.typeId);
    const { sport_ids, ...data } = req.body as ReturnType<typeof updateAwardTypeSchema.parse>;
    const allSports = data.all_sports ?? before.all_sports;
    await assertEventSports(championshipId, allSports ? [] : sport_ids);
    await prisma.$transaction(async (tx) => {
      await tx.award_types.update({ where: { id: before.id }, data: { ...data, updated_at: new Date() } });
      if (data.all_sports !== undefined || sport_ids !== undefined) {
        await setAwardTypeSports(tx, before.id, allSports, sport_ids ?? before.award_type_sports.map((s) => s.sport_id));
      }
    });
    const after = await loadOwnType(championshipId, before.id);
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeUpdated,
      championshipId,
      target: { type: 'award_types', id: after.id, label: after.label },
      summary: `Updated the event award "${after.label}"`,
    });
    res.json(awardTypeView(after));
  }));

  router.delete('/:id/award-types/:typeId', manager, asyncHandler(async (req, res) => {
    const championshipId = req.params.id;
    const row = await loadOwnType(championshipId, req.params.typeId);
    const used = await awardTypeUsage(prisma, row.id);
    if (used > 0) await prisma.award_types.update({ where: { id: row.id }, data: { is_active: false, updated_at: new Date() } });
    else await prisma.award_types.delete({ where: { id: row.id } });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeDeleted,
      championshipId,
      target: { type: 'award_types', id: row.id, label: row.label },
      summary: used > 0 ? `Deactivated the event award "${row.label}" (already given)` : `Deleted the event award "${row.label}"`,
    });
    res.json({ result: used > 0 ? 'deactivated' : 'deleted' });
  }));

  return router;
}

// Best-effort, after the save: a player award tells the player, a team award tells
// every active member of the team. One failure never stops the rest.
async function notifyNewChampionshipAwards(
  prisma: Prisma,
  scope: AwardScope,
  awards: Array<{ award_name: string; recipient_user_id: string | null; recipient_team_id: string | null }>,
  senderId: string,
): Promise<void> {
  if (awards.length === 0) return;
  try {
    const [champ, tournament, ts] = await Promise.all([
      prisma.championships.findUnique({ where: { id: scope.championshipId }, select: { name: true } }),
      scope.tournamentId ? prisma.tournaments.findUnique({ where: { id: scope.tournamentId }, select: { name: true } }) : null,
      scope.tournamentSportId
        ? prisma.tournament_sports.findUnique({ where: { id: scope.tournamentSportId }, select: { sports: { select: { name: true } } } })
        : null,
    ]);
    const label = [ts?.sports?.name, tournament?.name ?? champ?.name].filter(Boolean).join(' · ');
    const teamIds = [...new Set(awards.map((a) => a.recipient_team_id).filter((x): x is string => !!x))];
    const members = teamIds.length
      ? await prisma.team_members.findMany({ where: { team_id: { in: teamIds }, is_active: true }, select: { team_id: true, user_id: true } })
      : [];
    for (const a of awards) {
      const userIds = a.recipient_team_id
        ? members.filter((m) => m.team_id === a.recipient_team_id).map((m) => m.user_id)
        : a.recipient_user_id ? [a.recipient_user_id] : [];
      for (const userId of userIds) {
        try {
          await notify(prisma, {
            type: 'tournament_award', championshipId: scope.championshipId, userId, senderId,
            data: { label, awardName: a.award_name },
          });
        } catch (err) {
          console.error(`[awards] notification failed for ${userId} in championship ${scope.championshipId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`[awards] notification setup failed for championship ${scope.championshipId}:`, err);
  }
}
