import { Router } from 'express';
import { z } from 'zod';
import {
  AUDIENCES, MODULE_KEYS, MODULES, PERMISSION_CODES, permissionsByArea, assignRoleSchema, updateRoleGrantSchema,
  effectiveGrants, type PermissionCode,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { can, heldPermissions } from '../../http/middleware/can.js';
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


// A hex colour, or null to go back to the product's own blue. Validated here so a
// value that cannot be parsed never reaches the browser, where it would silently
// resolve to "no theme" and read as the setting not having saved.
const appearanceSchema = z.object({
  brand: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Enter a colour like #004AAD').nullable().optional(),
  logo_url: z.string().max(600).nullable().optional(),
}).refine((v) => v.brand !== undefined || v.logo_url !== undefined, { message: 'Nothing to change' });

const setRolePermissionsSchema = z.object({
  // Only catalogue codes. A permission the product cannot enforce is not a
  // permission, so an unknown code is rejected rather than stored and ignored.
  permission_ids: z.array(z.enum(PERMISSION_CODES as [string, ...string[]])),
  // How far the role reaches. The owner sets this too: "Sports Admin" scoped to the
  // whole organisation and scoped to one campus are different jobs, and which one an
  // institution means is theirs to decide, not the platform's.
  scope: z.enum(['whole_org', 'campus_unit', 'single_event']).optional(),
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

  // ---- appearance: the institution's own colour -------------------------
  //
  // Stored beside the module map in `organizations.settings`, for the same reason:
  // it is a setting about the organisation, not a new table. ONE colour is stored -
  // the ten-step ramp the interface actually uses is derived from it in the browser
  // (index.css expresses every --color-brand-* step as an hsl() of three seed
  // variables), so a tenant picks a colour rather than authoring a palette, and the
  // lightness relationships the product was designed against survive whatever hue
  // they choose.
  //
  // `org.manage` to write, and readable by any active member: the client needs it
  // to paint the workspace, and it is not a secret - it is on every screen.

  router.get('/organizations/:id/settings/appearance', asyncHandler(async (req, res) => {
    const org = await prisma.organizations.findUnique({
      where: { id: req.params.id },
      select: { settings: true, name: true },
    });
    if (!org) throw new NotFoundError('Organization');
    const theme = (org.settings as { theme?: unknown } | null)?.theme;
    res.json({ theme: theme && typeof theme === 'object' ? theme : {} });
  }));

  router.patch('/organizations/:id/settings/appearance', guards.orgPermission('org.manage'),
    validateBody(appearanceSchema), asyncHandler(async (req, res) => {
      const organizationId = req.params.id;
      const org = await prisma.organizations.findUnique({
        where: { id: organizationId },
        select: { settings: true, name: true },
      });
      if (!org) throw new NotFoundError('Organization');

      const before = (org.settings as { theme?: unknown } | null)?.theme ?? {};
      // Merged into the blob rather than replacing it: `settings` also carries the
      // module map, retention and other keys that have nothing to do with colour.
      const theme = { ...(before as object), ...req.body };
      await prisma.organizations.update({
        where: { id: organizationId },
        data: { settings: { ...(org.settings as object ?? {}), theme } },
      });

      await audit(prisma, req, {
        action: AUDIT_ACTIONS.orgSettingsChanged,
        target: { type: 'organizations', id: organizationId, label: 'Appearance' },
        organizationId,
        summary: `Changed the workspace colour for ${org.name}`,
        diff: { theme: { from: before, to: theme } },
      });

      res.json({ theme });
    }));


  // `role.manage` rather than membership. The screen that decides who is a Sports
  // Admin was itself reachable only by an owner/admin MEMBER, which meant the one
  // permission in the catalogue whose entire purpose is delegating administration
  // could not be delegated. Membership stays as the fallback, so this widens only.
  const orgAdmin = guards.orgPermission('role.manage');

  /**
   * Everything the CALLER holds in this organisation - the ceiling on what they may
   * hand out.
   *
   * THE DELEGATION RULE: you cannot grant what you do not hold. Without it this
   * router was a privilege-escalation route with a form on it. An Org Admin - a role
   * the Owner appoints and can remove - could assign themselves Billing Admin and
   * reach the company card that the ladder deliberately keeps above them; or take a
   * private copy of any role, edit `billing.manage` into it, and assign that. Both
   * took two clicks and left an audit line saying it was fine.
   *
   * Read through the engine rather than from the ladder, because an institution may
   * have redefined its own roles and the answer has to be what is true HERE. A super
   * admin gets '*' and is exempted before this is called.
   */
  async function callerGrants(req: { user?: { id: string; isSuperAdmin?: boolean } }, organizationId: string) {
    return heldPermissions(prisma, {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
    });
  }

  /** What `wanted` asks for that the caller cannot give. Empty means go ahead. */
  async function beyondCaller(
    req: { user?: { id: string; isSuperAdmin?: boolean } },
    organizationId: string,
    wanted: readonly string[],
  ): Promise<PermissionCode[]> {
    if (req.user!.isSuperAdmin) return [];
    const held = await callerGrants(req, organizationId);
    return (wanted as PermissionCode[]).filter((p) => !held.has(p));
  }

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
        kind: r.kind,
        scope: r.scope,
        // What the reader needs to know before they click: is this ours, and can we
        // change it here?
        owner: r.organization_id ? 'organisation' : 'platform',
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

      // You cannot write a permission into a role that you do not hold yourself.
      // Editing a role definition is the widest form of delegation in the product -
      // it changes what everybody holding that role may do - and without this an Org
      // Admin could add `billing.manage` to a role and then assign it.
      const over = await beyondCaller(req, req.params.id, req.body.permission_ids as string[]);
      if (over.length) {
        throw new ForbiddenError(
          `You cannot grant a permission you do not hold yourself: ${over.join(', ')}`,
        );
      }

      // A role can lose permissions the editor lacks - taking access away is not
      // escalation - but not the ones that are their own authority to be here. Losing
      // `role.manage` from the role you hold it through locks the institution out of
      // its own Roles screen, and only the Owner could put it back.
      const losing = (((before.permission_ids as unknown as string[]) ?? [])
        .filter((p) => !(req.body.permission_ids as string[]).includes(p)));
      if (losing.includes('role.manage') && !req.user!.isSuperAdmin) {
        const mine = await callerGrants(req, req.params.id);
        const heldThroughThis = await prisma.user_org_roles.findFirst({
          where: { user_id: req.user!.id, organization_id: req.params.id, role_id: before.id, status: 'ACTIVE' },
          select: { id: true },
        });
        if (heldThroughThis && mine.has('role.manage')) {
          throw new ForbiddenError('Removing role.manage from the role you hold it through would lock you out of this screen');
        }
      }

      const row = await prisma.roles.update({
        where: { id: before.id },
        data: {
          permission_ids: req.body.permission_ids,
          ...(req.body.scope ? { scope: req.body.scope } : {}),
        },
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
          ...(req.body.scope && req.body.scope !== before.scope
            ? { scope: { from: before.scope, to: req.body.scope } }
            : {}),
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
        data: {
          permission_ids: req.body.permission_ids,
          ...(req.body.scope ? { scope: req.body.scope } : {}),
        },
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
          ...(req.body.scope && req.body.scope !== before.scope
            ? { scope: { from: before.scope, to: req.body.scope } }
            : {}),
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
      prisma.roles.findUnique({
        where: { id: role_id },
        select: { id: true, name: true, code: true, permission_ids: true, organization_id: true },
      }),
      prisma.organization_members.findFirst({
        where: { user_id, organization_id: req.params.id },
        select: { id: true },
      }),
    ]);
    if (!user) throw new NotFoundError('User');
    if (!role) throw new NotFoundError('Role');
    // A role inside an institution only means anything for someone who is in it.
    if (!member) throw new ForbiddenError('That person is not a member of this organisation');

    // A role belonging to ANOTHER institution is not this institution's to hand out.
    // The screen only offers its own effective set, but the id arrives in the body
    // and nothing checked it - so one organisation could assign another's private
    // role, whose permissions that organisation had defined.
    if (role.organization_id && role.organization_id !== req.params.id) {
      throw new ForbiddenError('That role belongs to another organisation');
    }

    // THE DELEGATION RULE. Whatever this role grants has to be something the person
    // assigning it already holds here. This is the check that makes "the Owner
    // decides who is an Organiser, a Billing Admin, a Sports Admin" true in both
    // directions: the Owner holds everything and may appoint anybody, and an
    // administrator they appointed cannot appoint their way past them.
    //
    // Judged on STORED ∪ LADDER, which matters in both directions:
    //
    //   * stored alone would miss a platform row the database has not been synced to
    //     the model yet - a role that grants more than its array says.
    //   * the ladder alone would miss anything a super admin added on /platform/roles
    //     (the platform `organiser` row holds 18 permissions where the ladder
    //     computes 6) and would score a CUSTOM role - `code` null, real permissions
    //     stored - as granting nothing at all, making it assignable by anybody.
    //
    // The union is the honest answer to "what would this person end up holding".
    const stored = ((role.permission_ids as unknown as string[]) ?? []);
    const roleWants = [...new Set([...stored, ...(effectiveGrants(role.code ?? '') as unknown as string[])])];
    const over = await beyondCaller(req, req.params.id, roleWants);
    if (over.length) {
      throw new ForbiddenError(
        `${role.name} grants more than you hold, so you cannot assign it: ${over.join(', ')}`,
      );
    }

    // A scope_ref names one of THIS institution's campuses or batches, and now that
    // can() reads it that has to be true: an unresolvable scope_ref would be a grant
    // narrowed to a unit that does not exist, which reads as "campus only" on the
    // screen and grants nothing anywhere.
    if (scope_ref) {
      const unit = await prisma.org_units.findFirst({
        where: { id: scope_ref, organization_id: req.params.id },
        select: { id: true },
      });
      if (!unit) throw new ForbiddenError('That scope is not a campus or batch of this organisation');
    }

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
