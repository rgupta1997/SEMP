/*
 * Runs a blueprint against a demo_sandboxes row: reads the stored config, builds
 * the championship, and keeps the row's manifest and status current as it goes.
 *
 * The engine itself lives in blueprint-seeder.service.ts and knows nothing about
 * rows or jobs - this is the only place the two meet, so the same engine can be
 * driven from a CLI without dragging the job machinery along with it.
 */
import { seedBlueprintSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { buildFromBlueprint, type SeedTracker } from './blueprint-seeder.service.js';

type Manifest = Record<string, string[]>;

export async function seedBlueprintRow(prisma: Prisma, sandboxId: string): Promise<void> {
  const row = await prisma.demo_sandboxes.findUnique({ where: { id: sandboxId } });
  if (!row) throw new Error(`Build ${sandboxId} no longer exists`);

  // Parsed, not cast: the row may have been written by an older shape, and failing
  // here with a readable message beats failing deep inside the engine on a missing
  // field. Defaults are applied the same way the route applied them on create.
  const blueprint = seedBlueprintSchema.parse(row.config);

  const manifest: Manifest = (row.manifest as Manifest) ?? {};
  const tracker: SeedTracker = {
    track: (table, ids) => {
      manifest[table] ??= [];
      manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
    },
    // Flushed after each batch, so a process that dies mid-build still leaves a
    // trail teardown can follow. Without it a half-built demo is unremovable.
    flush: () => prisma.demo_sandboxes.update({
      where: { id: sandboxId },
      data: { manifest: manifest as any, updated_at: new Date() },
    }),
    note: (message) => {
      // Progress is written to the row's error column while seeding - it is the
      // only free-text field the UI already polls. Cleared on success below.
      void prisma.demo_sandboxes
        .update({ where: { id: sandboxId }, data: { error: message, updated_at: new Date() } })
        .catch(() => { /* a progress note is never worth failing a build for */ });
    },
  };

  const result = await buildFromBlueprint(prisma, blueprint, row.slug, tracker);

  await prisma.demo_sandboxes.update({
    where: { id: sandboxId },
    data: {
      status: 'ready',
      error: null,
      manifest: manifest as any,
      last_seeded_at: new Date(),
      updated_at: new Date(),
      config: {
        ...(row.config as object),
        _result: {
          championship_id: result.championshipId,
          slug: result.slug,
          start_date: result.startDate.toISOString().slice(0, 10),
          end_date: result.endDate.toISOString().slice(0, 10),
          counts: result.counts,
          logins: result.logins,
        },
      } as any,
    },
  });
}
