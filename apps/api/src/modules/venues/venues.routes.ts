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

export function makeVenuesRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const writeGuards = [guards.eventCrudGuard({
    body: async (req) => req.body?.event_id,
    byId: guards.resolvers.eventOfVenue,
  })];

  router.post('/bulk', guards.eventCrudGuard({
    body: async (req) => req.body?.venues?.[0]?.event_id,
    byId: guards.resolvers.eventOfVenue,
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
    listFilters: ['event_id'], orderBy: { created_at: 'asc' }, writeGuards,
  }));

  return router;
}

export function makeVenueGroundsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const writeGuards = [guards.eventCrudGuard({
    body: async (req) => guards.resolvers.eventOfVenue(req.body?.venue_id),
    byId: guards.resolvers.eventOfVenueGround,
  })];

  router.post('/bulk', guards.eventCrudGuard({
    body: async (req) => guards.resolvers.eventOfVenue(req.body?.grounds?.[0]?.venue_id),
    byId: guards.resolvers.eventOfVenueGround,
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
  }));

  return router;
}
