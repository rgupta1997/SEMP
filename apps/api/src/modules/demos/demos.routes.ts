// Demo sandbox management - super-admin only. Create spins up a personalized
// 4-championship demo environment for a client; Reset wipes it (including anything
// the client did during the demo) and re-seeds the identical state; Delete erases
// every trace. Seeding/wiping run as detached background jobs (10-30s through the
// pooler) - the row's `status` is the progress signal the UI polls.

import { Router } from 'express';
import { createDemoSandboxSchema, type CreateDemoSandboxInput } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { emailDomainFor, generateDemoPassword, makeSandboxSlug } from './demo-names.js';
import { seedSandbox } from './demo-seeder.service.js';
import { wipeSandbox } from './demo-teardown.service.js';

// A sandbox may sit in `seeding`/`resetting` forever if the process died mid-job;
// after this long we treat the busy state as stale and allow Reset/Delete again.
const STALE_BUSY_MS = 10 * 60 * 1000;

// One in-flight job per sandbox per process (statuses guard cross-process).
const busy = new Set<string>();

function toListRow(row: any) {
  const manifest = (row.manifest ?? {}) as Record<string, string[]>;
  return {
    id: row.id,
    client_name: row.client_name,
    slug: row.slug,
    email_domain: row.email_domain,
    brand_color: row.brand_color,
    visibility: row.config?.visibility === 'private' ? 'private' : 'public',
    status: row.status,
    error: row.error,
    organiser_email: row.organiser_email,
    organiser_password: row.organiser_password,
    organiser_user_id: row.organiser_user_id,
    created_at: row.created_at,
    last_seeded_at: row.last_seeded_at,
    counts: {
      championships: manifest.championships?.length ?? 0,
      organizations: manifest.organizations?.length ?? 0,
      teams: manifest.teams?.length ?? 0,
      users: manifest.users?.length ?? 0,
      fixtures: manifest.fixtures?.length ?? 0,
    },
  };
}

export function makeDemosRouter(prisma: Prisma): Router {
  const router = Router();

  const runJob = (sandboxId: string, job: () => Promise<void>) => {
    busy.add(sandboxId);
    void job()
      .catch(async (e) => {
        console.error(`[demos] job failed for sandbox ${sandboxId}:`, e);
        try {
          await prisma.demo_sandboxes.update({
            where: { id: sandboxId },
            data: { status: 'error', error: e instanceof Error ? e.message : String(e), updated_at: new Date() },
          });
        } catch { /* row deleted mid-job - nothing to record on */ }
      })
      .finally(() => busy.delete(sandboxId));
  };

  const assertIdle = (row: { id: string; status: string; updated_at: Date }) => {
    const staleBusy = ['seeding', 'resetting', 'deleting'].includes(row.status)
      && Date.now() - new Date(row.updated_at).getTime() > STALE_BUSY_MS
      && !busy.has(row.id);
    if (!['ready', 'error'].includes(row.status) && !staleBusy) {
      throw new ConflictError('This sandbox is busy - wait for the current operation to finish.');
    }
    if (busy.has(row.id)) throw new ConflictError('This sandbox is busy - wait for the current operation to finish.');
  };

  router.get('/', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const rows = await prisma.demo_sandboxes.findMany({ orderBy: { created_at: 'desc' } });
    res.json(rows.map(toListRow));
  }));

  router.post('/', requireSuperAdmin, validateBody(createDemoSandboxSchema), asyncHandler(async (req, res) => {
    const input = req.body as CreateDemoSandboxInput;
    const clientName = input.client_name.trim();
    const emailDomain = emailDomainFor(clientName);

    const existing = await prisma.demo_sandboxes.findFirst({ where: { email_domain: emailDomain } });
    if (existing) throw new ConflictError(`A demo sandbox for this client already exists (${existing.client_name}). Reset or delete it instead.`);

    // Validate the sports selection up-front so a typo fails the request, not the job.
    if (input.sports?.length) {
      const catalog = await prisma.sports.findMany({ select: { name: true } });
      const known = new Set(catalog.map((s) => s.name.trim().toLowerCase()));
      const missing = input.sports.filter((s) => !known.has(s.trim().toLowerCase()));
      if (missing.length) throw new ConflictError(`Unknown sports: ${missing.join(', ')}`);
    }

    const attach = input.organiser?.mode === 'attach';
    if (attach) {
      const user = await prisma.users.findUnique({ where: { email: input.organiser!.email! } });
      if (!user) throw new NotFoundError('User to attach as organiser');
    }

    const slug = makeSandboxSlug(clientName);
    const row = await prisma.demo_sandboxes.create({ data: {
      client_name: clientName,
      slug,
      email_domain: emailDomain,
      brand_color: input.brand_color ?? null,
      config: input as any,
      manifest: {},
      organiser_email: attach ? input.organiser!.email! : `organiser@${emailDomain}`,
      organiser_password: attach ? null : generateDemoPassword(),
      status: 'seeding',
      created_by: req.user!.id,
    } });

    runJob(row.id, () => seedSandbox(prisma, row.id));
    res.status(201).json(toListRow(row));
  }));

  // Reset: wipe everything (including client-made changes), then re-seed the exact
  // same personalized state from the stored config - same logins, fresh data.
  router.post('/:id/reset', requireSuperAdmin, asyncHandler(async (req, res) => {
    const row = await prisma.demo_sandboxes.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Demo sandbox');
    assertIdle(row);
    await prisma.demo_sandboxes.update({ where: { id: row.id }, data: { status: 'resetting', error: null, updated_at: new Date() } });
    runJob(row.id, async () => {
      await wipeSandbox(prisma, row);
      await seedSandbox(prisma, row.id);
    });
    res.status(202).json({ ok: true });
  }));

  // Delete: wipe everything, then drop the sandbox row itself.
  router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
    const row = await prisma.demo_sandboxes.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Demo sandbox');
    assertIdle(row);
    await prisma.demo_sandboxes.update({ where: { id: row.id }, data: { status: 'deleting', updated_at: new Date() } });
    runJob(row.id, async () => {
      await wipeSandbox(prisma, row);
      await prisma.demo_sandboxes.delete({ where: { id: row.id } });
    });
    res.status(202).json({ ok: true });
  }));

  return router;
}
