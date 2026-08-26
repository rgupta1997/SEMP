import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';

// The institution's own shape (J1-E4): Institution → Programme → Batch.
//
// Two levels, typed, because that is the shape reports group by. The counts are
// derived on every read rather than stored: a stored count is a number that goes
// quietly wrong the first time somebody is moved between batches, and it would be
// wrong in the one place - a report to leadership - where nobody would catch it.

const createUnitSchema = z.object({
  type: z.enum(['programme', 'batch']),
  name: z.string().min(1).max(80),
  code: z.string().max(24).optional(),
  // Required for a batch, forbidden for a programme - checked in the handler where a
  // useful message can be given.
  parent_id: z.string().uuid().optional(),
  display_order: z.number().int().optional(),
});

const updateUnitSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  code: z.string().max(24).nullable().optional(),
  display_order: z.number().int().optional(),
});

export interface OrgUnitNode {
  id: string;
  type: string;
  name: string;
  code: string | null;
  display_order: number;
  /** Derived, never stored. Includes people in this unit's batches. */
  member_count: number;
  children: OrgUnitNode[];
}

export function makeOrgUnitsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // Reading the structure is open to any member - people need to see the programme
  // they are in. Editing it is the sports office's job.
  const orgAdmin = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    if (await guards.orgRole(u.id, req.params.id, ['owner', 'admin'])) return next();
    throw new ForbiddenError('Only an organization owner/admin can change the structure');
  });

  // One query for the units, one for the counts, assembled in memory: a tree this
  // small (a few dozen nodes) is not worth a recursive CTE, and the counts have to be
  // rolled up from batches to programmes anyway.
  async function readTree(organizationId: string): Promise<OrgUnitNode[]> {
    const [units, counts] = await Promise.all([
      prisma.org_units.findMany({
        where: { organization_id: organizationId },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
      }),
      prisma.organization_members.groupBy({
        by: ['org_unit_id'],
        where: { organization_id: organizationId, org_unit_id: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const direct = new Map(counts.map((c) => [c.org_unit_id as string, c._count._all]));
    const nodes = new Map<string, OrgUnitNode>(units.map((u) => [u.id, {
      id: u.id, type: u.type, name: u.name, code: u.code,
      display_order: u.display_order,
      member_count: direct.get(u.id) ?? 0,
      children: [],
    }]));

    const roots: OrgUnitNode[] = [];
    for (const u of units) {
      const node = nodes.get(u.id)!;
      const parent = u.parent_id ? nodes.get(u.parent_id) : null;
      if (parent) {
        parent.children.push(node);
        // A programme's count is its own people plus everyone in its batches -
        // otherwise "PGP: 0, PGP 2024: 120" reads as a bug to anybody looking at it.
        parent.member_count += node.member_count;
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  router.get('/:id/units', asyncHandler(async (req, res) => {
    res.json(await readTree(req.params.id));
  }));

  router.post('/:id/units', orgAdmin, validateBody(createUnitSchema), asyncHandler(async (req, res) => {
    const { type, name, code, parent_id, display_order } = req.body as z.infer<typeof createUnitSchema>;

    if (type === 'batch' && !parent_id) throw new BusinessRuleError('A batch belongs to a programme - pick one');
    if (type === 'programme' && parent_id) throw new BusinessRuleError('A programme sits at the top level and has no parent');

    if (parent_id) {
      const parent = await prisma.org_units.findFirst({
        where: { id: parent_id, organization_id: req.params.id },
        select: { type: true },
      });
      if (!parent) throw new NotFoundError('Programme');
      // Two levels, deliberately (see the migration header).
      if (parent.type !== 'programme') throw new BusinessRuleError('Batches sit inside a programme, not inside another batch');
    }

    const row = await prisma.org_units.create({
      data: {
        organization_id: req.params.id,
        type, name: name.trim(), code: code?.trim() || null,
        parent_id: parent_id ?? null,
        display_order: display_order ?? 0,
      },
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgUnitCreated,
      target: { type: 'org_units', id: row.id, label: row.name },
      organizationId: req.params.id,
      summary: `Added the ${type} ${row.name}`,
    });

    res.status(201).json(row);
  }));

  router.patch('/:id/units/:unitId', orgAdmin, validateBody(updateUnitSchema), asyncHandler(async (req, res) => {
    const before = await prisma.org_units.findFirst({ where: { id: req.params.unitId, organization_id: req.params.id } });
    if (!before) throw new NotFoundError('Unit');

    const row = await prisma.org_units.update({ where: { id: before.id }, data: req.body });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgUnitUpdated,
      target: { type: 'org_units', id: row.id, label: row.name },
      organizationId: req.params.id,
      summary: before.name === row.name ? `Updated ${row.name}` : `Renamed ${before.name} to ${row.name}`,
      diff: {
        ...(before.name !== row.name ? { name: { from: before.name, to: row.name } } : {}),
        ...(before.code !== row.code ? { code: { from: before.code, to: row.code } } : {}),
        ...(before.display_order !== row.display_order ? { display_order: { from: before.display_order, to: row.display_order } } : {}),
      },
    });

    res.json(row);
  }));

  // What deleting would actually cost, so the UI can say it before asking. A count is
  // the difference between "are you sure?" and "this affects 118 people".
  router.get('/:id/units/:unitId/impact', orgAdmin, asyncHandler(async (req, res) => {
    const unit = await prisma.org_units.findFirst({
      where: { id: req.params.unitId, organization_id: req.params.id },
      select: { id: true, name: true, type: true },
    });
    if (!unit) throw new NotFoundError('Unit');

    const children = await prisma.org_units.findMany({ where: { parent_id: unit.id }, select: { id: true, name: true } });
    const ids = [unit.id, ...children.map((c) => c.id)];
    const members = await prisma.organization_members.count({ where: { org_unit_id: { in: ids } } });

    res.json({ unit, batches: children, members });
  }));

  router.delete('/:id/units/:unitId', orgAdmin, asyncHandler(async (req, res) => {
    const unit = await prisma.org_units.findFirst({
      where: { id: req.params.unitId, organization_id: req.params.id },
      select: { id: true, name: true, type: true },
    });
    if (!unit) throw new NotFoundError('Unit');

    const children = await prisma.org_units.findMany({ where: { parent_id: unit.id }, select: { id: true } });
    const ids = [unit.id, ...children.map((c) => c.id)];
    const affected = await prisma.organization_members.count({ where: { org_unit_id: { in: ids } } });

    // The people survive; only their placement goes. That is the FK's ON DELETE SET
    // NULL doing the work, and the batches cascade - but the count is read first so
    // the audit entry can say how many people this actually touched.
    await prisma.org_units.delete({ where: { id: unit.id } });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgUnitDeleted,
      target: { type: 'org_units', id: unit.id, label: unit.name },
      organizationId: req.params.id,
      summary: `Removed the ${unit.type} ${unit.name}${affected ? `, clearing the placement of ${affected} ${affected === 1 ? 'person' : 'people'}` : ''}`,
      diff: { members_unplaced: { from: null, to: affected }, batches_removed: { from: null, to: children.length } },
    });

    res.json({ ok: true, members_unplaced: affected, batches_removed: children.length });
  }));

  return router;
}
