import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

const DEMO_PW_HASH = bcrypt.hashSync('demo123', 10);

// ============================================================================
// SPORTS & DISCIPLINES - 32 sports, 60+ disciplines
// ============================================================================
const SPORTS_CONFIG: Array<{
  name: string;
  icon: string;
  disciplines: Array<{ name: string; entry_type: string; squad_min: number; squad_max: number }>;
}> = [
  { name: 'Cricket', icon: '🏏', disciplines: [{ name: 'T20', entry_type: 'team', squad_min: 11, squad_max: 15 }] },
  { name: 'Football', icon: '⚽', disciplines: [{ name: 'Men\'s', entry_type: 'team', squad_min: 11, squad_max: 18 }] },
  { name: 'Basketball', icon: '🏀', disciplines: [
    { name: 'Men\'s', entry_type: 'team', squad_min: 5, squad_max: 12 },
    { name: 'Women\'s', entry_type: 'team', squad_min: 5, squad_max: 12 },
  ]},
  { name: 'Volleyball', icon: '🏐', disciplines: [
    { name: 'Men\'s', entry_type: 'team', squad_min: 6, squad_max: 12 },
    { name: 'Women\'s', entry_type: 'team', squad_min: 6, squad_max: 12 },
  ]},
  { name: 'Badminton', icon: '🏸', disciplines: [
    { name: 'Men\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Women\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Men\'s Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
    { name: 'Mixed Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ]},
  { name: 'Table Tennis', icon: '🏓', disciplines: [
    { name: 'Men\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Women\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Men\'s Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
    { name: 'Mixed Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ]},
  { name: 'Tennis', icon: '🎾', disciplines: [
    { name: 'Men\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Women\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ]},
  { name: 'Athletics', icon: '🏃', disciplines: [
    { name: '100m Sprint', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '200m Sprint', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '400m', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '800m', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '1500m', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Long Jump', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'High Jump', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Shot Put', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '4x100m Relay', entry_type: 'relay', squad_min: 4, squad_max: 4 },
    { name: '4x400m Relay', entry_type: 'relay', squad_min: 4, squad_max: 4 },
  ]},
  { name: 'Swimming', icon: '🏊', disciplines: [
    { name: '50m Freestyle', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '100m Freestyle', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '100m Backstroke', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '100m Butterfly', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '4x100m Relay', entry_type: 'relay', squad_min: 4, squad_max: 4 },
  ]},
  { name: 'Hockey', icon: '🏑', disciplines: [{ name: 'Men\'s', entry_type: 'team', squad_min: 11, squad_max: 16 }] },
  { name: 'Kabaddi', icon: '🤼', disciplines: [{ name: 'Men\'s', entry_type: 'team', squad_min: 7, squad_max: 12 }] },
  { name: 'Kho-Kho', icon: '🏃‍♂️', disciplines: [{ name: 'Men\'s', entry_type: 'team', squad_min: 9, squad_max: 12 }] },
  { name: 'Handball', icon: '🤾', disciplines: [{ name: 'Men\'s', entry_type: 'team', squad_min: 7, squad_max: 14 }] },
  { name: 'Chess', icon: '♟️', disciplines: [
    { name: 'Standard', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Rapid', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Blitz', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Carrom', icon: '⚫', disciplines: [
    { name: 'Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ]},
  { name: 'Squash', icon: '🎾', disciplines: [
    { name: 'Men\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Women\'s Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Wrestling', icon: '🤼‍♂️', disciplines: [
    { name: '57kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '65kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '74kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '86kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Boxing', icon: '🥊', disciplines: [
    { name: '51kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '60kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '69kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '81kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Judo', icon: '🥋', disciplines: [
    { name: '60kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '73kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '90kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Taekwondo', icon: '🥋', disciplines: [
    { name: '58kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '68kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '80kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Fencing', icon: '⚔️', disciplines: [
    { name: 'Épée', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Foil', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Sabre', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Archery', icon: '🏹', disciplines: [
    { name: 'Individual Recurve', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Team Recurve', entry_type: 'team', squad_min: 3, squad_max: 3 },
  ]},
  { name: 'Shooting', icon: '🎯', disciplines: [
    { name: '10m Air Rifle', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '10m Air Pistol', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Weightlifting', icon: '🏋️', disciplines: [
    { name: '61kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '73kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '89kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Powerlifting', icon: '💪', disciplines: [
    { name: '66kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '83kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Gymnastics', icon: '🤸', disciplines: [
    { name: 'Floor', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Vault', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Cycling', icon: '🚴', disciplines: [
    { name: 'Road Race', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Time Trial', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
  { name: 'Rowing', icon: '🚣', disciplines: [
    { name: 'Single Sculls', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Double Sculls', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ]},
  { name: 'Throwball', icon: '🏐', disciplines: [{ name: 'Women\'s', entry_type: 'team', squad_min: 7, squad_max: 12 }] },
  { name: 'Tug of War', icon: '🪢', disciplines: [{ name: 'Men\'s', entry_type: 'team', squad_min: 8, squad_max: 10 }] },
  { name: 'Yoga', icon: '🧘', disciplines: [{ name: 'Individual', entry_type: 'individual', squad_min: 1, squad_max: 1 }] },
  { name: 'Arm Wrestling', icon: '💪', disciplines: [
    { name: 'Lightweight', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Heavyweight', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ]},
];

// ============================================================================
// INSTITUTIONS - 5 colleges
// ============================================================================
const INSTITUTIONS = [
  { name: 'VJTI Mumbai', short_name: 'VJTI', code: 'MH-1042', city: 'Mumbai' },
  { name: 'IIT Bombay', short_name: 'IITB', code: 'MH-1001', city: 'Mumbai' },
  { name: 'DJ Sanghvi', short_name: 'DJSCE', code: 'MH-2055', city: 'Mumbai' },
  { name: 'SPIT Mumbai', short_name: 'SPIT', code: 'MH-2088', city: 'Mumbai' },
  { name: 'COEP Pune', short_name: 'COEP', code: 'MH-3001', city: 'Pune' },
];

// Names for generating players
const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva', 'Advait', 'Pranav', 'Kabir', 'Rohan', 'Dev', 'Harsh', 'Karthik', 'Rahul', 'Priya', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Aanya', 'Kavya', 'Ishita', 'Meera', 'Nisha'];
const LAST_NAMES = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Mehta', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Joshi', 'Rao', 'Desai', 'Shah', 'Malhotra', 'Kulkarni', 'Verma', 'Kapoor', 'Mukherjee', 'Banerjee', 'Pillai'];

function randomName(i: number): string {
  return `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]}`;
}

async function main() {
  console.log('🏗️  Building comprehensive tournament data...\n');

  // ---- Super admin ----
  const password_hash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10);
  const admin = await prisma.users.upsert({
    where: { email: env.SEED_ADMIN_EMAIL },
    update: { password_hash, is_super_admin: true },
    create: { name: env.SEED_ADMIN_NAME, email: env.SEED_ADMIN_EMAIL, password_hash, is_super_admin: true },
  });
  console.log(`✓ Admin: ${admin.email}`);

  // ---- Permissions ----
  const permDefs = [
    { code: 'P1', label: 'Full access (Organiser)' },
    { code: 'P2', label: 'Manage matches & scoring (Official)' },
    { code: 'P3', label: 'Manage own team (Captain/POC)' },
    { code: 'P4', label: 'Read-only (Participant)' },
  ];
  const perms: Record<string, string> = {};
  for (const p of permDefs) {
    const row = await prisma.permissions.upsert({
      where: { code: p.code }, update: { label: p.label }, create: { code: p.code, label: p.label, rules: [] },
    });
    perms[p.code] = row.id;
  }

  // ---- Roles ----
  const roleDefs = [
    { name: 'Organiser', description: 'Runs the championship', codes: ['P1'] },
    { name: 'Official', description: 'Scores matches', codes: ['P2', 'P4'] },
    { name: 'Captain', description: 'Leads a team', codes: ['P3', 'P4'] },
    { name: 'POC', description: 'Organization point of contact', codes: ['P3', 'P4'] },
    { name: 'Participant', description: 'Plays', codes: ['P4'] },
  ];
  for (const r of roleDefs) {
    await prisma.roles.upsert({
      where: { name: r.name },
      update: { description: r.description, permission_ids: r.codes.map((c) => perms[c]) },
      create: { name: r.name, description: r.description, permission_ids: r.codes.map((c) => perms[c]) },
    });
  }
  console.log(`✓ Roles & Permissions`);

  // ---- Tournament formats ----
  const formatDefs = [
    { name: 'Knockout', description: 'Single elimination', config: { third_place_match: 'bool' } },
    { name: 'League', description: 'Everyone plays everyone', config: { double_round: 'bool' } },
    { name: 'Round Robin', description: 'Round robin', config: { double_round: 'bool' } },
    { name: 'Groups+Knockout', description: 'Group stage then knockout', config: { num_groups: 'int', advance_per_group: 'int' } },
  ];
  for (const f of formatDefs) {
    await prisma.tournament_formats.upsert({ where: { name: f.name }, update: { description: f.description, config: f.config }, create: f });
  }
  const knockout = await prisma.tournament_formats.findUnique({ where: { name: 'Knockout' } });
  const league = await prisma.tournament_formats.findUnique({ where: { name: 'League' } });
  console.log(`✓ Tournament formats`);

  // ---- Sports & Disciplines ----
  const sportMap: Record<string, { id: string; icon: string }> = {};
  const disciplineMap: Record<string, Record<string, string>> = {}; // sport -> discipline -> id
  let discCount = 0;
  for (const sc of SPORTS_CONFIG) {
    let sport = await prisma.sports.findFirst({ where: { name: sc.name } });
    if (!sport) sport = await prisma.sports.create({ data: { name: sc.name, icon: sc.icon } });
    sportMap[sc.name] = { id: sport.id, icon: sc.icon };
    disciplineMap[sc.name] = {};
    let order = 1;
    for (const dc of sc.disciplines) {
      let disc = await prisma.disciplines.findFirst({ where: { sport_id: sport.id, name: dc.name } });
      if (!disc) disc = await prisma.disciplines.create({ data: { sport_id: sport.id, name: dc.name, entry_type: dc.entry_type, squad_min: dc.squad_min, squad_max: dc.squad_max, display_order: order++ } });
      disciplineMap[sc.name][dc.name] = disc.id;
      discCount++;
    }
  }
  console.log(`✓ ${Object.keys(sportMap).length} Sports, ${discCount} Disciplines`);

  // ---- Organizations ----
  const organizations: Array<{ id: string; short_name: string; name: string }> = [];
  for (const inst of INSTITUTIONS) {
    let row = await prisma.organizations.findFirst({ where: { name: inst.name } });
    if (!row) row = await prisma.organizations.create({ data: { name: inst.name, short_name: inst.short_name, code: inst.code, city: inst.city, status: true } });
    organizations.push({ id: row.id, short_name: inst.short_name!, name: row.name });
  }
  console.log(`✓ ${organizations.length} Organizations`);

  // Helper: ensure a user ↔ org membership with a given role (idempotent).
  const ensureMember = (userId: string, organizationId: string, role: string) =>
    prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: userId, organization_id: organizationId } },
      update: { role, status: 'active' },
      create: { user_id: userId, organization_id: organizationId, role },
    });

  // ---- Users: Organiser (a plain user who hosts the championship) ----
  const organiser = await prisma.users.upsert({
    where: { email: 'organiser@semp.local' },
    update: { name: 'Olivia Organiser', password_hash: DEMO_PW_HASH },
    create: { email: 'organiser@semp.local', name: 'Olivia Organiser', password_hash: DEMO_PW_HASH, phone: '98000 00001' },
  });
  console.log(`✓ Organiser: organiser@semp.local`);

  // ---- Users: org owner ("POC") per organization ----
  const pocs: Array<{ id: string; organizationId: string; email: string }> = [];
  for (let i = 0; i < organizations.length; i++) {
    const inst = organizations[i];
    const email = `poc@${inst.short_name.toLowerCase()}.local`;
    const user = await prisma.users.upsert({
      where: { email },
      update: { name: `${inst.short_name} Owner`, password_hash: DEMO_PW_HASH, organization_id: inst.id },
      create: { email, name: `${inst.short_name} Owner`, password_hash: DEMO_PW_HASH, organization_id: inst.id, phone: `98100 0000${i + 1}` },
    });
    await ensureMember(user.id, inst.id, 'owner');
    pocs.push({ id: user.id, organizationId: inst.id, email });
  }
  console.log(`✓ ${pocs.length} Org owners: ${pocs.map((p) => p.email).join(', ')}`);

  // ---- Users: Officials (one per 3 sports = ~10 officials) ----
  const officials: Array<{ id: string; email: string; sportIdx: number[] }> = [];
  const sportNames = Object.keys(sportMap);
  for (let i = 0; i < Math.ceil(sportNames.length / 3); i++) {
    const email = `official${i + 1}@semp.local`;
    const user = await prisma.users.upsert({
      where: { email },
      update: { name: `Official ${i + 1}`, password_hash: DEMO_PW_HASH },
      create: { email, name: `Official ${i + 1}`, password_hash: DEMO_PW_HASH, phone: `98200 0000${i + 1}` },
    });
    officials.push({ id: user.id, email, sportIdx: [i * 3, i * 3 + 1, i * 3 + 2].filter((x) => x < sportNames.length) });
  }
  console.log(`✓ ${officials.length} Officials: ${officials.map((o) => o.email).join(', ')}`);

  // ---- Users: Players (20 per org = 100 players), each a member of their org ----
  const playersPerInst: Record<string, Array<{ id: string; email: string; name: string }>> = {};
  let playerIdx = 0;
  for (const inst of organizations) {
    playersPerInst[inst.id] = [];
    for (let p = 1; p <= 20; p++) {
      const email = `player${p}@${inst.short_name.toLowerCase()}.local`;
      const name = randomName(playerIdx++);
      const user = await prisma.users.upsert({
        where: { email },
        update: { name, password_hash: DEMO_PW_HASH, organization_id: inst.id },
        create: { email, name, password_hash: DEMO_PW_HASH, organization_id: inst.id },
      });
      await ensureMember(user.id, inst.id, 'member');
      playersPerInst[inst.id].push({ id: user.id, email, name });
    }
  }
  console.log(`✓ ${playerIdx} Players (20 per organization)`);

  // ==========================================================================
  // EVENT: Genesis Sports Fest '26
  // ==========================================================================
  let championship = await prisma.championships.findUnique({ where: { slug: 'genesis-26' } });
  if (championship) {
    console.log('\n⚠️  Championship genesis-26 already exists. Run `npm run reset:demo` first to rebuild.\n');
    return;
  }

  championship = await prisma.championships.create({
    data: {
      name: "Genesis Sports Fest '26",
      slug: 'genesis-26',
      description: 'The flagship inter-collegiate sports festival — 32 sports across 9 days.',
      venue: 'Mumbai University Grounds',
      start_date: new Date('2026-03-14'),
      end_date: new Date('2026-03-22'),
      status: 'ongoing', // championship is live
    },
  });
  console.log(`\n✓ Championship: ${championship.name} (${championship.slug})`);

  // Organiser role assignment
  const organiserRole = await prisma.roles.findUnique({ where: { name: 'Organiser' } });
  if (organiserRole) {
    await prisma.user_championship_roles.create({ data: { championship_id: championship.id, user_id: organiser.id, role_id: organiserRole.id } });
  }

  // Assign officials to this championship (championship-scoped for multi-tenant isolation)
  for (const official of officials) {
    await prisma.championship_officials.create({
      data: { championship_id: championship.id, user_id: official.id, assigned_by: organiser.id },
    });
  }
  console.log(`✓ ${officials.length} Officials assigned to championship`);

  // ---- Venues & Grounds ----
  const venueMain = await prisma.venues.create({ data: { championship_id: championship.id, name: 'Main Stadium', city: 'Mumbai', address: 'Marine Lines' } });
  const venueIndoor = await prisma.venues.create({ data: { championship_id: championship.id, name: 'Indoor Complex', city: 'Mumbai', address: 'Matunga' } });
  const venuePool = await prisma.venues.create({ data: { championship_id: championship.id, name: 'Aquatic Center', city: 'Mumbai', address: 'Worli' } });
  const grounds: Record<string, string> = {};
  const groundDefs: Array<[string, string, string, number]> = [
    [venueMain.id, 'Ground A', 'field', 5000],
    [venueMain.id, 'Ground B', 'field', 3000],
    [venueMain.id, 'Track', 'track', 8000],
    [venueIndoor.id, 'Court 1', 'court', 500],
    [venueIndoor.id, 'Court 2', 'court', 500],
    [venueIndoor.id, 'Ring Area', 'ring', 300],
    [venueIndoor.id, 'Table Area', 'table', 200],
    [venuePool.id, 'Olympic Pool', 'pool', 1500],
  ];
  for (let i = 0; i < groundDefs.length; i++) {
    const [vid, name, gtype, cap] = groundDefs[i];
    const g = await prisma.venue_grounds.create({ data: { venue_id: vid, name, ground_type: gtype, capacity: cap, display_order: i + 1 } });
    grounds[name] = g.id;
  }
  console.log(`✓ ${Object.keys(grounds).length} Grounds across 3 Venues`);

  // ---- Organization Enrollments (all 5 approved) ----
  const enrollments: Record<string, string> = {}; // inst.id -> enrollment.id
  for (const inst of organizations) {
    const poc = pocs.find((p) => p.organizationId === inst.id)!;
    const ei = await prisma.championship_organizations.create({
      data: { championship_id: championship.id, organization_id: inst.id, applied_by: poc.id, status: 'approved', reviewed_by: organiser.id, reviewed_at: new Date() },
    });
    enrollments[inst.id] = ei.id;
  }
  console.log(`✓ ${Object.keys(enrollments).length} Organization enrollments (all approved)`);

  // ---- Tournament + Sports + Disciplines ----
  const tournament = await prisma.tournaments.create({
    data: { championship_id: championship.id, name: 'Genesis Main Championship', description: 'Overall inter-college championship', status: 'active' },
  });

  // Create tournament_sports and tournament_disciplines for first 8 sports (faster seeding)
  const activeSports = sportNames.slice(0, 8);
  const tournamentDisciplines: Array<{ id: string; sportName: string; discName: string; entryType: string; squadMin: number; squadMax: number }> = [];

  for (let si = 0; si < activeSports.length; si++) {
    const sportName = activeSports[si];
    const sport = sportMap[sportName];
    const format = si % 3 === 0 ? knockout! : league!;
    const ts = await prisma.tournament_sports.create({
      data: { tournament_id: tournament.id, sport_id: sport.id, format_id: format.id, display_order: si + 1 },
    });
    // Disciplines for this sport
    const discNames = Object.keys(disciplineMap[sportName]);
    for (let di = 0; di < discNames.length; di++) {
      const discName = discNames[di];
      const discId = disciplineMap[sportName][discName];
      const disc = await prisma.disciplines.findUnique({ where: { id: discId } });
      const venueId = sportName === 'Swimming' ? venuePool.id : (disc?.entry_type === 'team' ? venueMain.id : venueIndoor.id);
      const td = await prisma.tournament_disciplines.create({
        data: {
          tournament_sport_id: ts.id,
          discipline_id: discId,
          format_id: format.id,
          venue_id: venueId,
          entry_type: disc!.entry_type!,
          squad_min: disc!.squad_min!,
          squad_max: disc!.squad_max!,
          status: 'upcoming',
          display_order: di + 1,
        },
      });
      tournamentDisciplines.push({ id: td.id, sportName, discName, entryType: disc!.entry_type!, squadMin: disc!.squad_min!, squadMax: disc!.squad_max! });
    }
  }
  console.log(`✓ ${tournamentDisciplines.length} Tournament disciplines across ${activeSports.length} sports`);

  // ---- Teams & Rosters ----
  const teams: Array<{ id: string; instId: string; tdId: string; name: string }> = [];
  for (const td of tournamentDisciplines) {
    // Each organization enters a team in each discipline
    for (const inst of organizations) {
      const poc = pocs.find((p) => p.organizationId === inst.id)!;
      const teamName = `${inst.short_name} ${td.sportName}${td.discName !== td.sportName ? ' ' + td.discName : ''}`;
      const team = await prisma.teams.create({
        data: {
          championship_id: championship.id,
          sport_id: sportMap[td.sportName].id,
          organization_id: inst.id,
          championship_organization_id: enrollments[inst.id],
          tournament_discipline_id: td.id,
          name: teamName,
          status: 'roster_locked',
          invite_token: randomBytes(16).toString('hex'),
        },
      });
      teams.push({ id: team.id, instId: inst.id, tdId: td.id, name: teamName });

      // Add members: POC as captain + required players
      await prisma.team_members.create({ data: { team_id: team.id, user_id: poc.id, role: 'captain', jersey_number: 1 } });
      const neededPlayers = Math.min(td.squadMax - 1, 5); // Up to 5 additional players
      const instPlayers = playersPerInst[inst.id];
      for (let pi = 0; pi < neededPlayers; pi++) {
        const player = instPlayers[pi % instPlayers.length];
        // Check if already on this team
        const exists = await prisma.team_members.findFirst({ where: { team_id: team.id, user_id: player.id } });
        if (!exists) {
          await prisma.team_members.create({ data: { team_id: team.id, user_id: player.id, role: 'player', jersey_number: pi + 2 } });
        }
      }
    }
  }
  console.log(`✓ ${teams.length} Teams with rosters`);

  // ---- Fixtures ----
  const statuses: Array<'completed' | 'live' | 'scheduled'> = ['completed', 'completed', 'live', 'scheduled', 'scheduled'];
  let fixtureCount = 0;
  const baseDate = new Date('2026-03-15T09:00:00Z');

  for (const td of tournamentDisciplines) {
    const tdTeams = teams.filter((t) => t.tdId === td.id);
    if (tdTeams.length < 2) continue;

    // Create fixtures (round robin style, simplified)
    for (let i = 0; i < tdTeams.length; i++) {
      for (let j = i + 1; j < tdTeams.length; j++) {
        const status = statuses[fixtureCount % statuses.length];
        const official = officials[fixtureCount % officials.length];
        const groundKeys = Object.keys(grounds);
        const groundId = grounds[groundKeys[fixtureCount % groundKeys.length]];
        const scheduled = new Date(baseDate.getTime() + fixtureCount * 3600000); // +1 hour each

        const homeTeam = tdTeams[i];
        const awayTeam = tdTeams[j];
        let homeScore: number | null = null;
        let awayScore: number | null = null;
        let winnerId: string | null = null;

        if (status === 'completed') {
          homeScore = Math.floor(Math.random() * 5);
          awayScore = Math.floor(Math.random() * 5);
          if (homeScore !== awayScore) {
            winnerId = homeScore > awayScore ? homeTeam.id : awayTeam.id;
          }
        } else if (status === 'live') {
          homeScore = Math.floor(Math.random() * 3);
          awayScore = Math.floor(Math.random() * 3);
        }

        await prisma.fixtures.create({
          data: {
            tournament_discipline_id: td.id,
            home_team_id: homeTeam.id,
            away_team_id: awayTeam.id,
            venue_ground_id: groundId,
            official_id: official.id,
            round: `Round ${Math.floor(fixtureCount / 5) + 1}`,
            status,
            scheduled_at: scheduled,
            duration_minutes: 60,
            home_score: homeScore,
            away_score: awayScore,
            winner_team_id: winnerId,
          },
        });
        fixtureCount++;
        if (fixtureCount >= 100) break; // Cap at 100 fixtures for faster seeding
      }
      if (fixtureCount >= 100) break;
    }
    if (fixtureCount >= 100) break;
  }
  console.log(`✓ ${fixtureCount} Fixtures (mix of completed/live/scheduled)`);

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🎉 COMPREHENSIVE TOURNAMENT SEEDED SUCCESSFULLY!');
  console.log('='.repeat(60));
  console.log(`
📊 Summary:
   - ${Object.keys(sportMap).length} Sports
   - ${discCount} Disciplines
   - ${organizations.length} Organizations
   - ${pocs.length} POCs
   - ${officials.length} Officials
   - ${playerIdx} Players
   - ${teams.length} Teams
   - ${fixtureCount} Fixtures

🔐 Demo Logins (password: demo123):
   System/Organiser:
   - admin@semp.local (super admin)
   - organiser@semp.local

   Organization POCs:
${pocs.map((p) => `   - ${p.email}`).join('\n')}

   Officials:
${officials.map((o) => `   - ${o.email}`).join('\n')}

   Sample Players (20 per organization):
   - player1@vjti.local ... player20@vjti.local
   - player1@iitb.local ... player20@iitb.local
   - player1@djsce.local ... player20@djsce.local
   - player1@spit.local ... player20@spit.local
   - player1@coep.local ... player20@coep.local

🌐 URLs:
   - API: http://localhost:4000
   - Web: http://localhost:5173
`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
