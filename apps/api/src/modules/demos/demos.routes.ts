// Demo sandbox management - super-admin only. Create spins up a personalized
// 4-championship demo environment for a client; Reset wipes it (including anything
// the client did during the demo) and re-seeds the identical state; Delete erases
// every trace. Seeding/wiping run as detached background jobs (10-30s through the
// pooler) - the row's `status` is the progress signal the UI polls.

import { Router } from 'express';
import {
  createDemoSandboxSchema, createSeedBuildSchema, eventTemplateFor, tieTemplateFor,
  type CreateDemoSandboxInput, type CreateSeedBuildInput,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { emailDomainFor, generateDemoPassword, makeSandboxSlug } from './demo-names.js';
import { seedSandbox } from './demo-seeder.service.js';
import { seedBlueprintRow } from './blueprint-run.service.js';
import { wipeSandbox } from './demo-teardown.service.js';

/** A row built from a blueprint resets through the new engine, not the old recipe. */
const isBlueprint = (row: { config: unknown }) =>
  !!(row.config as any)?.draws;

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
    // What the build actually produced. Written by the blueprint engine onto the
    // config; absent for rows made by the old four-championship recipe.
    result: row.config?._result ?? null,
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
      // Reset rebuilds through whichever engine made it. A blueprint row reseeded
      // by the old recipe would come back as a different demo entirely.
      if (isBlueprint(row)) await seedBlueprintRow(prisma, row.id);
      else await seedSandbox(prisma, row.id);
    });
    res.status(202).json({ ok: true });
  }));

  // ---- Blueprint builds ---------------------------------------------------
  // The configurable replacement for the fixed four-championship recipe above.
  // Both live on this router and on the same table: a row is a blueprint build if
  // its config carries `draws`, and `seedRow` dispatches on exactly that - so old
  // sandbox rows keep resetting through the old seeder rather than breaking.

  /** What the form needs to populate its pickers, in one call. */
  /**
   * Every login this build made, with what each person is.
   *
   * Derived from the manifest rather than stored on the row: a build is well over a
   * thousand accounts, and writing them all into the row's jsonb would bloat every
   * list request for something only one card at a time ever opens.
   *
   * Returned whole - a thousand-odd rows is one small response, and searching and
   * paging them in the browser is far better than a round trip per keystroke.
   */
  router.get('/:id/logins', requireSuperAdmin, asyncHandler(async (req, res) => {
    const row = await prisma.demo_sandboxes.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Build');

    const manifest = (row.manifest ?? {}) as Record<string, string[]>;
    const userIds = manifest.users ?? [];
    if (!userIds.length) { res.json({ password: row.organiser_password, total: 0, rows: [] }); return; }

    const [users, memberships, eventRoles, captaincies] = await Promise.all([
      prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, account_type: true, organizations: { select: { name: true, short_name: true } } },
        orderBy: { email: 'asc' },
      }),
      prisma.organization_members.findMany({
        where: { user_id: { in: userIds } },
        select: { user_id: true, role: true, member_code: true },
      }),
      prisma.user_championship_roles.findMany({
        where: { user_id: { in: userIds } },
        select: { user_id: true, roles: { select: { code: true, name: true } } },
      }),
      // Captaincy is what makes a participant worth opening on screen - they have a
      // squad behind them and records to show.
      prisma.team_members.findMany({
        where: { user_id: { in: userIds }, role: 'captain' },
        select: { user_id: true, teams: { select: { name: true } } },
      }),
    ]);

    const memberOf = new Map(memberships.map((m) => [m.user_id, m]));
    const eventRoleOf = new Map<string, string>();
    for (const r of eventRoles) {
      // An organiser who is also a POC should read as the more significant one.
      const code = r.roles?.code ?? '';
      const rank = ['participant', 'captain', 'poc', 'official', 'organiser'];
      const cur = eventRoleOf.get(r.user_id);
      if (!cur || rank.indexOf(code) > rank.indexOf(cur)) eventRoleOf.set(r.user_id, code);
    }
    const captainOf = new Map<string, string>();
    for (const c of captaincies) if (!captainOf.has(c.user_id)) captainOf.set(c.user_id, c.teams?.name ?? '');

    const LABEL: Record<string, string> = {
      organiser: 'Organiser', official: 'Official', poc: 'POC', captain: 'Captain', participant: 'Player',
    };

    // `key=1` is the handful a demo is actually driven from - everyone who is not
    // just a player. It exists so the summary tab can show real accounts without
    // pulling a thousand rows it will never display.
    const keyOnly = req.query.key === '1';

    const rows = users.map((u) => {
      const m = memberOf.get(u.id);
      const ev = eventRoleOf.get(u.id);
      const captainTeam = captainOf.get(u.id);
      // Most specific thing a person is, in the order that matters on screen.
      const role = ev === 'organiser' ? 'Organiser'
        : ev === 'official' ? 'Official'
          : m?.role === 'owner' ? 'Institution admin'
            : m?.role === 'admin' ? 'Org admin'
              : captainTeam ? 'Captain'
                : ev ? (LABEL[ev] ?? 'Player') : 'Player';
      return {
        name: u.name,
        email: u.email,
        role,
        organization: u.organizations?.name ?? null,
        short: u.organizations?.short_name ?? null,
        member_code: m?.member_code ?? null,
        team: captainTeam || null,
      };
    });

    // Sorted by how significant the role is, then by name - so the organiser is the
    // first thing on screen rather than whoever's email sorted first.
    const RANK = ['Organiser', 'Institution admin', 'Org admin', 'Official', 'POC', 'Captain', 'Player'];
    const visible = (keyOnly ? rows.filter((r) => r.role !== 'Player') : rows)
      .sort((a, b) => (RANK.indexOf(a.role) - RANK.indexOf(b.role)) || a.name.localeCompare(b.name));

    res.json({ password: row.organiser_password, total: visible.length, rows: visible });
  }));

  router.get('/catalogue', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const [sports, disciplines, formats] = await Promise.all([
      prisma.sports.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } }),
      prisma.tournament_formats.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    ]);
    const bySport = new Map<string, string[]>();
    for (const d of disciplines) {
      bySport.set(d.sport_id, [...(bySport.get(d.sport_id) ?? []), d.name]);
    }
    res.json({
      sports: sports.map((s) => ({
        name: s.name,
        disciplines: (bySport.get(s.id) ?? []).sort(),
        // The shared templates decide how a sport is scored, so the form can show
        // it rather than letting someone pick a structure the engine will override.
        kind: tieTemplateFor(s.name) ? 'tie' : eventTemplateFor(s.name) ? 'event' : 'single',
      })),
      formats: formats.map((f) => f.name),
    });
  }));

  router.post('/builds', requireSuperAdmin, validateBody(createSeedBuildSchema), asyncHandler(async (req, res) => {
    const { label, blueprint } = req.body as CreateSeedBuildInput;

    // Validate the catalogue references up front, so a typo fails the request
    // rather than a job that has already created half a championship.
    const [sports, formats] = await Promise.all([
      prisma.sports.findMany({ select: { id: true, name: true } }),
      prisma.tournament_formats.findMany({ select: { name: true } }),
    ]);
    const sportByName = new Map(sports.map((s) => [s.name, s.id]));
    const formatNames = new Set(formats.map((f) => f.name));
    const unknownSports = [...new Set(blueprint.draws.map((d) => d.sport))].filter((s) => !sportByName.has(s));
    if (unknownSports.length) throw new ConflictError(`Unknown sports: ${unknownSports.join(', ')}`);
    const unknownFormats = [...new Set(blueprint.draws.map((d) => d.format))].filter((f) => !formatNames.has(f));
    if (unknownFormats.length) throw new ConflictError(`Unknown formats: ${unknownFormats.join(', ')}`);

    const disciplines = await prisma.disciplines.findMany({ select: { name: true, sport_id: true } });
    const badDraw = blueprint.draws.find((d) =>
      !disciplines.some((x) => x.sport_id === sportByName.get(d.sport) && x.name === d.discipline));
    if (badDraw) throw new ConflictError(`${badDraw.sport} has no discipline "${badDraw.discipline}"`);

    // Emails must be free before anything is created - a build that dies on a
    // unique violation half way through leaves rows nobody asked for.
    const emails = [blueprint.accounts.organiser.email, blueprint.accounts.player.email, blueprint.accounts.institution_admin.email];
    const clash = await prisma.users.findFirst({ where: { email: { in: emails, mode: 'insensitive' } }, select: { email: true } });
    if (clash) throw new ConflictError(`An account already exists for ${clash.email}`);

    // The domain is stored EXACTLY as the engine will use it. Teardown's safety net
    // sweeps for users at the row's domain to catch anything created during a demo,
    // and a row whose domain does not match the real logins makes that sweep find
    // nothing - leaving whatever the manifest missed behind forever.
    const domainClash = await prisma.demo_sandboxes.findFirst({ where: { email_domain: blueprint.email_domain } });
    if (domainClash) {
      throw new ConflictError(`"${blueprint.email_domain}" is already used by the build "${domainClash.client_name}". Give this one its own email domain.`);
    }

    const slug = makeSandboxSlug(label);
    const row = await prisma.demo_sandboxes.create({ data: {
      client_name: label.trim(),
      slug,
      email_domain: blueprint.email_domain,
      config: { ...blueprint, _kind: 'blueprint' } as any,
      manifest: {},
      organiser_email: blueprint.accounts.organiser.email,
      organiser_password: blueprint.password,
      status: 'seeding',
      created_by: req.user!.id,
    } });

    runJob(row.id, () => seedBlueprintRow(prisma, row.id));
    res.status(201).json(toListRow(row));
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
