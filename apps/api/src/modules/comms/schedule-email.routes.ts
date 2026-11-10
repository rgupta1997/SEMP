import { Router } from 'express';
import { scheduleEmailSendSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { NotFoundError } from '../../shared/errors.js';
import { getScheduleAudience, sendScheduleEmails } from './schedule-email.service.js';

// Super-admin console: email every entered participant that the fixtures are live.
// Mounted behind the global parseAuth; every route additionally requires a super admin.
// GET  /platform/schedule-email/:championshipId/audience  — orgs + people + flags
// POST /platform/schedule-email/:championshipId/send      — mail the confirmed ids
export function makeScheduleEmailRouter(prisma: Prisma): Router {
  const router = Router();

  router.get('/:championshipId/audience', requireSuperAdmin, asyncHandler(async (req, res) => {
    const champ = await prisma.championships.findUnique({
      where: { id: req.params.championshipId }, select: { id: true },
    });
    if (!champ) throw new NotFoundError('Championship');
    res.json(await getScheduleAudience(prisma, req.params.championshipId));
  }));

  router.post('/:championshipId/send', requireSuperAdmin, validateBody(scheduleEmailSendSchema),
    asyncHandler(async (req, res) => {
      const champ = await prisma.championships.findUnique({
        where: { id: req.params.championshipId }, select: { id: true },
      });
      if (!champ) throw new NotFoundError('Championship');
      const result = await sendScheduleEmails(prisma, req.params.championshipId, req.body.userIds);
      res.json(result);
    }));

  return router;
}
