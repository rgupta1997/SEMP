/*
 * THE QA BENCH - Claude's own championship, for end-to-end testing.
 *
 * SEPARATE FROM seed-all-sports-bench.ts ON PURPOSE. That one is the user's to
 * test on and must not be disturbed; this one gets driven through the whole
 * lifecycle - generate, score, submit, lock, unlock - which mutates it heavily.
 * Different tag, different domain, different manifest, so cleanup of one cannot
 * touch the other.
 *
 * SIX DRAWS, chosen to cover every code path rather than every sport:
 *   racquet singles  - the rally kernel, serve rotation, deuce
 *   racquet doubles  - the pairing / partner resolvers
 *   net (team)       - period deck, sets, per-player attribution
 *   invasion (team)  - clock-terminated halves, aggregate scoring, cards
 *   cricket          - its own engine, ball-by-ball, three stat tables
 *   board (chess)    - a single-unit result with a colour
 *
 *   npx tsx scripts/seed-qa-bench.ts seed      # build it
 *   npx tsx scripts/seed-qa-bench.ts logins    # print the logins again
 *   npx tsx scripts/seed-qa-bench.ts cleanup   # delete EXACTLY what was built
 *
 * WHY. seed-racquet-bench.ts put five sports in the one state the format picker can
 * be tested from: fully set up, every squad entered and approved, and NO FIXTURES
 * YET - because the picker runs BEFORE the draw is generated. That worked, and now
 * there are formats for twenty-seven sports and three families of engine. This is
 * the same bench widened to all of them.
 *
 * THE DRAWS ARE READ FROM THE CATALOGUE, NOT LISTED HERE. That is the important
 * difference from the racquet bench, and it is not tidiness - it is the fix for the
 * failure that bench hit four times. A hardcoded list said Tennis "Men's Doubles"
 * (the catalogue calls it "Doubles"), and Squash "Men's Doubles" (which does not
 * exist at all), and each one failed at insert time after half the rows were in.
 * Reading the disciplines that ARE there cannot be wrong about them.
 *
 * WHICH SPORTS. Every sport `isScoredSport` covers - the rally kernel's six families
 * plus cricket's own engine. The ten measured sports (athletics, swimming,
 * powerlifting, weightlifting, cycling, rowing, archery, shooting, gymnastics, yoga)
 * are deliberately absent: they have no head-to-head match and no scoring format, so
 * a knockout draw for them would be a lie. They are covered by the Rankings path.
 *
 * TWO RULES, the same two the racquet and role benches keep.
 *
 * 1. IT TOUCHES NOTHING THAT ALREADY EXISTS. Every row is new and recorded by id in
 *    .seed-qa-manifest.json; cleanup deletes those ids and only those, in FK
 *    order. The global catalogue (sports, disciplines, formats, roles) is READ and
 *    never written.
 * 2. EVERY ROW IS ONE A SCREEN COULD HAVE PRODUCED - inserted in the shape its own
 *    route writes, so nothing here can disagree with the code that normally does it.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { purgeFixtureArtefacts, purgeUserArtefacts } from './seed-purge.js';
import { isCricketSport, isScoredSport, matchPresetsFor } from '@semp/shared';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-qa-manifest.json');

const PASSWORD = 'Qa@2026';
const DOMAIN = 'qa.test';
const TAG = 'QA';

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
// already in the table. Allocate around the existing set instead.
function makeIdAllocator(taken: Set<string>) {
  let n = 9500000;
  return () => {
    let id = '';
    do { id = `EOS-${n}`; n += 1; } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

interface Catalogued {
  name: string;
  sportId: string;
  disciplineId: string;
  /** individual | doubles | team | relay, from `disciplines.entry_type`. */
  shape: string;
  squad: number;
}

interface Draw extends Catalogued {
  key: string;
  discipline: string;
  format: 'Knockout' | 'League';
  /** How many institutions enter. */
  size: number;
}

// The institutions entering. One hosts. Eight, so a draw of 8 is reachable.
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

const STAFF = [
  { key: 'organiser', name: 'Priya Menon', local: 'organiser', orgKey: 'kbc', role: 'organiser', note: 'Organiser · runs the event, sees Setup + Schedule' },
  { key: 'official', name: 'Rahul Das', local: 'official', orgKey: 'kbc', role: 'official', note: 'Official · scores matches only' },
  { key: 'captain', name: 'Neha Pillai', local: 'captain', orgKey: 'rvu', role: 'captain', note: 'Captain · Riverside squads' },
];

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Vivaan', 'Ananya', 'Ishan', 'Tara',
  'Arnav', 'Kiara', 'Reyansh', 'Myra', 'Advik', 'Anika', 'Shaurya', 'Navya', 'Dhruv', 'Riya',
  'Aditya', 'Pari', 'Vihaan', 'Aadhya', 'Sai', 'Zara', 'Arjun', 'Ira'];
const LAST = ['Sharma', 'Reddy', 'Nair', 'Iyer', 'Bose', 'Kulkarni', 'Rao', 'Sequeira', 'Chandra', 'Menon',
  'Verma', 'Patel', 'Ghosh', 'Pillai'];

/**
 * The biggest squad any draw needs, so every institution has enough bodies.
 *
 * Cricket and football want eleven. Slicing a distinct window per draw on top of
 * that is what stops the same person appearing in every squad, so the pool has to be
 * comfortably larger than the largest squad rather than exactly as large.
 */
const BODIES_PER_ORG = 26;

/**
 * Which sports this bench carries. One per family, so every engine and every
 * console is exercised without 65 draws to walk through by hand.
 */
const ONLY = new Map<string, string[]>([
  ['Table Tennis', ["Men's Singles", "Men's Doubles"]],
  ['Volleyball', ["Men's"]],
  ['Football', ["Men's"]],
  ['Cricket', ["Men's"]],
  ['Chess', ['Standard']],
]);

/**
 * QA_ALL=1 drops the shortlist and takes the WHOLE catalogue.
 *
 * The six-draw default is the fast bench - one draw per scoring engine, which
 * covers every code path. It does NOT cover every sport's console screen, and
 * those are twenty-seven different screens with twenty-seven different shelves.
 * This flag builds the full set so each one can be opened in a browser, without
 * needing a second seed script that would drift from this one.
 */
const ALL = process.env.QA_ALL === '1';
const MAX_SQUAD = 12;

/**
 * Which disciplines of a sport are worth a draw.
 *
 * Two kinds of row are filtered out, and both would otherwise produce a draw nobody
 * wants:
 *
 *   * "Whole sport" is the aggregate placeholder the medal tally hangs off, not a
 *     competition anybody enters.
 *   * several sports carry BOTH a specific discipline ("Men's", squad 11-15) and a
 *     generic duplicate ("Men", squad 1-15) left over from an earlier import. The
 *     generic one has no real squad range, so a cricket draw built on it would
 *     accept a one-person team.
 */
function pickDisciplines(
  all: Array<{ id: string; name: string; entry_type: string; squad_min: number; squad_max: number }>,
): typeof all {
  const real = all.filter((d) => !/^whole sport$/i.test(d.name));
  // A team row spanning the full 1-15 default is the generic kind. Drop it only when
  // the sport has something more specific - some sports have nothing else.
  const specific = real.filter((d) => !(d.entry_type === 'team' && d.squad_min <= 1 && d.squad_max >= 15));
  const chosen = specific.length ? specific : real;
  // Deduplicate by name, case- and apostrophe-insensitively: the catalogue holds
  // both "Men's" and "Men" for several sports, and both "4x100m" and "4×100m".
  const seen = new Set<string>();
  return chosen.filter((d) => {
    const k = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
async function seed() {
  if (existsSync(MANIFEST)) {
    console.error('A manifest already exists - run `cleanup` first, or delete', MANIFEST);
    process.exit(1);
  }
  const run = Math.random().toString(36).slice(2, 9);
  const hash = bcrypt.hashSync(PASSWORD, 10);

  // ---- catalogue reads (never written) -----------------------------------
  const sports = await prisma.sports.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const disciplines = await prisma.disciplines.findMany({
    select: { id: true, name: true, sport_id: true, entry_type: true, squad_min: true, squad_max: true },
    orderBy: { display_order: 'asc' },
  });

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

  // ---- build the draw list FROM THE CATALOGUE ----------------------------
  const DRAWS: Draw[] = [];
  const skipped: string[] = [];
  let n = 0;
  for (const s of sports) {
    if (!isScoredSport(s.name)) { skipped.push(s.name); continue; }
    const want = ONLY.get(s.name);
    if (!ALL && !want) continue;
    const picked = pickDisciplines(disciplines.filter((d) => d.sport_id === s.id))
      .filter((d) => ALL || want!.includes(d.name));
    if (!picked.length) { skipped.push(`${s.name} (no disciplines)`); continue; }
    for (const d of picked) {
      n += 1;
      const squad = Math.max(1, Math.min(MAX_SQUAD, d.squad_min || 1));
      DRAWS.push({
        key: `d${n}`,
        name: s.name,
        sportId: s.id,
        disciplineId: d.id,
        discipline: d.name,
        shape: d.entry_type,
        squad,
        // Mostly knockouts, because that is what the per-round format editor is for
        // (QF / SF / Final). Every fourth draw is a league so the round-robin
        // generator and the standings table are on the bench too.
        // One league in six so the round-robin generator and the standings table
        // are on the bench too; the rest knockouts for the per-round format editor.
        format: n % 6 === 3 ? 'League' : 'Knockout',
        // 8 entrants gives a full R8 -> QF -> SF -> Final ladder; 6 is deliberately
        // not a power of two, so bye propagation is reachable; 4 keeps the volume
        // down for the rest.
        // 4 everywhere: a clean SF + Final bracket on every draw. Byes are
        // covered on the user's bench, which has draws of 6.
        size: 4,
      });
    }
  }

  if (!DRAWS.length) {
    console.error('No scored sports found in the catalogue - nothing to build.');
    process.exit(1);
  }

  const takenIds = new Set(
    (await prisma.users.findMany({ where: { sportagon_id: { not: null } }, select: { sportagon_id: true } }))
      .map((u) => u.sportagon_id!),
  );
  const nextSportagonId = makeIdAllocator(takenIds);

  // EVERY super admin, not the first one found. /championships/mine is built from
  // event roles, team membership and org membership, and being a platform admin is
  // none of those - so without an event role a super admin opening the event gets
  // the PERSONAL sidebar and no event tabs at all.
  const superAdmins = await prisma.users.findMany({
    where: { is_super_admin: true }, select: { id: true, name: true, email: true },
  });

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
      // Phones are unique too; the 63xx range keeps these clear of both the 9xxx
      // seeded personas and the racquet bench's 6100-6199.
      phone: `63${String(10000000 + seq).slice(0, 8)}`,
      organization_id: orgKey ? orgIds.get(orgKey)! : null,
      account_type: 'institution', sportagon_id: nextSportagonId(),
      email_verified_at: new Date(),
    });
    return id;
  };

  for (const s of STAFF) userIds.set(s.key, addUser(s.name, s.local, s.orgKey));

  const bodies = new Map<string, string[]>();
  for (const [oi, o] of ORGS.entries()) {
    const list: string[] = [];
    for (let i = 0; i < BODIES_PER_ORG; i++) {
      const name = `${FIRST[(i + oi * 3) % FIRST.length]} ${LAST[(i + oi) % LAST.length]}`;
      list.push(addUser(name, `${o.key}.p${i + 1}`, o.key));
    }
    bodies.set(o.key, list);
  }
  await prisma.users.createMany({ data: userRows });
  track('users', userRows.map((u) => u.id));

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
      name: ALL ? `${TAG} Bench · Claude QA All Sports 2026` : `${TAG} Bench · Claude QA Games 2026`,
      slug: `qa-bench-${run}`,
      description: `Every scored sport on one bench: ${DRAWS.length} draws across ${new Set(DRAWS.map((d) => d.name)).size} sports, fully set up, every squad entered and approved, NO fixtures yet - so the format picker runs before the draw. Safe to delete with the seed cleanup.`,
      venue: 'Kingsbridge Sports Complex, Bengaluru',
      start_date: day('2026-10-05'), end_date: day('2026-10-18'),
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
  const ucrRows = STAFF.map((s) => ({
    id: randomUUID(), user_id: userIds.get(s.key)!, championship_id: champId, role_id: roleId(s.role),
  }));
  for (const sa of superAdmins) {
    ucrRows.push({ id: randomUUID(), user_id: sa.id, championship_id: champId, role_id: roleId('organiser') });
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
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'Kingsbridge Sports Complex', city: 'Bengaluru' } });
  track('venues', venueId);

  const groundRows = ['Main Ground', 'Cricket Oval', 'Indoor Hall A', 'Indoor Hall B',
    'Court 1', 'Court 2', 'Table Hall', 'Squash Court A', 'Mat Room', 'Pool Deck']
    .map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: groundRows });
  track('venue_grounds', groundRows.map((g) => g.id));

  const tsIds = new Map<string, string>();
  const tsRows = [...new Set(DRAWS.map((d) => d.name))].map((sport, i) => {
    const id = randomUUID();
    tsIds.set(sport, id);
    const first = DRAWS.find((x) => x.name === sport)!;
    return { id, tournament_id: tournamentId, sport_id: first.sportId, format_id: formatId(first.format), display_order: i };
  });
  await prisma.tournament_sports.createMany({ data: tsRows });
  track('tournament_sports', tsRows.map((t) => t.id));

  // The draws themselves. format_config is left EMPTY on purpose: no scoring
  // template, no stage tree. That is the state the ladder resolves from - it falls
  // through to the sport default, which for all 27 of these is now a real published
  // format rather than the generic counter it used to be.
  const drawIds = new Map<string, string>();
  const tdRows = DRAWS.map((d, i) => {
    const id = randomUUID();
    drawIds.set(d.key, id);
    return {
      id, tournament_sport_id: tsIds.get(d.name)!,
      discipline_id: d.disciplineId,
      format_id: formatId(d.format), venue_id: venueId,
      status: 'upcoming', display_order: i,
      // entry_type is LEFT NULL on purpose, which is what 169 of the 180 existing
      // draws do. It is NOT the squad shape - that is `disciplines.entry_type`, a
      // different column with the same name. On tournament_disciplines the UI reads
      // it as a DISPLAY signal: ResultsPage does `individual = entry_type ===
      // 'individual'` and then renders "Ranking event" with no team chips and no
      // score. Setting it for a singles knockout told the product these were
      // multi-competitor ranking events, and a Men's Singles QF between two real
      // squads rendered with no opponents and no scoreline.
      squad_min: d.squad, squad_max: d.squad,
      format_config: {},
    };
  });
  await prisma.tournament_disciplines.createMany({ data: tdRows });
  track('tournament_disciplines', tdRows.map((t) => t.id));

  await prisma.standings_rules.create({
    data: {
      id: randomUUID(), championship_id: champId, scope_type: 'championship', scope_id: null,
      // Draws are allowed on this bench - a clocked football half and a Test match
      // can both legitimately end level - so the rule carries a draw value rather
      // than leaving those matches unscoreable.
      config: { scheme: 'league_points', win: 3, draw: 1, loss: 0, participation: 0, tiebreakers: ['points', 'wins', 'score_diff'] },
    },
  }).then((r) => track('standings_rules', r.id));

  // ---- 7 · squads, entered and approved ----------------------------------
  // Screen: My Team › Create squad, then Enter discipline. Every one is approved,
  // so the draw is generatable the moment you open Schedule.
  const teamRows: any[] = [];
  const teamMemberRows: any[] = [];
  const teamEntryRows: any[] = [];

  for (const [di, d] of DRAWS.entries()) {
    const entrants = ORGS.slice(0, d.size);
    for (const o of entrants) {
      const pool = bodies.get(o.key)!;
      // A distinct window per draw, so the same person is not in every squad and a
      // doubles pair is two DIFFERENT people (which the serve resolvers need to name
      // the right partner). Wrapped, because there are more draws than bodies.
      const room = Math.max(1, BODIES_PER_ORG - d.squad);
      const start = (di * 3) % room;
      const squad = pool.slice(start, start + d.squad);
      // The named captain LEADS Riverside's squads by taking the first slot, rather
      // than being added on top of a full roster. Adding one made every RVU squad
      // squad_min + 1, which on a singles draw is a two-person entry - and the
      // racquet pairing reads two names on a side as DOUBLES, so a Men's Singles
      // match would have been scored with a partner.
      if (o.key === 'rvu') squad[0] = userIds.get('captain')!;
      const teamId = randomUUID();
      teamRows.push({
        id: teamId, sport_id: d.sportId, organization_id: orgIds.get(o.key)!,
        // The sport is in the name because one institution now fields squads in
        // twenty-seven of them, and "KBC Men's" alone would appear a dozen times.
        name: `${o.short} ${d.name} ${d.discipline}`.slice(0, 90),
        short_name: o.short,
        // teams_status_check allows forming | submitted | approved | roster_locked.
        status: 'approved',
      });
      squad.forEach((uid, i) => {
        teamMemberRows.push({
          id: randomUUID(), team_id: teamId, user_id: uid,
          role: i === 0 ? 'captain' : 'player', jersey_number: i + 1, is_active: true,
        });
      });
      teamEntryRows.push({
        id: randomUUID(), team_id: teamId, organization_id: orgIds.get(o.key)!, championship_id: champId,
        championship_organization_id: entryByOrg.get(orgIds.get(o.key)!)!,
        tournament_discipline_id: drawIds.get(d.key)!, status: 'approved',
      });
    }
  }
  // Chunked: createMany with a couple of thousand rows in one statement exceeds what
  // the pooled connection will take.
  const chunk = <T>(xs: T[], n = 500) =>
    Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

  for (const part of chunk(teamRows)) await prisma.teams.createMany({ data: part });
  track('teams', teamRows.map((t) => t.id));
  for (const part of chunk(teamMemberRows)) await prisma.team_members.createMany({ data: part });
  track('team_members', teamMemberRows.map((m) => m.id));
  for (const part of chunk(teamEntryRows)) await prisma.team_entries.createMany({ data: part });
  track('team_entries', teamEntryRows.map((e) => e.id));

  // ---- 8 · NO FIXTURES ---------------------------------------------------
  // Deliberate, and the whole point of this bench. The format picker runs BEFORE
  // generation, so a draw that already has fixtures cannot exercise it.

  console.log(`\n${TAG} bench built: ${DRAWS.length} draws · ${new Set(DRAWS.map((d) => d.name)).size} sports · ${teamRows.length} squads · ${teamMemberRows.length} squad places.\n`);
  if (skipped.length) {
    console.log(`Not included (no scoring format - these are the measured sports, covered by the Rankings path):`);
    console.log(`  ${skipped.join(', ')}\n`);
  }
  await printLogins(champId, superAdmins);
  console.log('\nEvery draw is set up, entered and APPROVED, with no fixtures.');
  console.log('Open Schedule on any draw and press "Generate draw" to meet the format picker.');
  console.log(`\nCleanup: npx tsx scripts/seed-qa-bench.ts cleanup`);
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
              display_order: true,
              sports: { select: { name: true } },
              tournament_disciplines: {
                select: {
                  id: true, squad_min: true,
                  disciplines: { select: { name: true, entry_type: true } },
                  tournament_formats: { select: { name: true } },
                  _count: { select: { team_entries: true, fixtures: true } },
                },
                orderBy: { display_order: 'asc' },
              },
            },
            orderBy: { display_order: 'asc' },
          },
        },
      },
    },
  });
  if (!ch) return;
  console.log(`CHAMPIONSHIP  ${ch.name}`);
  console.log(`URL           /championships/${ch.id}`);
  console.log(`\nLOGINS (password for all: ${PASSWORD})`);
  for (const s of STAFF) console.log(`  ${`${s.local}@${DOMAIN}`.padEnd(30)} ${s.name.padEnd(16)} ${s.note}`);
  for (const sa of superAdmins) {
    console.log(`  ${(sa.email ?? '(super admin)').padEnd(30)} ${sa.name.padEnd(16)} super admin · also granted Organiser here, so the event sidebar works`);
  }

  console.log('\nDRAWS (all awaiting fixtures)');
  console.log(`  ${'SPORT'.padEnd(15)} ${'DISCIPLINE'.padEnd(17)} ${'FORMAT'.padEnd(9)} SQ  ENT  ENGINE   PRESETS`);
  for (const ts of ch.tournaments.flatMap((t) => t.tournament_sports)) {
    const sport = ts.sports?.name ?? '?';
    // Which engine will score it, so a tester knows which console to expect.
    const engine = isCricketSport(sport) ? 'cricket' : 'kernel';
    const presets = matchPresetsFor(sport).length;
    for (const td of ts.tournament_disciplines) {
      console.log(
        `  ${sport.padEnd(15)} ${(td.disciplines?.name ?? '-').padEnd(17)}`
        + ` ${(td.tournament_formats?.name ?? '-').slice(0, 9).padEnd(9)}`
        + ` ${String(td.squad_min ?? '-').padStart(2)}`
        + ` ${String(td._count.team_entries).padStart(4)}`
        + `  ${engine.padEnd(8)} ${presets}`,
      );
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
        // The per-category detail tables cascade from player_match_stats, and
        // cricket_innings cascades from fixtures - so deleting those two clears the
        // ten typed tables with them. Best-effort, because a database that has not
        // had the migrations applied has none of them.
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
    // Formats saved against a bench institution during testing.
    await prisma.$executeRaw`delete from scoring_formats where organization_id in (
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
    // Chunked for the same reason the inserts are: this bench has thousands of
    // squad places, and one `in (...)` of that size is refused.
    let count = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const n = await (prisma as any)[table].deleteMany({ where: { id: { in: part } } });
      count += n.count;
    }
    console.log(`  ${table}: ${count}`);
  }
  rmSync(MANIFEST);
  console.log('\nCleaned up.');
}

// ---------------------------------------------------------------------------
const cmd = process.argv[2] ?? 'seed';
const main = async () => {
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

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
