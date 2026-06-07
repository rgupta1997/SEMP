// Deletes ALL demo data including seeded users (except admin), sports, disciplines,
// institutions, and the genesis-26 event with everything hanging off it.
// Run before seed to get a completely fresh start.
import { prisma } from './prisma.js';

async function main() {
  console.log('🧹 Cleaning demo data...\n');

  // Step 1: Identify all demo users, institutions
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
  const demoInsts = await prisma.institutions.findMany({ where: { name: { in: instNames } }, select: { id: true } });
  const instIds = demoInsts.map((i) => i.id);

  // Step 2: Delete genesis-26 event data (most restrictive FKs)
  const event = await prisma.events.findUnique({ where: { slug: 'genesis-26' } });
  if (event) {
    const eventId = event.id;

    // Get all teams for this event first (need their IDs for fixture cleanup)
    const teams = await prisma.teams.findMany({ where: { event_id: eventId }, select: { id: true } });
    const teamIds = teams.map((t) => t.id);

    // Delete ALL fixtures referencing these teams (handles partial seed state)
    if (teamIds.length > 0) {
      await prisma.fixtures.deleteMany({
        where: { OR: [{ home_team_id: { in: teamIds } }, { away_team_id: { in: teamIds } }] },
      });
    }
    console.log('  - Deleted fixtures');

    // Delete team members
    await prisma.team_members.deleteMany({ where: { team_id: { in: teamIds } } });
    console.log('  - Deleted team members');

    // Delete teams
    await prisma.teams.deleteMany({ where: { event_id: eventId } });
    console.log('  - Deleted teams');

    // Delete event_officials
    await prisma.event_officials.deleteMany({ where: { event_id: eventId } });
    console.log('  - Deleted event officials');

    // Get tournament structure IDs
    const tournaments = await prisma.tournaments.findMany({ where: { event_id: eventId }, select: { id: true } });
    const tournamentIds = tournaments.map((t) => t.id);
    const tsports = await prisma.tournament_sports.findMany({ where: { tournament_id: { in: tournamentIds } }, select: { id: true } });
    const tsportIds = tsports.map((t) => t.id);
    const tdIds = (await prisma.tournament_disciplines.findMany({ where: { tournament_sport_id: { in: tsportIds } }, select: { id: true } })).map((t) => t.id);
    
    await prisma.tournament_disciplines.deleteMany({ where: { id: { in: tdIds } } });
    await prisma.tournament_sports.deleteMany({ where: { id: { in: tsportIds } } });
    await prisma.tournaments.deleteMany({ where: { event_id: eventId } });
    console.log('  - Deleted tournament structure');

    // Venues
    const venues = await prisma.venues.findMany({ where: { event_id: eventId }, select: { id: true } });
    await prisma.venue_grounds.deleteMany({ where: { venue_id: { in: venues.map((v) => v.id) } } });
    await prisma.venues.deleteMany({ where: { event_id: eventId } });
    console.log('  - Deleted venues');

    // Event-level entities
    await prisma.sponsors.deleteMany({ where: { event_id: eventId } });
    await prisma.user_event_roles.deleteMany({ where: { event_id: eventId } });
    await prisma.event_institutions.deleteMany({ where: { event_id: eventId } });
    await prisma.events.delete({ where: { id: eventId } });
    console.log('✓ Event genesis-26 removed');
  }

  // Step 3: Delete any remaining teams for demo institutions (from other events)
  if (instIds.length > 0) {
    const remainingTeams = await prisma.teams.findMany({ where: { institution_id: { in: instIds } }, select: { id: true } });
    if (remainingTeams.length > 0) {
      const rtIds = remainingTeams.map((t) => t.id);
      await prisma.fixtures.deleteMany({ where: { OR: [{ home_team_id: { in: rtIds } }, { away_team_id: { in: rtIds } }] } });
      await prisma.team_members.deleteMany({ where: { team_id: { in: rtIds } } });
      await prisma.teams.deleteMany({ where: { id: { in: rtIds } } });
      console.log(`  - Cleaned up ${remainingTeams.length} orphaned teams`);
    }
  }

  // Step 4: Delete any remaining event_institutions for demo institutions
  if (instIds.length > 0) {
    await prisma.event_institutions.deleteMany({ where: { institution_id: { in: instIds } } });
  }

  // Step 5: Clear officials from fixtures (don't delete fixtures, just unassign)
  if (userIds.length > 0) {
    await prisma.fixtures.updateMany({ where: { official_id: { in: userIds } }, data: { official_id: null } });
  }

  // Step 6: Delete user roles
  if (userIds.length > 0) {
    await prisma.user_event_roles.deleteMany({ where: { user_id: { in: userIds } } });
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

  // Step 9: Delete demo institutions
  if (instIds.length > 0) {
    await prisma.institutions.deleteMany({ where: { id: { in: instIds } } });
    console.log(`✓ Removed ${instIds.length} demo institutions`);
  }

  console.log('\n✅ Demo data cleanup complete. Run `npm run seed` to rebuild.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
