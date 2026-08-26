import { Router } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { deleteTemplate, listTemplates } from './templates.service.js';


// The template library: what an organiser can start a new championship from.
//
// Mounted after the global requireAuth. There is no create route here on purpose - a
// template is captured from a championship that exists, via
// POST /championships/:id/save-template, so a template always describes something real.

export function makeChampionshipTemplatesRouter(prisma: Prisma): Router {
  const router = Router();

  // The built-ins, plus anything this person or their organisations saved.
  router.get('/', asyncHandler(async (req, res) => {
    res.json(await listTemplates(prisma, req.user!.id));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await deleteTemplate(prisma, req, req.params.id));
  }));

  return router;
}
