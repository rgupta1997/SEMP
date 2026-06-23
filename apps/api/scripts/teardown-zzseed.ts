// One-off recovery: fully remove the disposable "ZZ Seed" championship subtree plus
// its dedicated orgs/users/teams, so the fixed-email seed can be re-run cleanly.
// Scoped strictly to ZZ Seed artifacts (champ name "ZZ Seed%", orgs "ZZ Seed%",
// users "seed.%@..."). Dry-run by default; pass `apply` to delete.
import { PrismaClient } from '@prisma/client';
import { existsSync, rmSync } from 'node:fs';

const prisma = new PrismaClient();
const APPLY = process.argv[2] === 'apply';
const MANIFEST = new URL('./.seed-iimb-manifest.json', import.meta.url).pathname.replace(/^\//, '');

async function main() {
  const champs = await prisma.championships.findMany({ where: { name: { startsWith: 'ZZ Seed' } }, select: { id: true, name: true } });
  const orgs = await prisma.organizations.findMany({ where: { name: { startsWith: 'ZZ Seed' } }, select: { id: true } });
  const users = await prisma.users.findMany({ where: { email: { startsWith: 'seed.' } }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  const userIds = users.map((u) => u.id);
  const champIds = champs.map((c) => c.id);

  const tournaments = await prisma.tournaments.findMany({ where: { championship_id: { in: champIds } }, select: { id: true } });
  const tids = tournaments.map((t) => t.id);
  const tsports = await prisma.tournament_sports.findMany({ where: { tournament_id: { in: tids } }, select: { id: true } });
  const tsids = tsports.map((t) => t.id);
  const tds = await prisma.tournament_disciplines.findMany({ where: { tournament_sport_id: { in: tsids } }, select: { id: true } });
  const tdids = tds.map((t) => t.id);
  const venues = await prisma.venues.findMany({ where: { championship_id: { in: champIds } }, select: { id: true } });
  const vids = venues.map((v) => v.id);
  const teams = await prisma.teams.findMany({ where: { organization_id: { in: orgIds } }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);
  const fixtures = await prisma.fixtures.findMany({ where: { tournament_discipline_id: { in: tdids } }, select: { id: true } });
  const fixtureIds = fixtures.map((f) => f.id);

  console.log('SCOPE:', JSON.stringify({ champs: champs.map((c) => c.name), tournaments: tids.length, sports: tsids.length, disciplines: tdids.length, venues: vids.length, teams: teamIds.length, orgs: orgIds.length, seedUsers: userIds.length }, null, 2));
  if (!APPLY) { console.log('\nDRY RUN — pass "apply" to delete.'); return; }

  const step = async (label: string, fn: () => Promise<{ count: number }>) => {
    try { const r = await fn(); console.log(`  ${label}: ${r.count}`); } catch (e: any) { console.log(`  ${label}: ERR ${e.code ?? e.message}`); }
  };

  // children -> parents
  await step('fixture_awards', () => prisma.fixture_awards.deleteMany({ where: { fixture_id: { in: fixtureIds } } }));
  await step('fixtures', () => prisma.fixtures.deleteMany({ where: { tournament_discipline_id: { in: tdids } } }));
  await step('standings', () => prisma.standings.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('standings_rules', () => prisma.standings_rules.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('team_entries', () => prisma.team_entries.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('team_members', () => prisma.team_members.deleteMany({ where: { team_id: { in: teamIds } } }));
  await step('teams', () => prisma.teams.deleteMany({ where: { id: { in: teamIds } } }));
  await step('championship_officials', () => prisma.championship_officials.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('championship_organizations', () => prisma.championship_organizations.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('user_championship_roles', () => prisma.user_championship_roles.deleteMany({ where: { championship_id: { in: champIds } } }));
  await step('tournament_disciplines', () => prisma.tournament_disciplines.deleteMany({ where: { tournament_sport_id: { in: tsids } } }));
  await step('tournament_sports', () => prisma.tournament_sports.deleteMany({ where: { id: { in: tsids } } }));
  await step('venue_grounds', () => prisma.venue_grounds.deleteMany({ where: { venue_id: { in: vids } } }));
  await step('venues', () => prisma.venues.deleteMany({ where: { id: { in: vids } } }));
  await step('tournaments', () => prisma.tournaments.deleteMany({ where: { id: { in: tids } } }));
  await step('championships', () => prisma.championships.deleteMany({ where: { id: { in: champIds } } }));
  await step('organization_members', () => prisma.organization_members.deleteMany({ where: { organization_id: { in: orgIds } } }));
  await step('seed users', () => prisma.users.deleteMany({ where: { id: { in: userIds } } }));
  await step('organizations', () => prisma.organizations.deleteMany({ where: { id: { in: orgIds } } }));

  if (existsSync(MANIFEST)) { rmSync(MANIFEST); console.log('  manifest removed'); }
  console.log('TEARDOWN COMPLETE');
}

main().catch((e) => { console.error('FAILED:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
