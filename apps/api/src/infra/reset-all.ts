// FULL reset: wipes ALL data, then seeds 2 fully-populated championships and one
// login per role type so every page/role can be exercised end-to-end.
//   npm run reset:all   (workspace @semp/api)
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

const PW = bcrypt.hashSync('demo123', 10);
const token = () => randomBytes(16).toString('hex');

// Every table, FK-safe via CASCADE. RESTART IDENTITY is a no-op for uuid PKs but harmless.
async function wipe() {
  await prisma.$executeRawUnsafe(`truncate table
    organization_members, notification_reads, notification_reactions, notifications,
    fixtures, team_members, teams, championship_organizations, user_championship_roles,
    championship_officials, tournament_disciplines, tournament_sports, tournaments,
    venue_grounds, venues, sponsors, championships, organizations,
    disciplines, sports, tournament_formats, roles, permissions, users
    restart identity cascade`);
  console.log('🧹 Wiped all data');
}

const SPORTS = [
  { name: 'Cricket', icon: '🏏', disc: 'T20' },
  { name: 'Football', icon: '⚽', disc: "Men's" },
  { name: 'Basketball', icon: '🏀', disc: "Men's" },
];

const FIRST = ['Aarav', 'Vivaan', 'Arjun', 'Sai', 'Reyansh', 'Ishaan', 'Kabir', 'Rohan', 'Dev', 'Karthik', 'Priya', 'Ananya', 'Diya', 'Kavya', 'Meera', 'Nisha'];
const LAST = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Mehta', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Joshi', 'Rao', 'Desai'];
const playerName = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;

async function main() {
  await wipe();

  // ---- Super admin ----
  const admin = await prisma.users.create({
    data: { name: env.SEED_ADMIN_NAME, email: env.SEED_ADMIN_EMAIL, password_hash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10), is_super_admin: true },
  });

  // ---- Permissions + roles ----
  const permDefs = [['P1', 'Full access'], ['P2', 'Score matches'], ['P3', 'Manage team'], ['P4', 'Read only']];
  const perms: Record<string, string> = {};
  for (const [code, label] of permDefs) perms[code] = (await prisma.permissions.create({ data: { code, label, rules: [] } })).id;
  const roleDefs: Array<[string, string[]]> = [
    ['Organiser', ['P1']], ['Official', ['P2', 'P4']], ['Captain', ['P3', 'P4']], ['Participant', ['P4']],
  ];
  const roles: Record<string, string> = {};
  for (const [name, codes] of roleDefs) roles[name] = (await prisma.roles.create({ data: { name, description: name, permission_ids: codes.map((c) => perms[c]) } })).id;

  // ---- Formats ----
  const knockout = await prisma.tournament_formats.create({ data: { name: 'Knockout', description: 'Single elimination', config: {} } });
  const league = await prisma.tournament_formats.create({ data: { name: 'League', description: 'Round robin', config: {} } });

  // ---- Sports + disciplines ----
  const sport: Record<string, { id: string; discId: string }> = {};
  for (const s of SPORTS) {
    const row = await prisma.sports.create({ data: { name: s.name, icon: s.icon } });
    const d = await prisma.disciplines.create({ data: { sport_id: row.id, name: s.disc, entry_type: 'team', squad_min: 5, squad_max: 15, display_order: 1 } });
    sport[s.name] = { id: row.id, discId: d.id };
  }

  // ---- Role logins (one per type) ----
  const mk = (name: string, email: string) => prisma.users.create({ data: { name, email, password_hash: PW, phone: '98000 00000' } });
  const host = await mk('Hema Host', 'host@sportagon.test');
  const official = await mk('Omar Official', 'official@sportagon.test');
  const ownerA = await mk('Asha Owner', 'owner@sportagon.test');
  const ownerB = await mk('Bala Owner', 'owner2@sportagon.test');
  const captain = await mk('Cara Captain', 'captain@sportagon.test');
  const player = await mk('Pavan Player', 'player@sportagon.test');

  // ---- Organizations + members ----
  const orgA = await prisma.organizations.create({ data: { name: 'Infosys', short_name: 'INF', city: 'Pune', status: true } });
  const orgB = await prisma.organizations.create({ data: { name: 'Pune United FC', short_name: 'PUN', city: 'Pune', status: true } });
  const member = (userId: string, orgId: string, role: string) =>
    prisma.organization_members.create({ data: { user_id: userId, organization_id: orgId, role } });
  await member(ownerA.id, orgA.id, 'owner');
  await member(ownerB.id, orgB.id, 'owner');
  await member(captain.id, orgA.id, 'captain');
  await member(player.id, orgA.id, 'member');
  await prisma.users.update({ where: { id: ownerA.id }, data: { organization_id: orgA.id } });
  await prisma.users.update({ where: { id: ownerB.id }, data: { organization_id: orgB.id } });
  await prisma.users.update({ where: { id: captain.id }, data: { organization_id: orgA.id } });
  await prisma.users.update({ where: { id: player.id }, data: { organization_id: orgA.id } });

  // ---- Extra squad players per org (members), to fill rosters ----
  const orgPlayers: Record<string, { id: string }[]> = { [orgA.id]: [captain, player], [orgB.id]: [] };
  let pi = 0;
  for (const org of [orgA, orgB]) {
    for (let n = 0; n < 6; n++) {
      const u = await prisma.users.create({ data: { name: playerName(pi), email: `p${pi}@${org.short_name!.toLowerCase()}.sportagon.test`, password_hash: PW, organization_id: org.id } });
      await member(u.id, org.id, 'member');
      orgPlayers[org.id].push(u);
      pi++;
    }
  }

  // ---- Championships ----
  const CH = [
    { name: 'Corporate Cup 2026', slug: 'corporate-cup-2026', status: 'ongoing', venue: 'Infosys Campus, Pune', sports: ['Cricket', 'Football'], start: '2026-06-20', end: '2026-06-28' },
    { name: 'City Premier League 2026', slug: 'city-premier-league-2026', status: 'registration_open', venue: 'City Stadium, Pune', sports: ['Football', 'Basketball'], start: '2026-07-10', end: '2026-07-20' },
  ];

  let fixtureCount = 0;
  for (const c of CH) {
    const champ = await prisma.championships.create({
      data: { name: c.name, slug: c.slug, status: c.status, venue: c.venue, description: `${c.name} — a multi-sport championship.`, start_date: new Date(c.start), end_date: new Date(c.end) },
    });
    // host organises it; official is assigned; one sponsor
    await prisma.user_championship_roles.create({ data: { championship_id: champ.id, user_id: host.id, role_id: roles.Organiser, assigned_by: admin.id } });
    await prisma.championship_officials.create({ data: { championship_id: champ.id, user_id: official.id, assigned_by: host.id } });
    await prisma.sponsors.create({ data: { championship_id: champ.id, name: 'Acme Corp', tier: 'gold', display_order: 1 } });

    // venue + grounds
    const venue = await prisma.venues.create({ data: { championship_id: champ.id, name: c.venue, city: 'Pune' } });
    const groundA = await prisma.venue_grounds.create({ data: { venue_id: venue.id, name: 'Ground A', ground_type: 'field', display_order: 1 } });
    const groundB = await prisma.venue_grounds.create({ data: { venue_id: venue.id, name: 'Court 1', ground_type: 'court', display_order: 2 } });

    // tournament + sports + disciplines
    const tournament = await prisma.tournaments.create({ data: { championship_id: champ.id, name: `${c.name} Championship`, status: 'active' } });
    const disciplineIds: { id: string; sport: string }[] = [];
    for (let si = 0; si < c.sports.length; si++) {
      const sName = c.sports[si];
      const ts = await prisma.tournament_sports.create({ data: { tournament_id: tournament.id, sport_id: sport[sName].id, format_id: (si === 0 ? knockout : league).id, display_order: si + 1 } });
      const td = await prisma.tournament_disciplines.create({
        data: { tournament_sport_id: ts.id, discipline_id: sport[sName].discId, format_id: (si === 0 ? knockout : league).id, venue_id: venue.id, entry_type: 'team', squad_min: 5, squad_max: 15, status: 'ongoing', display_order: 1 },
      });
      disciplineIds.push({ id: td.id, sport: sName });
    }

    // both orgs enrolled + approved
    const enroll: Record<string, string> = {};
    for (const org of [orgA, orgB]) {
      const ei = await prisma.championship_organizations.create({
        data: { championship_id: champ.id, organization_id: org.id, applied_by: (org.id === orgA.id ? ownerA : ownerB).id, status: 'approved', reviewed_by: host.id, reviewed_at: new Date() },
      });
      enroll[org.id] = ei.id;
    }

    // teams (one per org per discipline) + rosters + fixtures
    for (const d of disciplineIds) {
      const teamByOrg: Record<string, string> = {};
      for (const org of [orgA, orgB]) {
        const team = await prisma.teams.create({
          data: {
            championship_id: champ.id, sport_id: sport[d.sport].id, organization_id: org.id,
            championship_organization_id: enroll[org.id], tournament_discipline_id: d.id,
            name: `${org.short_name} ${d.sport}`, status: 'approved', invite_token: token(),
          },
        });
        teamByOrg[org.id] = team.id;
        // roster: captain + 5 players from this org
        const squad = orgPlayers[org.id];
        await prisma.team_members.create({ data: { team_id: team.id, user_id: squad[0].id, role: 'captain', jersey_number: 1 } });
        for (let m = 1; m <= 5 && m < squad.length; m++) {
          await prisma.team_members.create({ data: { team_id: team.id, user_id: squad[m].id, role: 'player', jersey_number: m + 1 } });
        }
      }
      // A played/placed match (completed or live → scheduled at 10:00) so standings
      // and the timeline have content...
      const status = fixtureCount % 2 === 0 ? 'completed' : 'live';
      const home = teamByOrg[orgA.id]; const away = teamByOrg[orgB.id];
      const homeScore = status === 'completed' ? 2 : 1;
      const awayScore = status === 'completed' ? 1 : 1;
      const ground = d.sport === 'Basketball' ? groundB.id : groundA.id;
      await prisma.fixtures.create({
        data: {
          tournament_discipline_id: d.id, home_team_id: home, away_team_id: away,
          venue_ground_id: ground, official_id: official.id,
          round: 'Semi-final', status, scheduled_at: new Date(`${c.start}T10:00:00Z`), duration_minutes: 90,
          home_score: homeScore, away_score: awayScore, winner_team_id: status === 'completed' ? home : null,
        },
      });
      // ...plus an UNSCHEDULED match so the timeline's "+ schedule" flow has something to place.
      await prisma.fixtures.create({
        data: {
          tournament_discipline_id: d.id, home_team_id: home, away_team_id: away,
          official_id: official.id, round: 'Final', status: 'scheduled', duration_minutes: 90,
        },
      });
      fixtureCount += 2;
    }
    console.log(`✓ Championship: ${c.name} (${c.status})`);
  }

  console.log(`\n${'='.repeat(56)}\n🎉 SEEDED 2 CHAMPIONSHIPS · ${fixtureCount} fixtures\n${'='.repeat(56)}`);
  console.log(`
🔐 Logins (password: demo123 · admin: admin123)

  System admin   ${env.SEED_ADMIN_EMAIL}        → platform / master data
  Host/Organiser host@sportagon.test    → Host page, runs both championships
  Official       official@sportagon.test → assigned to matches (score console)
  Org owner      owner@sportagon.test    → owns Infosys (Organizations → Manage)
  Org owner      owner2@sportagon.test   → owns Pune United FC
  Captain        captain@sportagon.test  → captains Infosys teams
  Player         player@sportagon.test   → plays for Infosys (My Game)
`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
