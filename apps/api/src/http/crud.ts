import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import type { Prisma } from '../infra/prisma.js';
import { ConflictError, NotFoundError } from '../shared/errors.js';
import { audit } from '../modules/iam/audit.service.js';
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
  // Always-on where clause for list. Not a filter the caller can turn off: it narrows
  // what this router is FOR (e.g. /roles serves platform roles, never an institution's
  // private copies).
  listWhere?: Record<string, unknown>;
  orderBy?: any;
  include?: any;          // Prisma relations to eager-load on list/get
  guards?: RequestHandler[];      // applied to every route (reads + writes)
  writeGuards?: RequestHandler[]; // applied to update/delete (and create unless createGuards is set)
  createGuards?: RequestHandler[]; // applied only to create; falls back to writeGuards when omitted
  beforeDelete?: (id: string) => Promise<void>; // run before delete: clean up children or block (throw)
  // Record writes in the audit trail. Actions are named `<entity>.created|updated|deleted`.
  audit?: {
    entity: string;                                   // e.g. 'org_domain'
    targetType: string;                               // table the row lives in
    prisma: Prisma;                                   // audit_log lives outside this delegate
    organizationIdOf?: (row: any) => string | null;   // which tenant the row belongs to
    labelOf?: (row: any) => string;                   // denormalised at write time
    summaryOf?: (verb: Verb, row: any) => string;
  };
}

type Verb = 'created' | 'updated' | 'deleted';

// Field-level before/after for the audit entry. On update only the keys that
// actually moved are listed, so the timeline shows "verified: true -> false"
// rather than the whole row twice. Dates are compared by value, not identity.
function fieldDiff(verb: Verb, row: any, before?: any): Record<string, { from: unknown; to: unknown }> {
  const same = (a: unknown, b: unknown) =>
    (a instanceof Date && b instanceof Date) ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);

  if (verb === 'created') return { '*': { from: null, to: row } };
  if (verb === 'deleted') return { '*': { from: row, to: null } };
  if (!before) return { '*': { from: null, to: row } };

  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(row)) {
    if (!same(before[key], row[key])) out[key] = { from: before[key] ?? null, to: row[key] ?? null };
  }
  return out;
}

// Builds a REST CRUD router (list/get/create/update/delete) over a Prisma delegate.
// Used for simple master-data resources; domain-rich contexts get bespoke routers.
export function makeCrudRouter(delegate: Delegate, opts: CrudOptions): Router {
  const router = Router();
  if (opts.guards?.length) router.use(...opts.guards);
  const writeGuards = opts.writeGuards ?? [];
  const createGuards = opts.createGuards ?? writeGuards;

  router.get('/', asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = { ...(opts.listWhere ?? {}) };
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

  // Records a write, if this resource asked to be audited. Safe by construction:
  // audit() never throws, so a failure here can't undo the write it describes.
  const record = async (req: Request, verb: Verb, row: any, before?: any) => {
    const a = opts.audit;
    if (!a || !row) return;
    await audit(a.prisma, req, {
      action: `${a.entity}.${verb}`,
      target: { type: a.targetType, id: row.id ?? null, label: a.labelOf?.(row) ?? null },
      organizationId: a.organizationIdOf?.(row) ?? null,
      summary: a.summaryOf?.(verb, row) ?? `${opts.name} ${verb}`,
      diff: fieldDiff(verb, row, before),
    });
  };

  // Prisma's default unique-violation message names the index, which is meaningless
  // to the admin typing the form - and for an expression index (e.g. lower(domain))
  // it doesn't even name the column. Say what was duplicated instead, without
  // revealing which row already holds it.
  const asConflict = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err: any) {
      if (err?.code === 'P2002') throw new ConflictError(`This ${opts.name.toLowerCase()} already exists`);
      throw err;
    }
  };

  router.post('/', ...createGuards, validateBody(opts.createSchema), asyncHandler(async (req, res) => {
    const row = await asConflict(() => delegate.create({ data: req.body }));
    await record(req, 'created', row);
    res.status(201).json(row);
  }));

  router.patch('/:id', ...writeGuards, validateBody(opts.updateSchema), asyncHandler(async (req, res) => {
    // Read first when auditing, so the entry can say what actually changed rather
    // than just echoing the new state back.
    const before = opts.audit ? await delegate.findUnique({ where: { id: req.params.id } }) : null;
    const row = await asConflict(() => delegate.update({ where: { id: req.params.id }, data: req.body }));
    await record(req, 'updated', row, before);
    res.json(row);
  }));

  router.delete('/:id', ...writeGuards, asyncHandler(async (req, res) => {
    if (opts.beforeDelete) await opts.beforeDelete(req.params.id);
    // Read first so the audit row can describe what was removed - after the delete
    // there is nothing left to name.
    const existing = opts.audit ? await delegate.findUnique({ where: { id: req.params.id } }) : null;
    await delegate.delete({ where: { id: req.params.id } });
    await record(req, 'deleted', existing);
    res.status(204).send();
  }));

  return router;
}
