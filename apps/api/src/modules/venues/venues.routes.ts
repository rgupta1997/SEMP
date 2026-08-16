import { Router } from 'express';
import {
  bulkCreateGroundsSchema, bulkCreateVenuesSchema,
  createGroundSchema, createVenueSchema, updateGroundSchema, updateVenueSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { makeCrudRouter } from '../../http/crud.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { BusinessRuleError } from '../../shared/errors.js';

export function makeVenuesRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const writeGuards = [guards.championshipCrudGuard({
    body: async (req) => req.body?.championship_id,
    byId: guards.resolvers.championshipOfVenue,
  })];

  router.post('/bulk', guards.championshipCrudGuard({
    body: async (req) => req.body?.venues?.[0]?.championship_id,
    byId: guards.resolvers.championshipOfVenue,
  }), validateBody(bulkCreateVenuesSchema), asyncHandler(async (req, res) => {
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const v of req.body.venues) {
        out.push(await tx.venues.create({ data: v }));
      }
      return out;
    });
    res.status(201).json({ created: created.length, venues: created });
  }));

  router.use(makeCrudRouter(prisma.venues, {
    name: 'Venue', createSchema: createVenueSchema, updateSchema: updateVenueSchema,
    listFilters: ['championship_id'], orderBy: { created_at: 'asc' }, writeGuards,
    // A venue whose grounds are hosting matches cannot be deleted (J2-E3-S2). The FK
    // would refuse it anyway, but as an opaque constraint error - this says which
    // matches are in the way, which is the difference between a wall and a next step.
    beforeDelete: async (id) => {
      const grounds = await prisma.venue_grounds.findMany({ where: { venue_id: id }, select: { id: true } });
      if (grounds.length) {
        const used = await prisma.fixtures.count({ where: { venue_ground_id: { in: grounds.map((g) => g.id) } } });
        if (used > 0) {
          throw new BusinessRuleError(
            `This venue has ${used} scheduled match${used === 1 ? '' : 'es'} on its grounds. Move or unschedule them first.`,
          );
        }
        // No fixtures reference them, so the empty grounds go with the venue rather
        // than leaving the organiser to delete each one by hand.
        await prisma.venue_grounds.deleteMany({ where: { venue_id: id } });
      }
    },
  }));

  return router;
}

export function makeVenueGroundsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const writeGuards = [guards.championshipCrudGuard({
    body: async (req) => guards.resolvers.championshipOfVenue(req.body?.venue_id),
    byId: guards.resolvers.championshipOfVenueGround,
  })];

  router.post('/bulk', guards.championshipCrudGuard({
    body: async (req) => guards.resolvers.championshipOfVenue(req.body?.grounds?.[0]?.venue_id),
    byId: guards.resolvers.championshipOfVenueGround,
  }), validateBody(bulkCreateGroundsSchema), asyncHandler(async (req, res) => {
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < req.body.grounds.length; i++) {
        const g = req.body.grounds[i];
        out.push(await tx.venue_grounds.create({
          data: { ...g, display_order: g.display_order ?? i },
        }));
      }
      return out;
    });
    res.status(201).json({ created: created.length, grounds: created });
  }));

  router.use(makeCrudRouter(prisma.venue_grounds, {
    name: 'Ground', createSchema: createGroundSchema, updateSchema: updateGroundSchema,
    listFilters: ['venue_id'], orderBy: { display_order: 'asc' }, writeGuards,
    beforeDelete: async (id) => {
      const used = await prisma.fixtures.count({ where: { venue_ground_id: id } });
      if (used > 0) {
        throw new BusinessRuleError(
          `This ground has ${used} scheduled match${used === 1 ? '' : 'es'} on it. Move or unschedule them first.`,
        );
      }
    },
  }));

  return router;
}
