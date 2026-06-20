// Clean slate — wipe ALL transactional data (championships, tournaments, venues,
// organizations, teams, fixtures, enrollments, invitations, notifications, standings,
// …) while KEEPING the master tables:
//   sports · disciplines · tournament_formats · roles · permissions · users
// Demo `.local` users are removed (super admins are always kept so platform access
// survives). The Cricket discipline catalogue is corrected to categories (not formats).
// Nothing is re-seeded — you're left with master data + real users only.
//   Run:  npm run reset:clean   (workspace @semp/api)
import { prisma } from './prisma.js';

const CRICKET_DISCIPLINES = ["Men's", "Women's", 'U-19', 'U-23'];

async function main() {
  console.log('🧹 Clean slate — wiping data, keeping master + real users…\n');

  // Unlink users from organizations (users.organization_id is FK NoAction) so the
  // organization deletes below don't violate the constraint.
  await prisma.users.updateMany({ data: { organization_id: null } });

  // Delete transactional data, children first (FKs are mostly ON DELETE NO ACTION).
  const steps: Array<[string, () => Promise<{ count: number }>]> = [
    ['fixture awards', () => prisma.fixture_awards.deleteMany({})],
    ['fixtures', () => prisma.fixtures.deleteMany({})],
    ['team members', () => prisma.team_members.deleteMany({})],
    ['team entries', () => prisma.team_entries.deleteMany({})],
    ['teams', () => prisma.teams.deleteMany({})],
    ['notification reactions', () => prisma.notification_reactions.deleteMany({})],
    ['notification reads', () => prisma.notification_reads.deleteMany({})],
    ['notifications', () => prisma.notifications.deleteMany({})],
    ['standings', () => prisma.standings.deleteMany({})],
    ['standings rules', () => prisma.standings_rules.deleteMany({})],
    ['championship officials', () => prisma.championship_officials.deleteMany({})],
    ['user championship roles', () => prisma.user_championship_roles.deleteMany({})],
    ['championship invitations', () => prisma.championship_invitations.deleteMany({})],
    ['championship organizations', () => prisma.championship_organizations.deleteMany({})],
    ['sponsors', () => prisma.sponsors.deleteMany({})],
    ['tournament disciplines', () => prisma.tournament_disciplines.deleteMany({})],
    ['tournament sports', () => prisma.tournament_sports.deleteMany({})],
    ['tournaments', () => prisma.tournaments.deleteMany({})],
    ['venue grounds', () => prisma.venue_grounds.deleteMany({})],
    ['venues', () => prisma.venues.deleteMany({})],
    ['championships', () => prisma.championships.deleteMany({})],
    ['organization members', () => prisma.organization_members.deleteMany({})],
    ['organizations', () => prisma.organizations.deleteMany({})],
  ];
  for (const [label, fn] of steps) {
    const { count } = await fn();
    console.log(`  - cleared ${label}: ${count}`);
  }

  // Remove demo `.local` users (keep super admins so platform access survives).
  const localUsers = await prisma.users.findMany({
    where: { email: { endsWith: '.local' }, is_super_admin: false },
    select: { id: true, email: true },
  });
  const ids = localUsers.map((u) => u.id);
  if (ids.length) {
    await prisma.demo_requests.updateMany({ where: { handled_by: { in: ids } }, data: { handled_by: null } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`  - removed ${ids.length} .local user(s)`);

  // Fix Cricket disciplines: categories (gender/age), not formats — drop anything else
  // (e.g. T20) and ensure the four categories exist.
  const cricket = await prisma.sports.findFirst({ where: { name: 'Cricket' } });
  if (cricket) {
    await prisma.disciplines.deleteMany({ where: { sport_id: cricket.id, name: { notIn: CRICKET_DISCIPLINES } } });
    let order = 1;
    for (const name of CRICKET_DISCIPLINES) {
      const existing = await prisma.disciplines.findFirst({ where: { sport_id: cricket.id, name } });
      if (!existing) {
        await prisma.disciplines.create({ data: { sport_id: cricket.id, name, entry_type: 'team', squad_min: 11, squad_max: 15, display_order: order } });
      }
      order++;
    }
    console.log(`  - Cricket disciplines → ${CRICKET_DISCIPLINES.join(', ')}`);
  }

  const [sports, disciplines, formats, roles, perms, users, supers] = await Promise.all([
    prisma.sports.count(), prisma.disciplines.count(), prisma.tournament_formats.count(),
    prisma.roles.count(), prisma.permissions.count(), prisma.users.count(),
    prisma.users.count({ where: { is_super_admin: true } }),
  ]);
  console.log(`\n✅ Clean slate done. Kept master → sports ${sports} · disciplines ${disciplines} · formats ${formats} · roles ${roles} · permissions ${perms}.`);
  console.log(`   Users remaining: ${users} (${supers} super-admin). Demo .local accounts removed.`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
