import { Router } from 'express';
import { z } from 'zod';
import { UNIT_TYPES, unitLabels } from '@semp/shared';
import { assertCapability } from '@semp/entitlements/server';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';

// The institution's own shape (J1-E4): Organisation -> Campus -> Department.
//
// Two levels, typed, because that is the shape reports group by AND the shape an
// intra-organisation championship competes along: a campus-level event has one
// entrant per campus row here, a department-level event one per department. The
// nouns are per-organisation labels (a college says Campus/Batch, a company says
// Office/Department) and never change the structure - see @semp/shared
// org-structure.ts.
//
// The counts are derived on every read rather than stored: a stored count is a
// number that goes quietly wrong the first time somebody is moved between
// departments, and it would be wrong in the one place - a report to leadership -
// where nobody would catch it.

const createUnitSchema = z.object({
  type: z.enum(UNIT_TYPES),
  name: z.string().min(1).max(80),
  code: z.string().max(24).optional(),
  // Required for a department, forbidden for a campus - checked in the handler where
  // a useful message can be given.
  parent_id: z.string().uuid().optional(),
  display_order: z.number().int().optional(),
  // SETUP means "created, not yet in use": a legitimate scope for a role grant, and
  // not yet offered as an entrant to a championship.
  status: z.enum(['ACTIVE', 'SETUP', 'ARCHIVED']).optional(),
  admin_user_id: z.string().uuid().nullable().optional(),
});

const updateUnitSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  code: z.string().max(24).nullable().optional(),
  display_order: z.number().int().optional(),
  status: z.enum(['ACTIVE', 'SETUP', 'ARCHIVED']).optional(),
  admin_user_id: z.string().uuid().nullable().optional(),
  // Moving a department to another campus. Null is not accepted - a department
  // without a campus has no place in the tree, and the way to remove one is to
  // delete it, not to orphan it.
  parent_id: z.string().uuid().optional(),
});

export interface OrgUnitNode {
  id: string;
  type: string;
  name: string;
  code: string | null;
  display_order: number;
  status: string;
  admin: { id: string; name: string } | null;
  /** Derived, never stored. Includes people in this unit's departments. */
  member_count: number;
  /** Teams that play FOR this unit - the squad count a campus card shows. */
  team_count: number;
  /** Championships this unit has been entered into. */
  event_count: number;
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
    const [units, memberCounts, teamCounts, entryRows] = await Promise.all([
      prisma.org_units.findMany({
        where: { organization_id: organizationId },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
        include: { users: { select: { id: true, name: true } } },
      }),
      // From the join table: a person in a campus AND a department beneath it is
      // counted in both, which is the honest answer to "how many of my people" and
      // means per-unit counts sum to more than the headcount.
      prisma.org_unit_members.groupBy({
        by: ['org_unit_id'],
        where: { organization_id: organizationId },
        _count: { _all: true },
      }),
      prisma.teams.groupBy({
        by: ['org_unit_id'],
        where: { organization_id: organizationId, org_unit_id: { not: null } },
        _count: { _all: true },
      }),
      // Distinct championships, not entry rows: one campus entering six draws of one
      // championship has taken part in ONE event, and a card reading "6 events" for a
      // campus that went to a single meet is a number leadership would act on.
      prisma.championship_organizations.findMany({
        where: { organization_id: organizationId, org_unit_id: { not: null } },
        select: { org_unit_id: true, championship_id: true },
        distinct: ['org_unit_id', 'championship_id'],
      }),
    ]);

    const direct = new Map(memberCounts.map((c) => [c.org_unit_id, c._count?._all ?? 0]));
    const teams = new Map(teamCounts.map((c) => [c.org_unit_id as string, c._count._all]));
    const events = new Map<string, number>();
    for (const e of entryRows) events.set(e.org_unit_id!, (events.get(e.org_unit_id!) ?? 0) + 1);

    const nodes = new Map<string, OrgUnitNode>(units.map((u) => [u.id, {
      id: u.id, type: u.type, name: u.name, code: u.code,
      display_order: u.display_order,
      status: u.status,
      admin: u.users ? { id: u.users.id, name: u.users.name } : null,
      member_count: direct.get(u.id) ?? 0,
      team_count: teams.get(u.id) ?? 0,
      event_count: events.get(u.id) ?? 0,
      children: [],
    }]));

    const roots: OrgUnitNode[] = [];
    for (const u of units) {
      const node = nodes.get(u.id)!;
      const parent = u.parent_id ? nodes.get(u.parent_id) : null;
      if (parent) {
        parent.children.push(node);
        // Teams still roll up - a department's squad is one of its campus's squads.
        // PEOPLE deliberately do NOT: placement is now explicit per unit, so somebody
        // in Bangalore AND Sales already appears in both counts and adding them
        // together would count them twice on the campus row.
        parent.team_count += node.team_count;
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  // The tree, plus the nouns this organisation calls its levels. Returned together
  // because a client that fetched them separately would render "Campus" for a moment
  // before flipping to "Office", and would show the wrong word entirely if the
  // second call failed.
  router.get('/:id/units', asyncHandler(async (req, res) => {
    const [tree, org] = await Promise.all([
      readTree(req.params.id),
      prisma.organizations.findUnique({ where: { id: req.params.id }, select: { settings: true } }),
    ]);
    res.json({ units: tree, labels: unitLabels(org?.settings) });
  }));

  // What this organisation calls its two levels. Stored in the settings blob beside
  // module access rather than as columns: it is presentation, and the STRUCTURE it
  // describes is what everything else keys on.
  router.patch('/:id/unit-labels', orgAdmin, validateBody(z.object({
    campus: z.string().trim().min(1).max(24),
    department: z.string().trim().min(1).max(24),
  })), asyncHandler(async (req, res) => {
    const org = await prisma.organizations.findUnique({ where: { id: req.params.id }, select: { settings: true } });
    if (!org) throw new NotFoundError('Organization');
    const before = unitLabels(org.settings);
    const labels = { campus: req.body.campus, department: req.body.department };
    // Merged, never replaced: `settings` also carries module access, retention and
    // billing keys that have nothing to do with what a campus is called.
    await prisma.organizations.update({
      where: { id: req.params.id },
      data: { settings: { ...(org.settings as object ?? {}), unit_labels: labels } },
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgSettingsChanged,
      target: { type: 'organizations', id: req.params.id, label: 'Structure labels' },
      organizationId: req.params.id,
      summary: `Renamed the structure levels to ${labels.campus} / ${labels.department}`,
      diff: { unit_labels: { from: before, to: labels } },
    });
    res.json({ labels });
  }));

  /**
   * The person named as a unit's administrator has to be a member of the
   * organisation that owns it.
   *
   * Not decoration: this row is what a campus-scoped role grant points at, and
   * naming somebody outside the institution would put a stranger's name on an
   * institution's structure with no membership to revoke.
   */
  async function assertAdminIsMember(organizationId: string, userId: string | null | undefined) {
    if (!userId) return;
    const member = await prisma.organization_members.findFirst({
      where: { user_id: userId, organization_id: organizationId, status: 'active' },
      select: { id: true },
    });
    if (!member) throw new BusinessRuleError('The person you named is not an active member of this organisation');
  }

  router.post('/:id/units', orgAdmin, validateBody(createUnitSchema), asyncHandler(async (req, res) => {
    const { type, name, code, parent_id, display_order, status, admin_user_id } = req.body as z.infer<typeof createUnitSchema>;
    const labels = unitLabels((await prisma.organizations.findUnique({
      where: { id: req.params.id }, select: { settings: true },
    }))?.settings);

    // The messages use this organisation's own nouns. A company that renamed its
    // levels to Office/Department should never be told what a "campus" needs.
    if (type === 'department' && !parent_id) {
      throw new BusinessRuleError(`A ${labels.department.toLowerCase()} belongs to a ${labels.campus.toLowerCase()} - pick one`);
    }
    if (type === 'campus' && parent_id) {
      throw new BusinessRuleError(`A ${labels.campus.toLowerCase()} sits at the top level and has no parent`);
    }

    if (parent_id) {
      const parent = await prisma.org_units.findFirst({
        where: { id: parent_id, organization_id: req.params.id },
        select: { type: true },
      });
      if (!parent) throw new NotFoundError(labels.campus);
      // Two levels, deliberately (see the migration header).
      if (parent.type !== 'campus') {
        throw new BusinessRuleError(`A ${labels.department.toLowerCase()} sits inside a ${labels.campus.toLowerCase()}, not inside another ${labels.department.toLowerCase()}`);
      }
    }

    await assertAdminIsMember(req.params.id, admin_user_id);

    // `multi_campus` is asserted here rather than on the route, because only here is
    // it known whether this is the FIRST campus or an additional one. Every
    // organisation gets one campus and as many departments beneath it as it likes;
    // running more than one campus is the paid feature the capability is named for.
    if (type === 'campus') {
      const existing = await prisma.org_units.count({ where: { organization_id: req.params.id, type: 'campus' } });
      if (existing >= 1) {
        await assertCapability(prisma, 'multi_campus', { userId: req.user!.id, organizationId: req.params.id });
      }
    }

    const row = await prisma.org_units.create({
      data: {
        organization_id: req.params.id,
        type, name: name.trim(), code: code?.trim() || null,
        parent_id: parent_id ?? null,
        display_order: display_order ?? 0,
        status: status ?? 'ACTIVE',
        admin_user_id: admin_user_id ?? null,
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

    await assertAdminIsMember(req.params.id, req.body.admin_user_id);

    // Re-parenting is only meaningful for a department, and the new parent must be a
    // campus of the SAME organisation. Without the organisation check this is a way
    // to graft one institution's department onto another's campus, which nothing
    // downstream is built to survive.
    if (req.body.parent_id !== undefined) {
      if (before.type !== 'department') {
        throw new BusinessRuleError('Only a department can be moved to a different campus');
      }
      const parent = await prisma.org_units.findFirst({
        where: { id: req.body.parent_id, organization_id: req.params.id, type: 'campus' },
        select: { id: true },
      });
      if (!parent) throw new NotFoundError('Campus');
    }

    // Archiving a campus that is currently entered into a live championship would
    // remove it from the entrant list mid-event while its results kept accruing.
    // Refused rather than cascaded: the honest fix is to finish the event.
    if (req.body.status && req.body.status !== 'ACTIVE' && before.status === 'ACTIVE') {
      const live = await prisma.championship_organizations.findFirst({
        where: {
          org_unit_id: before.id,
          championships: { status: { in: ['registration_open', 'ongoing'] } },
        },
        select: { championships: { select: { name: true } } },
      });
      if (live) {
        throw new BusinessRuleError(`${before.name} is entered in “${live.championships?.name}”, which is still running. Finish that championship first.`);
      }
    }

    const row = await prisma.org_units.update({ where: { id: before.id }, data: req.body });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgUnitUpdated,
      target: { type: 'org_units', id: row.id, label: row.name },
      organizationId: req.params.id,
      summary: before.name === row.name ? `Updated ${row.name}` : `Renamed ${before.name} to ${row.name}`,
      diff: {
        ...(before.name !== row.name ? { name: { from: before.name, to: row.name } } : {}),
        ...(before.code !== row.code ? { code: { from: before.code, to: row.code } } : {}),
        ...(before.status !== row.status ? { status: { from: before.status, to: row.status } } : {}),
        ...(before.admin_user_id !== row.admin_user_id ? { admin_user_id: { from: before.admin_user_id, to: row.admin_user_id } } : {}),
        ...(before.parent_id !== row.parent_id ? { parent_id: { from: before.parent_id, to: row.parent_id } } : {}),
        ...(before.display_order !== row.display_order ? { display_order: { from: before.display_order, to: row.display_order } } : {}),
      },
    });

    res.json(row);
  }));

  // ---- who is in a unit -----------------------------------------------------
  //
  // Placement is a SET per person, so there are two shapes of write and both are
  // needed: "these forty people are all Bangalore" (the intake, done from a unit)
  // and "this person is in Bangalore, Sales and Batch 2026" (the correction, done
  // from a person). Offering only one of them makes the other a loop of clicks.

  router.get('/:id/units/:unitId/members', asyncHandler(async (req, res) => {
    const rows = await prisma.org_unit_members.findMany({
      where: { organization_id: req.params.id, org_unit_id: req.params.unitId },
      select: { user_id: true, users: { select: { id: true, name: true, email: true } } },
    });
    res.json(rows.map((r) => ({ user_id: r.user_id, name: r.users?.name ?? null, email: r.users?.email ?? null })));
  }));

  /** Add people to one unit. Idempotent - re-adding somebody is not an error. */
  router.post('/:id/units/:unitId/members', orgAdmin, validateBody(z.object({
    user_ids: z.array(z.string().uuid()).min(1).max(2000),
  })), asyncHandler(async (req, res) => {
    const unit = await prisma.org_units.findFirst({
      where: { id: req.params.unitId, organization_id: req.params.id },
      select: { id: true, name: true },
    });
    if (!unit) throw new NotFoundError('Campus or department');

    // Only actual members of this institution. Placing a stranger would create a
    // person who is in a campus but not in the organisation that owns it.
    const members = await prisma.organization_members.findMany({
      where: { organization_id: req.params.id, user_id: { in: req.body.user_ids }, status: 'active' },
      select: { user_id: true },
    });
    const eligible = members.map((m) => m.user_id);
    const skipped = req.body.user_ids.filter((id: string) => !eligible.includes(id));

    const created = await prisma.org_unit_members.createMany({
      data: eligible.map((user_id) => ({ organization_id: req.params.id, org_unit_id: unit.id, user_id })),
      skipDuplicates: true,
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgUnitUpdated,
      target: { type: 'org_units', id: unit.id, label: unit.name },
      organizationId: req.params.id,
      summary: `Added ${created.count} ${created.count === 1 ? 'person' : 'people'} to ${unit.name}`,
    });

    res.json({ added: created.count, skipped: skipped.length });
  }));

  router.delete('/:id/units/:unitId/members/:userId', orgAdmin, asyncHandler(async (req, res) => {
    const { count } = await prisma.org_unit_members.deleteMany({
      where: { organization_id: req.params.id, org_unit_id: req.params.unitId, user_id: req.params.userId },
    });
    res.json({ removed: count });
  }));

  /**
   * Replace one person's whole set of units.
   *
   * A replace rather than add/remove deltas: the screen that calls this shows every
   * unit with a tick, so it knows the complete intended set, and sending deltas
   * from a complete picture is how the two drift apart.
   */
  router.put('/:id/people/:userId/units', orgAdmin, validateBody(z.object({
    unit_ids: z.array(z.string().uuid()).max(50),
  })), asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { organization_id: req.params.id, user_id: req.params.userId },
      select: { id: true },
    });
    if (!member) throw new NotFoundError('Member');

    // Every unit must belong to this organisation - otherwise this is a route for
    // filing somebody into another institution's structure.
    const wanted = [...new Set(req.body.unit_ids as string[])];
    if (wanted.length) {
      const owned = await prisma.org_units.count({
        where: { id: { in: wanted }, organization_id: req.params.id },
      });
      if (owned !== wanted.length) throw new NotFoundError('Campus or department');
    }

    await prisma.$transaction([
      prisma.org_unit_members.deleteMany({
        where: { organization_id: req.params.id, user_id: req.params.userId, org_unit_id: { notIn: wanted.length ? wanted : ['00000000-0000-0000-0000-000000000000'] } },
      }),
      prisma.org_unit_members.createMany({
        data: wanted.map((org_unit_id) => ({ organization_id: req.params.id, org_unit_id, user_id: req.params.userId })),
        skipDuplicates: true,
      }),
    ]);

    res.json({ unit_ids: wanted });
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
    const members = await prisma.org_unit_members.count({ where: { org_unit_id: { in: ids } } });

    // A unit that has competed cannot be deleted - its standings rows point at it,
    // and a published result whose competitor no longer exists is unreadable. The
    // count is returned so the screen can say so before the button is pressed.
    const entries = await prisma.championship_organizations.count({ where: { org_unit_id: { in: ids } } });
    res.json({ unit, departments: children, batches: children, members, entries });
  }));

  router.delete('/:id/units/:unitId', orgAdmin, asyncHandler(async (req, res) => {
    const unit = await prisma.org_units.findFirst({
      where: { id: req.params.unitId, organization_id: req.params.id },
      select: { id: true, name: true, type: true },
    });
    if (!unit) throw new NotFoundError('Unit');

    const children = await prisma.org_units.findMany({ where: { parent_id: unit.id }, select: { id: true } });
    const ids = [unit.id, ...children.map((c) => c.id)];
    const affected = await prisma.org_unit_members.count({ where: { org_unit_id: { in: ids } } });

    // Refused if this unit has ever competed. `standings.org_unit_id` cascades, so
    // deleting would silently erase finished results rather than failing loudly -
    // and a medal table that loses a row is worse than a delete that is refused.
    const competed = await prisma.championship_organizations.count({ where: { org_unit_id: { in: ids } } });
    if (competed > 0) {
      throw new BusinessRuleError(`${unit.name} has been entered into ${competed} championship${competed === 1 ? '' : 's'} and cannot be deleted. Archive it instead - archiving keeps its results.`);
    }

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
