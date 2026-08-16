import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { enterAsIndividual } from './solo-entry.service.js';

// Entering without an institution (J3-E1). Its own router rather than a branch inside
// the enrolment routes, because the whole point is that this path never mentions an
// organisation - keeping it separate keeps that promise visible in the code too.
const soloEntrySchema = z.object({
  draw_id: z.string().uuid(),
  // Present = "a group of friends" and this is the squad name; absent = "just me".
  squad_name: z.string().min(1).max(60).optional(),
});

export function makeSoloEntryRouter(prisma: Prisma): Router {
  const router = Router();

  // No guard beyond the global requireAuth: a person entering on their own behalf is
  // authorised by being themselves. The service checks the championship is open and
  // that its organiser allows individual entries.
  router.post('/championships/:eventId/enter-individually',
    validateBody(soloEntrySchema),
    asyncHandler(async (req, res) => {
      const { draw_id, squad_name } = req.body as { draw_id: string; squad_name?: string };
      const out = await enterAsIndividual(prisma, req, {
        championshipId: req.params.eventId,
        drawId: draw_id,
        squadName: squad_name ?? null,
      });
      res.status(201).json(out);
    }));

  return router;
}
