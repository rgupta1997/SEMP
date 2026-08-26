/*
 * Bench acceptance: does every persona authenticate, and does the permission
 * engine give each of them what their role is supposed to give?
 *
 * Goes through the real services rather than HTTP - buildAuthContext IS what
 * /auth/login returns, and can() IS the boundary every route applies - so this
 * verifies the same things the endpoints would without needing the server up.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { buildAuthContext } from '../src/modules/iam/me-context.js';
import { can } from '../src/http/middleware/can.js';
import { visibleModulesFor } from '../src/modules/iam/module-access.js';

const p = new PrismaClient();
const PASSWORD = 'Bench@2026';

const CHECKS = [
  ['people.view', 'People'], ['people.edit', 'AddPpl'], ['team.manage', 'Teams'],
  ['event.create', 'NewEvt'], ['event.manage', 'MgEvt'], ['achievement.view', 'Honour'],
  ['certificate.issue', 'Certs'], ['report.view', 'Report'], ['role.manage', 'Roles'],
  ['billing.manage', 'Billng'], ['audit.view', 'Audit'],
] as const;

const main = async () => {
  const champ = await p.championships.findFirst({ where: { slug: { startsWith: 'bench-' } }, select: { id: true, name: true } });
  const nit = await p.organizations.findFirst({ where: { name: 'Northfield Institute of Technology' }, select: { id: true } });
  const wbc = await p.organizations.findFirst({ where: { name: 'Westbrook College' }, select: { id: true } });
  if (!champ || !nit || !wbc) throw new Error('bench not found - run the seed first');

  const users = await p.users.findMany({
    where: { email: { endsWith: '@bench.test' }, NOT: { email: { startsWith: 'squad.' } } },
    orderBy: { created_at: 'asc' },
  });

  console.log(`championship: ${champ.name}\n`);
  const head = ['ACCOUNT'.padEnd(20), 'PWD'.padEnd(6), 'CONTEXT'.padEnd(16), ...CHECKS.map(([, l]) => l.padStart(8))].join('');
  console.log(head);
  console.log('-'.repeat(head.length));

  let bad = 0;
  for (const u of users) {
    const pw = u.password_hash ? await bcrypt.compare(PASSWORD, u.password_hash) : false;
    if (!pw) bad++;
    let ctxLabel = '-';
    try {
      const ctx: any = await buildAuthContext(p as any, u);
      const orgs = ctx.organizations.filter((m: any) => m.status === 'active').length;
      ctxLabel = `${orgs}org ${ctx.championship_roles.length}evt ${ctx.managed_championship_ids.length}mgd`;
    } catch { ctxLabel = 'CTX FAIL'; bad++; }

    const cells: string[] = [];
    for (const [perm] of CHECKS) {
      const ok = await can(p as any, perm as any, {
        user: { id: u.id, isSuperAdmin: !!u.is_super_admin },
        scope: { organizationId: nit.id, championshipId: champ.id },
      });
      cells.push((ok ? 'yes' : '.').padStart(8));
    }
    console.log(u.email.replace('@bench.test', '').padEnd(20) + (pw ? 'ok' : 'FAIL').padEnd(6) + ctxLabel.padEnd(16) + cells.join(''));
  }

  console.log('\nModule gate - Northfield leaves everything on, Westbrook limits People to staff:');
  for (const email of ['owner.nit', 'viewer.nit', 'alumni.nit', 'poc.wbc', 'captain.wbc', 'player.wbc']) {
    const u = users.find((x) => x.email.startsWith(email));
    if (!u) continue;
    const a = await visibleModulesFor(p as any, u.id, nit.id, !!u.is_super_admin);
    const b = await visibleModulesFor(p as any, u.id, wbc.id, !!u.is_super_admin);
    console.log(`  ${email.padEnd(13)} Northfield[${(a.audience ?? '-').padEnd(8)}] ${a.modules.length} modules  |  Westbrook[${(b.audience ?? '-').padEnd(8)}] ${b.modules.length} modules${b.audience && !b.modules.includes('people') ? '  <- People hidden' : ''}`);
  }

  console.log(`\nfailures: ${bad}`);
  await p.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
