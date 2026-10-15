// Event Setup - super-admin only. One row per event built from the standard workbook:
// create (pick the event type) -> validate (upload the grids; the shared validator,
// then the platform plan) -> apply (a detached job; the row's status is the progress
// signal the dashboard polls) -> verify -> credentials -> undo.
//
// Status machine:
//   draft --validate--> validated | invalid      (re-validate any time before apply)
//   validated --apply--> applying --> applied | failed
//   failed --validate--> validated --apply--> ... (the manifest carries over, so a
//                                                  second apply finds what the first made)
//   applied | failed --undo--> undone --validate--> ...
// Nothing that would orphan rows is allowed: delete is refused while the manifest
// lists rows this setup created, and validate is refused once applied (undo first).

import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  SETUP_DEFAULT_STEPS, SETUP_EVENT_TYPES, SETUP_STALE_APPLY_MS, SETUP_STEP_KEYS, SETUP_STEP_MODES,
  SETUP_WORKBOOK_LIMITS, isPlaceholderEmail, isPlaceholderPhone, validateSetupWorkbook,
  type SetupIssue, type SetupSteps, type SetupValidationResult,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  CleanupRefusedError, applyBlueprint, cleanupBlueprint, createdCount, planPlatform, storableCredential,
  verifyBlueprint, type CredentialRow,
} from './engine.js';
import { makeEventSetupRepo, type EventSetupListRow, type EventSetupRow } from './event-setup.repo.js';

// A row may sit in 'applying' forever if the process died mid-job (or a Lambda was
// frozen under it); after this long without progress (every manifest save refreshes
// updated_at) the busy state is treated as stale and apply / undo are allowed again.
// Shared with the dashboard, which shows the same "looks stuck" state.
export const STALE_APPLYING_MS = SETUP_STALE_APPLY_MS;

/** The upload caps, shared with the dashboard. The JSON parser's own limit (5 MB, server.ts) is the outer wall. */
export const WORKBOOK_LIMITS = SETUP_WORKBOOK_LIMITS;

// One in-flight job per setup per process (the status compare-and-set guards across processes).
const busy = new Set<string>();

// Every step key, each with one of the three modes - nothing missing, nothing extra.
const stepsSchema = z.object(
  Object.fromEntries(SETUP_STEP_KEYS.map((k) => [k, z.enum(SETUP_STEP_MODES)])) as z.ZodRawShape,
).strict() as unknown as z.ZodType<SetupSteps>;

const createSchema = z.object({
  label: z.string().trim().min(1, 'Give the setup a name').max(120),
  event_type: z.enum(SETUP_EVENT_TYPES),
});

const putStepsSchema = z.object({ steps: stepsSchema });

// SheetJS hands back strings with `raw: false`, but a hand-built request may carry
// numbers, booleans or nulls: all read as the text a cell would show.
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).transform((v) => (v == null ? '' : String(v)));
const validateSchema = z.object({
  file_name: z.string().trim().max(255).nullish(),
  sheets: z.record(
    z.string().max(100),
    z.array(z.array(cell).max(WORKBOOK_LIMITS.columns, `A row may have at most ${WORKBOOK_LIMITS.columns} columns`))
      .max(WORKBOOK_LIMITS.rows, `A sheet may have at most ${WORKBOOK_LIMITS.rows} rows`),
  ),
}).superRefine((b, ctx) => {
  const n = Object.keys(b.sheets).length;
  if (n < 1 || n > WORKBOOK_LIMITS.sheets) ctx.addIssue({ code: 'custom', path: ['sheets'], message: `A workbook needs 1 to ${WORKBOOK_LIMITS.sheets} sheets` });
});

const hasErrors = (issues: SetupIssue[] | undefined | null) => !!issues?.some((i) => i.severity === 'error');

/** No real contact to sign in with: every contact the account has is a placeholder (or absent). */
export const isUnreachable = (u: { phone: string | null; email: string | null }) =>
  !((u.phone && !isPlaceholderPhone(u.phone)) || (u.email && !isPlaceholderEmail(u.email)));

/** A fresh credential replaces an older one for the same login; the rest are kept. */
export function mergeCredentials(existing: CredentialRow[] | null | undefined, fresh: CredentialRow[]): CredentialRow[] {
  const byLogin = new Map<string, CredentialRow>();
  for (const c of [...(existing ?? []), ...fresh]) byLogin.set(c.email.toLowerCase(), storableCredential(c));
  return [...byLogin.values()];
}

export function makeEventSetupRouter(prisma: Prisma): Router {
  const router = Router();
  const repo = makeEventSetupRepo(prisma);
  router.use(requireSuperAdmin);

  const load = async (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('Event setup');
    const row = await repo.get(id);
    if (!row) throw new NotFoundError('Event setup');
    return row;
  };
  const isStaleApplying = (row: EventSetupListRow) =>
    row.status === 'applying' && !busy.has(row.id) && Date.now() - new Date(row.updated_at).getTime() > STALE_APPLYING_MS;
  const assertIdle = (row: EventSetupListRow) => {
    if (busy.has(row.id) || (row.status === 'applying' && !isStaleApplying(row))) {
      throw new ConflictError('This setup is being applied - wait for it to finish.');
    }
  };

  /**
   * For users this setup CREATED: how many still have no real way to sign in. An
   * account is "placeholder" while every contact it has is a stand-in; a real mobile
   * (OTP) or a real email is enough to reach it. Every account is minted with a
   * placeholder EMAIL, so "either contact is a placeholder" would count the captains
   * who came with a real mobile as still waiting - and never let them leave.
   */
  const contactsOf = async (row: EventSetupRow) => {
    const ids = row.manifest.created.users ?? [];
    if (!ids.length) return null;
    const users = await prisma.users.findMany({ where: { id: { in: ids } }, select: { phone: true, email: true } });
    const placeholder = users.filter((u) => isUnreachable(u)).length;
    return { total: users.length, placeholder, replaced: users.length - placeholder };
  };

  const listView = (r: EventSetupListRow) => ({
    id: r.id, label: r.label, event_type: r.event_type, status: r.status, file_name: r.file_name,
    organization_id: r.organization_id, org_name: r.org_name,
    championship_id: r.championship_id, championship_name: r.championship_name,
    summary: r.summary ?? null,
    issue_counts: r.issue_counts ?? { error: 0, warning: 0, info: 0 },
    created_at: r.created_at, updated_at: r.updated_at, applied_at: r.applied_at,
    created_by_name: r.created_by_name,
  });

  const detail = async (id: string) => {
    const row = await load(id);
    return {
      ...listView(row),
      steps: row.steps,
      validation: row.validation ?? null,
      platform: row.platform ?? null,
      apply_report: row.apply_report ?? null,
      verify_report: row.verify_report ?? null,
      error: row.error,
      contacts: await contactsOf(row),
      credentials_count: row.credentials?.length ?? 0,
    };
  };

  /** The validator, then - when it produced a blueprint - the platform plan. */
  const validateAndPlan = async (row: EventSetupRow, sheets: Record<string, string[][]>) => {
    const validation: SetupValidationResult = validateSetupWorkbook({ eventType: row.event_type, steps: row.steps, sheets });
    const platform = validation.blueprint
      ? await planPlatform(prisma, validation.blueprint, repo.manifestStore(row.id)).then(({ steps, issues }) => ({ steps, issues }))
      : null;
    const ok = !!validation.blueprint && !hasErrors(validation.issues) && !hasErrors(platform?.issues);
    return { validation, platform, ok };
  };

  router.get('/', asyncHandler(async (_req, res) => {
    res.json((await repo.list()).map(listView));
  }));

  router.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
    const { label, event_type } = req.body as z.infer<typeof createSchema>;
    const id = await repo.create({ label, event_type, steps: SETUP_DEFAULT_STEPS[event_type], created_by: req.user!.id });
    res.status(201).json(await detail(id));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(await detail(req.params.id));
  }));

  // Changing what a step does makes the last validation stale: back to draft.
  router.put('/:id/steps', validateBody(putStepsSchema), asyncHandler(async (req, res) => {
    const row = await load(req.params.id);
    assertIdle(row);
    if (row.status === 'applied') throw new ConflictError('This setup has been applied - undo it before changing its steps.');
    const steps = (req.body as { steps: SetupSteps }).steps;
    const moved = await repo.update(row.id, { steps, ...(row.status === 'validated' ? { status: 'draft' as const } : {}) },
      { onlyIf: ['draft', 'invalid', 'validated', 'failed', 'undone'], staleApplyingMs: STALE_APPLYING_MS });
    if (!moved) throw new ConflictError('This setup changed while you were editing it - reload and try again.');
    res.json(await detail(row.id));
  }));

  router.post('/:id/validate', asyncHandler(async (req, res) => {
    const length = Number(req.headers['content-length'] ?? 0) || Buffer.byteLength(JSON.stringify(req.body ?? {}));
    if (length > WORKBOOK_LIMITS.bytes) throw new ValidationError('The workbook is too large to upload (2 MB at most). Remove empty rows and columns, or split it.');
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      throw new ValidationError(i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'Invalid workbook', parsed.error.flatten());
    }
    const row = await load(req.params.id);
    assertIdle(row);
    if (row.status === 'applied') throw new ConflictError('This setup has been applied - undo it before validating a new workbook.');

    const sheets = parsed.data.sheets as Record<string, string[][]>;
    const { validation, platform, ok } = await validateAndPlan(row, sheets);
    const moved = await repo.update(row.id, {
      file_name: parsed.data.file_name ?? null,
      workbook: { sheets },
      validation, platform,
      blueprint_key: validation.blueprint?.key ?? null,
      status: ok ? 'validated' : 'invalid',
      error: null,
    }, { onlyIf: ['draft', 'invalid', 'validated', 'failed', 'undone'], staleApplyingMs: STALE_APPLYING_MS });
    if (!moved) throw new ConflictError('This setup changed while it was being validated - reload and try again.');
    res.json(await detail(row.id));
  }));

  router.post('/:id/apply', asyncHandler(async (req: Request, res) => {
    const row = await load(req.params.id);
    if (busy.has(row.id)) throw new ConflictError('This setup is being applied - wait for it to finish.');
    if (row.status !== 'validated' && !isStaleApplying(row)) {
      throw new ConflictError(row.status === 'applying'
        ? 'This setup is being applied - wait for it to finish.'
        : 'Only a validated setup can be applied - validate the workbook first.');
    }
    // Re-validate what is stored: the platform may have changed since (an org made,
    // a person removed), and nothing is written from a stale verdict.
    const workbook = await repo.workbook(row.id);
    if (!workbook) throw new ConflictError('There is no workbook on this setup - upload and validate one first.');
    const { validation, platform, ok } = await validateAndPlan(row, workbook.sheets);
    if (!ok || !validation.blueprint) {
      await repo.update(row.id, { validation, platform, status: 'invalid' }, { onlyIf: ['validated'], staleApplyingMs: STALE_APPLYING_MS });
      throw new ConflictError('The workbook no longer validates against the platform - see the issues, fix them and validate again.');
    }
    const moved = await repo.update(row.id, { validation, platform, status: 'applying', error: null },
      { onlyIf: ['validated'], staleApplyingMs: STALE_APPLYING_MS });
    if (!moved) throw new ConflictError('This setup is already being applied.');

    const bp = validation.blueprint;
    const actorId = req.user!.id;
    const store = repo.manifestStore(row.id);
    busy.add(row.id);
    // Detached, like the demo sandboxes: the request returns and the dashboard polls.
    void (async () => {
      const credentials: CredentialRow[] = [];
      try {
        const result = await applyBlueprint(prisma, bp, store, { actorId, credentials });
        const current = await repo.get(row.id);
        await repo.update(row.id, {
          status: 'applied', apply_report: result.reports, error: null,
          credentials: mergeCredentials(current?.credentials, credentials),
          organization_id: result.ids.orgId, championship_id: result.ids.champId, applied_at: new Date(),
        });
      } catch (e) {
        console.error(`[event-setup] apply failed for ${row.id}:`, e);
        try {
          const current = await repo.get(row.id);
          await repo.update(row.id, {
            status: 'failed', error: e instanceof Error ? e.message : String(e),
            // Accounts made before the failure exist: keep their logins.
            ...(credentials.length ? { credentials: mergeCredentials(current?.credentials, credentials) } : {}),
            organization_id: current?.manifest.keys.org ?? current?.organization_id ?? null,
            championship_id: current?.manifest.keys.championship ?? current?.championship_id ?? null,
          });
        } catch (inner) {
          console.error(`[event-setup] could not record the failure for ${row.id}:`, inner);
        }
      } finally {
        busy.delete(row.id);
      }
    })();
    res.status(202).json(await detail(row.id));
  }));

  router.post('/:id/verify', asyncHandler(async (req, res) => {
    const row = await load(req.params.id);
    assertIdle(row);
    const bp = row.validation?.blueprint;
    if (!bp) throw new ConflictError('Nothing to verify against - validate a workbook first.');
    const { checked, failures } = await verifyBlueprint(prisma, bp, repo.manifestStore(row.id));
    await repo.update(row.id, { verify_report: { checked, failures, at: new Date().toISOString() } });
    res.json(await detail(row.id));
  }));

  router.get('/:id/credentials', asyncHandler(async (req, res) => {
    const row = await load(req.params.id);
    res.json({
      rows: (row.credentials ?? []).map((c) => ({
        name: c.name, role: c.role, contact: c.contact, phone: c.phone, email: c.email,
        password: c.contact === 'placeholder' ? null : c.password ?? null,
      })),
    });
  }));

  router.post('/:id/undo', asyncHandler(async (req, res) => {
    const row = await load(req.params.id);
    assertIdle(row);
    if (!createdCount(row.manifest) && row.status !== 'applied' && row.status !== 'failed' && !isStaleApplying(row)) {
      throw new ConflictError('Nothing to undo - this setup has not created anything.');
    }
    // Undo deletes a real event (WNS was a live one) and is only refused once a match
    // is played, so the caller must type what it deletes: the championship's current
    // name, or the setup's label when no championship was made. Checked here, not
    // only in the dashboard, so no single stray request can remove an event.
    const champ = row.championship_id
      ? await prisma.championships.findUnique({ where: { id: row.championship_id }, select: { name: true } })
      : null;
    const expected = (champ?.name ?? row.label).trim();
    const typed = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : '';
    if (typed.toLowerCase() !== expected.toLowerCase()) {
      throw new ValidationError(`To undo, type "${expected}" exactly as the confirmation.`);
    }
    busy.add(row.id);
    try {
      await cleanupBlueprint(prisma, repo.manifestStore(row.id), { apply: true });
    } catch (e) {
      if (e instanceof CleanupRefusedError) throw new ConflictError(e.message);
      throw e;
    } finally {
      busy.delete(row.id);
    }
    await repo.update(row.id, { status: 'undone', credentials: null, error: null });
    res.json(await detail(row.id));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const row = await load(req.params.id);
    assertIdle(row);
    const empty = !createdCount(row.manifest);
    // Anything that has created nothing can go, including a validated setup the admin
    // decided not to apply. Once a run has made rows, undo it first.
    const deletable = ['draft', 'invalid', 'validated', 'undone', 'failed'].includes(row.status) && empty;
    if (!deletable) {
      throw new ConflictError(empty
        ? `A ${row.status} setup cannot be deleted.`
        : 'This setup created rows on the platform - undo it before deleting it.');
    }
    await repo.remove(row.id);
    res.json({ ok: true });
  }));

  return router;
}
