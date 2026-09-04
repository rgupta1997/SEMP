/*
 * AN INTRA-INSTITUTION CHAMPIONSHIP, on the QA bench's people.
 *
 *   npx tsx scripts/seed-qa-intra.ts seed | cleanup
 *
 * WHY SEPARATE. The inter/intra split on a career record is only worth anything if a
 * person has BOTH - one number against other institutions, another against the
 * department down the corridor. Every existing bench is inter (entries are whole
 * institutions), so the intra half of the hierarchy had no data at all and could not
 * be checked. This adds a departmental event inside one of the QA institutions,
 * played by people who already have inter results, so the same profile shows both.
 *
 * It reuses the QA bench's users and organisation - it creates no people. The two
 * tiers on one player's page is the entire point.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { purgeFixtureArtefacts } from './seed-purge.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-qa-intra-manifest.json');

type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  save();
};

const day = (d: string) => new Date(`${d}T04:00:00Z`);

/** The departments that compete. Four, so the bracket is clean. */
const DEPARTMENTS = ['Computer Science', 'Mechanical', 'Commerce', 'Design'];

/** The sports it runs. Deliberately ones the inter bench also runs, so a player's
 *  page shows the SAME sport at two tiers - which is the comparison that matters. */
const SPORTS: Array<{ sport: string; discipline: string; squad: number }> = [
  // SMALLER SQUADS than the inter bench, because a department is not an institution:
  // splitting one college's people four ways leaves six or seven each, and a
  // departmental cup is played six-a-side for exactly that reason. The sports are
  // deliberately the same, so a player's page shows one sport at two tiers.
  { sport: 'Cricket', discipline: "Men's", squad: 6 },
  { sport: 'Football', discipline: "Men's", squad: 6 },
  { sport: 'Table Tennis', discipline: "Men's Singles", squad: 1 },
  { sport: 'Badminton', discipline: "Men's Singles", squad: 1 },
];

async function seed() {
  if (existsSync(MANIFEST)) {
    console.error('A manifest already exists - run `cleanup` first.');
    process.exit(1);
  }

  // The host: the QA bench's own institution, with its people already in place.
  const org = await prisma.organizations.findFirst({
    where: { name: { startsWith: 'QA Kingsbridge' } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error('Seed the QA bench first: QA_ALL=1 npx tsx scripts/seed-qa-bench.ts seed');

  const organiser = await prisma.users.findFirst({
    where: { email: 'organiser@qa.test' }, select: { id: true },
  });
  const official = await prisma.users.findFirst({
    where: { email: 'official@qa.test' }, select: { id: true },
  });
  if (!organiser || !official) throw new Error('QA staff accounts not found.');

  const people = await prisma.users.findMany({
    where: { organization_id: org.id, email: { contains: '@qa.test' } },
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
    take: 60,
  });
  if (people.length < 24) throw new Error(`Only ${people.length} people in ${org.name}; need 24+.`);

  // ---- 1 - the departments -------------------------------------------------
  // These are org_units, which is what makes an intra event possible at all: the
  // competing entity is a unit of one institution rather than an institution.
  const unitIds = new Map<string, string>();
  const unitRows = DEPARTMENTS.map((name, i) => {
    const id = randomUUID();
    unitIds.set(name, id);
    return {
      id, organization_id: org.id, parent_id: null, type: 'department',
      // UPPERCASE: org_units_status_check allows ACTIVE | SETUP | ARCHIVED, unlike
      // every other status column on the platform, which is lowercase.
      name: `QA ${name}`, code: name.slice(0, 3).toUpperCase(), display_order: i, status: 'ACTIVE',
    };
  });
  await prisma.org_units.createMany({ data: unitRows });
  track('org_units', unitRows.map((u) => u.id));

  // Each person belongs to a department, round-robin so every unit has a squad.
  const unitOf = new Map<string, string>();
  const memberRows = people.map((p, i) => {
    const unitId = unitIds.get(DEPARTMENTS[i % DEPARTMENTS.length])!;
    unitOf.set(p.id, unitId);
    // No status column here - membership of a unit is simply a fact.
    return { id: randomUUID(), organization_id: org.id, org_unit_id: unitId, user_id: p.id };
  });
  await prisma.org_unit_members.createMany({ data: memberRows, skipDuplicates: true });
  track('org_unit_members', memberRows.map((m) => m.id));

  // ---- 2 - the championship ------------------------------------------------
  // entry_level 'department' is THE signal. It decides who competes, and the career
  // record reads it to decide the tier - so the two cannot drift apart.
  const run = Math.random().toString(36).slice(2, 8);
  const champId = randomUUID();
  await prisma.championships.create({
    data: {
      id: champId,
      name: 'QA Bench · Inter-Department Cup 2026',
      slug: `qa-intra-${run}`,
      description: 'An INTRA-institution championship: departments of one institution against each other. Its results file under the intra tier on a player\'s career record, separately from their inter-institution results.',
      venue: 'Kingsbridge Sports Complex',
      start_date: day('2026-11-02'), end_date: day('2026-11-08'),
      status: 'ongoing', visibility: 'public', type: 'multi_sport',
      country: 'India', region: 'asia',
      entry_level: 'department',
      host_organization_id: org.id,
    },
  });
  track('championships', champId);

  const roles = await prisma.roles.findMany({ select: { id: true, code: true } });
  const roleId = (code: string) => roles.find((r) => r.code === code)!.id;
  const ucr = [
    { id: randomUUID(), user_id: organiser.id, championship_id: champId, role_id: roleId('organiser') },
    { id: randomUUID(), user_id: official.id, championship_id: champId, role_id: roleId('official') },
  ];
  await prisma.user_championship_roles.createMany({ data: ucr });
  track('user_championship_roles', ucr.map((r) => r.id));

  const offRow = { id: randomUUID(), championship_id: champId, user_id: official.id, is_active: true };
  await prisma.championship_officials.create({ data: offRow });
  track('championship_officials', offRow.id);

  // The host institution still enters, because entries hang off a championship
  // organisation row even when the competing entity is a unit beneath it.
  const coId = randomUUID();
  await prisma.championship_organizations.create({
    data: {
      id: coId, championship_id: champId, organization_id: org.id,
      applied_by: organiser.id, status: 'approved',
      reviewed_by: organiser.id, reviewed_at: new Date(),
    },
  });
  track('championship_organizations', coId);

  // ---- 3 - setup -----------------------------------------------------------
  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'Campus Grounds', city: 'Bengaluru' } });
  track('venues', venueId);

  const formats = await prisma.tournament_formats.findMany({ select: { id: true, name: true } });
  const knockout = formats.find((f) => /knock|elimin/i.test(f.name))!.id;

  const sports = await prisma.sports.findMany({ select: { id: true, name: true } });
  const disciplines = await prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } });

  const teamRows: any[] = [];
  const teamMemberRows: any[] = [];
  const entryRows: any[] = [];
  const drawIds: string[] = [];

  for (const [i, s] of SPORTS.entries()) {
    const sport = sports.find((x) => x.name === s.sport);
    const disc = disciplines.find((d) => d.sport_id === sport?.id && d.name === s.discipline);
    if (!sport || !disc) { console.log(`  (skipped ${s.sport} / ${s.discipline}: not in the catalogue)`); continue; }

    const tsId = randomUUID();
    await prisma.tournament_sports.create({
      data: { id: tsId, tournament_id: tournamentId, sport_id: sport.id, format_id: knockout, display_order: i },
    });
    track('tournament_sports', tsId);

    const tdId = randomUUID();
    await prisma.tournament_disciplines.create({
      data: {
        id: tdId, tournament_sport_id: tsId, discipline_id: disc.id, format_id: knockout,
        venue_id: venueId, status: 'upcoming', display_order: i,
        squad_min: s.squad, squad_max: s.squad, format_config: {},
      },
    });
    track('tournament_disciplines', tdId);
    drawIds.push(tdId);

    // One squad per department. `org_unit_id` on the team is what makes the standings
    // table show four departments rather than one institution playing itself.
    for (const dept of DEPARTMENTS) {
      const unitId = unitIds.get(dept)!;
      const pool = people.filter((p) => unitOf.get(p.id) === unitId);
      if (pool.length < s.squad) continue;
      const squad = pool.slice(0, s.squad);
      const teamId = randomUUID();
      teamRows.push({
        id: teamId, sport_id: sport.id, organization_id: org.id, org_unit_id: unitId,
        name: `${dept} ${s.sport}`, short_name: dept.slice(0, 3).toUpperCase(), status: 'approved',
      });
      squad.forEach((u, n) => teamMemberRows.push({
        id: randomUUID(), team_id: teamId, user_id: u.id,
        role: n === 0 ? 'captain' : 'player', jersey_number: n + 1, is_active: true,
      }));
      entryRows.push({
        id: randomUUID(), team_id: teamId, organization_id: org.id, championship_id: champId,
        championship_organization_id: coId, tournament_discipline_id: tdId, status: 'approved',
        // THE ENTRY carries the unit, not just the team. team_entries is unique on
        // (championship, draw, organisation, org_unit) - so without this the four
        // departments are one entry from one institution, which is precisely the
        // collapse the contingent model exists to prevent.
        org_unit_id: unitId,
      });
    }
  }

  await prisma.teams.createMany({ data: teamRows });
  track('teams', teamRows.map((t) => t.id));
  await prisma.team_members.createMany({ data: teamMemberRows });
  track('team_members', teamMemberRows.map((m) => m.id));
  await prisma.team_entries.createMany({ data: entryRows });
  track('team_entries', entryRows.map((e) => e.id));

  console.log(`\nIntra championship built: ${drawIds.length} draws · ${DEPARTMENTS.length} departments · ${teamRows.length} squads.`);
  console.log(`URL  /championships/${champId}`);
  console.log(`\nentry_level = 'department', so every result here files under the INTRA tier.`);
  console.log('Play it with qa-all-draws-style scoring, or score a few by hand, then lock.');
  console.log(`\nCleanup: npx tsx scripts/seed-qa-intra.ts cleanup`);
}

const DELETE_ORDER = [
  'team_entries', 'team_members', 'teams',
  'tournament_disciplines', 'tournament_sports', 'tournaments',
  'venues', 'championship_officials', 'user_championship_roles',
  'championship_organizations', 'championships',
  'org_unit_members', 'org_units',
];

async function cleanup() {
  if (!existsSync(MANIFEST)) { console.error('No manifest - nothing to clean up.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  for (const champId of m.championships ?? []) {
    const tds = await prisma.tournament_disciplines.findMany({
      where: { tournament_sports: { tournaments: { championship_id: champId } } },
      select: { id: true },
    });
    const fx = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: { in: tds.map((t) => t.id) } }, select: { id: true },
    });
    if (fx.length) {
      const gone = await purgeFixtureArtefacts(prisma, fx.map((f) => f.id));
      for (const [k, n] of Object.entries(gone)) console.log(`  ${k}: ${n}`);
      await prisma.fixtures.deleteMany({ where: { id: { in: fx.map((f) => f.id) } } });
      console.log(`  fixtures: ${fx.length}`);
    }
    await prisma.standings.deleteMany({ where: { championship_id: champId } }).catch(() => 0);
  }

  for (const table of DELETE_ORDER) {
    const ids = m[table];
    if (!ids?.length) continue;
    const n = await (prisma as any)[table].deleteMany({ where: { id: { in: ids } } });
    console.log(`  ${table}: ${n.count}`);
  }
  rmSync(MANIFEST);
  console.log('\nCleaned up. The QA bench itself is untouched - this only ever added rows.');
}

const cmd = process.argv[2] ?? 'seed';
(cmd === 'cleanup' ? cleanup() : seed())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
