// Deletes ALL demo data including seeded users (except admin), sports, disciplines,
// organizations, and the genesis-26 championship with everything hanging off it.
// Run before seed to get a completely fresh start.
import { prisma } from './prisma.js';

async function main() {
  console.log('🧹 Cleaning demo data...\n');

  // Step 1: Identify all demo users, organizations
  const demoEmailPatterns = ['@semp.local', '@vjti.local', '@iitb.local', '@djsce.local', '@spit.local', '@coep.local', '@sies.local'];
  const demoUsers = await prisma.users.findMany({
    where: {
      OR: demoEmailPatterns.map((p) => ({ email: { endsWith: p } })),
      is_super_admin: false,
    },
    select: { id: true },
  });
  const userIds = demoUsers.map((u) => u.id);

  const instNames = ['VJTI Mumbai', 'IIT Bombay', 'DJ Sanghvi', 'SPIT Mumbai', 'COEP Pune', 'SIES College', 'Manipal Institute'];
  const demoInsts = await prisma.organizations.findMany({ where: { name: { in: instNames } }, select: { id: true } });
  const instIds = demoInsts.map((i) => i.id);

  // Step 2: Delete genesis-26 championship data (most restrictive FKs)
  const championship = await prisma.championships.findUnique({ where: { slug: 'genesis-26' } });
  if (championship) {
    const eventId = championship.id;

    // Get all teams entered into this championship (need their IDs for fixture cleanup)
    const entries = await prisma.team_entries.findMany({ where: { championship_id: eventId }, select: { team_id: true } });
    const teamIds = [...new Set(entries.map((e) => e.team_id))];

    // Delete ALL fixtures referencing these teams (handles partial seed state)
    if (teamIds.length > 0) {
      await prisma.fixtures.deleteMany({
        where: { OR: [{ home_team_id: { in: teamIds } }, { away_team_id: { in: teamIds } }] },
      });
    }
    console.log('  - Deleted fixtures');

    // Delete the championship entries (roster identities are wiped below for the demo)
    await prisma.team_entries.deleteMany({ where: { championship_id: eventId } });
    console.log('  - Deleted team entries');

    // Delete team members
    await prisma.team_members.deleteMany({ where: { team_id: { in: teamIds } } });
    console.log('  - Deleted team members');

    // Delete teams
    await prisma.teams.deleteMany({ where: { id: { in: teamIds } } });
    console.log('  - Deleted teams');

    // Delete championship_officials
    await prisma.championship_officials.deleteMany({ where: { championship_id: eventId } });
    console.log('  - Deleted championship officials');

    // Get tournament structure IDs
    const tournaments = await prisma.tournaments.findMany({ where: { championship_id: eventId }, select: { id: true } });
    const tournamentIds = tournaments.map((t) => t.id);
    const tsports = await prisma.tournament_sports.findMany({ where: { tournament_id: { in: tournamentIds } }, select: { id: true } });
    const tsportIds = tsports.map((t) => t.id);
    const tdIds = (await prisma.tournament_disciplines.findMany({ where: { tournament_sport_id: { in: tsportIds } }, select: { id: true } })).map((t) => t.id);

    // Remove any fixtures still hanging off these disciplines (byes / null-team rows
    // the team-based delete above doesn't catch) before deleting the disciplines.
    if (tdIds.length > 0) {
      await prisma.fixtures.deleteMany({ where: { tournament_discipline_id: { in: tdIds } } });
    }
    await prisma.tournament_disciplines.deleteMany({ where: { id: { in: tdIds } } });
    await prisma.tournament_sports.deleteMany({ where: { id: { in: tsportIds } } });
    await prisma.tournaments.deleteMany({ where: { championship_id: eventId } });
    console.log('  - Deleted tournament structure');

    // Venues
    const venues = await prisma.venues.findMany({ where: { championship_id: eventId }, select: { id: true } });
    await prisma.venue_grounds.deleteMany({ where: { venue_id: { in: venues.map((v) => v.id) } } });
    await prisma.venues.deleteMany({ where: { championship_id: eventId } });
    console.log('  - Deleted venues');

    // Championship-level entities
    await prisma.sponsors.deleteMany({ where: { championship_id: eventId } });
    await prisma.user_championship_roles.deleteMany({ where: { championship_id: eventId } });
    await prisma.championship_organizations.deleteMany({ where: { championship_id: eventId } });
    await prisma.championships.delete({ where: { id: eventId } });
    console.log('✓ Championship genesis-26 removed');
  }

  // Step 3: Delete any remaining teams for demo organizations (from other championships)
  if (instIds.length > 0) {
    const remainingTeams = await prisma.teams.findMany({ where: { organization_id: { in: instIds } }, select: { id: true } });
    if (remainingTeams.length > 0) {
      const rtIds = remainingTeams.map((t) => t.id);
      await prisma.fixtures.deleteMany({ where: { OR: [{ home_team_id: { in: rtIds } }, { away_team_id: { in: rtIds } }] } });
      await prisma.team_members.deleteMany({ where: { team_id: { in: rtIds } } });
      await prisma.teams.deleteMany({ where: { id: { in: rtIds } } });
      console.log(`  - Cleaned up ${remainingTeams.length} orphaned teams`);
    }
  }

  // Step 4: Delete any remaining championship_organizations for demo organizations
  if (instIds.length > 0) {
    await prisma.championship_organizations.deleteMany({ where: { organization_id: { in: instIds } } });
  }

  // Step 5: Clear officials from fixtures (don't delete fixtures, just unassign)
  if (userIds.length > 0) {
    await prisma.fixtures.updateMany({ where: { official_id: { in: userIds } }, data: { official_id: null } });
  }

  // Step 6: Delete user roles (rows owned by, or assigned by, a demo user)
  if (userIds.length > 0) {
    await prisma.user_championship_roles.deleteMany({
      where: { OR: [{ user_id: { in: userIds } }, { assigned_by: { in: userIds } }] },
    });
  }

  // Step 6b: Delete enrollments that reference a demo user (applied_by is NOT NULL,
  // reviewed_by NoAction) — both would otherwise block the user delete below.
  if (userIds.length > 0) {
    await prisma.championship_organizations.deleteMany({
      where: { OR: [{ applied_by: { in: userIds } }, { reviewed_by: { in: userIds } }] },
    });
  }

  // Step 6c: Drop org memberships for demo users (FK is cascade, but be explicit).
  if (userIds.length > 0) {
    await prisma.organization_members.deleteMany({ where: { user_id: { in: userIds } } });
  }

  // Step 6d: Drop official assignments referencing a demo user (assigned_by is NoAction).
  if (userIds.length > 0) {
    await prisma.championship_officials.deleteMany({
      where: { OR: [{ user_id: { in: userIds } }, { assigned_by: { in: userIds } }] },
    });
  }

  // Step 7: Delete remaining team_members for demo users
  if (userIds.length > 0) {
    await prisma.team_members.deleteMany({ where: { user_id: { in: userIds } } });
  }

  // Step 8: Delete demo users
  if (userIds.length > 0) {
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    console.log(`✓ Removed ${userIds.length} demo users`);
  }

  // Step 9: Delete demo organizations — first unlink any surviving users whose
  // home org is one of these (users.organization_id FK is NoAction).
  if (instIds.length > 0) {
    await prisma.users.updateMany({ where: { organization_id: { in: instIds } }, data: { organization_id: null } });
    await prisma.organizations.deleteMany({ where: { id: { in: instIds } } });
    console.log(`✓ Removed ${instIds.length} demo organizations`);
  }

  console.log('\n✅ Demo data cleanup complete. Run `npm run seed` to rebuild.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
