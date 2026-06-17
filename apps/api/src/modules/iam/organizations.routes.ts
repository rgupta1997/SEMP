import { Router } from 'express';
import {
  addOrganizationMemberSchema, createOrganizationWithOwnerSchema,
  updateOrganizationMemberSchema, updateOrganizationSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { findUserByPhone, hashProvisionedPassword } from './users.helpers.js';

// Organizations router: list/get are open reads. Any authenticated user can
// create an organization (they become its first `owner`). Edits, deletes and
// member management require an owner/admin of that org (or super admin).
export function makeOrganizationsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // super OR owner/admin of the :id org
  const orgAdmin = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    if (await guards.orgRole(u.id, req.params.id, ['owner', 'admin'])) return next();
    throw new ForbiddenError('Only an organization owner/admin can do this');
  });

  router.get('/', asyncHandler(async (_req, res) => {
    const rows = await prisma.organizations.findMany({ orderBy: { name: 'asc' } });
    res.json(rows);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await prisma.organizations.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Organization');
    res.json(row);
  }));

  // Create an organization — the creator becomes its owner. Optionally assigns a
  // separate POC/owner: if the phone (or email) already belongs to a user we reuse
  // them, otherwise we provision a new login (forced to change its password on
  // first sign-in) and return its temporary password once so it can be shared.
  router.post('/', validateBody(createOrganizationWithOwnerSchema), asyncHandler(async (req, res) => {
    const { owner, ...organization } = req.body as {
      name: string; short_name?: string; code?: string; logo_url?: string;
      city?: string; status?: boolean; country?: string;
      owner?: { user_id?: string; name?: string; email?: string; password?: string; phone?: string };
    };

    // Resolve an existing POC: an explicitly chosen user, else a phone/email match.
    let pocUserId: string | null = null;
    if (owner) {
      if (owner.user_id) {
        pocUserId = owner.user_id;
      } else {
        const existing = await findUserByPhone(prisma, owner.phone)
          ?? (owner.email ? await prisma.users.findUnique({ where: { email: owner.email }, select: { id: true } }) : null);
        pocUserId = existing?.id ?? null;
      }
    }
    const provision = owner && !pocUserId ? await hashProvisionedPassword(owner.password) : null;

    const created = await prisma.$transaction(async (tx) => {
      const org = await tx.organizations.create({ data: { ...organization, status: organization.status ?? true } });
      // The authenticated creator is always an owner of the new org.
      await tx.organization_members.create({
        data: { user_id: req.user!.id, organization_id: org.id, role: 'owner' },
      });
      if (owner) {
        if (!pocUserId) {
          if (!owner.name || !owner.email) throw new BusinessRuleError('Provide a name and email for the new POC');
          const u = await tx.users.create({
            data: { name: owner.name, email: owner.email, phone: owner.phone ?? null, password_hash: provision!.password_hash, organization_id: org.id, must_change_password: true },
          });
          pocUserId = u.id;
        }
        await tx.organization_members.upsert({
          where: { user_id_organization_id: { user_id: pocUserId, organization_id: org.id } },
          update: { role: 'owner' },
          create: { user_id: pocUserId, organization_id: org.id, role: 'owner' },
        });
      }
      return org;
    });

    // Surface the new login's credentials once so the actor can share them.
    const credentials = owner && provision && owner.name && owner.email
      ? { name: owner.name, email: owner.email, phone: owner.phone ?? null, password: provision.tempPassword }
      : null;
    res.status(201).json({ ...created, poc_credentials: credentials });
  }));

  router.patch('/:id', orgAdmin, validateBody(updateOrganizationSchema), asyncHandler(async (req, res) => {
    const row = await prisma.organizations.update({ where: { id: req.params.id }, data: req.body });
    res.json(row);
  }));

  router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
    await prisma.organizations.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  // ---- Members ----
  router.get('/:id/members', asyncHandler(async (req, res) => {
    const rows = await prisma.organization_members.findMany({
      where: { organization_id: req.params.id },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { joined_at: 'asc' },
    });
    res.json(rows);
  }));

  // Add a member. Users are central: resolve by user_id, then by phone, then by
  // email; provision a new login only if none match. A newly provisioned login is
  // forced to change its password on first sign-in and its temporary password is
  // returned once so it can be shared.
  router.post('/:id/members', orgAdmin, validateBody(addOrganizationMemberSchema), asyncHandler(async (req, res) => {
    const { user_id, name, email, phone, role } = req.body as { user_id?: string; name?: string; email?: string; phone?: string; role: string };

    let resolvedUserId = user_id ?? null;
    let credentials: { name: string; email: string; phone: string | null; password: string } | null = null;

    if (!resolvedUserId) {
      const existing = await findUserByPhone(prisma, phone)
        ?? (email ? await prisma.users.findUnique({ where: { email }, select: { id: true } }) : null);
      if (existing) {
        resolvedUserId = existing.id;
      } else if (email) {
        const { tempPassword, password_hash } = await hashProvisionedPassword(null);
        const u = await prisma.users.create({
          data: { name: name?.trim() || email.split('@')[0], email, phone: phone ?? null, password_hash, organization_id: req.params.id, must_change_password: true },
        });
        resolvedUserId = u.id;
        credentials = { name: u.name, email: u.email, phone: u.phone, password: tempPassword };
      }
    }
    if (!resolvedUserId) throw new BusinessRuleError('Provide a user, a registered phone, or an email to create one');

    const member = await prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: resolvedUserId, organization_id: req.params.id } },
      update: { role, status: 'active' },
      create: { user_id: resolvedUserId, organization_id: req.params.id, role },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.status(201).json({ ...member, poc_credentials: credentials });
  }));

  router.patch('/:id/members/:memberId', orgAdmin, validateBody(updateOrganizationMemberSchema), asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
    });
    if (!member) throw new NotFoundError('Member');
    const updated = await prisma.organization_members.update({
      where: { id: member.id },
      data: req.body,
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.json(updated);
  }));

  router.delete('/:id/members/:memberId', orgAdmin, asyncHandler(async (req, res) => {
    await prisma.organization_members.deleteMany({ where: { id: req.params.memberId, organization_id: req.params.id } });
    res.status(204).send();
  }));

  return router;
}
