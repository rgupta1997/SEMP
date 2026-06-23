import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { bulkCreateUsersSchema, createUserSchema, updateUserSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { ForbiddenError } from '../../shared/errors.js';
import { deriveProvisionedPassword, findUserByPhone, hashProvisionedPassword, maskEmail, maskPhone, phoneLast10 } from './users.helpers.js';

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

  // List/search users - open to any authenticated caller (used by assign/roster
  // pickers). `q` matches name/email and, on its digits, phone; `limit` caps the
  // result count so pickers can show just the first few by default.
  router.get('/', asyncHandler(async (req, res) => {
    const organizationId = req.query.organization_id as string | undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const take = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 0, 0), 100) : undefined;
    const qDigits = q.replace(/\D/g, '');

    // Phone is stored with formatting (e.g. "+91 98765 43210"), so a plain contains
    // can't match a digits-only query. Resolve phone hits on the normalized form via
    // a raw query, then fold the ids into the main filter (org scope is re-applied below).
    let phoneIds: string[] = [];
    if (qDigits.length >= 3) {
      const hits = await prisma.$queryRaw<Array<{ id: string }>>`
        select id from users
        where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') like ${`%${qDigits}%`}
        limit 100`;
      phoneIds = hits.map((r) => r.id);
    }

    const rows = await prisma.users.findMany({
      where: {
        ...(organizationId ? { organization_id: organizationId } : {}),
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
          ],
        } : {}),
      },
      select: PUBLIC_SELECT,
      orderBy: { created_at: 'desc' },
      ...(take ? { take } : {}),
    });

    // Privacy: when `mask` is set (the assign pickers), hide each phone except the
    // one whose full number the searcher has typed correctly (last-10 exact match).
    const mask = req.query.mask === '1' || req.query.mask === 'true';
    const qLast10 = qDigits.length >= 10 ? qDigits.slice(-10) : '';
    const out = mask
      ? rows.map((u) => ({ ...u, phone: qLast10 && phoneLast10(u.phone) === qLast10 ? u.phone : maskPhone(u.phone) }))
      : rows;
    res.json(out);
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

  // Bulk import - match/create by email, optionally mapping each to a championship role.
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

    // Drop repeated emails within this batch so we don't try to create the same
    // login twice (email is unique).
    const seen = new Set<string>();
    const rows = users.filter((u) => (seen.has(u.email) ? false : (seen.add(u.email), true)));
    const emails = rows.map((r) => r.email);

    // Which of these already exist? Those are "matched"; the rest are created.
    const existing = await prisma.users.findMany({ where: { email: { in: emails } }, select: { email: true } });
    const existingEmails = new Set(existing.map((u) => u.email));

    // Build the new logins, hashing passwords OUTSIDE the transaction — bcrypt is
    // CPU-bound and doing it inside would hold the transaction open and time out.
    const toCreate = await Promise.all(
      rows.filter((r) => !existingEmails.has(r.email)).map(async (r) => {
        const name = r.name.trim() || r.email.split('@')[0];
        // Rule: first name + "@" + last 4 phone digits (e.g. rohit@7626).
        const password = deriveProvisionedPassword(name, r.phone);
        return { name, email: r.email, phone: r.phone ?? null, password, password_hash: await bcrypt.hash(password, 10) };
      }),
    );

    // Inside the transaction we only touch the DB (fast): bulk-insert the new
    // users, then link everyone we saw to the org / championship role. skipDuplicates
    // makes the membership/role links idempotent on re-import.
    await prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.users.createMany({
          data: toCreate.map((u) => ({
            name: u.name, email: u.email, phone: u.phone,
            password_hash: u.password_hash, organization_id: orgId, must_change_password: true,
          })),
          skipDuplicates: true,
        });
      }

      const ids = (await tx.users.findMany({ where: { email: { in: emails } }, select: { id: true } })).map((u) => u.id);

      if (orgId && ids.length) {
        await tx.organization_members.createMany({
          data: ids.map((user_id) => ({ user_id, organization_id: orgId, role: 'member' })),
          skipDuplicates: true,
        });
      }
      if (championship_id && role_id && ids.length) {
        await tx.user_championship_roles.createMany({
          data: ids.map((user_id) => ({ user_id, championship_id, role_id, assigned_by: actor.id })),
          skipDuplicates: true,
        });
      }
    }, { timeout: 30000 });

    const created = toCreate.length;
    res.status(201).json({
      created,
      matched: rows.length - created,
      total: rows.length,
      credentials: toCreate.map((u) => ({ name: u.name, email: u.email, phone: u.phone, password: u.password })),
    });
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
