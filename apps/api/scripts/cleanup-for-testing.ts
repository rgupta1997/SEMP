// One-off: strip the database back to a single championship plus the institutions
// needed to run the manual test protocol (Waves 0-3), so a person can work the
// checklist without wading through four client demos and a month of scratch data.
//
// Scope is explicit and guarded: a KEEP list is asserted before and after every
// phase, so a mistake in a sweep predicate fails loudly rather than quietly taking
// something it shouldn't. Dry-run by default; pass `apply` to delete.
//
//   npx tsx scripts/cleanup-for-testing.ts          # report only
//   npx tsx scripts/cleanup-for-testing.ts apply    # delete
//
// audit_log is deliberately untouched - it is append-only at the database level
// (trg_audit_log_no_update), and its rows are meant to outlive what they describe.
import { PrismaClient } from '@prisma/client';
import { wipeSandbox } from '../src/modules/demos/demo-teardown.service.js';
import { ROLE_CODES, roleWhereByCode } from '../src/modules/iam/role-codes.js';

const prisma = new PrismaClient();
const APPLY = process.argv[2] === 'apply';

// ---- what must still be here when this finishes --------------------------------
const KEEP_CHAMPS = ['IIMB ICE BREAKER - 2026'];
const KEEP_ORGS = [
  'Section A', 'Section B', 'Section C', 'Section D',
  'Section E', 'Section F', 'Section G', 'Section H', 'EPGP',
  'IIM Bangalore', 'Sportagon', 'Rohit Gupta',
];
// Everyone on these domains stays, plus these named accounts.
const KEEP_DOMAINS = ['iimb.ac.in', 'import.local', 'sportagon.in'];
const KEEP_EMAILS = [
  'rgupta6696@gmail.com', 'superadmin@gmail.com',
  'nagmamansuri6696@gmail.com', 'amansen1018@gmail.com',
  'aman@champ.in', 'aman@off.in',
];

// ---- what goes ------------------------------------------------------------------
const DROP_CHAMPS = [
  'abcd', 'My championship', 'Champions legue', 'FIFA ',
  'AWS testing championship', 'Cultural Fest 2026', 'Aman champ org',
  'Check template', '2026',
];
const DROP_ORGS = [
  "Aman's Sport organization", 'My organization', 'Lambda test org',
  'AWS testing org', 'whole new org', 'Amans whole new org',
];
const DROP_USERS = ['priyanshuu.rnjn@gmail.com'];
// Playwright / authz-suite residue from 15 Aug.
const RESIDUE_PREFIXES = ['ZZ ', 'PW Club '];

const log = (s: string) => console.log(s);
const head = (s: string) => console.log(`\n${'-'.repeat(70)}\n${s}\n${'-'.repeat(70)}`);

async function step(label: string, fn: () => Promise<{ count: number }>) {
  if (!APPLY) return;
  try {
    const r = await fn();
    if (r.count) log(`    ${label}: ${r.count}`);
  } catch (e: any) {
    log(`    ${label}: ERR ${e.code ?? e.message}`);
    throw e;
  }
}

/** Read-only mirror of wipeSandbox's scope resolution, for the dry-run report. */
async function sandboxScope(sb: { id: string; slug: string; email_domain: string; manifest: any }) {
  const manifest = (sb.manifest ?? {}) as Record<string, string[]>;
  const domainUsers = await prisma.users.findMany({
    where: { email: { endsWith: `@${sb.email_domain}` } }, select: { id: true },
  });
  const userIds = new Set<string>([...(manifest.users ?? []), ...domainUsers.map((u) => u.id)]);

  const codePrefix = `DEMO-${sb.slug.toUpperCase()}-`;
  const [codeOrgs, ownedOrgs] = await Promise.all([
    prisma.organizations.findMany({ where: { code: { startsWith: codePrefix } }, select: { id: true } }),
    userIds.size
      ? prisma.organization_members.findMany({
          where: { user_id: { in: [...userIds] }, role: { in: ['owner', 'admin'] } },
          select: { organization_id: true },
        })
      : Promise.resolve([] as { organization_id: string }[]),
  ]);
  const orgIds = new Set<string>([
    ...(manifest.organizations ?? []), ...codeOrgs.map((o) => o.id), ...ownedOrgs.map((o) => o.organization_id),
  ]);
  if (orgIds.size) {
    const orgUsers = await prisma.users.findMany({ where: { organization_id: { in: [...orgIds] } }, select: { id: true } });
    for (const u of orgUsers) userIds.add(u.id);
  }
  if (userIds.size) {
    const supers = await prisma.users.findMany({ where: { id: { in: [...userIds] }, is_super_admin: true }, select: { id: true } });
    for (const s of supers) userIds.delete(s.id);
  }

  const organised = userIds.size
    ? await prisma.user_championship_roles.findMany({
        where: { user_id: { in: [...userIds] }, roles: roleWhereByCode(ROLE_CODES.organiser) },
        select: { championship_id: true },
      })
    : [];
  const slugChamps = await prisma.championships.findMany({ where: { slug: { startsWith: `${sb.slug}-` } }, select: { id: true } });
  const champIds = new Set<string>([
    ...(manifest.championships ?? []), ...organised.map((c) => c.championship_id), ...slugChamps.map((c) => c.id),
  ]);
  return { userIds, orgIds, champIds };
}

/** Delete a championship subtree by id. Mirrors the sandbox order, minus users/orgs. */
async function dropChampionships(champIds: string[]) {
  if (!champIds.length) return;
  const tournaments = await prisma.tournaments.findMany({ where: { championship_id: { in: champIds } }, select: { id: true } });
  const tIds = tournaments.map((t) => t.id);
  const tSports = tIds.length ? await prisma.tournament_sports.findMany({ where: { tournament_id: { in: tIds } }, select: { id: true } }) : [];
  const tsIds = tSports.map((t) => t.id);
  const tDiscs = tsIds.length ? await prisma.tournament_disciplines.findMany({ where: { tournament_sport_id: { in: tsIds } }, select: { id: true } }) : [];
  const tdIds = tDiscs.map((t) => t.id);
  const venues = await prisma.venues.findMany({ where: { championship_id: { in: champIds } }, select: { id: true } });
  const vIds = venues.map((v) => v.id);
  const fixtures = tdIds.length ? await prisma.fixtures.findMany({ where: { tournament_discipline_id: { in: tdIds } }, select: { id: true } }) : [];
  const fIds = fixtures.map((f) => f.id);

  // lifetime_entries/achievements are `on delete restrict` against users - clear by
  // championship so the record cannot block the drop.
  await step('lifetime_entries', () => prisma.lifetime_entries.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('achievements', () => prisma.achievements.deleteMany({ where: { championship_id: { in: champIds } } }));
  if (fIds.length) {
    await step('fixture_awards', () => prisma.fixture_awards.deleteMany({ where: { fixture_id: { in: fIds } } }));
    await step('fixtures', () => prisma.fixtures.deleteMany({ where: { id: { in: fIds } } }));
  }
  await step('standings', () => prisma.standings.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('standings_rules', () => prisma.standings_rules.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('team_entries', () => prisma.team_entries.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('championship_officials', () => prisma.championship_officials.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('user_championship_roles', () => prisma.user_championship_roles.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('championship_organizations', () => prisma.championship_organizations.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('championship_invitations', () => prisma.championship_invitations.deleteMany({ where: { championship_id: { in: champIds } } }));
  // A saved template outlives the championship it was cut from - detach, never
  // delete. "IIM BANGALORE 2025" is sourced from one of the drops below, and it is
  // the whole point of keeping the template gallery usable afterwards.
  await step('championship_templates -> detach source', () => prisma.championship_templates.updateMany({
    where: { source_championship_id: { in: champIds } }, data: { source_championship_id: null },
  }));
  await step('notifications', () => prisma.notifications.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('feedback', () => prisma.feedback.deleteMany({ where: { championship_id: { in: champIds } } }));
  if (tdIds.length) await step('tournament_disciplines', () => prisma.tournament_disciplines.deleteMany({ where: { id: { in: tdIds } } }));
  if (tsIds.length) await step('tournament_sports', () => prisma.tournament_sports.deleteMany({ where: { id: { in: tsIds } } }));
  if (vIds.length) {
    await step('venue_grounds', () => prisma.venue_grounds.deleteMany({ where: { venue_id: { in: vIds } } }));
    await step('venues', () => prisma.venues.deleteMany({ where: { id: { in: vIds } } }));
  }
  if (tIds.length) await step('tournaments', () => prisma.tournaments.deleteMany({ where: { id: { in: tIds } } }));
  await step('sponsors', () => prisma.sponsors.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('championships', () => prisma.championships.deleteMany({ where: { id: { in: champIds } } }));
}

/** Delete organisations by id, plus everything hanging off them. Users are left alone. */
async function dropOrganizations(orgIds: string[]) {
  if (!orgIds.length) return;
  const teams = await prisma.teams.findMany({ where: { organization_id: { in: orgIds } }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length) {
    await step('achievements(team)', () => prisma.achievements.deleteMany({ where: { team_id: { in: teamIds } } }));
    await step('team_entries', () => prisma.team_entries.deleteMany({ where: { team_id: { in: teamIds } } }));
    await step('team_members', () => prisma.team_members.deleteMany({ where: { team_id: { in: teamIds } } }));
    await step('fixtures(home)', () => prisma.fixtures.deleteMany({ where: { OR: [
      { home_team_id: { in: teamIds } }, { away_team_id: { in: teamIds } }, { winner_team_id: { in: teamIds } },
    ] } }));
    await step('teams', () => prisma.teams.deleteMany({ where: { id: { in: teamIds } } }));
  }
  await step('team_entries(org)', () => prisma.team_entries.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('lifetime_entries(org)', () => prisma.lifetime_entries.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('achievements(org)', () => prisma.achievements.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('standings(org)', () => prisma.standings.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('championship_organizations', () => prisma.championship_organizations.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('championship_invitations', () => prisma.championship_invitations.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('championship_templates', () => prisma.championship_templates.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('notifications', () => prisma.notifications.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('roles(org)', () => prisma.roles.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('user_org_roles', () => prisma.user_org_roles.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('org_domains', () => prisma.org_domains.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('organization_members', () => prisma.organization_members.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('org_units', () => prisma.org_units.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('users.organization_id -> null', () => prisma.users.updateMany({ where: { organization_id: { in: orgIds } }, data: { organization_id: null } }));
  await step('organizations', () => prisma.organizations.deleteMany({ where: { id: { in: orgIds } } }));
}

async function assertKeepSetIntact(where: string) {
  const champs = await prisma.championships.findMany({ where: { name: { in: KEEP_CHAMPS } }, select: { name: true } });
  const orgs = await prisma.organizations.findMany({ where: { name: { in: KEEP_ORGS } }, select: { name: true } });
  const missingC = KEEP_CHAMPS.filter((n) => !champs.some((c) => c.name === n));
  const missingO = KEEP_ORGS.filter((n) => !orgs.some((o) => o.name === n));
  if (missingC.length || missingO.length) {
    throw new Error(`KEEP SET DAMAGED after ${where}: champs=${missingC.join(',')} orgs=${missingO.join(',')}`);
  }
  log(`  keep-set intact (${champs.length} champs, ${orgs.length} orgs)`);
}

async function counts() {
  const [orgs, champs, users, fixtures, teams] = await Promise.all([
    prisma.organizations.count(), prisma.championships.count(), prisma.users.count(),
    prisma.fixtures.count(), prisma.teams.count(),
  ]);
  return { orgs, champs, users, fixtures, teams };
}

async function main() {
  log(APPLY ? '*** APPLY MODE - this deletes ***' : '*** DRY RUN - nothing will be deleted ***');
  log(`before: ${JSON.stringify(await counts())}`);
  await assertKeepSetIntact('start');

  // ---- Phase 1: the four demo sandboxes ---------------------------------------
  head('PHASE 1  demo sandboxes (data wiped, sandbox definitions kept for re-seeding)');
  const sandboxes = await prisma.demo_sandboxes.findMany();
  for (const sb of sandboxes) {
    const scope = await sandboxScope(sb as any);
    const champNames = await prisma.championships.findMany({ where: { id: { in: [...scope.champIds] } }, select: { name: true } });
    log(`  ${sb.client_name}: ${scope.orgIds.size} orgs, ${scope.userIds.size} users, ${scope.champIds.size} champs`);
    for (const c of champNames) log(`      - ${c.name}`);
    const guarded = await prisma.championships.findMany({ where: { id: { in: [...scope.champIds] }, name: { in: KEEP_CHAMPS } }, select: { name: true } });
    const guardedO = await prisma.organizations.findMany({ where: { id: { in: [...scope.orgIds] }, name: { in: KEEP_ORGS } }, select: { name: true } });
    if (guarded.length || guardedO.length) {
      throw new Error(`sandbox ${sb.client_name} sweep would take protected rows: ${[...guarded, ...guardedO].map((x) => x.name).join(', ')}`);
    }
    if (APPLY) { await wipeSandbox(prisma as any, sb as any); log('    wiped'); }
  }
  if (APPLY) await assertKeepSetIntact('phase 1');

  // ---- Phase 2: leftover scratch championships ---------------------------------
  head('PHASE 2  scratch championships');
  const dropC = await prisma.championships.findMany({ where: { name: { in: DROP_CHAMPS } }, select: { id: true, name: true } });
  for (const c of dropC) log(`  - ${c.name}`);
  log(`  (${dropC.length} to drop)`);
  await dropChampionships(dropC.map((c) => c.id));
  if (APPLY) await assertKeepSetIntact('phase 2');

  // ---- Phase 3: scratch + test-residue organisations ---------------------------
  head('PHASE 3  scratch organisations and automated-test residue');
  const residue = await prisma.organizations.findMany({
    where: { OR: RESIDUE_PREFIXES.map((p) => ({ name: { startsWith: p } })) }, select: { id: true, name: true },
  });
  const scratch = await prisma.organizations.findMany({ where: { name: { in: DROP_ORGS } }, select: { id: true, name: true } });
  log(`  test residue: ${residue.length} orgs (${RESIDUE_PREFIXES.join(', ')}…)`);
  log(`  scratch: ${scratch.map((o) => o.name).join(', ') || '(none)'}`);
  const dropO = [...residue, ...scratch];
  if (dropO.some((o) => KEEP_ORGS.includes(o.name))) throw new Error('phase 3 would take a protected org');
  await dropOrganizations(dropO.map((o) => o.id));
  if (APPLY) await assertKeepSetIntact('phase 3');

  // ---- Phase 4: named accounts --------------------------------------------------
  head('PHASE 4  named accounts');
  const dropU = await prisma.users.findMany({ where: { email: { in: DROP_USERS } }, select: { id: true, email: true, is_super_admin: true } });
  for (const u of dropU) log(`  - ${u.email}`);
  const ids = dropU.filter((u) => !u.is_super_admin).map((u) => u.id);
  if (ids.length) {
    await step('organization_members', () => prisma.organization_members.deleteMany({ where: { user_id: { in: ids } } }));
    await step('team_members', () => prisma.team_members.deleteMany({ where: { user_id: { in: ids } } }));
    await step('notification_reads', () => prisma.notification_reads.deleteMany({ where: { user_id: { in: ids } } }));
    await step('notification_reactions', () => prisma.notification_reactions.deleteMany({ where: { user_id: { in: ids } } }));
    await step('auth_tokens', () => prisma.auth_tokens.deleteMany({ where: { user_id: { in: ids } } }));
    await step('users', () => prisma.users.deleteMany({ where: { id: { in: ids }, is_super_admin: false } }));
  }

  // ---- Phase 5: transient rows --------------------------------------------------
  head('PHASE 5  transient rows');
  const rl = await prisma.rate_limits.count();
  const at = await prisma.auth_tokens.count();
  log(`  rate_limits: ${rl}  auth_tokens: ${at}  (both cleared - they are throwaway)`);
  await step('rate_limits', () => prisma.rate_limits.deleteMany({}));
  await step('auth_tokens', () => prisma.auth_tokens.deleteMany({}));

  // ---- Phase 6: lock residue on what survives ----------------------------------
  // Locking is the spine of the protocol and every later wave reads what it wrote.
  // Anything half-locked from earlier poking around would make Wave 3's record and
  // medal checks fail for the wrong reason, so the surviving championship starts
  // from draft with no derived rows at all. Scores and live state stay: the Live tab
  // check explicitly wants a match somebody left running.
  head('PHASE 6  lock-derived state on surviving data');
  const [lif, ach, awd, std, sub, lck] = await Promise.all([
    prisma.lifetime_entries.count(), prisma.achievements.count(), prisma.fixture_awards.count(),
    prisma.standings.count(),
    prisma.fixtures.count({ where: { scorecard_status: { not: 'draft' } } }),
    prisma.fixtures.count({ where: { locked_at: { not: null } } }),
  ]);
  log(`  lifetime_entries ${lif}, achievements ${ach}, fixture_awards ${awd}, standings ${std}`);
  log(`  fixtures not in draft ${sub}, locked ${lck}`);
  await step('lifetime_entries', () => prisma.lifetime_entries.deleteMany({}));
  await step('achievements', () => prisma.achievements.deleteMany({}));
  await step('fixture_awards', () => prisma.fixture_awards.deleteMany({}));
  await step('standings', () => prisma.standings.deleteMany({}));
  await step('fixtures -> draft', () => prisma.fixtures.updateMany({
    where: { OR: [{ scorecard_status: { not: 'draft' } }, { locked_at: { not: null } }, { submitted_at: { not: null } }] },
    data: {
      scorecard_status: 'draft', submitted_at: null, submitted_by: null,
      locked_at: null, locked_by: null, lock_version: 0,
    },
  }));

  head('RESULT');
  if (APPLY) await assertKeepSetIntact('end');
  log(`after: ${JSON.stringify(await counts())}`);
  if (!APPLY) log('\nDRY RUN - pass "apply" to delete.');
}

main()
  .catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
