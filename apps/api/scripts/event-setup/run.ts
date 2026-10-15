/*
 * Event setup, from a client's sheet to a ready event.
 *
 *   npx tsx scripts/event-setup/run.ts <event> plan      # read-only: what would be found / created
 *   npx tsx scripts/event-setup/run.ts <event> apply     # do it (safe to re-run)
 *   npx tsx scripts/event-setup/run.ts <event> verify    # check the built event against the sheet
 *   npx tsx scripts/event-setup/run.ts <event> cleanup   # dry run of the undo
 *   npx tsx scripts/event-setup/run.ts <event> cleanup --yes
 *
 *   npx tsx scripts/event-setup/run.ts sheet <file.xlsx> <intra|inter|campus> plan|apply|verify|cleanup [--yes]
 *
 * <event> names a per-client adapter under scripts/event-setup/<event>/blueprint.ts;
 * `sheet` reads a filled-in STANDARD template through the same validator the
 * super-admin dashboard uses. Inputs live in data/<event>/, outputs (manifest,
 * credentials, report) in out/ - both gitignored, because a client's sheet carries
 * real names and phone numbers. The engine is the API's (src/modules/event-setup).
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  SETUP_DEFAULT_STEPS, SETUP_EVENT_TYPES, SETUP_XLSX_READ_OPTS, setupSheetsFromWorkbook, validateSetupWorkbook,
  type EventSetupBlueprint, type SetupEventType, type SetupMatchSide,
} from '@semp/shared';
import {
  applyBlueprint, cleanupBlueprint, planPlatform, verifyBlueprint, type CredentialRow,
} from '../../src/modules/event-setup/engine.js';
import { wnsBlueprint } from './wns/blueprint.js';
import { OUT, fileManifestStore } from './file-store.js';

const ADAPTERS: Record<string, () => EventSetupBlueprint> = { wns: wnsBlueprint };

/** A filled-in standard template, read as the browser reads it, through the shared validator. */
function sheetBlueprint(file: string, type: SetupEventType): EventSetupBlueprint {
  // `xlsx` ships CommonJS with ES-style typings; require() sidesteps the default-import mismatch.
  const XLSX = createRequire(import.meta.url)('xlsx') as typeof import('xlsx');
  // Read exactly as the dashboard reads it (the shared reader), dates included.
  const wb = XLSX.read(readFileSync(file), { type: 'buffer', ...SETUP_XLSX_READ_OPTS });
  const sheets = setupSheetsFromWorkbook(XLSX, wb);
  const result = validateSetupWorkbook({ eventType: type, steps: SETUP_DEFAULT_STEPS[type], sheets });
  for (const i of result.issues) {
    console.log(`${i.severity.toUpperCase().padEnd(7)} ${i.code.padEnd(24)} ${i.sheet ?? ''}${i.row ? ` r${i.row}` : ''}  ${i.message}`);
  }
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  if (!result.blueprint || errors) throw new Error(`the workbook has ${errors} errors - fix them and run again`);
  console.log(`workbook ok: ${JSON.stringify(result.summary)}\n`);
  return result.blueprint;
}

/** Never overwrite a credentials file: it may be the only copy of a placeholder's password. */
function writeCredentials(key: string, rows: CredentialRow[]) {
  if (!rows.length) return;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = ['name,role,contact,phone,email,password', ...rows.map((c) =>
    [c.name, c.role, c.contact === 'placeholder' ? 'PLACEHOLDER' : c.contact, c.phone, c.email, c.password ?? ''].map(esc).join(','))].join('\n');
  let file = path.join(OUT, `${key}.credentials.csv`);
  if (existsSync(file)) file = path.join(OUT, `${key}.credentials-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  writeFileSync(file, csv);
  console.log(`${rows.length} new logins -> ${path.relative(process.cwd(), file)}`);
}

function blueprintReport(bp: EventSetupBlueprint) {
  const sideName = (s: SetupMatchSide) => ('winnerOf' in s ? `Winner of ${s.winnerOf}` : bp.squads.find((q) => q.key === s.squadKey)?.name ?? '?');
  return {
    org: bp.org, campus: bp.campus, championship: bp.championship, venue: bp.venue, draws: bp.draws,
    staff: bp.staff.map(({ key, name, existingEmail, orgRole, eventRole, groundKey, competitorKey, note }) =>
      ({ key, name, existing: !!existingEmail, orgRole, eventRole, groundKey, competitorKey, note })),
    squads: bp.squads.map((s) => ({
      key: s.key, name: s.name, short: s.shortName, section: s.section ?? null,
      competitor: bp.competitors.find((c) => c.key === s.competitorKey)?.name,
      members: s.members.map((m) => {
        const p = bp.people.find((x) => x.key === m.personKey)!;
        return { name: p.name, role: m.role, realPhone: !!p.phone, uid: p.memberCode ?? null };
      }),
    })),
    fixtures: bp.fixtures.flatMap((f): Array<Record<string, unknown>> => (f.kind === 'knockout-rows'
      ? f.rows.map((r) => ({ draw: f.drawKey, matchId: r.matchId, date: r.date, kickoff: r.kickoff, ground: bp.venue.grounds.find((g) => g.key === r.groundKey)?.name, home: sideName(r.home), away: sideName(r.away) }))
      : [{ draw: f.drawKey, generated: true }])),
    people: { total: bp.people.length, realPhone: bp.people.filter((p) => p.phone).length, withUid: bp.people.filter((p) => p.memberCode).length },
    findings: bp.findings,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let bp: EventSetupBlueprint;
  let mode: string;
  let flag: string | undefined;
  if (args[0] === 'sheet') {
    const [, file, type, m = 'plan', f] = args;
    if (!file || !SETUP_EVENT_TYPES.includes(type as SetupEventType)) {
      throw new Error(`usage: run.ts sheet <file.xlsx> <${SETUP_EVENT_TYPES.join('|')}> plan|apply|verify|cleanup [--yes]`);
    }
    bp = sheetBlueprint(file, type as SetupEventType);
    mode = m; flag = f;
  } else {
    const [event, m = 'plan', f] = args;
    const adapter = ADAPTERS[event];
    if (!adapter) throw new Error(`unknown event "${event}" - one of: ${Object.keys(ADAPTERS).join(', ')}, or "sheet <file.xlsx> <type>"`);
    bp = adapter();
    mode = m; flag = f;
  }

  mkdirSync(OUT, { recursive: true });
  const store = fileManifestStore(bp.key);
  const prisma = new PrismaClient();
  try {
    if (mode === 'cleanup') {
      for (const line of await cleanupBlueprint(prisma, store, { apply: flag === '--yes' })) console.log(line);
      return;
    }
    if (mode === 'verify') {
      const { checked, failures } = await verifyBlueprint(prisma, bp, store);
      for (const f of failures) console.log('FAIL', f);
      console.log(`${checked} scheduled matches checked · ${failures.length} failures`);
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (mode !== 'plan' && mode !== 'apply') throw new Error(`unknown mode "${mode}"`);
    const t0 = Date.now();
    let report: Record<string, unknown>;
    if (mode === 'plan') {
      const plan = await planPlatform(prisma, bp, store);
      for (const r of plan.steps) {
        console.log(`${r.step.padEnd(13)} ${r.mode.padEnd(9)} found ${String(r.found).padStart(4)}  to create ${String(r.create).padStart(4)}  missing ${String(r.missing).padStart(3)}  ${r.notes.join(' · ')}`);
      }
      for (const i of plan.issues) console.log(`${i.severity.toUpperCase()} ${i.code}: ${i.message}`);
      report = { generatedAt: new Date().toISOString(), mode, key: bp.key, steps: plan.steps, issues: plan.issues, ...blueprintReport(bp) };
    } else {
      const credentials: CredentialRow[] = [];
      try {
        const result = await applyBlueprint(prisma, bp, store, { credentials });
        for (const r of result.reports) {
          console.log(`${r.step.padEnd(13)} ${r.mode.padEnd(9)} found ${String(r.found).padStart(4)}  created ${String(r.created).padStart(4)}  ${r.notes.join(' · ')}`);
        }
        report = { generatedAt: new Date().toISOString(), mode, key: bp.key, steps: result.reports, ids: result.ids, ...blueprintReport(bp), fixtures: result.fixtureView };
      } finally {
        // Written even when a later step failed: those accounts exist now.
        writeCredentials(bp.key, credentials);
      }
    }
    writeFileSync(path.join(OUT, `${bp.key}.${mode}.json`), JSON.stringify(report, null, 2));
    console.log(`\n${mode} done in ${((Date.now() - t0) / 1000).toFixed(1)}s · report out/${bp.key}.${mode}.json`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error('\nFAILED:', e.message ?? e); process.exitCode = 1; });
