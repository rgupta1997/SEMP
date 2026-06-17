import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { bulkCreateUsersSchema, createUserSchema, updateUserSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { ForbiddenError } from '../../shared/errors.js';
import { DEFAULT_PASSWORD, findUserByPhone, hashProvisionedPassword, maskEmail, maskPhone } from './users.helpers.js';

// Fields safe to return to any caller (never the password hash).
const PUBLIC_SELECT = {
  id: true, name: true, email: true, phone: true, is_active: true,
  is_super_admin: true, organization_id: true, created_at: true,
  organizations: { select: { id: true, name: true, short_name: true } },
} as const;

export function makeUsersRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // Which org may the actor provision users into? Super admins: any (or none).
  // Otherwise the actor must own/administer the requested org.
  async function assertCanProvision(actorId: string, isSuper: boolean, organizationId: string | null): Promise<string | null> {
    if (isSuper) return organizationId;
    if (organizationId && (await guards.orgRole(actorId, organizationId, ['owner', 'admin']))) return organizationId;
    throw new ForbiddenError('You can only create users in an organization you own or administer');
  }

  // List users — open to any authenticated caller (used by assign/roster pickers).
  router.get('/', asyncHandler(async (req, res) => {
    const organizationId = req.query.organization_id as string | undefined;
    const rows = await prisma.users.findMany({
      where: { ...(organizationId ? { organization_id: organizationId } : {}) },
      select: PUBLIC_SELECT,
      orderBy: { created_at: 'desc' },
    });
    res.json(rows);
  }));

  // Privacy-preserving lookup for the "find or create a POC/user" flows: only
  // confirms a match once a full phone number is supplied, and never returns the
  // unmasked phone/email. Used by the add-user pickers to dedupe by phone.
  router.get('/lookup', asyncHandler(async (req, res) => {
    const user = await findUserByPhone(prisma, req.query.phone as string | undefined);
    if (!user) { res.json({ found: false }); return; }
    res.json({ found: true, user: { id: user.id, name: user.name, phone: maskPhone(user.phone), email: maskEmail(user.email) } });
  }));

  // Create a single login, scoped by the actor's org rights. Users are central:
  // if the phone (or email) already belongs to someone, reuse them rather than
  // creating a duplicate. A freshly created login must change its password on
  // first sign-in, and its temporary password is returned once so the actor can
  // share it.
  router.post('/', validateBody(createUserSchema), asyncHandler(async (req, res) => {
    const actor = req.user!;
    const orgId = await assertCanProvision(actor.id, actor.isSuperAdmin, req.body.organization_id ?? null);

    const existing = await findUserByPhone(prisma, req.body.phone)
      ?? await prisma.users.findUnique({ where: { email: req.body.email }, select: { id: true } });

    if (existing) {
      const user = await prisma.$transaction(async (tx) => {
        if (orgId) {
          await tx.organization_members.upsert({
            where: { user_id_organization_id: { user_id: existing.id, organization_id: orgId } },
            update: {},
            create: { user_id: existing.id, organization_id: orgId, role: 'member' },
          });
        }
        return tx.users.findUnique({ where: { id: existing.id }, select: PUBLIC_SELECT });
      });
      res.status(200).json({ ...user, matched: true });
      return;
    }

    const { tempPassword, password_hash } = await hashProvisionedPassword(req.body.password);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.users.create({
        data: {
          name: req.body.name,
          email: req.body.email,
          phone: req.body.phone ?? null,
          password_hash,
          organization_id: orgId,
          must_change_password: true,
        },
        select: PUBLIC_SELECT,
      });
      if (orgId) {
        await tx.organization_members.upsert({
          where: { user_id_organization_id: { user_id: u.id, organization_id: orgId } },
          update: {},
          create: { user_id: u.id, organization_id: orgId, role: 'member' },
        });
      }
      return u;
    });
    res.status(201).json({ ...user, created: true, temp_password: tempPassword });
  }));

  // Bulk import — match/create by email, optionally mapping each to a championship role.
  router.post('/bulk', validateBody(bulkCreateUsersSchema), asyncHandler(async (req, res) => {
    const actor = req.user!;
    const { users, organization_id, championship_id, role_id } = req.body as {
      users: Array<{ name: string; email: string; phone?: string }>;
      organization_id?: string | null; championship_id?: string; role_id?: string;
    };

    const orgId = await assertCanProvision(actor.id, actor.isSuperAdmin, organization_id ?? null);

    // Validate the role mapping up front: the actor must organise the championship.
    if (championship_id && role_id && !actor.isSuperAdmin && !(await guards.organisesChampionship(actor.id, championship_id))) {
      throw new ForbiddenError('You do not manage this championship');
    }

    const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let matched = 0;
      const skipped: { label: string; reason: string }[] = [];

      for (const row of users) {
        let user = await tx.users.findUnique({ where: { email: row.email }, select: { id: true, name: true } });
        if (user) {
          matched++;
        } else {
          const u = await tx.users.create({
            data: {
              name: row.name.trim() || row.email.split('@')[0],
              email: row.email,
              phone: row.phone ?? null,
              password_hash: defaultHash,
              organization_id: orgId,
              must_change_password: true,
            },
            select: { id: true, name: true },
          });
          user = u;
          created++;
        }

        if (orgId) {
          await tx.organization_members.upsert({
            where: { user_id_organization_id: { user_id: user.id, organization_id: orgId } },
            update: {},
            create: { user_id: user.id, organization_id: orgId, role: 'member' },
          });
        }

        if (championship_id && role_id) {
          await tx.user_championship_roles.upsert({
            where: { user_id_championship_id_role_id: { user_id: user.id, championship_id, role_id } },
            update: {},
            create: { user_id: user.id, championship_id, role_id, assigned_by: actor.id },
          });
        }
      }
      return { created, matched, skipped, total: created + matched };
    });

    res.status(201).json(result);
  }));

  // Edit a user (super admin, or an owner/admin of the target's organization).
  router.patch('/:id', guards.manageUser, validateBody(updateUserSchema), asyncHandler(async (req, res) => {
    const { password, ...rest } = req.body as Record<string, unknown> & { password?: string };
    const data: Record<string, unknown> = { ...rest };
    if (typeof password === 'string' && password) data.password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.update({ where: { id: req.params.id }, data, select: PUBLIC_SELECT });
    res.json(user);
  }));

  // "Delete" = deactivate, so foreign keys (rosters, fixtures) stay intact.
  router.delete('/:id', guards.manageUser, asyncHandler(async (req, res) => {
    await prisma.users.update({ where: { id: req.params.id }, data: { is_active: false } });
    res.status(204).send();
  }));

  return router;
}
