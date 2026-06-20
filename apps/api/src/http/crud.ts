import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { NotFoundError } from '../shared/errors.js';
import { asyncHandler } from './middleware/error.js';
import { validateBody } from './middleware/validate.js';
import { coerceFilter, parsePaging } from './paging.js';

// Minimal Prisma model delegate shape we rely on.
interface Delegate {
  findMany(args?: any): Promise<any[]>;
  findUnique(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
}

interface CrudOptions {
  name: string;
  createSchema: ZodSchema<any>;
  updateSchema: ZodSchema<any>;
  listFilters?: string[]; // query params allowed as exact-match where clauses
  orderBy?: any;
  include?: any;          // Prisma relations to eager-load on list/get
  guards?: RequestHandler[];      // applied to every route (reads + writes)
  writeGuards?: RequestHandler[]; // applied to update/delete (and create unless createGuards is set)
  createGuards?: RequestHandler[]; // applied only to create; falls back to writeGuards when omitted
  beforeDelete?: (id: string) => Promise<void>; // run before delete: clean up children or block (throw)
}

// Builds a REST CRUD router (list/get/create/update/delete) over a Prisma delegate.
// Used for simple master-data resources; domain-rich contexts get bespoke routers.
export function makeCrudRouter(delegate: Delegate, opts: CrudOptions): Router {
  const router = Router();
  if (opts.guards?.length) router.use(...opts.guards);
  const writeGuards = opts.writeGuards ?? [];
  const createGuards = opts.createGuards ?? writeGuards;

  router.get('/', asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = {};
    for (const key of opts.listFilters ?? []) {
      const val = coerceFilter(req.query[key]);
      if (val !== undefined) where[key] = val;
    }
    const { take, skip } = parsePaging(req.query);
    const rows = await delegate.findMany({ where, orderBy: opts.orderBy, take, skip, include: opts.include });
    res.json(rows);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await delegate.findUnique({ where: { id: req.params.id }, include: opts.include });
    if (!row) throw new NotFoundError(opts.name);
    res.json(row);
  }));

  router.post('/', ...createGuards, validateBody(opts.createSchema), asyncHandler(async (req, res) => {
    const row = await delegate.create({ data: req.body });
    res.status(201).json(row);
  }));

  router.patch('/:id', ...writeGuards, validateBody(opts.updateSchema), asyncHandler(async (req, res) => {
    const row = await delegate.update({ where: { id: req.params.id }, data: req.body });
    res.json(row);
  }));

  router.delete('/:id', ...writeGuards, asyncHandler(async (req, res) => {
    if (opts.beforeDelete) await opts.beforeDelete(req.params.id);
    await delegate.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  return router;
}
