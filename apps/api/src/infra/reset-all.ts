// FULL reset: wipes ALL data, then seeds a large, realistic dataset that exercises
// every screen, role and status in the app:
//   - full sport/discipline catalog (32 sports, ~80 disciplines, all entry types)
//   - all 4 tournament formats (Knockout / League / Round Robin / Groups+Knockout)
//   - ~15 organizations of three kinds (institution / corporate / club)
//   - ~500 logins; some users span multiple orgs and some play in one championship
//     while hosting another
//   - 6 championships across every lifecycle stage (draft → registration_open →
//     ongoing → completed) with enrollments (approved/pending/rejected), invitations
//     (pending/accepted), teams (all statuses + all member roles), fixtures (all
//     statuses, via the real generators), per-match awards and notifications.
//   Run:  npm run reset:all   (workspace @semp/api)
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { generateFixtures } from '../modules/fixtures/domain/generators/index.js';
import type { GeneratedFixture, TeamRef } from '../modules/fixtures/domain/generators/index.js';
import { FIXTURE_STATUS, GROUND_TYPE, SPONSOR_TIER, TEAM_STATUS } from '@semp/shared';

const PW = bcrypt.hashSync('demo123', 10);
const token = () => randomBytes(16).toString('hex');
const pickN = <T>(arr: T[], i: number): T => arr[i % arr.length];
const rint = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

// ----------------------------------------------------------------------------
// Sport / discipline catalog (32 sports, ~80 disciplines, all four entry types).
// ----------------------------------------------------------------------------
type DiscDef = { name: string; entry_type: string; squad_min: number; squad_max: number };
const SPORTS_CONFIG: Array<{ name: string; icon: string; disciplines: DiscDef[] }> = [
  { name: 'Cricket', icon: '🏏', disciplines: [{ name: 'T20', entry_type: 'team', squad_min: 11, squad_max: 15 }] },
  { name: 'Football', icon: '⚽', disciplines: [{ name: "Men's", entry_type: 'team', squad_min: 11, squad_max: 18 }] },
  { name: 'Basketball', icon: '🏀', disciplines: [
    { name: "Men's", entry_type: 'team', squad_min: 5, squad_max: 12 },
    { name: "Women's", entry_type: 'team', squad_min: 5, squad_max: 12 },
  ] },
  { name: 'Volleyball', icon: '🏐', disciplines: [
    { name: "Men's", entry_type: 'team', squad_min: 6, squad_max: 12 },
    { name: "Women's", entry_type: 'team', squad_min: 6, squad_max: 12 },
  ] },
  { name: 'Badminton', icon: '🏸', disciplines: [
    { name: "Men's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: "Women's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: "Men's Doubles", entry_type: 'doubles', squad_min: 2, squad_max: 2 },
    { name: 'Mixed Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ] },
  { name: 'Table Tennis', icon: '🏓', disciplines: [
    { name: "Men's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: "Women's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: "Men's Doubles", entry_type: 'doubles', squad_min: 2, squad_max: 2 },
    { name: 'Mixed Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ] },
  { name: 'Tennis', icon: '🎾', disciplines: [
    { name: "Men's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: "Women's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ] },
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
  ] },
  { name: 'Swimming', icon: '🏊', disciplines: [
    { name: '50m Freestyle', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '100m Freestyle', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '100m Backstroke', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '100m Butterfly', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '4x100m Relay', entry_type: 'relay', squad_min: 4, squad_max: 4 },
  ] },
  { name: 'Hockey', icon: '🏑', disciplines: [{ name: "Men's", entry_type: 'team', squad_min: 11, squad_max: 16 }] },
  { name: 'Kabaddi', icon: '🤼', disciplines: [{ name: "Men's", entry_type: 'team', squad_min: 7, squad_max: 12 }] },
  { name: 'Kho-Kho', icon: '🏃‍♂️', disciplines: [{ name: "Men's", entry_type: 'team', squad_min: 9, squad_max: 12 }] },
  { name: 'Handball', icon: '🤾', disciplines: [{ name: "Men's", entry_type: 'team', squad_min: 7, squad_max: 14 }] },
  { name: 'Chess', icon: '♟️', disciplines: [
    { name: 'Standard', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Rapid', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Blitz', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Carrom', icon: '⚫', disciplines: [
    { name: 'Singles', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Doubles', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ] },
  { name: 'Squash', icon: '🎾', disciplines: [
    { name: "Men's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: "Women's Singles", entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Wrestling', icon: '🤼‍♂️', disciplines: [
    { name: '57kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '65kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '74kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '86kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Boxing', icon: '🥊', disciplines: [
    { name: '51kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '60kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '69kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '81kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Judo', icon: '🥋', disciplines: [
    { name: '60kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '73kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '90kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Taekwondo', icon: '🥋', disciplines: [
    { name: '58kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '68kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '80kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Fencing', icon: '⚔️', disciplines: [
    { name: 'Épée', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Foil', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Sabre', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Archery', icon: '🏹', disciplines: [
    { name: 'Individual Recurve', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Team Recurve', entry_type: 'team', squad_min: 3, squad_max: 3 },
  ] },
  { name: 'Shooting', icon: '🎯', disciplines: [
    { name: '10m Air Rifle', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '10m Air Pistol', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Weightlifting', icon: '🏋️', disciplines: [
    { name: '61kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '73kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '89kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Powerlifting', icon: '💪', disciplines: [
    { name: '66kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: '83kg', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Gymnastics', icon: '🤸', disciplines: [
    { name: 'Floor', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Vault', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Cycling', icon: '🚴', disciplines: [
    { name: 'Road Race', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Time Trial', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
  { name: 'Rowing', icon: '🚣', disciplines: [
    { name: 'Single Sculls', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Double Sculls', entry_type: 'doubles', squad_min: 2, squad_max: 2 },
  ] },
  { name: 'Throwball', icon: '🏐', disciplines: [{ name: "Women's", entry_type: 'team', squad_min: 7, squad_max: 12 }] },
  { name: 'Tug of War', icon: '🪢', disciplines: [{ name: "Men's", entry_type: 'team', squad_min: 8, squad_max: 10 }] },
  { name: 'Yoga', icon: '🧘', disciplines: [{ name: 'Individual', entry_type: 'individual', squad_min: 1, squad_max: 1 }] },
  { name: 'Arm Wrestling', icon: '💪', disciplines: [
    { name: 'Lightweight', entry_type: 'individual', squad_min: 1, squad_max: 1 },
    { name: 'Heavyweight', entry_type: 'individual', squad_min: 1, squad_max: 1 },
  ] },
];

// ----------------------------------------------------------------------------
// Organizations — three kinds, conveyed by name/short_name/code (no schema type).
// ----------------------------------------------------------------------------
type OrgDef = { name: string; short: string; code: string; city: string; kind: 'institution' | 'corporate' | 'club'; status: boolean };
const ORGS: OrgDef[] = [
  // Institutions (colleges/universities)
  { name: 'VJTI Mumbai', short: 'VJTI', code: 'INST-1042', city: 'Mumbai', kind: 'institution', status: true },
  { name: 'IIT Bombay', short: 'IITB', code: 'INST-1001', city: 'Mumbai', kind: 'institution', status: true },
  { name: 'DJ Sanghvi College', short: 'DJSCE', code: 'INST-2055', city: 'Mumbai', kind: 'institution', status: true },
  { name: 'SPIT Mumbai', short: 'SPIT', code: 'INST-2088', city: 'Mumbai', kind: 'institution', status: true },
  { name: 'COEP Pune', short: 'COEP', code: 'INST-3001', city: 'Pune', kind: 'institution', status: true },
  { name: 'NITK Surathkal', short: 'NITK', code: 'INST-5001', city: 'Mangalore', kind: 'institution', status: true },
  // Corporates (companies)
  { name: 'Infosys', short: 'INFY', code: 'CORP-INFY', city: 'Pune', kind: 'corporate', status: true },
  { name: 'Tata Consultancy Services', short: 'TCS', code: 'CORP-TCS', city: 'Mumbai', kind: 'corporate', status: true },
  { name: 'Wipro', short: 'WIPRO', code: 'CORP-WIPRO', city: 'Bengaluru', kind: 'corporate', status: true },
  { name: 'Accenture', short: 'ACN', code: 'CORP-ACN', city: 'Pune', kind: 'corporate', status: true },
  // Organisations (clubs / academies / trusts)
  { name: 'Pune United FC', short: 'PUFC', code: 'CLUB-PUFC', city: 'Pune', kind: 'club', status: true },
  { name: 'Khelo Sports Academy', short: 'KSA', code: 'CLUB-KSA', city: 'Nashik', kind: 'club', status: true },
  { name: 'Spartans Sports Club', short: 'SSC', code: 'CLUB-SSC', city: 'Mumbai', kind: 'club', status: true },
  { name: 'City Sports Trust', short: 'CST', code: 'NGO-CST', city: 'Pune', kind: 'club', status: true },
  // One inactive org, to cover the disabled-organization state.
  { name: 'Velocity Athletics (Inactive)', short: 'VEL', code: 'CLUB-VEL', city: 'Nagpur', kind: 'club', status: false },
];

const PLAYERS_PER_ORG = 30;

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva', 'Advait', 'Pranav', 'Kabir', 'Rohan', 'Dev', 'Harsh', 'Karthik', 'Rahul', 'Priya', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Aanya', 'Kavya', 'Ishita', 'Meera', 'Nisha'];
const LAST = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Mehta', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Joshi', 'Rao', 'Desai', 'Shah', 'Malhotra', 'Kulkarni', 'Verma', 'Kapoor', 'Mukherjee', 'Banerjee', 'Pillai'];
const playerName = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;

// ----------------------------------------------------------------------------
// Championship blueprint: 2 small, 2 medium, 2 big across every lifecycle stage.
// ----------------------------------------------------------------------------
type ChampStatus = 'draft' | 'registration_open' | 'ongoing' | 'completed';
type ChampDef = {
  name: string; slug: string; status: ChampStatus; city: string;
  tournaments: number; sportsPerTournament: number; featured: number; orgCount: number;
  start: string; end: string;
};
const CHAMPS: ChampDef[] = [
  // Small (1 tournament)
  { name: 'Founders Cup 2025', slug: 'founders-cup-2025', status: 'completed', city: 'Pune', tournaments: 1, sportsPerTournament: 2, featured: 2, orgCount: 6, start: '2025-09-12', end: '2025-09-15' },
  { name: 'Monsoon Trophy 2026', slug: 'monsoon-trophy-2026', status: 'draft', city: 'Mumbai', tournaments: 1, sportsPerTournament: 2, featured: 0, orgCount: 0, start: '2026-08-01', end: '2026-08-04' },
  // Medium (3 tournaments)
  { name: 'Inter-Corporate League 2026', slug: 'inter-corporate-league-2026', status: 'registration_open', city: 'Bengaluru', tournaments: 3, sportsPerTournament: 2, featured: 3, orgCount: 8, start: '2026-07-18', end: '2026-07-27' },
  { name: 'University Games 2026', slug: 'university-games-2026', status: 'ongoing', city: 'Mumbai', tournaments: 3, sportsPerTournament: 3, featured: 4, orgCount: 8, start: '2026-06-10', end: '2026-06-20' },
  // Big (5-6 tournaments)
  { name: 'Genesis National Championship 2026', slug: 'genesis-national-2026', status: 'ongoing', city: 'Mumbai', tournaments: 5, sportsPerTournament: 3, featured: 6, orgCount: 12, start: '2026-06-14', end: '2026-06-24' },
  { name: 'Apex Premier Games 2025', slug: 'apex-premier-games-2025', status: 'completed', city: 'Delhi', tournaments: 6, sportsPerTournament: 3, featured: 6, orgCount: 12, start: '2025-11-05', end: '2025-11-16' },
];

// Grounds we lay down per championship — every GROUND_TYPE is represented.
const GROUND_BLUEPRINT: Array<{ name: string; type: (typeof GROUND_TYPE)[number]; cap: number }> = [
  { name: 'Main Ground', type: 'field', cap: 5000 },
  { name: 'Show Court', type: 'court', cap: 800 },
  { name: 'Athletics Track', type: 'track', cap: 6000 },
  { name: 'Aquatic Pool', type: 'pool', cap: 1200 },
  { name: 'Combat Ring', type: 'ring', cap: 400 },
  { name: 'Indoor Tables', type: 'table', cap: 200 },
];

// ============================================================================
// Wipe — every table, FK-safe via CASCADE.
// ============================================================================
async function wipe() {
  await prisma.$executeRawUnsafe(`truncate table
    organization_members, notification_reads, notification_reactions, notifications,
    fixture_awards, fixtures, team_members, teams, championship_organizations,
    championship_invitations, user_championship_roles, championship_officials,
    tournament_disciplines, tournament_sports, tournaments,
    venue_grounds, venues, sponsors, championships, organizations,
    disciplines, sports, tournament_formats, roles, permissions, users
    restart identity cascade`);
  console.log('🧹 Wiped all data');
}

// Decide roster size + roles for a team given its entry type, capping team sizes
// so the dataset stays tractable. Returns the role for each member slot.
function rosterRoles(entryType: string, squadMax: number): string[] {
  let size: number;
  if (entryType === 'individual') size = 1;
  else if (entryType === 'doubles') size = 2;
  else if (entryType === 'relay') size = 4;
  else size = Math.min(squadMax, 10); // team
  const roles: string[] = [];
  for (let i = 0; i < size; i++) {
    if (i === 0) roles.push('captain');
    else if (i === 1 && size >= 3) roles.push('vice_captain');
    else if (i === size - 1 && size >= 4) roles.push('substitute');
    else roles.push('player');
  }
  return roles;
}

// Map a generated fixture onto persisted columns, deciding result/status from the
// championship's lifecycle so every FIXTURE_STATUS value appears in the dataset.
type FixtureResult = {
  status: (typeof FIXTURE_STATUS)[number];
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  live_state: Prisma.InputJsonValue;
  live_log: Prisma.InputJsonValue;
};
function resolveFixture(gf: GeneratedFixture, idx: number, mode: 'all_completed' | 'mixed'): FixtureResult {
  const base: FixtureResult = { status: 'scheduled', home_score: null, away_score: null, winner_team_id: null, live_state: {}, live_log: [] };
  if (gf.status === 'bye') return { ...base, status: 'bye' };
  if (!gf.homeTeamId || !gf.awayTeamId) return base; // future-round placeholder

  // Cycle a status pattern; 'mixed' surfaces live/postponed/cancelled/walkover too.
  const pattern: Array<(typeof FIXTURE_STATUS)[number]> = mode === 'all_completed'
    ? ['completed', 'completed', 'completed', 'completed', 'walkover']
    : ['completed', 'completed', 'live', 'scheduled', 'postponed', 'completed', 'cancelled', 'scheduled', 'walkover', 'completed'];
  const status = pickN(pattern, idx);

  if (status === 'completed') {
    const hs = rint(0, 5);
    let as = rint(0, 5);
    if (hs === as) as = hs + 1; // avoid draws so a winner exists
    return { ...base, status, home_score: hs, away_score: as, winner_team_id: hs > as ? gf.homeTeamId : gf.awayTeamId };
  }
  if (status === 'live') {
    const hs = rint(0, 3);
    const as = rint(0, 3);
    return {
      ...base, status, home_score: hs, away_score: as,
      live_state: { minute: rint(10, 80), period: '2nd Half', home_score: hs, away_score: as },
      live_log: [
        { minute: 1, text: 'Kick-off' },
        { minute: rint(10, 40), text: 'Goal!' },
      ],
    };
  }
  if (status === 'walkover') {
    return { ...base, status, winner_team_id: gf.homeTeamId }; // away forfeits
  }
  return { ...base, status }; // scheduled / postponed / cancelled — no result yet
}

async function main() {
  const t0 = Date.now();
  await wipe();

  // ---- Super admin ----
  const admin = await prisma.users.create({
    data: { name: env.SEED_ADMIN_NAME, email: env.SEED_ADMIN_EMAIL, password_hash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10), is_super_admin: true, phone: '98765 43210' },
  });

  // ---- Permissions + roles (the "good" RBAC set) ----
  const permDefs: Array<[string, string]> = [
    ['P1', 'Full access (Organiser)'],
    ['P2', 'Manage matches & scoring (Official)'],
    ['P3', 'Manage own team (Captain/POC)'],
    ['P4', 'Read-only (Participant)'],
  ];
  const perms: Record<string, string> = {};
  for (const [code, label] of permDefs) perms[code] = (await prisma.permissions.create({ data: { code, label, rules: [] } })).id;

  const roleDefs: Array<{ name: string; description: string; codes: string[] }> = [
    { name: 'Organiser', description: 'Runs the championship', codes: ['P1'] },
    { name: 'Official', description: 'Scores matches', codes: ['P2', 'P4'] },
    { name: 'Captain', description: 'Leads a team', codes: ['P3', 'P4'] },
    { name: 'POC', description: 'Organization point of contact', codes: ['P3', 'P4'] },
    { name: 'Participant', description: 'Plays', codes: ['P4'] },
  ];
  const roles: Record<string, string> = {};
  for (const r of roleDefs) roles[r.name] = (await prisma.roles.create({ data: { name: r.name, description: r.description, permission_ids: r.codes.map((c) => perms[c]) } })).id;
  console.log('✓ Permissions + roles');

  // ---- Tournament formats (all four) ----
  const formatDefs = [
    { name: 'Knockout', description: 'Single elimination', config: { third_place_match: true } },
    { name: 'League', description: 'Everyone plays everyone', config: { double_round: false } },
    { name: 'Round Robin', description: 'Single round robin', config: { double_round: false } },
    { name: 'Groups+Knockout', description: 'Group stage then knockout', config: { num_groups: 2, advance_per_group: 2 } },
  ];
  const formatId: Record<string, string> = {};
  for (const f of formatDefs) formatId[f.name] = (await prisma.tournament_formats.create({ data: f })).id;
  const FORMAT_NAMES = formatDefs.map((f) => f.name);
  console.log('✓ 4 tournament formats');

  // ---- Sports + disciplines (full catalog) ----
  type DiscRow = { id: string; name: string; entry_type: string; squad_min: number; squad_max: number };
  const sportMap: Record<string, { id: string; icon: string; disciplines: DiscRow[] }> = {};
  let discCount = 0;
  for (const sc of SPORTS_CONFIG) {
    const sport = await prisma.sports.create({ data: { name: sc.name, icon: sc.icon } });
    const disciplines: DiscRow[] = [];
    let order = 1;
    for (const d of sc.disciplines) {
      const row = await prisma.disciplines.create({
        data: { sport_id: sport.id, name: d.name, entry_type: d.entry_type, squad_min: d.squad_min, squad_max: d.squad_max, display_order: order++ },
      });
      disciplines.push({ id: row.id, name: d.name, entry_type: d.entry_type, squad_min: d.squad_min, squad_max: d.squad_max });
      discCount++;
    }
    sportMap[sc.name] = { id: sport.id, icon: sc.icon, disciplines };
  }
  const SPORT_NAMES = SPORTS_CONFIG.map((s) => s.name);
  console.log(`✓ ${SPORT_NAMES.length} sports, ${discCount} disciplines`);

  // ---- Organizations ----
  const orgRows: Array<OrgDef & { id: string }> = [];
  for (const o of ORGS) {
    const row = await prisma.organizations.create({ data: { name: o.name, short_name: o.short, code: o.code, city: o.city, country: 'India', status: o.status } });
    orgRows.push({ ...o, id: row.id });
  }
  const activeOrgs = orgRows.filter((o) => o.status); // the inactive org enters nothing
  console.log(`✓ ${orgRows.length} organizations (${orgRows.filter((o) => o.kind === 'institution').length} institutions, ${orgRows.filter((o) => o.kind === 'corporate').length} corporate, ${orgRows.filter((o) => o.kind === 'club').length} clubs)`);

  // Membership helper.
  const member = (userId: string, orgId: string, role: string) =>
    prisma.organization_members.create({ data: { user_id: userId, organization_id: orgId, role } });

  // ---- Org owners (POCs) ----
  const ownerByOrg: Record<string, string> = {};
  for (const o of orgRows) {
    const u = await prisma.users.create({
      data: { name: `${o.short} Admin`, email: `owner@${o.short.toLowerCase()}.semp.local`, password_hash: PW, phone: `98${rint(100, 999)} ${rint(10000, 99999)}`, organization_id: o.id },
    });
    ownerByOrg[o.id] = u.id;
    await member(u.id, o.id, 'owner');
  }
  console.log(`✓ ${orgRows.length} org owners (POCs)`);

  // ---- Players (bulk) — 30 per org ----
  const playerData: Array<{ name: string; email: string; password_hash: string; phone: string; organization_id: string; must_change_password: boolean }> = [];
  let gi = 0;
  for (const o of orgRows) {
    for (let n = 1; n <= PLAYERS_PER_ORG; n++) {
      const idx = gi++;
      const ph = String(9000000000 + idx); // unique 10-digit mobile
      playerData.push({
        name: playerName(idx),
        email: `player${n}@${o.short.toLowerCase()}.semp.local`,
        password_hash: PW,
        phone: `${ph.slice(0, 5)} ${ph.slice(5)}`,
        organization_id: o.id,
        // a couple of freshly-provisioned members per org must reset their password
        must_change_password: n > PLAYERS_PER_ORG - 2,
      });
    }
  }
  await prisma.users.createMany({ data: playerData });
  const playerRows = await prisma.users.findMany({ where: { email: { in: playerData.map((p) => p.email) } }, select: { id: true, email: true, organization_id: true } });
  const playersByOrg: Record<string, string[]> = {};
  for (const o of orgRows) playersByOrg[o.id] = [];
  for (const p of playerRows) if (p.organization_id) playersByOrg[p.organization_id].push(p.id);
  // Org-member rows for every player.
  await prisma.organization_members.createMany({ data: playerRows.filter((p) => p.organization_id).map((p) => ({ user_id: p.id, organization_id: p.organization_id!, role: 'member' })) });
  console.log(`✓ ${playerRows.length} players (${PLAYERS_PER_ORG}/org)`);

  // ---- Officials pool ----
  const officials: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const u = await prisma.users.create({
      data: { name: `Official ${i}`, email: `official${i}@semp.local`, password_hash: PW, phone: `98200 ${rint(10000, 99999)}`, must_change_password: i > 8 },
    });
    officials.push(u.id);
  }
  console.log(`✓ ${officials.length} officials`);

  // ---- Dedicated organisers pool ----
  const organisers: string[] = [];
  const ORGANISER_NAMES = ['Olivia Organiser', 'Omar Host', 'Ishaan Events', 'Neha Director'];
  for (let i = 0; i < ORGANISER_NAMES.length; i++) {
    const u = await prisma.users.create({ data: { name: ORGANISER_NAMES[i], email: `organiser${i + 1}@semp.local`, password_hash: PW, phone: `98300 ${rint(10000, 99999)}` } });
    organisers.push(u.id);
  }
  console.log(`✓ ${organisers.length} organisers`);

  // ---- Cross-cutting links (user's nuance) ----
  // (a) A few players hold membership in a SECOND organization.
  const crossOrgPlayers: string[] = [];
  for (let k = 0; k < 4; k++) {
    const homeOrg = activeOrgs[k];
    const otherOrg = activeOrgs[(k + 3) % activeOrgs.length];
    const playerId = playersByOrg[homeOrg.id][k];
    if (homeOrg.id !== otherOrg.id) {
      await member(playerId, otherOrg.id, 'member');
      crossOrgPlayers.push(playerId);
    }
  }
  // (b) Two PLAYERS who will also host a championship (assigned Organiser below).
  const playerHosts = [playersByOrg[activeOrgs[0].id][0], playersByOrg[activeOrgs[1].id][0]];
  console.log(`✓ Cross-org members + player-hosts wired`);

  // Pick the host for each championship: organisers cycle, but two events are hosted
  // by players (so a participant in one championship organises another), and one
  // organiser hosts two events.
  const hostFor = (idx: number): string => {
    if (idx === 1) return playerHosts[0]; // small draft event hosted by a player
    if (idx === 4) return playerHosts[1]; // big ongoing event co-context with a player
    if (idx === 5) return organisers[0]; // organiser[0] also hosts the small completed (idx 0) → repeat
    return pickN(organisers, idx);
  };

  // ==========================================================================
  // Championships
  // ==========================================================================
  let totalTournaments = 0, totalTDs = 0, totalTeams = 0, totalFixtures = 0, totalAwards = 0, totalNotifs = 0;
  let sportCursor = 0; // walk the catalog so events feature different sports
  const FIXTURE_CAP = 1500;

  for (let ci = 0; ci < CHAMPS.length; ci++) {
    const c = CHAMPS[ci];
    const champ = await prisma.championships.create({
      data: { name: c.name, slug: c.slug, status: c.status, venue: `${c.city} Sports Complex`, description: `${c.name} — a multi-sport championship in ${c.city}.`, start_date: new Date(c.start), end_date: new Date(c.end) },
    });
    const hostId = hostFor(ci);
    await prisma.user_championship_roles.create({ data: { championship_id: champ.id, user_id: hostId, role_id: roles.Organiser, assigned_by: admin.id } });
    // Big events get a co-organiser to exercise multi-host.
    if (c.tournaments >= 5) {
      const co = pickN(organisers, ci + 1);
      if (co !== hostId) await prisma.user_championship_roles.create({ data: { championship_id: champ.id, user_id: co, role_id: roles.Organiser, assigned_by: admin.id } });
    }

    // Officials assigned to this championship (3 for big, 2 otherwise).
    const champOfficials = officials.slice(0, c.tournaments >= 5 ? 4 : 2);
    for (const oid of champOfficials) {
      await prisma.championship_officials.create({ data: { championship_id: champ.id, user_id: oid, assigned_by: hostId } });
    }

    // Sponsors — big events cover all four tiers; others get one.
    const tiers: Array<(typeof SPONSOR_TIER)[number]> = c.tournaments >= 5 ? [...SPONSOR_TIER] : ['gold'];
    for (let s = 0; s < tiers.length; s++) {
      await prisma.sponsors.create({ data: { championship_id: champ.id, name: `${tiers[s][0].toUpperCase()}${tiers[s].slice(1)} Sponsor ${ci + 1}`, tier: tiers[s], display_order: s + 1 } });
    }

    // Venue + grounds (all ground types).
    const venue = await prisma.venues.create({ data: { championship_id: champ.id, name: `${c.city} Sports Complex`, city: c.city, address: `${c.city} Stadium Road` } });
    const groundIds: string[] = [];
    for (let g = 0; g < GROUND_BLUEPRINT.length; g++) {
      const gb = GROUND_BLUEPRINT[g];
      const row = await prisma.venue_grounds.create({ data: { venue_id: venue.id, name: gb.name, ground_type: gb.type, capacity: gb.cap, display_order: g + 1 } });
      groundIds.push(row.id);
    }

    // ---- Tournaments → sports → disciplines ----
    type FeaturedTD = { id: string; sportName: string; discName: string; entryType: string; squadMax: number; formatName: string };
    const allTDs: FeaturedTD[] = [];
    let formatCursor = ci; // vary which format leads off each event
    for (let ti = 0; ti < c.tournaments; ti++) {
      const tournament = await prisma.tournaments.create({
        data: { championship_id: champ.id, name: c.tournaments === 1 ? `${c.name} Championship` : `${c.name} — Series ${ti + 1}`, description: `Series ${ti + 1} of ${c.name}.`, status: c.status === 'completed' ? 'completed' : c.status === 'draft' ? 'draft' : 'active' },
      });
      totalTournaments++;

      for (let si = 0; si < c.sportsPerTournament; si++) {
        const sportName = pickN(SPORT_NAMES, sportCursor++);
        const sport = sportMap[sportName];
        const fmtName = pickN(FORMAT_NAMES, formatCursor++);
        const ts = await prisma.tournament_sports.create({ data: { tournament_id: tournament.id, sport_id: sport.id, format_id: formatId[fmtName], display_order: si + 1 } });
        // A discipline status that matches the lifecycle.
        const tdStatus = c.status === 'completed' ? 'completed' : c.status === 'ongoing' ? 'ongoing' : 'upcoming';
        for (let di = 0; di < sport.disciplines.length; di++) {
          const d = sport.disciplines[di];
          const td = await prisma.tournament_disciplines.create({
            data: {
              tournament_sport_id: ts.id, discipline_id: d.id, format_id: formatId[fmtName], venue_id: venue.id,
              entry_type: d.entry_type, squad_min: d.squad_min, squad_max: d.squad_max, status: tdStatus, display_order: di + 1,
            },
          });
          totalTDs++;
          allTDs.push({ id: td.id, sportName, discName: d.name, entryType: d.entry_type, squadMax: d.squad_max, formatName: fmtName });
        }
      }
    }

    // Draft event stops here (structure only — no enrollments/teams/fixtures).
    if (c.status === 'draft' || c.orgCount === 0) {
      console.log(`✓ Championship: ${c.name} (${c.status}) — structure only`);
      continue;
    }

    // ---- Enrollments: approved (most) + pending + rejected ----
    const enrolledOrgs = activeOrgs.slice(0, c.orgCount);
    const enrollByOrg: Record<string, string> = {};
    for (let oi = 0; oi < enrolledOrgs.length; oi++) {
      const org = enrolledOrgs[oi];
      // Last org pending, second-last rejected (only when registration is open);
      // everything else approved.
      let status: 'approved' | 'pending' | 'rejected' = 'approved';
      let rejection_note: string | null = null;
      if (c.status === 'registration_open' && oi === enrolledOrgs.length - 1) status = 'pending';
      else if (c.status === 'registration_open' && oi === enrolledOrgs.length - 2) { status = 'rejected'; rejection_note = 'Entry fee not received before the deadline.'; }
      const ei = await prisma.championship_organizations.create({
        data: {
          championship_id: champ.id, organization_id: org.id, applied_by: ownerByOrg[org.id], status,
          reviewed_by: status === 'pending' ? null : hostId, reviewed_at: status === 'pending' ? null : new Date(), rejection_note,
        },
      });
      if (status === 'approved') enrollByOrg[org.id] = ei.id;
    }

    // ---- Host → org invitations: one pending, one accepted ----
    await prisma.championship_invitations.create({
      data: { championship_id: champ.id, org_name: 'Phoenix Sports Club', poc_mobile: `9${rint(700000000, 799999999)}`, status: 'pending', invited_by: hostId },
    });
    const acceptedOrg = enrolledOrgs[0];
    await prisma.championship_invitations.create({
      data: { championship_id: champ.id, org_name: acceptedOrg.name, poc_mobile: `9${rint(800000000, 899999999)}`, status: 'accepted', invited_by: hostId, organization_id: acceptedOrg.id, accepted_by: ownerByOrg[acceptedOrg.id], responded_at: new Date() },
    });

    // ---- Featured disciplines get teams + fixtures ----
    const approvedOrgIds = Object.keys(enrollByOrg);
    const featured = allTDs.slice(0, c.featured);
    const fixtureMode: 'all_completed' | 'mixed' = c.status === 'completed' ? 'all_completed' : 'mixed';
    const baseTime = new Date(`${c.start}T09:00:00Z`).getTime();
    const teamRoster: Record<string, string[]> = {}; // teamId -> [userId]

    for (const td of featured) {
      // Up to 8 approved orgs enter this discipline.
      const orgIdsForTd = approvedOrgIds.slice(0, 8);
      const teamRefs: TeamRef[] = [];
      const orgCursorByDisc: Record<string, number> = {};
      for (let oi = 0; oi < orgIdsForTd.length; oi++) {
        const orgId = orgIdsForTd[oi];
        const org = orgRows.find((o) => o.id === orgId)!;
        // Team status spreads across all TEAM_STATUS for registration_open; locked otherwise.
        const teamStatus = c.status === 'registration_open' ? pickN([...TEAM_STATUS], oi) : 'roster_locked';
        const team = await prisma.teams.create({
          data: {
            championship_id: champ.id, sport_id: sportMap[td.sportName].id, organization_id: orgId,
            championship_organization_id: enrollByOrg[orgId], tournament_discipline_id: td.id,
            name: `${org.short} ${td.sportName}${td.discName && td.discName !== td.sportName ? ' ' + td.discName : ''}`,
            status: teamStatus, invite_token: token(),
          },
        });
        totalTeams++;
        // Roster from this org's players (rotate so different disciplines pull different members).
        const pool = playersByOrg[orgId];
        const startAt = (orgCursorByDisc[orgId] ?? featured.indexOf(td)) * 3;
        const rRoles = rosterRoles(td.entryType, td.squadMax);
        const memberRows = rRoles.map((role, mi) => {
          const uid = pool[(startAt + mi) % pool.length];
          return { team_id: team.id, user_id: uid, role, jersey_number: mi + 1 };
        });
        // Dedup by user (unique team_id+user_id).
        const seen = new Set<string>();
        const deduped = memberRows.filter((m) => (seen.has(m.user_id) ? false : (seen.add(m.user_id), true)));
        await prisma.team_members.createMany({ data: deduped });
        teamRoster[team.id] = deduped.map((m) => m.user_id);
        teamRefs.push({ teamId: team.id });
      }

      // Generate fixtures only when there are enough teams and the event is live/done.
      if (teamRefs.length < 2 || c.status === 'registration_open' || totalFixtures >= FIXTURE_CAP) continue;
      let generated: GeneratedFixture[];
      try {
        const params = td.formatName.includes('Group') ? { num_groups: teamRefs.length >= 6 ? 2 : 2, advance_per_group: 2 } : { third_place_match: true, double_round: false };
        generated = generateFixtures(td.formatName, teamRefs, params);
      } catch {
        continue; // not enough teams for this format — skip rather than fail the seed
      }
      const rows = generated.slice(0, FIXTURE_CAP - totalFixtures).map((gf, idx) => {
        const r = resolveFixture(gf, idx, fixtureMode);
        return {
          tournament_discipline_id: td.id,
          home_team_id: gf.homeTeamId, away_team_id: gf.awayTeamId,
          venue_ground_id: pickN(groundIds, idx), official_id: pickN(champOfficials, idx),
          round: gf.round, pool_number: gf.poolNumber, bracket_position: gf.bracketPosition,
          scheduled_at: new Date(baseTime + (totalFixtures + idx) * 3600_000),
          duration_minutes: pickN([60, 90, 45], idx),
          status: r.status, home_score: r.home_score, away_score: r.away_score, winner_team_id: r.winner_team_id,
          live_state: r.live_state, live_log: r.live_log,
        };
      });
      await prisma.fixtures.createMany({ data: rows });
      totalFixtures += rows.length;

      // ---- Awards on completed fixtures ----
      const completed = await prisma.fixtures.findMany({
        where: { tournament_discipline_id: td.id, status: 'completed' },
        select: { id: true, home_team_id: true, away_team_id: true },
      });
      const awardRows: Array<{ fixture_id: string; recipient_user_id: string; award_name: string }> = [];
      completed.forEach((fx, idx) => {
        const winnerRoster = fx.home_team_id ? teamRoster[fx.home_team_id] : undefined;
        if (winnerRoster && winnerRoster.length) {
          awardRows.push({ fixture_id: fx.id, recipient_user_id: winnerRoster[0], award_name: 'Player of the Match' });
          if (idx % 4 === 0 && winnerRoster.length > 1) awardRows.push({ fixture_id: fx.id, recipient_user_id: winnerRoster[1], award_name: 'Best Performer' });
        }
      });
      if (awardRows.length) { await prisma.fixture_awards.createMany({ data: awardRows }); totalAwards += awardRows.length; }
    }

    // ---- Notifications (manual both audiences + lifecycle + enrollment_approved) ----
    const notifDefs = [
      { type: 'manual', audience: 'all', title: `Welcome to ${c.name}!`, body: 'Schedules and live scores are now available in the app.' },
      { type: 'manual', audience: 'organizations_captains', title: 'Captains briefing', body: 'Please confirm your rosters before the first match.' },
      { type: 'event_lifecycle', audience: 'all', title: `${c.name} is now ${c.status}`, body: `The championship status changed to ${c.status}.` },
      { type: 'enrollment_approved', audience: 'organizations_captains', title: 'Your organization has been approved', body: 'You can now register teams for the disciplines.' },
    ];
    const notifIds: string[] = [];
    for (const n of notifDefs) {
      const row = await prisma.notifications.create({ data: { championship_id: champ.id, sender_id: hostId, type: n.type, audience: n.audience, title: n.title, body: n.body } });
      notifIds.push(row.id);
      totalNotifs++;
    }
    // Reads + reactions from a sample of org owners.
    const reactors = enrolledOrgs.slice(0, 4).map((o) => ownerByOrg[o.id]);
    const reactionEmojis = ['👍', '❤️', '🎉', '👏'];
    const readRows: Array<{ notification_id: string; user_id: string }> = [];
    const reactionRows: Array<{ notification_id: string; user_id: string; reaction: string }> = [];
    notifIds.forEach((nid, nIdx) => {
      reactors.forEach((uid, uIdx) => {
        if ((nIdx + uIdx) % 2 === 0) readRows.push({ notification_id: nid, user_id: uid });
        if (nIdx === 0) reactionRows.push({ notification_id: nid, user_id: uid, reaction: pickN(reactionEmojis, uIdx) });
      });
    });
    if (readRows.length) await prisma.notification_reads.createMany({ data: readRows, skipDuplicates: true });
    if (reactionRows.length) await prisma.notification_reactions.createMany({ data: reactionRows, skipDuplicates: true });

    console.log(`✓ Championship: ${c.name} (${c.status}) — ${featured.length} featured disciplines`);
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  const [userCount, fixtureRows] = await Promise.all([prisma.users.count(), prisma.fixtures.count()]);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`🎉 SEEDED ${CHAMPS.length} championships in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('='.repeat(64));
  console.log(`📊  Sports ${SPORT_NAMES.length} · Disciplines ${discCount} · Formats 4 · Orgs ${orgRows.length}
    Users ${userCount} · Tournaments ${totalTournaments} · Tournament-disciplines ${totalTDs}
    Teams ${totalTeams} · Fixtures ${fixtureRows} · Awards ${totalAwards} · Notifications ${totalNotifs}`);
  console.log(`
🔐  Logins (password: demo123 · admin: ${env.SEED_ADMIN_PASSWORD})

   System admin   ${env.SEED_ADMIN_EMAIL}
   Organisers     organiser1@semp.local … organiser4@semp.local
   Officials      official1@semp.local … official10@semp.local
   Org owners     owner@vjti.semp.local, owner@infy.semp.local, owner@pufc.semp.local, …
   Players        player1@vjti.semp.local … player30@vjti.semp.local (per org)
   Player-hosts   player1@vjti.semp.local & player1@iitb.semp.local also ORGANISE a championship

🌐  API http://localhost:4000   ·   Web http://localhost:5173
`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
