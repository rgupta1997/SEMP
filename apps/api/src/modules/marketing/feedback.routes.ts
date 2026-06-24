import { Router } from 'express';
import { createFeedbackSchema, updateFeedbackSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { NotFoundError } from '../../shared/errors.js';

// User feedback from the public championship pages and the in-app shell.
//
// This router is mounted BEFORE the global requireAuth gate, so the create route is
// reachable by anonymous visitors; a signed-in sender's id is captured opportunistically
// (parseAuth runs globally first). Read/triage/delete are restricted to platform
// super-admins via requireSuperAdmin. Mirrors makeDemoRequestsRouter.
export function makeFeedbackRouter(prisma: Prisma): Router {
  const router = Router();

  // Public: capture feedback. Returns only an acknowledgement - never echoes stored data.
  router.post('/', validateBody(createFeedbackSchema), asyncHandler(async (req, res) => {
    const { email, ...rest } = req.body as {
      message: string; name?: string; email?: string; context?: string; championship_id?: string;
    };
    await prisma.feedback.create({
      data: { ...rest, email: email || null, user_id: req.user?.id ?? null },
    });
    res.status(201).json({ ok: true });
  }));

  // Admin: newest-first list of all feedback, with the triaging admin's name.
  router.get('/', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const rows = await prisma.feedback.findMany({
      orderBy: { created_at: 'desc' },
      include: { users: { select: { id: true, name: true } } },
    });
    res.json(rows);
  }));

  // Admin: move a feedback row through its triage lifecycle. Records who triaged it.
  router.patch('/:id', requireSuperAdmin, validateBody(updateFeedbackSchema), asyncHandler(async (req, res) => {
    const existing = await prisma.feedback.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Feedback');
    const updated = await prisma.feedback.update({
      where: { id: req.params.id },
      data: { ...req.body, handled_by: req.user!.id, updated_at: new Date() },
      include: { users: { select: { id: true, name: true } } },
    });
    res.json(updated);
  }));

  // Admin: drop a feedback row.
  router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
    const existing = await prisma.feedback.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Feedback');
    await prisma.feedback.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));

  return router;
}
