import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { SETUP_DEFAULT_STEPS, type SetupValidationResult } from '@semp/shared';

// /api/event-setups as the dashboard drives it: a real HTTP round trip (so the zod
// bodies, the super-admin guard and the error mapping are all in the path) over an
// in-memory event_setups table. The validator and the engine are stubbed - each is
// tested on its own; what is asserted here is the status machine and its 409s.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(48) }, isProduction: false }));

const validateSetupWorkbook = vi.fn();
vi.mock('@semp/shared', async (orig) => ({ ...(await orig<typeof import('@semp/shared')>()), validateSetupWorkbook: (i: unknown) => validateSetupWorkbook(i) }));

const engine = { planPlatform: vi.fn(), applyBlueprint: vi.fn(), verifyBlueprint: vi.fn(), cleanupBlueprint: vi.fn() };
vi.mock('./engine.js', async (orig) => ({
  ...(await orig<typeof import('./engine.js')>()),
  planPlatform: (...a: unknown[]) => engine.planPlatform(...a),
  applyBlueprint: (...a: unknown[]) => engine.applyBlueprint(...a),
  verifyBlueprint: (...a: unknown[]) => engine.verifyBlueprint(...a),
  cleanupBlueprint: (...a: unknown[]) => engine.cleanupBlueprint(...a),
}));

// ---- the table ---------------------------------------------------------------------
type Row = Record<string, any>;
const rows = new Map<string, Row>();
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const emptyManifest = () => ({ keys: {}, created: {}, runs: [] });
const listOf = (r: Row) => ({
  id: r.id, label: r.label, event_type: r.event_type, status: r.status, file_name: r.file_name ?? null,
  organization_id: r.organization_id ?? null, org_name: null, championship_id: r.championship_id ?? null, championship_name: null,
  summary: r.validation?.summary ?? null, issue_counts: { error: 0, warning: 0, info: 0 },
  created_at: r.created_at, updated_at: r.updated_at, applied_at: r.applied_at ?? null, created_by_name: 'Admin',
});
vi.mock('./event-setup.repo.js', () => ({
  makeEventSetupRepo: () => ({
    get: async (id: string) => {
      const r = rows.get(id);
      return r ? structuredClone({ ...listOf(r), ...r }) : null;
    },
    list: async () => [...rows.values()].map(listOf),
    workbook: async (id: string) => rows.get(id)?.workbook ?? null,
    create: async (i: Row) => {
      const id = newId();
      rows.set(id, { id, ...i, status: 'draft', manifest: emptyManifest(), credentials: null, created_at: new Date(), updated_at: new Date() });
      return id;
    },
    update: async (id: string, patch: Row, guard?: { onlyIf: string[]; staleApplyingMs?: number }) => {
      const r = rows.get(id);
      if (!r) return false;
      const stale = guard?.staleApplyingMs && r.status === 'applying' && Date.now() - r.updated_at.getTime() > guard.staleApplyingMs;
      if (guard && !guard.onlyIf.includes(r.status) && !stale) return false;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) r[k] = structuredClone(v);
      r.updated_at = new Date();
      return true;
    },
    remove: async (id: string) => { rows.delete(id); },
    manifestStore: (id: string) => ({ load: async () => rows.get(id)!.manifest, save: async (m: Row) => { rows.get(id)!.manifest = m; } }),
  }),
}));

const champNames = new Map<string, string>();
const prisma = {
  users: { findMany: async () => [] as Array<{ phone: string | null; email: string | null }> },
  championships: { findUnique: async ({ where }: { where: { id: string } }) => (champNames.has(where.id) ? { name: champNames.get(where.id)! } : null) },
};

const express = (await import('express')).default;
const { makeEventSetupRouter, isUnreachable, mergeCredentials } = await import('./event-setup.routes.js');
const { CleanupRefusedError } = await import('./engine.js');
const { friendlyError } = await import('../../http/middleware/error.js');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, _res, next) => {
  const isSuperAdmin = req.headers['x-test-super'] === '1';
  (req as Request).user = { id: '11111111-1111-4111-8111-111111111111', email: 'a@x.in', isSuperAdmin, organizationId: null };
  next();
});
app.use('/event-setups', makeEventSetupRouter(prisma as never));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const f = friendlyError(err);
  res.status(f.status).json({ error: { code: f.code, message: f.message } });
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

async function call(method: string, path: string, body?: unknown, { superAdmin = true } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/event-setups${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(superAdmin ? { 'x-test-super': '1' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

const BLUEPRINT = { key: 'acme-cup-2026' };
const result = (over: Partial<SetupValidationResult> = {}): SetupValidationResult => ({
  ok: true, issues: [], blueprint: BLUEPRINT as never,
  summary: { draws: 1, competitors: 2, squads: 2, people: 10, peopleWithMobile: 2, peopleOnPlaceholder: 8, peopleInSeveralSquads: 0, staff: 1, grounds: 1, matches: 1, byes: 0 },
  ...over,
});
const SHEETS = { Event: [['Field', 'Value'], ['Event name', 'Acme Cup']] };

async function created(type = 'intra') {
  return (await call('POST', '/', { label: 'Acme Cup', event_type: type })).body;
}
async function validated() {
  const d = await created();
  await call('POST', `/${d.id}/validate`, { file_name: 'acme.xlsx', sheets: SHEETS });
  return rows.get(d.id)!;
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  rows.clear();
  champNames.clear();
  vi.clearAllMocks();
  validateSetupWorkbook.mockImplementation(() => result());
  engine.planPlatform.mockResolvedValue({ steps: [{ step: 'org', mode: 'sheet', found: 0, create: 1, missing: 0, notes: [] }], issues: [] });
  engine.verifyBlueprint.mockResolvedValue({ checked: 3, failures: [] });
  engine.cleanupBlueprint.mockResolvedValue([]);
});

describe('the guard', () => {
  it('is super-admin only, on every route', async () => {
    expect((await call('GET', '/', undefined, { superAdmin: false })).status).toBe(403);
    expect((await call('POST', '/', { label: 'x', event_type: 'intra' }, { superAdmin: false })).status).toBe(403);
    expect((await call('GET', `/${newId()}/credentials`, undefined, { superAdmin: false })).status).toBe(403);
    expect(rows.size).toBe(0);
  });

  it('404s an unknown or malformed id rather than reaching the database with it', async () => {
    expect((await call('GET', `/${newId()}`)).status).toBe(404);
    expect((await call('GET', '/not-a-uuid')).status).toBe(404);
  });
});

describe('create', () => {
  it('starts a draft on the event type\'s default steps', async () => {
    const { status, body } = await call('POST', '/', { label: '  Acme Invitational ', event_type: 'inter' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ label: 'Acme Invitational', event_type: 'inter', status: 'draft', validation: null, platform: null, contacts: null, credentials_count: 0 });
    expect(body.steps).toEqual(SETUP_DEFAULT_STEPS.inter);
    expect(body.steps.campus).toBe('skip');
    expect((await call('GET', '/')).body).toHaveLength(1);
  });

  it('rejects an unknown event type or an empty label', async () => {
    expect((await call('POST', '/', { label: 'x', event_type: 'league' })).status).toBe(422);
    expect((await call('POST', '/', { label: '   ', event_type: 'intra' })).status).toBe(422);
  });
});

describe('PUT /:id/steps', () => {
  const steps = { ...SETUP_DEFAULT_STEPS.intra, fixtures: 'skip' };

  it('needs every step with a known mode, and nothing else', async () => {
    const d = await created();
    const { fixtures: _f, ...missingOne } = steps;
    expect((await call('PUT', `/${d.id}/steps`, { steps: missingOne })).status).toBe(422);
    expect((await call('PUT', `/${d.id}/steps`, { steps: { ...steps, extra: 'sheet' } })).status).toBe(422);
    expect((await call('PUT', `/${d.id}/steps`, { steps: { ...steps, org: 'maybe' } })).status).toBe(422);
    const ok = await call('PUT', `/${d.id}/steps`, { steps });
    expect(ok.status).toBe(200);
    expect(ok.body.steps.fixtures).toBe('skip');
  });

  it('sends a validated setup back to draft', async () => {
    const row = await validated();
    expect(row.status).toBe('validated');
    const { body } = await call('PUT', `/${row.id}/steps`, { steps });
    expect(body.status).toBe('draft');
  });

  it('is refused once applied', async () => {
    const d = await created();
    rows.get(d.id)!.status = 'applied';
    expect((await call('PUT', `/${d.id}/steps`, { steps })).status).toBe(409);
  });
});

describe('POST /:id/validate', () => {
  it('stores the grids, the verdict and the platform plan, and is validated when neither has an error', async () => {
    const d = await created();
    const { status, body } = await call('POST', `/${d.id}/validate`, { file_name: 'acme.xlsx', sheets: SHEETS });
    expect(status).toBe(200);
    expect(body.status).toBe('validated');
    expect(body.file_name).toBe('acme.xlsx');
    expect(body.validation.summary.people).toBe(10);
    expect(body.platform.steps[0]).toMatchObject({ step: 'org', create: 1 });
    expect(validateSetupWorkbook).toHaveBeenCalledWith({ eventType: 'intra', steps: SETUP_DEFAULT_STEPS.intra, sheets: SHEETS });
    const row = rows.get(d.id)!;
    expect(row.workbook).toEqual({ sheets: SHEETS });
    expect(row.blueprint_key).toBe('acme-cup-2026');
  });

  it('is invalid on a validator error, and does not ask the platform without a blueprint', async () => {
    validateSetupWorkbook.mockImplementation(() => result({ ok: false, blueprint: null, issues: [{ severity: 'error', code: 'missing_column', message: 'm' }] }));
    const d = await created();
    const { body } = await call('POST', `/${d.id}/validate`, { sheets: SHEETS });
    expect(body.status).toBe('invalid');
    expect(body.platform).toBeNull();
    expect(engine.planPlatform).not.toHaveBeenCalled();
  });

  it('is invalid on a platform error even when the sheet is clean', async () => {
    engine.planPlatform.mockResolvedValue({ steps: [], issues: [{ severity: 'error', code: 'not_on_platform', message: 'Acme is not on the platform' }] });
    const d = await created();
    expect((await call('POST', `/${d.id}/validate`, { sheets: SHEETS })).body.status).toBe('invalid');
  });

  it('reads numbers and blanks as the text a cell shows', async () => {
    const d = await created();
    await call('POST', `/${d.id}/validate`, { sheets: { Draws: [['Squad max', 10, null, true]] } });
    expect(validateSetupWorkbook.mock.calls[0][0].sheets).toEqual({ Draws: [['Squad max', '10', '', 'true']] });
  });

  it('caps the workbook: sheets, rows and bytes', async () => {
    const d = await created();
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`S${i}`, [['a']]]));
    expect((await call('POST', `/${d.id}/validate`, { sheets: many })).status).toBe(422);
    expect((await call('POST', `/${d.id}/validate`, { sheets: { Squads: Array.from({ length: 5001 }, () => ['a']) } })).status).toBe(422);
    const big = { Squads: Array.from({ length: 4000 }, () => ['x'.repeat(600)]) };
    const r = await call('POST', `/${d.id}/validate`, { sheets: big });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/2 MB/);
    expect(validateSetupWorkbook).not.toHaveBeenCalled();
  });

  it('is refused while applying and after applied', async () => {
    const d = await created();
    rows.get(d.id)!.status = 'applying';
    expect((await call('POST', `/${d.id}/validate`, { sheets: SHEETS })).status).toBe(409);
    rows.get(d.id)!.status = 'applied';
    expect((await call('POST', `/${d.id}/validate`, { sheets: SHEETS })).status).toBe(409);
  });
});

describe('POST /:id/apply', () => {
  it('is refused unless validated', async () => {
    const d = await created();
    expect((await call('POST', `/${d.id}/apply`)).status).toBe(409);
    for (const status of ['invalid', 'applied', 'failed', 'undone', 'applying']) {
      rows.get(d.id)!.status = status;
      expect((await call('POST', `/${d.id}/apply`)).status).toBe(409);
    }
    expect(engine.applyBlueprint).not.toHaveBeenCalled();
  });

  it('refuses a stored workbook that no longer validates, and marks it invalid', async () => {
    const row = await validated();
    validateSetupWorkbook.mockImplementation(() => result({ ok: false, issues: [{ severity: 'error', code: 'x', message: 'm' }] }));
    expect((await call('POST', `/${row.id}/apply`)).status).toBe(409);
    expect(rows.get(row.id)!.status).toBe('invalid');
    expect(engine.applyBlueprint).not.toHaveBeenCalled();
  });

  it('returns 202 applying, then lands applied with the report, the ids and only reachable passwords', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    engine.applyBlueprint.mockImplementation(async (_p: unknown, _bp: unknown, _s: unknown, opts: { credentials: unknown[] }) => {
      await gate;
      const creds = [
        { name: 'A', role: 'player', contact: 'real mobile', phone: '9876543210', email: 'a@placeholder.invalid', password: 'a@3210' },
        { name: 'B', role: 'player', contact: 'placeholder', phone: '5000000001', email: 'b@placeholder.invalid', password: 'random-secret' },
      ];
      opts.credentials.push(...creds);
      return { reports: [{ step: 'org', mode: 'sheet', found: 0, created: 1, notes: [] }], ids: { orgId: 'org-1', champId: 'champ-1' }, credentials: creds, fixtureView: [] };
    });
    const row = await validated();
    const r = await call('POST', `/${row.id}/apply`);
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('applying');
    // A second click while it runs.
    expect((await call('POST', `/${row.id}/apply`)).status).toBe(409);
    release();
    await until(() => rows.get(row.id)!.status !== 'applying');
    const done = rows.get(row.id)!;
    expect(done).toMatchObject({ status: 'applied', organization_id: 'org-1', championship_id: 'champ-1', error: null });
    expect(done.apply_report[0]).toMatchObject({ step: 'org', created: 1 });
    expect(done.applied_at).toBeInstanceOf(Date);
    expect(done.credentials.find((c: any) => c.name === 'B').password).toBeNull();
    expect(JSON.stringify(done.credentials)).not.toContain('random-secret');
    const creds = (await call('GET', `/${row.id}/credentials`)).body.rows;
    expect(creds).toEqual([
      { name: 'A', role: 'player', contact: 'real mobile', phone: '9876543210', email: 'a@placeholder.invalid', password: 'a@3210' },
      { name: 'B', role: 'player', contact: 'placeholder', phone: '5000000001', email: 'b@placeholder.invalid', password: null },
    ]);
  });

  it('lands failed with the message, keeping logins made before the failure', async () => {
    engine.applyBlueprint.mockImplementation(async (_p: unknown, _bp: unknown, _s: unknown, opts: { credentials: unknown[] }) => {
      opts.credentials.push({ name: 'A', role: 'player', contact: 'real mobile', phone: '9876543210', email: 'a@x.in', password: 'a@3210' });
      throw new Error('squads: boom');
    });
    const row = await validated();
    rows.get(row.id)!.manifest = { keys: { org: 'org-9' }, created: { users: ['u1'] }, runs: [] };
    expect((await call('POST', `/${row.id}/apply`)).status).toBe(202);
    await until(() => rows.get(row.id)!.status !== 'applying');
    expect(rows.get(row.id)).toMatchObject({ status: 'failed', error: 'squads: boom', organization_id: 'org-9' });
    expect(rows.get(row.id)!.credentials).toHaveLength(1);
  });

  it('lets a stale applying row (no progress for 10 minutes) be applied again', async () => {
    engine.applyBlueprint.mockResolvedValue({ reports: [], ids: { orgId: 'o', champId: 'c' }, credentials: [], fixtureView: [] });
    const row = await validated();
    rows.get(row.id)!.status = 'applying';
    rows.get(row.id)!.updated_at = new Date(Date.now() - 11 * 60 * 1000);
    expect((await call('POST', `/${row.id}/apply`)).status).toBe(202);
    await until(() => rows.get(row.id)!.status !== 'applying');
    expect(rows.get(row.id)!.status).toBe('applied');
  });
});

describe('verify and undo', () => {
  it('stores the verify report', async () => {
    const row = await validated();
    const { body } = await call('POST', `/${row.id}/verify`);
    expect(body.verify_report).toMatchObject({ checked: 3, failures: [] });
  });

  it('refuses to verify without a blueprint', async () => {
    const d = await created();
    expect((await call('POST', `/${d.id}/verify`)).status).toBe(409);
  });

  it('undoes an applied setup and clears its logins', async () => {
    const d = await created();
    Object.assign(rows.get(d.id)!, { status: 'applied', credentials: [{ name: 'A' }], manifest: { keys: {}, created: { users: ['u1'] }, runs: [] } });
    const { status, body } = await call('POST', `/${d.id}/undo`, { confirm: 'acme cup' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'undone', credentials_count: 0 });
    expect(engine.cleanupBlueprint).toHaveBeenCalledTimes(1);
  });

  it('refuses to undo without the typed confirmation, and names what to type', async () => {
    const d = await created();
    Object.assign(rows.get(d.id)!, { status: 'applied', manifest: { keys: {}, created: { users: ['u1'] }, runs: [] } });
    const none = await call('POST', `/${d.id}/undo`);
    expect(none.status).toBe(422);
    expect(none.body.error.message).toContain('"Acme Cup"');
    expect((await call('POST', `/${d.id}/undo`, { confirm: 'Acme' })).status).toBe(422);
    expect(engine.cleanupBlueprint).not.toHaveBeenCalled();
    expect(rows.get(d.id)!.status).toBe('applied');
  });

  it('asks for the current championship name once one was made, not the setup label', async () => {
    const d = await created();
    Object.assign(rows.get(d.id)!, { status: 'applied', championship_id: 'c-1', manifest: { keys: {}, created: { users: ['u1'] }, runs: [] } });
    champNames.set('c-1', 'Acme Football Cup 2026');
    expect((await call('POST', `/${d.id}/undo`, { confirm: 'Acme Cup' })).status).toBe(422);
    expect((await call('POST', `/${d.id}/undo`, { confirm: ' Acme Football Cup 2026 ' })).status).toBe(200);
  });

  it('turns the engine\'s refusal (a match was played) into a 409 and leaves the setup as it was', async () => {
    engine.cleanupBlueprint.mockRejectedValue(new CleanupRefusedError('Undo refused: 2 matches have been played.'));
    const d = await created();
    Object.assign(rows.get(d.id)!, { status: 'applied', manifest: { keys: {}, created: { fixtures: ['f'] }, runs: [] } });
    const r = await call('POST', `/${d.id}/undo`, { confirm: 'Acme Cup' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/played/);
    expect(rows.get(d.id)!.status).toBe('applied');
  });

  it('has nothing to undo on a setup that created nothing', async () => {
    const d = await created();
    expect((await call('POST', `/${d.id}/undo`)).status).toBe(409);
  });
});

describe('DELETE /:id', () => {
  const withStatus = async (status: string, createdRows = false) => {
    const d = await created();
    Object.assign(rows.get(d.id)!, { status, manifest: { keys: {}, created: createdRows ? { users: ['u1'] } : {}, runs: [] } });
    return d.id as string;
  };

  it('deletes a draft, an invalid, a validated, an undone, and a failed setup that made nothing', async () => {
    for (const s of ['draft', 'invalid', 'validated', 'undone', 'failed']) {
      const id = await withStatus(s);
      expect((await call('DELETE', `/${id}`)).status).toBe(200);
      expect(rows.has(id)).toBe(false);
    }
  });

  it('refuses applying and applied setups, and anything whose manifest lists rows', async () => {
    // validated + rows: re-validated after a failed run that built part of the event.
    for (const [s, made] of [['validated', true], ['applied', true], ['applying', false], ['failed', true], ['invalid', true]] as const) {
      const id = await withStatus(s, made);
      expect((await call('DELETE', `/${id}`)).status).toBe(409);
      expect(rows.has(id)).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('counts an account reachable once it has one real contact', () => {
    expect(isUnreachable({ phone: '5000000001', email: 'a@placeholder.invalid' })).toBe(true);
    expect(isUnreachable({ phone: null, email: 'a@placeholder.invalid' })).toBe(true);
    expect(isUnreachable({ phone: '9876543210', email: 'a@placeholder.invalid' })).toBe(false);
    expect(isUnreachable({ phone: '5000000001', email: 'asha@corp.com' })).toBe(false);
  });

  it('merges logins by email, the fresh one winning, never keeping a placeholder password', () => {
    const merged = mergeCredentials(
      [{ name: 'A', role: 'player', contact: 'real mobile', phone: '1', email: 'A@x.in', password: 'old' }],
      [{ name: 'A', role: 'player', contact: 'real mobile', phone: '1', email: 'a@x.in', password: 'new' },
        { name: 'B', role: 'player', contact: 'placeholder', phone: '5', email: 'b@p.invalid', password: 'secret' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].password).toBe('new');
    expect(merged[1].password).toBeNull();
  });
});
