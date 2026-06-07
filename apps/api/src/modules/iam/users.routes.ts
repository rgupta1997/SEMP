import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { bulkCreateUsersSchema, createUserSchema, updateUserSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError } from '../../shared/errors.js';

// Shared default for provisioned logins — they can reset later. Matches the
// roster bulk-import convention so demo accounts all share one password.
const DEFAULT_PASSWORD = 'demo123';

// Fields safe to return to any caller (never the password hash).
const PUBLIC_SELECT = {
  id: true, name: true, email: true, phone: true, is_active: true,
  is_super_admin: true, account_type: true, institution_id: true, created_at: true,
  institutions: { select: { id: true, name: true, short_name: true } },
} as const;

type Actor = { id: string; isSuperAdmin: boolean; accountType: string; institutionId: string | null };

// Resolve the account_type + institution a creator is allowed to set, throwing
// when the actor isn't permitted to mint users at all.
function resolveCreateScope(actor: Actor, accountType: string, institutionId: string | null) {
  if (actor.isSuperAdmin) return { account_type: accountType, institution_id: institutionId };
  if (actor.accountType === 'organiser') {
    if (!['official', 'participant', 'institution'].includes(accountType)) {
      throw new ForbiddenError('Organisers can only create officials, participants or institution contacts');
    }
    return { account_type: accountType, institution_id: institutionId };
  }
  if (actor.accountType === 'institution' && actor.institutionId) {
    // A POC may only mint participant logins, always under their own institution.
    if (accountType && accountType !== 'participant') {
      throw new ForbiddenError('You can only create participant logins');
    }
    return { account_type: 'participant', institution_id: actor.institutionId };
  }
  throw new ForbiddenError('You are not allowed to create users');
}

export function makeUsersRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // List users — open to any authenticated caller (used by assign/roster pickers).
  router.get('/', asyncHandler(async (req, res) => {
    const accountType = req.query.account_type as string | undefined;
    const institutionId = req.query.institution_id as string | undefined;
    const rows = await prisma.users.findMany({
      where: {
        ...(accountType ? { account_type: accountType } : {}),
        ...(institutionId ? { institution_id: institutionId } : {}),
      },
      select: PUBLIC_SELECT,
      orderBy: { created_at: 'desc' },
    });
    res.json(rows);
  }));

  // Create a single login (official / participant / POC), scoped by the actor.
  router.post('/', validateBody(createUserSchema), asyncHandler(async (req, res) => {
    const actor = req.user! as Actor;
    const scope = resolveCreateScope(actor, req.body.account_type, req.body.institution_id ?? null);

    const existing = await prisma.users.findUnique({ where: { email: req.body.email }, select: { id: true } });
    if (existing) throw new BusinessRuleError('A user with this email already exists');

    const password_hash = await bcrypt.hash(req.body.password || DEFAULT_PASSWORD, 10);
    const user = await prisma.users.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone ?? null,
        password_hash,
        account_type: scope.account_type,
        institution_id: scope.institution_id,
      },
      select: PUBLIC_SELECT,
    });
    res.status(201).json(user);
  }));

  // Bulk import — match/create by email, optionally mapping each to an event role.
  router.post('/bulk', validateBody(bulkCreateUsersSchema), asyncHandler(async (req, res) => {
    const actor = req.user! as Actor;
    const { users, institution_id, event_id, role_id } = req.body as {
      users: Array<{ name: string; email: string; phone?: string; account_type: string }>;
      institution_id?: string | null; event_id?: string; role_id?: string;
    };

    // Validate the role mapping up front: the actor must organise the event.
    if (event_id && role_id && !actor.isSuperAdmin && !(await guards.organisesEvent(actor.id, event_id))) {
      throw new ForbiddenError('You do not manage this event');
    }

    const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let matched = 0;
      const skipped: { label: string; reason: string }[] = [];

      for (const row of users) {
        const scope = resolveCreateScope(actor, row.account_type, institution_id ?? null);
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
              account_type: scope.account_type,
              institution_id: scope.institution_id,
            },
            select: { id: true, name: true },
          });
          user = u;
          created++;
        }

        if (event_id && role_id) {
          await tx.user_event_roles.upsert({
            where: { user_id_event_id_role_id: { user_id: user.id, event_id, role_id } },
            update: {},
            create: { user_id: user.id, event_id, role_id, assigned_by: actor.id },
          });
        }
      }
      return { created, matched, skipped, total: created + matched };
    });

    res.status(201).json(result);
  }));

  // Edit a user (super admin, or the institution POC of the target's institution).
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
