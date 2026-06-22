import { Router } from 'express';
import { createDemoRequestSchema, updateDemoRequestSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { NotFoundError } from '../../shared/errors.js';

// "Book a demo" leads from the public landing page.
//
// This router is mounted BEFORE the global requireAuth gate, so the create route
// is reachable by anonymous visitors. Read/triage/delete are restricted to
// platform super-admins via requireSuperAdmin (which itself rejects anonymous and
// non-admin callers), so no other authenticated user can see captured leads.
export function makeDemoRequestsRouter(prisma: Prisma): Router {
  const router = Router();

  // Public: capture a lead. Returns only an acknowledgement - never echoes stored
  // data back to the anonymous caller.
  router.post('/', validateBody(createDemoRequestSchema), asyncHandler(async (req, res) => {
    await prisma.demo_requests.create({ data: req.body });
    res.status(201).json({ ok: true });
  }));

  // Admin: newest-first list of all leads, with the triaging admin's name.
  router.get('/', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const rows = await prisma.demo_requests.findMany({
      orderBy: { created_at: 'desc' },
      include: { users: { select: { id: true, name: true } } },
    });
    res.json(rows);
  }));

  // Admin: move a lead through its lifecycle / annotate it. Records who triaged it.
  router.patch('/:id', requireSuperAdmin, validateBody(updateDemoRequestSchema), asyncHandler(async (req, res) => {
    const existing = await prisma.demo_requests.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Demo request');
    const updated = await prisma.demo_requests.update({
      where: { id: req.params.id },
      data: { ...req.body, handled_by: req.user!.id, updated_at: new Date() },
      include: { users: { select: { id: true, name: true } } },
    });
    res.json(updated);
  }));

  // Admin: drop a lead.
  router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
    const existing = await prisma.demo_requests.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Demo request');
    await prisma.demo_requests.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));

  return router;
}
