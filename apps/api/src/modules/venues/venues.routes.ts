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
import { ConflictError } from '../../shared/errors.js';
import { syncHostCities } from './host-cities.service.js';

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
    await syncHostCities(prisma, req.body.venues[0].championship_id);
    res.status(201).json({ created: created.length, venues: created });
  }));

  // Every venue change re-derives the championship's host cities (host-cities.service).
  router.use(makeCrudRouter(prisma.venues, {
    name: 'Venue', createSchema: createVenueSchema, updateSchema: updateVenueSchema,
    listFilters: ['championship_id'], orderBy: { created_at: 'asc' }, writeGuards,
    afterCreate: (row) => syncHostCities(prisma, row.championship_id),
    afterUpdate: async (_id, before, after) => {
      await syncHostCities(prisma, after.championship_id);
      if (before?.championship_id && before.championship_id !== after.championship_id) {
        await syncHostCities(prisma, before.championship_id);
      }
    },
    afterDelete: (before) => syncHostCities(prisma, before.championship_id),
  }));

  return router;
}

/** Ground names compared as a person reads them: case and extra spaces ignored. */
const groundKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

export function makeVenueGroundsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const writeGuards = [guards.championshipCrudGuard({
    body: async (req) => guards.resolvers.championshipOfVenue(req.body?.venue_id),
    byId: guards.resolvers.championshipOfVenueGround,
  })];

  /**
   * One venue cannot have two grounds of the same name - the fixture picker would list
   * both with nothing to tell them apart. Other venues may reuse it ("Turf 1" in two
   * cities). `exceptId` is the ground being renamed, which may keep its own name.
   */
  async function assertGroundNamesFree(venueId: string, names: string[], exceptId?: string): Promise<void> {
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(groundKey(n))) throw new ConflictError(`"${n.trim()}" is in the list twice.`);
      seen.add(groundKey(n));
    }
    const existing = await prisma.venue_grounds.findMany({
      where: { venue_id: venueId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true },
    });
    const taken = new Map(existing.map((g) => [groundKey(g.name), g.name]));
    const clash = names.find((n) => taken.has(groundKey(n)));
    if (clash) {
      const venue = await prisma.venues.findUnique({ where: { id: venueId }, select: { name: true } });
      throw new ConflictError(`${venue?.name ?? 'This venue'} already has a ground called "${taken.get(groundKey(clash))}".`);
    }
  }

  // Checked BEFORE the generic create/update below (which then runs as before), and
  // after the same guard, so a name list is never read for a venue you cannot edit.
  router.post('/', ...writeGuards, validateBody(createGroundSchema), asyncHandler(async (req, _res, next) => {
    await assertGroundNamesFree(req.body.venue_id, [req.body.name]);
    next();
  }));
  router.patch('/:id', ...writeGuards, validateBody(updateGroundSchema), asyncHandler(async (req, _res, next) => {
    if (typeof req.body.name === 'string' || req.body.venue_id) {
      const current = await prisma.venue_grounds.findUnique({ where: { id: req.params.id }, select: { venue_id: true, name: true } });
      if (current) {
        await assertGroundNamesFree(req.body.venue_id ?? current.venue_id, [req.body.name ?? current.name], req.params.id);
      }
    }
    next();
  }));

  router.post('/bulk', guards.championshipCrudGuard({
    body: async (req) => guards.resolvers.championshipOfVenue(req.body?.grounds?.[0]?.venue_id),
    byId: guards.resolvers.championshipOfVenueGround,
  }), validateBody(bulkCreateGroundsSchema), asyncHandler(async (req, res) => {
    // The schema already holds every row to one venue.
    await assertGroundNamesFree(req.body.grounds[0].venue_id, req.body.grounds.map((g: { name: string }) => g.name));
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
