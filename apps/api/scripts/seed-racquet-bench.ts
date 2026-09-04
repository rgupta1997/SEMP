/*
 * THE RACQUET BENCH - one championship, set up, entered, awaiting fixtures.
 *
 *   npx tsx scripts/seed-racquet-bench.ts seed      # build it
 *   npx tsx scripts/seed-racquet-bench.ts logins    # print the logins again
 *   npx tsx scripts/seed-racquet-bench.ts cleanup   # delete EXACTLY what was built
 *
 * WHY. The racquet scoring kernel needs a championship in one specific state to be
 * testable end to end: fully set up, every team entered and approved, and NO
 * FIXTURES YET - because the format picker runs BEFORE the draw is generated, so a
 * championship whose draws are already built cannot exercise it.
 *
 * The two existing benches are the wrong shape for that. seed-iimb.ts and
 * seed-role-bench.ts both generate their draws and play results, which is what they
 * are for; here the interesting moment is the one immediately before.
 *
 * ALSO: the organiser is an account you can actually log in as, and the platform
 * super admin is added as an organiser too. `/championships/mine` is built from
 * event roles, team membership and org membership - being a super admin is none of
 * those, so a platform account opening a championship gets no workspace context and
 * therefore no event sidebar at all. Granting the row is the difference between
 * "I can see the event but there are no tabs" and a usable workspace.
 *
 * TWO RULES, the same two the role bench keeps.
 *
 * 1. IT TOUCHES NOTHING THAT ALREADY EXISTS. Every row is new and recorded by id in
 *    .seed-racquet-bench-manifest.json; cleanup deletes those ids and only those, in
 *    FK order. The global catalogue (sports, disciplines, formats, roles) is READ
 *    and never written.
 * 2. EVERY ROW IS ONE A SCREEN COULD HAVE PRODUCED - inserted in the shape its own
 *    route writes, so nothing here can disagree with the code that normally does it.
 *
 * WHAT IS COVERED. All five racquet sports the kernel scores - table tennis,
 * badminton, tennis, pickleball, squash - across singles and doubles draws, each
 * with 4 or 8 entered squads so both a clean bracket and a bye are reachable.
 * Doubles squads carry exactly two players, which is what the serve resolvers need
 * to name the right partner.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { purgeFixtureArtefacts, purgeUserArtefacts } from './seed-purge.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-racquet-bench-manifest.json');

const PASSWORD = 'Racquet@2026';
const DOMAIN = 'racquet.test';
const TAG = 'Racquet';

// ---------------------------------------------------------------------------
// manifest - saved after every track() so a crash mid-run still cleans up
// ---------------------------------------------------------------------------
type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  save();
};

const day = (d: string, h = 4) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`);

// Sportagon ids are UNIQUE, and a hash-based formula collides with whatever is
// already in the table (the role bench's did). Allocate around the existing set
// instead: read what is taken, then hand out the next free number.
function makeIdAllocator(taken: Set<string>) {
  let n = 9000000;
  return () => {
    let id = '';
    do { id = `EOS-${n}`; n += 1; } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

// ---------------------------------------------------------------------------
// the draws
//
// `size` is how many squads enter. 4 and 8 are powers of two (clean brackets); 6
// deliberately is not, so bye propagation is reachable without editing anything.
// `per` is the squad size - 1 for singles, 2 for doubles - and it matters: the
// doubles serve resolvers name a PARTNER, which needs two people on the row.
// ---------------------------------------------------------------------------
interface Draw {
  key: string;
  sport: string;
  discipline: string;
  format: 'Knockout' | 'League';
  size: number;
  per: number;
}

const DRAWS: Draw[] = [
  // Table tennis - the sport whose 9-point / serve-every-3 Sprint format was the
  // original brief. Eight squads so QF / SF / Final all exist for per-round formats.
  { key: 'tt-ms', sport: 'Table Tennis', discipline: "Men's Singles", format: 'Knockout', size: 8, per: 1 },
  { key: 'tt-md', sport: 'Table Tennis', discipline: "Men's Doubles", format: 'Knockout', size: 4, per: 2 },

  // Badminton - rally serve, score-parity service court, decider switch at 11.
  { key: 'bd-ms', sport: 'Badminton', discipline: "Men's Singles", format: 'Knockout', size: 8, per: 1 },
  { key: 'bd-ws', sport: 'Badminton', discipline: "Women's Singles", format: 'League', size: 4, per: 1 },
  { key: 'bd-xd', sport: 'Badminton', discipline: 'Mixed Doubles', format: 'Knockout', size: 4, per: 2 },

  // Tennis - the nested game/set/match hierarchy and the tie-break substitution.
  // Its doubles discipline is called just "Doubles" in this catalogue, not
  // "Men's Doubles" the way badminton and table tennis name theirs.
  { key: 'tn-ms', sport: 'Tennis', discipline: "Men's Singles", format: 'Knockout', size: 4, per: 1 },
  { key: 'tn-md', sport: 'Tennis', discipline: 'Doubles', format: 'Knockout', size: 4, per: 2 },

  // Pickleball - new to the catalogue in 20260903000010. Side-out vs rally scoring
  // is a FORMAT choice here, which is what makes it worth two draws.
  { key: 'pb-md', sport: 'Pickleball', discipline: "Men's Doubles", format: 'Knockout', size: 4, per: 2 },
  { key: 'pb-xd', sport: 'Pickleball', discipline: 'Mixed Doubles', format: 'League', size: 4, per: 2 },

  // Squash - PARS 11 vs English 9, the pointScoring/movement split. Singles only:
  // the catalogue has no squash doubles discipline.
  { key: 'sq-ms', sport: 'Squash', discipline: "Men's Singles", format: 'Knockout', size: 6, per: 1 },
  { key: 'sq-ws', sport: 'Squash', discipline: "Women's Singles", format: 'League', size: 4, per: 1 },
];

// The institutions entering. One hosts.
const ORGS = [
  { key: 'kbc', name: `${TAG} Kingsbridge College`, short: 'KBC', host: true },
  { key: 'rvu', name: `${TAG} Riverside University`, short: 'RVU', host: false },
  { key: 'ash', name: `${TAG} Ashcroft Institute`, short: 'ASH', host: false },
  { key: 'lmt', name: `${TAG} Lakemont Academy`, short: 'LMT', host: false },
  { key: 'pnv', name: `${TAG} Pinevale School`, short: 'PNV', host: false },
  { key: 'wsd', name: `${TAG} Westdale Polytechnic`, short: 'WSD', host: false },
  { key: 'nhv', name: `${TAG} Northaven Tech`, short: 'NHV', host: false },
  { key: 'shl', name: `${TAG} Shoreline College`, short: 'SHL', host: false },
];

// Named accounts you log in as. Everyone else is a squad body.
const STAFF = [
  { key: 'organiser', name: 'Priya Menon', local: 'organiser', orgKey: 'kbc', role: 'organiser', note: 'Organiser · runs the event, sees Setup + Schedule' },
  { key: 'official', name: 'Rahul Das', local: 'official', orgKey: 'kbc', role: 'official', note: 'Official · scores matches only' },
  { key: 'captain', name: 'Neha Pillai', local: 'captain', orgKey: 'rvu', role: 'captain', note: 'Captain · Riverside squads' },
];

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Vivaan', 'Ananya', 'Ishan', 'Tara',
  'Arnav', 'Kiara', 'Reyansh', 'Myra', 'Advik', 'Anika', 'Shaurya', 'Navya', 'Dhruv', 'Riya'];
const LAST = ['Sharma', 'Reddy', 'Nair', 'Iyer', 'Bose', 'Kulkarni', 'Rao', 'Sequeira', 'Chandra', 'Menon'];

// ---------------------------------------------------------------------------
async function seed() {
  if (existsSync(MANIFEST)) {
    console.error('A manifest already exists - run `cleanup` first, or delete', MANIFEST);
    process.exit(1);
  }
  const run = Math.random().toString(36).slice(2, 9);
  const hash = bcrypt.hashSync(PASSWORD, 10);

  // ---- catalogue reads (never written) -----------------------------------
  const sports = await prisma.sports.findMany({ select: { id: true, name: true } });
  const sportId = new Map(sports.map((s) => [s.name, s.id]));
  const missing = [...new Set(DRAWS.map((d) => d.sport))].filter((s) => !sportId.has(s));
  if (missing.length) {
    console.error(`These sports are not in the catalogue: ${missing.join(', ')}`);
    console.error('Pickleball comes from supabase/migrations/20260903000010_pickleball_sport.sql - apply it first.');
    process.exit(1);
  }

  const disciplines = await prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } });
  const discId = (sport: string, name: string) => {
    const d = disciplines.find((x) => x.sport_id === sportId.get(sport) && x.name === name);
    if (!d) {
      const have = disciplines.filter((x) => x.sport_id === sportId.get(sport)).map((x) => x.name);
      throw new Error(`No discipline "${name}" under ${sport}. Available: ${have.join(' | ')}`);
    }
    return d.id;
  };

  const formats = await prisma.tournament_formats.findMany({ select: { id: true, name: true } });
  const formatId = (name: string) => {
    // Format names vary by installation ("Knockout" / "Single Elimination"), so match
    // loosely rather than assuming one spelling and failing at insert time.
    const f = formats.find((x) => x.name.toLowerCase().includes(name.toLowerCase()))
      ?? formats.find((x) => /knock|elimin/i.test(x.name));
    if (!f) throw new Error(`No tournament format matching "${name}". Available: ${formats.map((x) => x.name).join(', ')}`);
    return f.id;
  };

  const roles = await prisma.roles.findMany({ select: { id: true, code: true } });
  const roleId = (code: string) => {
    const r = roles.find((x) => x.code === code);
    if (!r) throw new Error(`No role with code "${code}"`);
    return r.id;
  };

  // EVERY super admin, not the first one found. There is more than one platform
  // account on this database, and granting the row to whichever came back first
  // left the others with no workspace context - the exact "I can see the event but
  // there are no tabs" symptom this block exists to prevent.
  const superAdmins = await prisma.users.findMany({
    where: { is_super_admin: true }, select: { id: true, name: true, email: true },
  });

  const takenIds = new Set(
    (await prisma.users.findMany({ where: { sportagon_id: { not: null } }, select: { sportagon_id: true } }))
      .map((u) => u.sportagon_id!),
  );
  const nextSportagonId = makeIdAllocator(takenIds);

  // ---- 1 · institutions ---------------------------------------------------
  const orgIds = new Map<string, string>();
  const orgRows = ORGS.map((o) => {
    const id = randomUUID();
    orgIds.set(o.key, id);
    // `kind`, not `type`, and the check constraint allows only
    // community | institution | personal - a college is an 'institution'.
    return { id, name: o.name, short_name: o.short, kind: 'institution', city: 'Bengaluru', country: 'India', verified: true };
  });
  await prisma.organizations.createMany({ data: orgRows });
  track('organizations', orgRows.map((o) => o.id));

  // ---- 2 · people ---------------------------------------------------------
  const userIds = new Map<string, string>();
  const userRows: any[] = [];
  let seq = 0;
  const addUser = (name: string, local: string, orgKey: string | null) => {
    const id = randomUUID();
    seq += 1;
    userRows.push({
      id, name, email: `${local}@${DOMAIN}`, password_hash: hash,
      // Phones are unique too; the 6xxx range keeps these clear of the seeded
      // 9xxx personas the other benches use.
      phone: `6${String(100000000 + seq).slice(0, 9)}`,
      organization_id: orgKey ? orgIds.get(orgKey)! : null,
      account_type: 'institution', sportagon_id: nextSportagonId(),
      email_verified_at: new Date(),
    });
    return id;
  };

  for (const s of STAFF) userIds.set(s.key, addUser(s.name, s.local, s.orgKey));

  // Squad bodies: enough per institution to fill every draw it enters.
  const bodiesPerOrg = 14;
  const bodies = new Map<string, string[]>();
  for (const o of ORGS) {
    const list: string[] = [];
    for (let i = 0; i < bodiesPerOrg; i++) {
      const name = `${FIRST[(i + ORGS.indexOf(o) * 3) % FIRST.length]} ${LAST[(i + ORGS.indexOf(o)) % LAST.length]}`;
      list.push(addUser(name, `${o.key}.p${i + 1}`, o.key));
    }
    bodies.set(o.key, list);
  }
  await prisma.users.createMany({ data: userRows });
  track('users', userRows.map((u) => u.id));

  // Memberships. The staff and every squad body belong to their institution.
  const memberRows = userRows
    .filter((u) => u.organization_id)
    .map((u) => ({
      id: randomUUID(), organization_id: u.organization_id, user_id: u.id,
      // ONLY the organiser is an org admin. The official and the captain are plain
      // members, because `managesChampionship` falls back to "admin of the HOST
      // organisation" - so making the official an admin silently handed them
      // organiser authority, and an official could lock results. Caught by the
      // backend E2E asserting that an official CANNOT lock.
      role: userIds.get('organiser') === u.id ? 'admin' : 'member',
      status: 'active', verification: 'verified', joined_at: new Date(),
    }));
  await prisma.organization_members.createMany({ data: memberRows });
  track('organization_members', memberRows.map((m) => m.id));

  // ---- 3 · the championship ----------------------------------------------
  // Screen: Create event wizard. `ongoing` because scoring is blocked until the
  // championship is under way - a draft one cannot be tested at all.
  const champId = randomUUID();
  await prisma.championships.create({
    data: {
      id: champId,
      name: `${TAG} Bench · Racquet Open 2026`,
      slug: `racquet-bench-${run}`,
      description: 'Racquet scoring bench. Fully set up, every squad entered and approved, NO fixtures yet - so the format picker runs before the draw. Safe to delete with the seed cleanup.',
      venue: 'Kingsbridge Indoor Centre, Bengaluru',
      start_date: day('2026-09-20'), end_date: day('2026-09-24'),
      status: 'ongoing', visibility: 'public', type: 'inter_college',
      country: 'India', region: 'asia', allow_individual_entry: true,
      entry_level: 'organization',
      host_organization_id: orgIds.get('kbc')!,
    },
  });
  track('championships', champId);

  // ---- 4 · entries (Discover › Enter, then Approvals) --------------------
  const entryRows = ORGS.map((o) => ({
    id: randomUUID(), championship_id: champId, organization_id: orgIds.get(o.key)!,
    applied_by: userIds.get('organiser')!,
    status: 'approved', reviewed_by: userIds.get('organiser')!, reviewed_at: new Date(),
  }));
  await prisma.championship_organizations.createMany({ data: entryRows });
  track('championship_organizations', entryRows.map((e) => e.id));
  const entryByOrg = new Map(entryRows.map((e) => [e.organization_id, e.id]));

  // ---- 5 · event roles ---------------------------------------------------
  // Screen: Organisers / Officials. The super admin gets an organiser row too:
  // /championships/mine is built from event roles, team membership and org
  // membership, and being a platform admin is none of those - so without this a
  // super admin opening the event gets the PERSONAL sidebar and no event tabs.
  const ucrRows = STAFF.map((s) => ({
    id: randomUUID(), user_id: userIds.get(s.key)!, championship_id: champId, role_id: roleId(s.role),
  }));
  for (const sa of superAdmins) {
    ucrRows.push({
      id: randomUUID(), user_id: sa.id, championship_id: champId, role_id: roleId('organiser'),
    });
  }
  await prisma.user_championship_roles.createMany({ data: ucrRows });
  track('user_championship_roles', ucrRows.map((r) => r.id));

  const officialRow = {
    id: randomUUID(), championship_id: champId, user_id: userIds.get('official')!, is_active: true,
  };
  await prisma.championship_officials.create({ data: officialRow });
  track('championship_officials', officialRow.id);

  // ---- 6 · setup (Event setup › Sports, Venues) --------------------------
  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'Kingsbridge Indoor Centre', city: 'Bengaluru' } });
  track('venues', venueId);

  const groundRows = ['Court 1', 'Court 2', 'Table Hall', 'Squash Court A']
    .map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: groundRows });
  track('venue_grounds', groundRows.map((g) => g.id));

  const tsIds = new Map<string, string>();
  const tsRows = [...new Set(DRAWS.map((d) => d.sport))].map((sport, i) => {
    const id = randomUUID();
    tsIds.set(sport, id);
    const first = DRAWS.find((x) => x.sport === sport)!;
    return { id, tournament_id: tournamentId, sport_id: sportId.get(sport)!, format_id: formatId(first.format), display_order: i };
  });
  await prisma.tournament_sports.createMany({ data: tsRows });
  track('tournament_sports', tsRows.map((t) => t.id));

  // The draws themselves. format_config is left EMPTY on purpose: no scoring
  // template, no stage tree. That is the state the racquet kernel resolves from -
  // it falls through the ladder to the sport default, which is now a real published
  // format rather than the generic counter it used to be.
  const drawIds = new Map<string, string>();
  const tdRows = DRAWS.map((d, i) => {
    const id = randomUUID();
    drawIds.set(d.key, id);
    return {
      id, tournament_sport_id: tsIds.get(d.sport)!,
      discipline_id: discId(d.sport, d.discipline),
      format_id: formatId(d.format), venue_id: venueId,
      status: 'upcoming', display_order: i,
      // entry_type is LEFT NULL on purpose, which is what 169 of the 180 existing
      // draws do (only 7 say 'team' and 4 say 'individual'; nothing says 'doubles').
      //
      // It is not the squad shape - that is `disciplines.entry_type`, a different
      // column with the same name. On tournament_disciplines the UI reads it as a
      // DISPLAY signal: ResultsPage does `individual = entry_type === 'individual'`
      // and then renders "Ranking event" with no team chips and no score. Setting it
      // to 'individual' for a singles knockout therefore told the product these were
      // multi-competitor ranking events, and a Men's Singles QF between two real
      // squads rendered with no opponents and no scoreline.
      //
      // Roster size is carried by squad_min / squad_max, which is what actually
      // constrains a singles or doubles entry.
      squad_min: d.per, squad_max: d.per,
      format_config: {},
    };
  });
  await prisma.tournament_disciplines.createMany({ data: tdRows });
  track('tournament_disciplines', tdRows.map((t) => t.id));

  await prisma.standings_rules.create({
    data: {
      id: randomUUID(), championship_id: champId, scope_type: 'championship', scope_id: null,
      // Draws are allowed on this bench (a clocked racquet match can end level), so
      // the rule carries a draw value rather than leaving one match unscoreable.
      config: { scheme: 'league_points', win: 3, draw: 1, loss: 0, participation: 0, tiebreakers: ['points', 'wins', 'score_diff'] },
    },
  }).then((r) => track('standings_rules', r.id));

  // ---- 7 · squads, entered and approved ----------------------------------
  // Screen: My Team › Create squad, then Enter discipline. Every one is approved,
  // so the draw is generatable the moment you open Schedule.
  const teamRows: any[] = [];
  const teamMemberRows: any[] = [];
  const teamEntryRows: any[] = [];

  for (const d of DRAWS) {
    // Which institutions enter this draw - the first `size` of them, so a draw of 4
    // and a draw of 8 share entrants and the fixtures are not all the same pairing.
    const entrants = ORGS.slice(0, d.size);
    for (const [n, o] of entrants.entries()) {
      const pool = bodies.get(o.key)!;
      // Offset the slice per draw so the same person is not in every squad, and a
      // doubles pair is two DIFFERENT people (which the serve resolvers need).
      const start = (DRAWS.indexOf(d) * 2) % (bodiesPerOrg - d.per);
      const squad = pool.slice(start, start + d.per);
      const teamId = randomUUID();
      teamRows.push({
        id: teamId, sport_id: sportId.get(d.sport)!, organization_id: orgIds.get(o.key)!,
        name: `${o.short} ${d.discipline}`,
        short_name: `${o.short}`,
        // teams_status_check allows forming | submitted | approved | roster_locked.
        // 'approved' is the state a squad reaches once the organiser accepts it,
        // which is what "entered and awaiting fixtures" means.
        status: 'approved',
      });
      squad.forEach((uid, i) => {
        teamMemberRows.push({
          id: randomUUID(), team_id: teamId, user_id: uid,
          role: i === 0 ? 'captain' : 'player', jersey_number: i + 1, is_active: true,
        });
      });
      // The named captain leads Riverside's squads, so a captain login has something.
      if (o.key === 'rvu') {
        teamMemberRows.push({
          id: randomUUID(), team_id: teamId, user_id: userIds.get('captain')!,
          role: 'captain', jersey_number: 9, is_active: true,
        });
      }
      teamEntryRows.push({
        id: randomUUID(), team_id: teamId, organization_id: orgIds.get(o.key)!, championship_id: champId,
        championship_organization_id: entryByOrg.get(orgIds.get(o.key)!)!,
        tournament_discipline_id: drawIds.get(d.key)!, status: 'approved',
      });
      void n;
    }
  }
  await prisma.teams.createMany({ data: teamRows });
  track('teams', teamRows.map((t) => t.id));
  await prisma.team_members.createMany({ data: teamMemberRows });
  track('team_members', teamMemberRows.map((m) => m.id));
  await prisma.team_entries.createMany({ data: teamEntryRows });
  track('team_entries', teamEntryRows.map((e) => e.id));

  // ---- 8 · NO FIXTURES ---------------------------------------------------
  // Deliberate, and the whole point of this bench. The format picker runs BEFORE
  // generation, so a draw that already has fixtures cannot exercise it.

  console.log(`\n${TAG} bench built.\n`);
  await printLogins(champId, superAdmins);
  console.log('\nEvery draw is set up, entered and APPROVED, with no fixtures.');
  console.log('Open Schedule on any draw and press "Generate draw" to meet the format picker.');
  console.log(`\nCleanup: npx tsx scripts/seed-racquet-bench.ts cleanup`);
}

async function printLogins(champId: string, superAdmins: Array<{ name: string; email: string | null }>) {
  const ch = await prisma.championships.findUnique({
    where: { id: champId },
    select: {
      id: true, name: true, slug: true,
      tournaments: {
        select: {
          tournament_sports: {
            select: {
              sports: { select: { name: true } },
              tournament_disciplines: {
                select: { id: true, disciplines: { select: { name: true } }, _count: { select: { team_entries: true, fixtures: true } } },
                orderBy: { display_order: 'asc' },
              },
            },
          },
        },
      },
    },
  });
  if (!ch) return;
  console.log(`CHAMPIONSHIP  ${ch.name}`);
  console.log(`URL           /championships/${ch.id}`);
  console.log(`\nLOGINS (password for all: ${PASSWORD})`);
  for (const s of STAFF) console.log(`  ${`${s.local}@${DOMAIN}`.padEnd(28)} ${s.name.padEnd(16)} ${s.note}`);
  for (const sa of superAdmins) {
    console.log(`  ${(sa.email ?? '(super admin)').padEnd(28)} ${sa.name.padEnd(16)} super admin · also granted Organiser here, so the event sidebar works`);
  }
  console.log('\nDRAWS (all awaiting fixtures)');
  for (const ts of ch.tournaments.flatMap((t) => t.tournament_sports)) {
    for (const td of ts.tournament_disciplines) {
      console.log(`  ${(ts.sports?.name ?? '?').padEnd(14)} ${(td.disciplines?.name ?? '-').padEnd(18)} ${String(td._count.team_entries).padStart(2)} squads · ${td._count.fixtures} fixtures · td=${td.id}`);
    }
  }
}

// ---------------------------------------------------------------------------
// cleanup - the manifest ids only, in FK order
// ---------------------------------------------------------------------------
const DELETE_ORDER = [
  'team_entries', 'team_members', 'teams',
  'standings_rules', 'tournament_disciplines', 'tournament_sports', 'tournaments',
  'venue_grounds', 'venues',
  'championship_officials', 'user_championship_roles', 'championship_organizations',
  'championships',
  'organization_members', 'users', 'organizations',
];

async function cleanup() {
  if (!existsSync(MANIFEST)) {
    console.error('No manifest at', MANIFEST, '- nothing to clean up.');
    process.exit(1);
  }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  // Anything the app wrote on top of the seeded rows (fixtures from a generate you
  // tried, stat lines from a lock) is not in the manifest, so remove it by parentage
  // first or the deletes below hit foreign keys.
  const champIds = m.championships ?? [];
  if (champIds.length) {
    const tds = await prisma.tournament_disciplines.findMany({
      where: { tournament_sports: { tournaments: { championship_id: { in: champIds } } } },
      select: { id: true },
    });
    const tdIds = tds.map((t) => t.id);
    if (tdIds.length) {
      const fx = await prisma.fixtures.findMany({ where: { tournament_discipline_id: { in: tdIds } }, select: { id: true } });
      const fxIds = fx.map((f) => f.id);
      if (fxIds.length) {
        // Everything the app wrote for these fixtures - stat lines, innings,
        // awards, timeline entries. The typed per-category tables cascade from
        // player_match_stats, so removing it clears those with it.
        const fxGone = await purgeFixtureArtefacts(prisma, fxIds);
        for (const [k, n] of Object.entries(fxGone)) console.log(`  ${k}: ${n}`);
        await prisma.fixtures.deleteMany({ where: { id: { in: fxIds } } });
        console.log(`  fixtures (created after seeding): ${fxIds.length}`);
      }
      await prisma.$executeRaw`update tournament_disciplines set scoring_format_id = null where id = any(${tdIds}::uuid[])`.catch(() => 0);
    }
    await prisma.standings.deleteMany({ where: { championship_id: { in: champIds } } }).catch(() => 0);
    await prisma.$executeRaw`delete from scoring_formats where organization_id = any(
      select id from organizations where name like ${`${TAG}%`})`.catch(() => 0);
  }

  // The app also writes rows keyed by the seeded USERS - a locked result puts an
  // entry on every participant's lifetime timeline, and career stats and
  // achievements alongside it. None of those are in the manifest, so without this
  // the users delete below fails on a foreign key and the bench becomes
  // undeletable. That is exactly what happened the first time this bench was used.
  if (m.users?.length) {
    const gone = await purgeUserArtefacts(prisma, m.users);
    for (const [k, n] of Object.entries(gone)) console.log(`  ${k}: ${n}`);
  }

  for (const table of DELETE_ORDER) {
    const ids = m[table];
    if (!ids?.length) continue;
    const n = await (prisma as any)[table].deleteMany({ where: { id: { in: ids } } });
    console.log(`  ${table}: ${n.count}`);
  }
  rmSync(MANIFEST);
  console.log('\nCleaned up.');
}

// ---------------------------------------------------------------------------
const cmd = process.argv[2] ?? 'seed';
const run = async () => {
  if (cmd === 'seed') return seed();
  if (cmd === 'cleanup') return cleanup();
  if (cmd === 'logins') {
    if (!existsSync(MANIFEST)) { console.error('No manifest - seed first.'); process.exit(1); }
    const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const sa = await prisma.users.findMany({ where: { is_super_admin: true }, select: { name: true, email: true } });
    return printLogins(m.championships![0], sa);
  }
  console.error(`Unknown command "${cmd}". Use seed | logins | cleanup.`);
  process.exit(1);
};

run()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
