import { Router } from 'express';
import { z } from 'zod';
import { AUDIENCES, MODULE_KEYS, MODULES, PERMISSION_CODES, permissionsByArea, assignRoleSchema, updateRoleGrantSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';
import { moduleSettingsOf, visibleModulesFor } from './module-access.js';

// The module map an institution may store. Only known module keys and known
// audiences survive - an unrecognised key would sit in the settings blob forever
// doing nothing, which is worse than a validation error at the point of typing.
const moduleSettingsSchema = z.object({
  modules: z.record(z.enum(AUDIENCES as unknown as [string, ...string[]]).array())
    .refine((m) => Object.keys(m).every((k) => (MODULE_KEYS as string[]).includes(k)), {
      message: 'Unknown module key',
    }),
});

// Assigning roles inside an institution (J6-E1-S3), and the catalogue the matrix is
// generated from (J6-E1-S1).
//
// A role assignment is scoped to ONE organisation: "Faculty Coordinator at IIMB"
// grants nothing at any other institution the same person belongs to. That is the
// property the whole engine exists to provide, so it is expressed in the table's
// shape (user + organization + role) rather than in a check somebody could forget.


const setRolePermissionsSchema = z.object({
  // Only catalogue codes. A permission the product cannot enforce is not a
  // permission, so an unknown code is rejected rather than stored and ignored.
  permission_ids: z.array(z.enum(PERMISSION_CODES as [string, ...string[]])),
});

export function makeOrgRolesRouter(prisma: Prisma): Router {
  const router = Router();

  // ---- J6-E2 · module access by audience ---------------------------------
  // Stored in `organizations.settings.modules` (module 03 §4.6), not a second
  // flag table. Read is open to any active member because the client needs it to
  // render navigation; writing is `org.manage`.

  router.get('/organizations/:id/settings/modules', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const view = await visibleModulesFor(prisma, req.user!.id, organizationId, req.user!.isSuperAdmin);
    if (!view.audience && !req.user!.isSuperAdmin) {
      throw new ForbiddenError('You are not a member of this institution.');
    }
    res.json({
      catalogue: MODULE_KEYS.map((key) => ({ key, label: MODULES[key].label })),
      audiences: AUDIENCES,
      // The stored map. A module absent from it is ON for everyone - the screen
      // renders that as both boxes ticked.
      settings: view.settings,
      // What THIS caller can currently reach, which is what navigation renders.
      my_audience: view.audience,
      my_modules: view.modules,
    });
  }));

  router.patch('/organizations/:id/settings/modules', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const allowed = await can(prisma, 'org.manage', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not manage this institution\'s settings.');

    const parsed = moduleSettingsSchema.parse(req.body ?? {});
    const org = await prisma.organizations.findUnique({ where: { id: organizationId }, select: { settings: true } });
    if (!org) throw new NotFoundError('Organization');

    const before = moduleSettingsOf(org.settings);
    // Merged into the existing settings blob rather than replacing it - `settings`
    // also carries retention and other keys that have nothing to do with modules.
    const settings = { ...(org.settings as object ?? {}), modules: parsed.modules };
    await prisma.organizations.update({ where: { id: organizationId }, data: { settings } });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgSettingsChanged,
      target: { type: 'organizations', id: organizationId, label: 'Module access' },
      organizationId,
      summary: 'Changed which modules each audience can reach',
      diff: { modules: { from: before, to: parsed.modules } },
    });

    res.json({ settings: parsed.modules });
  }));
  const guards = makeGuards(prisma);

  const orgAdmin = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    if (await guards.orgRole(u.id, req.params.id, ['owner', 'admin'])) return next();
    throw new ForbiddenError('Only an organization owner/admin can assign roles');
  });

  // The catalogue, grouped for the matrix. Code-owned and read-only: the UI renders
  // what the product can enforce, and cannot invent a row that nothing reads.
  router.get('/permission-catalogue', asyncHandler(async (_req, res) => {
    res.json(permissionsByArea());
  }));

  // ---- an institution's own roles ----
  //
  // A platform role (organization_id null) is the starting definition everybody gets.
  // An institution that wants "Coordinator" to mean something else here overrides it:
  // a copy owned by that organisation, which shadows the platform row for its members
  // only. Deleting the copy restores the platform definition - no data migration, and
  // no way to break another institution by editing your own.

  // The effective set for one organisation: its own rows, plus the platform rows it
  // has not overridden.
  router.get('/organizations/:id/role-definitions', orgAdmin, asyncHandler(async (req, res) => {
    const rows = await prisma.roles.findMany({
      where: { OR: [{ organization_id: null }, { organization_id: req.params.id }] },
      orderBy: { name: 'asc' },
    });
    const own = new Map(rows.filter((r) => r.organization_id).map((r) => [r.code ?? r.name, r]));

    res.json(rows
      .filter((r) => r.organization_id || !own.has(r.code ?? r.name))
      .map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        description: r.description,
        permission_ids: r.permission_ids,
        // What the reader needs to know before they click: is this ours, and can we
        // change it here?
        scope: r.organization_id ? 'organisation' : 'platform',
        editable: !!r.organization_id,
      })));
  }));

  // Take ownership of a platform role for this institution.
  router.post('/organizations/:id/role-definitions/:roleId/override', orgAdmin, asyncHandler(async (req, res) => {
    const source = await prisma.roles.findUnique({ where: { id: req.params.roleId } });
    if (!source) throw new NotFoundError('Role');
    if (source.organization_id === req.params.id) return void res.json(source); // already ours
    if (source.organization_id) throw new ForbiddenError('That role belongs to another organisation');

    const existing = await prisma.roles.findFirst({
      where: { organization_id: req.params.id, code: source.code ?? undefined },
    });
    if (existing) return void res.json(existing);

    const row = await prisma.roles.create({
      data: {
        // The copy starts identical, so overriding changes nothing until somebody
        // edits it - "customise" must never be a synonym for "lose your permissions".
        name: source.name,
        code: source.code,
        description: source.description,
        permission_ids: source.permission_ids,
        organization_id: req.params.id,
      },
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.rolePermissionsChanged,
      target: { type: 'roles', id: row.id, label: row.name },
      organizationId: req.params.id,
      summary: `Took ownership of the ${row.name} role for this organisation`,
      diff: { scope: { from: 'platform', to: 'organisation' } },
    });
    res.status(201).json(row);
  }));

  // Edit one of this institution's own roles.
  router.patch('/organizations/:id/role-definitions/:roleId', orgAdmin, validateBody(setRolePermissionsSchema),
    asyncHandler(async (req, res) => {
      const before = await prisma.roles.findUnique({ where: { id: req.params.roleId } });
      if (!before) throw new NotFoundError('Role');
      // Editing a platform row from an organisation screen would change every other
      // institution - the exact confusion this split exists to remove.
      if (before.organization_id !== req.params.id) {
        throw new ForbiddenError('Override this role for your organisation before editing it');
      }

      const row = await prisma.roles.update({
        where: { id: before.id },
        data: { permission_ids: req.body.permission_ids },
      });
      await audit(prisma, req, {
        action: AUDIT_ACTIONS.rolePermissionsChanged,
        target: { type: 'roles', id: row.id, label: row.name },
        organizationId: req.params.id,
        summary: `Changed what the ${row.name} role can do in this organisation`,
        diff: {
          permission_ids: {
            from: (before.permission_ids as unknown as string[]) ?? [],
            to: req.body.permission_ids,
          },
        },
      });
      res.json(row);
    }));

  // Give it back: the platform definition applies again.
  router.delete('/organizations/:id/role-definitions/:roleId', orgAdmin, asyncHandler(async (req, res) => {
    const row = await prisma.roles.findUnique({ where: { id: req.params.roleId } });
    if (!row) throw new NotFoundError('Role');
    if (row.organization_id !== req.params.id) throw new ForbiddenError('That role is not yours to reset');

    // Assignments point at this row; they go with it, and the platform role can be
    // assigned again. Deleting silently would leave people holding nothing while the
    // screen still showed them as Coordinators.
    const assigned = await prisma.user_org_roles.count({ where: { role_id: row.id } });
    await prisma.user_org_roles.deleteMany({ where: { role_id: row.id } });
    await prisma.roles.delete({ where: { id: row.id } });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.rolePermissionsChanged,
      target: { type: 'roles', id: row.id, label: row.name },
      organizationId: req.params.id,
      summary: `Reset the ${row.name} role to the platform definition`,
      diff: { scope: { from: 'organisation', to: 'platform' }, assignments_cleared: { from: assigned, to: 0 } },
    });
    res.json({ ok: true, assignments_cleared: assigned });
  }));

  // What each PLATFORM role grants. Editing this is a platform-level act - it is the
  // definition every institution that has not overridden it inherits.
  router.patch('/roles/:roleId/permissions', requireSuperAdmin, validateBody(setRolePermissionsSchema),
    asyncHandler(async (req, res) => {
      const before = await prisma.roles.findUnique({ where: { id: req.params.roleId } });
      if (!before) throw new NotFoundError('Role');
      // A super admin editing an institution's private role from the platform matrix
      // would be editing something that screen does not even list.
      if (before.organization_id) {
        throw new ForbiddenError('That role belongs to an organisation - edit it from their Roles screen');
      }

      const row = await prisma.roles.update({
        where: { id: before.id },
        data: { permission_ids: req.body.permission_ids },
      });

      await audit(prisma, req, {
        action: AUDIT_ACTIONS.rolePermissionsChanged,
        target: { type: 'roles', id: row.id, label: row.name },
        summary: `Changed what the ${row.name} role can do`,
        diff: {
          permission_ids: {
            from: (before.permission_ids as unknown as string[]) ?? [],
            to: req.body.permission_ids,
          },
        },
      });

      res.json(row);
    }));

  router.get('/organizations/:id/roles', orgAdmin, asyncHandler(async (req, res) => {
    const rows = await prisma.user_org_roles.findMany({
      where: { organization_id: req.params.id },
      include: {
        users_user_org_roles_user_idTousers: { select: { id: true, name: true, email: true } },
        roles: { select: { id: true, name: true, code: true, permission_ids: true } },
      },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(rows.map((r) => ({
      id: r.id,
      user: r.users_user_org_roles_user_idTousers,
      role: r.roles,
      // Where the grant applies. A campus_unit role with no scope_ref reaches the
      // whole organisation, which is usually not what somebody meant to configure.
      scope_ref: r.scope_ref,
      status: r.status,
      assigned_at: r.assigned_at,
    })));
  }));

  router.post('/organizations/:id/roles', orgAdmin, validateBody(assignRoleSchema), asyncHandler(async (req, res) => {
    const { user_id, role_id, scope_ref = null, status = 'ACTIVE' } = req.body as {
      user_id: string; role_id: string; scope_ref?: string | null; status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
    };

    const [user, role, member] = await Promise.all([
      prisma.users.findUnique({ where: { id: user_id }, select: { id: true, name: true, email: true } }),
      prisma.roles.findUnique({ where: { id: role_id }, select: { id: true, name: true } }),
      prisma.organization_members.findFirst({
        where: { user_id, organization_id: req.params.id },
        select: { id: true },
      }),
    ]);
    if (!user) throw new NotFoundError('User');
    if (!role) throw new NotFoundError('Role');
    // A role inside an institution only means anything for someone who is in it.
    if (!member) throw new ForbiddenError('That person is not a member of this organisation');

    // The unique key now includes the scope, so the same role at a different campus
    // is a different grant rather than a conflict. Prisma cannot express the
    // coalesce() in that index, so the existing row is looked up explicitly.
    const existing = await prisma.user_org_roles.findFirst({
      where: { user_id, organization_id: req.params.id, role_id, scope_ref: scope_ref ?? null },
      select: { id: true },
    });
    const row = existing
      ? await prisma.user_org_roles.update({ where: { id: existing.id }, data: { status } })
      : await prisma.user_org_roles.create({
        data: { user_id, organization_id: req.params.id, role_id, scope_ref, status, assigned_by: req.user!.id },
      });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.roleAssigned,
      target: { type: 'user_org_roles', id: row.id, label: `${user.name} (${user.email})` },
      organizationId: req.params.id,
      summary: `Gave ${user.name} the ${role.name} role${scope_ref ? ' (scoped)' : ''}`,
      diff: { role: { from: null, to: role.name }, scope: { from: null, to: scope_ref } },
    });

    res.status(201).json(row);
  }));

  // Suspending is not revoking. A suspended grant keeps its history and its scope,
  // so restoring somebody does not mean reconstructing what they had.
  router.patch('/organizations/:id/roles/:assignmentId', orgAdmin, validateBody(updateRoleGrantSchema),
    asyncHandler(async (req, res) => {
      const { status } = req.body as { status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' };
      const row = await prisma.user_org_roles.findFirst({
        where: { id: req.params.assignmentId, organization_id: req.params.id },
        include: {
          users_user_org_roles_user_idTousers: { select: { name: true, email: true } },
          roles: { select: { name: true } },
        },
      });
      if (!row) throw new NotFoundError('Assignment');

      const updated = await prisma.user_org_roles.update({ where: { id: row.id }, data: { status } });

      await audit(prisma, req, {
        action: AUDIT_ACTIONS.roleAssigned,
        target: { type: 'user_org_roles', id: row.id, label: row.users_user_org_roles_user_idTousers?.name ?? '' },
        organizationId: req.params.id,
        summary: `Set ${row.users_user_org_roles_user_idTousers?.name}'s ${row.roles?.name} role to ${status}`,
        diff: { status: { from: row.status, to: status } },
      });

      res.json(updated);
    }));

  router.delete('/organizations/:id/roles/:assignmentId', orgAdmin, asyncHandler(async (req, res) => {
    const row = await prisma.user_org_roles.findFirst({
      where: { id: req.params.assignmentId, organization_id: req.params.id },
      include: {
        users_user_org_roles_user_idTousers: { select: { name: true, email: true } },
        roles: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundError('Assignment');

    await prisma.user_org_roles.delete({ where: { id: row.id } });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.roleRevoked,
      target: { type: 'user_org_roles', id: row.id, label: row.users_user_org_roles_user_idTousers?.name ?? '' },
      organizationId: req.params.id,
      summary: `Removed the ${row.roles?.name} role from ${row.users_user_org_roles_user_idTousers?.name}`,
      diff: { role: { from: row.roles?.name ?? null, to: null } },
    });

    res.json({ ok: true });
  }));

  return router;
}
