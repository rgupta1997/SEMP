import { Router } from 'express';
import { awardTypeSchema, awardTypeSportsSchema, updateAwardTypeSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { awardTypeInclude, awardTypeUsage, awardTypeView, setAwardTypeSports } from './award-types.service.js';

// The global award catalogue, super-admin only: create award types and map/unmap
// them to sports. An organiser's own extras (championship_id set) are not listed here.
export function makeAwardTypesAdminRouter(prisma: Prisma): Router {
  const router = Router();
  router.use(requireSuperAdmin);

  const load = async (id: string) => {
    const row = await prisma.award_types.findFirst({ where: { id, championship_id: null }, include: awardTypeInclude });
    if (!row) throw new NotFoundError('Award type');
    return row;
  };

  router.get('/', asyncHandler(async (req, res) => {
    const sportId = typeof req.query.sport_id === 'string' && req.query.sport_id ? req.query.sport_id : null;
    const rows = await prisma.award_types.findMany({
      where: {
        championship_id: null,
        ...(sportId ? { OR: [{ all_sports: true }, { award_type_sports: { some: { sport_id: sportId } } }] } : {}),
      },
      include: awardTypeInclude,
      orderBy: [{ sort_order: 'asc' }, { label: 'asc' }],
    });
    const [m, c] = await Promise.all([
      prisma.fixture_awards.groupBy({ by: ['award_type_id'], _count: { _all: true }, where: { award_type_id: { not: null } } }),
      prisma.championship_awards.groupBy({ by: ['award_type_id'], _count: { _all: true } }),
    ]);
    const usage = new Map<string, number>();
    for (const g of [...m, ...c]) if (g.award_type_id) usage.set(g.award_type_id, (usage.get(g.award_type_id) ?? 0) + g._count._all);
    res.json(rows.map((r) => ({ ...awardTypeView(r), usage: usage.get(r.id) ?? 0 })));
  }));

  router.post('/', validateBody(awardTypeSchema), asyncHandler(async (req, res) => {
    const { sport_ids, ...data } = req.body as ReturnType<typeof awardTypeSchema.parse>;
    const clash = await prisma.award_types.findFirst({ where: { code: data.code, championship_id: null } });
    if (clash) throw new ConflictError(`An award type with code "${data.code}" already exists`);
    const id = await prisma.$transaction(async (tx) => {
      const created = await tx.award_types.create({ data: { ...data, created_by: req.user!.id } });
      await setAwardTypeSports(tx, created.id, data.all_sports, sport_ids);
      return created.id;
    });
    const row = await load(id);
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeCreated,
      target: { type: 'award_types', id, label: row.label },
      summary: `Created award type "${row.label}"`,
    });
    res.status(201).json(awardTypeView(row));
  }));

  router.patch('/:id', validateBody(updateAwardTypeSchema), asyncHandler(async (req, res) => {
    const before = await load(req.params.id);
    const { sport_ids, ...data } = req.body as ReturnType<typeof updateAwardTypeSchema.parse>;
    await prisma.$transaction(async (tx) => {
      await tx.award_types.update({ where: { id: before.id }, data: { ...data, updated_at: new Date() } });
      if (data.all_sports !== undefined || sport_ids !== undefined) {
        await setAwardTypeSports(tx, before.id, data.all_sports ?? before.all_sports, sport_ids ?? before.award_type_sports.map((s) => s.sport_id));
      }
    });
    const after = await load(before.id);
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['label', 'description', 'levels', 'recipient_kind', 'is_active', 'sort_order', 'all_sports'] as const) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) diff[k] = { from: before[k], to: after[k] };
    }
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeUpdated,
      target: { type: 'award_types', id: after.id, label: after.label },
      summary: `Updated award type "${after.label}"`,
      diff,
    });
    res.json(awardTypeView(after));
  }));

  // Map/unmap sports in one go.
  router.put('/:id/sports', validateBody(awardTypeSportsSchema), asyncHandler(async (req, res) => {
    const before = await load(req.params.id);
    const { all_sports, sport_ids } = req.body as ReturnType<typeof awardTypeSportsSchema.parse>;
    await prisma.$transaction((tx) => setAwardTypeSports(tx, before.id, all_sports, sport_ids));
    const after = await load(before.id);
    const names = (r: typeof before) => (r.all_sports ? ['All sports'] : r.award_type_sports.map((s) => s.sports?.name ?? s.sport_id).sort());
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeUpdated,
      target: { type: 'award_types', id: after.id, label: after.label },
      summary: `Changed the sports for "${after.label}"`,
      diff: { sports: { from: names(before), to: names(after) } },
    });
    res.json(awardTypeView(after));
  }));

  // A type that has been given is deactivated rather than deleted, so history keeps it.
  router.delete('/:id', asyncHandler(async (req, res) => {
    const row = await load(req.params.id);
    const used = await awardTypeUsage(prisma, row.id);
    if (used > 0) {
      await prisma.award_types.update({ where: { id: row.id }, data: { is_active: false, updated_at: new Date() } });
    } else {
      await prisma.award_types.delete({ where: { id: row.id } });
    }
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.awardTypeDeleted,
      target: { type: 'award_types', id: row.id, label: row.label },
      summary: used > 0
        ? `Deactivated award type "${row.label}" (given ${used} time${used === 1 ? '' : 's'}, so kept for history)`
        : `Deleted award type "${row.label}"`,
    });
    res.json({ result: used > 0 ? 'deactivated' : 'deleted' });
  }));

  return router;
}
