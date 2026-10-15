/*
 * One-off: put the WNS Football 2026 build (made by the CLI on 15 Oct, before the
 * dashboard existed) on the super-admin Event Setup dashboard, as an applied setup.
 *
 *   npx tsx scripts/event-setup/register.ts
 *
 * Idempotent: a second run finds the row (by blueprint key) and changes nothing.
 * Reads only the CLI's own outputs - the manifest, the apply report, the credentials
 * file - and the WNS adapter's blueprint, so the dashboard can Verify it. From here
 * on the row keeps its OWN copy of the manifest: an Undo on the dashboard does not
 * touch out/wns-football-2026.manifest.json, and a CLI run does not touch the row.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma as PrismaNS, PrismaClient } from '@prisma/client';
import { SETUP_STEP_KEYS, type EventSetupBlueprint, type SetupValidationSummary } from '@semp/shared';
import {
  knockoutFixturesOf, normaliseManifest, planPlatform, verifyBlueprint, type CredentialRow, type ManifestStore, type StepReport,
} from '../../src/modules/event-setup/engine.js';
import { parseCsv } from './csv.js';
import { OUT } from './file-store.js';
import { wnsBlueprint } from './wns/blueprint.js';

const KEY = 'wns-football-2026';
const OWNER_EMAIL = 'rohit@sportagon.in';

function summaryOf(bp: EventSetupBlueprint): SetupValidationSummary {
  const squadsOf = new Map<string, number>();
  for (const s of bp.squads) for (const m of s.members) squadsOf.set(m.personKey, (squadsOf.get(m.personKey) ?? 0) + 1);
  let matches = 0;
  let byes = 0;
  for (const f of bp.fixtures) {
    if (f.kind !== 'knockout-rows') continue;
    const draw = bp.draws.find((d) => d.key === f.drawKey)!;
    const { gen, realCount } = knockoutFixturesOf(f, draw.thirdPlace);
    matches += realCount;
    byes += gen.filter((g) => g.status === 'bye').length;
  }
  return {
    draws: bp.draws.length, competitors: bp.competitors.length, squads: bp.squads.length,
    people: bp.people.length,
    peopleWithMobile: bp.people.filter((p) => p.phone).length,
    peopleOnPlaceholder: bp.people.filter((p) => !p.phone && !p.email).length,
    peopleInSeveralSquads: [...squadsOf.values()].filter((n) => n > 1).length,
    staff: bp.staff.length, grounds: bp.venue.grounds.length, matches, byes,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.$queryRaw<Array<{ id: string; status: string }>>(PrismaNS.sql`
      select id::text as id, status from event_setups where blueprint_key = ${KEY} order by created_at limit 1`);
    if (existing.length) {
      console.log(`already registered: ${existing[0].id} (${existing[0].status}) - nothing changed`);
      return;
    }

    const manifest = normaliseManifest(JSON.parse(readFileSync(path.join(OUT, `${KEY}.manifest.json`), 'utf8')));
    const applied = JSON.parse(readFileSync(path.join(OUT, `${KEY}.apply.json`), 'utf8')) as { steps: Array<Omit<StepReport, 'step'> & { step: string }> };
    // The CLI called the competitors step "units" before the blueprint was shared.
    const applyReport: StepReport[] = applied.steps.map((s) => ({ ...s, step: (s.step === 'units' ? 'competitors' : s.step) as StepReport['step'] }));
    if (applyReport.some((s) => !(SETUP_STEP_KEYS as readonly string[]).includes(s.step))) throw new Error('apply report names an unknown step');

    const credentials: CredentialRow[] = parseCsv(readFileSync(path.join(OUT, `${KEY}.credentials.csv`), 'utf8')).map((r) => {
      const real = r.contact === 'real mobile';
      if (!real && r.contact !== 'PLACEHOLDER') throw new Error(`credentials: unexpected contact "${r.contact}"`);
      return { name: r.name, role: r.role, contact: real ? 'real mobile' : 'placeholder', phone: r.phone, email: r.email, password: real ? r.password : null };
    });

    const owner = await prisma.users.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
    if (!owner) throw new Error(`no account ${OWNER_EMAIL}`);

    const bp = wnsBlueprint();
    // Read-only against the platform: the same plan the dashboard would show.
    const memory: ManifestStore = { load: async () => normaliseManifest(manifest), save: async () => { throw new Error('register is read-only'); } };
    const plan = await planPlatform(prisma, bp, memory);
    const toCreate = plan.steps.reduce((n, s) => n + s.create + s.missing, 0);
    if (toCreate) throw new Error(`the WNS plan is not clean (${toCreate} to create or missing) - not registering a build that does not match the platform`);
    const verify = await verifyBlueprint(prisma, bp, memory);

    const runs = manifest.runs.filter((r) => r.mode === 'apply');
    const firstAt = runs[0]?.at ?? new Date().toISOString();
    const lastAt = runs[runs.length - 1]?.at ?? firstAt;
    const steps = Object.fromEntries(SETUP_STEP_KEYS.map((k) => [k, 'sheet']));
    const validation = { ok: true, issues: [], summary: summaryOf(bp), blueprint: bp };

    const [row] = await prisma.$queryRaw<Array<{ id: string }>>(PrismaNS.sql`
      insert into event_setups (
        label, event_type, status, steps, file_name, validation, platform, blueprint_key, manifest,
        apply_report, verify_report, credentials, organization_id, championship_id, created_by,
        created_at, updated_at, applied_at)
      values (
        'WNS Football Championship 2026', 'intra', 'applied', ${JSON.stringify(steps)}::jsonb,
        'WNS Teams + Master Schedule (CLI adapter)', ${JSON.stringify(validation)}::jsonb,
        ${JSON.stringify({ steps: plan.steps, issues: plan.issues })}::jsonb, ${KEY}, ${JSON.stringify(manifest)}::jsonb,
        ${JSON.stringify(applyReport)}::jsonb,
        ${JSON.stringify({ ...verify, at: new Date().toISOString() })}::jsonb,
        ${JSON.stringify(credentials)}::jsonb,
        ${manifest.keys.org ?? null}::uuid, ${manifest.keys.championship ?? null}::uuid, ${owner.id}::uuid,
        ${new Date(firstAt)}::timestamptz, now(), ${new Date(lastAt)}::timestamptz)
      returning id::text as id`);
    console.log(`registered ${row.id}: ${credentials.length} logins (${credentials.filter((c) => c.password).length} with a password), verify ${verify.checked} checked / ${verify.failures.length} failures`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error('\nFAILED:', e.message ?? e); process.exitCode = 1; });
