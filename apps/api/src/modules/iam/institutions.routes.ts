import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createInstitutionWithPocSchema, updateInstitutionSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';

const DEFAULT_PASSWORD = 'demo123';

// Bespoke institutions router: list/get are open reads; creation is allowed for
// super admins and organisers (so they can grow the master list) and can attach a
// first point-of-contact login atomically; edits/deletes stay super-admin only.
export function makeInstitutionsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  router.get('/', asyncHandler(async (_req, res) => {
    const rows = await prisma.institutions.findMany({ orderBy: { name: 'asc' } });
    res.json(rows);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await prisma.institutions.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Institution');
    res.json(row);
  }));

  router.post('/', guards.organiserAccount, validateBody(createInstitutionWithPocSchema), asyncHandler(async (req, res) => {
    const { poc, ...institution } = req.body as {
      name: string; short_name?: string; code?: string; logo_url?: string;
      city?: string; status?: boolean; country?: string;
      poc?: { name: string; email: string; password?: string; phone?: string };
    };

    if (poc) {
      const existing = await prisma.users.findUnique({ where: { email: poc.email }, select: { id: true } });
      if (existing) throw new BusinessRuleError('A user with the point-of-contact email already exists');
    }

    const created = await prisma.$transaction(async (tx) => {
      const inst = await tx.institutions.create({ data: { ...institution, status: institution.status ?? true } });
      if (poc) {
        const password_hash = await bcrypt.hash(poc.password || DEFAULT_PASSWORD, 10);
        await tx.users.create({
          data: {
            name: poc.name,
            email: poc.email,
            phone: poc.phone ?? null,
            password_hash,
            account_type: 'institution',
            institution_id: inst.id,
          },
        });
      }
      return inst;
    });

    res.status(201).json(created);
  }));

  router.patch('/:id', requireSuperAdmin, validateBody(updateInstitutionSchema), asyncHandler(async (req, res) => {
    const row = await prisma.institutions.update({ where: { id: req.params.id }, data: req.body });
    res.json(row);
  }));

  router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
    await prisma.institutions.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  return router;
}
