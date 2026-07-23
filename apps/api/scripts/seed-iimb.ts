/*
 * Disposable, fully-reversible test championship for end-to-end testing.
 *
 *   npx tsx scripts/seed-iimb.ts seed       # create everything
 *   npx tsx scripts/seed-iimb.ts cleanup    # delete EXACTLY what was created
 *
 * Safety: reuses the existing GLOBAL catalog (sports / disciplines / formats /
 * roles) - never creates or deletes those. Everything it creates is recorded by id
 * in scripts/.seed-iimb-manifest.json; cleanup deletes only those ids, in FK order.
 * It never touches the real "IIM Bangalore Icebreaker Championship".
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { tieTemplateFor, eventTemplateFor, initTie, decideRubber, tieWinner, rubbersWon } from '@semp/shared';
import { recomputeStandings } from '../src/modules/standings/standings.service.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-iimb-manifest.json');

const PASSWORD = 'Passw0rd!';
const TAG = 'ZZ Seed';
const ORG_NAMES = ['Section A', 'Section B', 'Section C', 'Section D', 'Section E', 'Section F', 'Section G', 'Section H'];
const PLAYERS_PER_TEAM = 5;

// ---- rulebook draw map (each entry -> one tournament_discipline) -------------
type Draw = { sport: string; discipline?: string; structure: 'single' | 'tie' | 'event'; mode?: 'detailed' | 'manual'; format: 'Knockout' | 'League' };
const DRAWS: Draw[] = [
  // ties (whole-sport, rubber-based)
  { sport: 'Table Tennis', structure: 'tie', format: 'Knockout' },
  { sport: 'Badminton', structure: 'tie', format: 'Knockout' },
  { sport: 'Squash', structure: 'tie', format: 'Knockout' },
  { sport: 'Carrom', structure: 'tie', format: 'Knockout' },
  { sport: 'Tennis', structure: 'tie', format: 'Knockout' },
  { sport: 'Pool/Snooker', structure: 'tie', format: 'Knockout' },
  { sport: 'Chess', structure: 'tie', format: 'Knockout' },
  // multi-competitor events (whole-sport)
  { sport: 'Swimming', structure: 'event', format: 'Knockout' },
  { sport: 'Powerlifting', structure: 'event', format: 'Knockout' },
  // single matches (discipline-scoped)
  { sport: 'Basketball', discipline: "Men's", structure: 'single', format: 'Knockout' },
  { sport: 'Basketball', discipline: "Women's", structure: 'single', format: 'Knockout' },
  { sport: 'Box Cricket', discipline: "Women's", structure: 'single', format: 'Knockout' },
  { sport: 'Cricket', discipline: "Men's", structure: 'single', format: 'Knockout' },
  { sport: 'Football', discipline: "Men's", structure: 'single', format: 'Knockout' },
  { sport: 'Frisbee', discipline: 'Mixed', structure: 'single', format: 'Knockout' },
  { sport: 'Futsal', discipline: "Women's", structure: 'single', format: 'League' },
  { sport: 'Hockey', discipline: "Men's", structure: 'single', mode: 'manual', format: 'Knockout' },
  { sport: 'Kabaddi', discipline: "Men's", structure: 'single', format: 'Knockout' },
  { sport: 'Kabaddi', discipline: "Women's", structure: 'single', format: 'League' },
  { sport: 'Kho-Kho', discipline: "Men's", structure: 'single', format: 'Knockout' },
  { sport: 'Throwball', discipline: "Women's", structure: 'single', format: 'Knockout' },
  { sport: 'Throwball', discipline: "Men's", structure: 'single', format: 'League' },
  { sport: 'Volleyball', discipline: "Men's", structure: 'single', format: 'Knockout' },
];

// ---- manifest (created ids per table, deleted in reverse on cleanup) ---------
// Saved after EVERY track() so a crash mid-seed still leaves a fully cleanable trail.
type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  saveManifest();
};

const SCORES: Record<string, [number, number]> = {
  Basketball: [58, 49], Football: [3, 1], Futsal: [4, 2], Hockey: [3, 2], Frisbee: [13, 9],
  'Kho-Kho': [12, 9], Kabaddi: [34, 28], Cricket: [142, 131], 'Box Cricket': [88, 79],
  Volleyball: [3, 1], Throwball: [3, 1],
};
const scorePair = (sport: string): [number, number] => SCORES[sport] ?? [2, 1];

// A fully-played tie state (winner = home/A), for completed tie fixtures.
function tieCompleted(sport: string) {
  const spec = tieTemplateFor(sport)!.tie!;
  let st = initTie(spec);
  for (let i = 0; i < spec.rubbers.length; i++) {
    if (tieWinner(spec, st)) break;
    st = decideRubber(spec, st, i, i % 3 === 2 ? 'B' : 'A');
  }
  const { a, b } = rubbersWon(st);
  return { live_state: { tie: st }, home_score: a, away_score: b };
}

// A live, mid-tie state (1 rubber to home, active rubber in progress).
function tieLive(sport: string) {
  const spec = tieTemplateFor(sport)!.tie!;
  let st = initTie(spec);
  st = decideRubber(spec, st, 0, 'A');
  if (st.rubbers[1]) { st.rubbers[1].status = 'live'; st.rubbers[1].state.a = 8; st.rubbers[1].state.b = 6; }
  const { a, b } = rubbersWon(st);
  return { live_state: { tie: st }, home_score: a, away_score: b };
}

async function seed() {
  if (existsSync(MANIFEST)) {
    console.error(`Manifest already exists (${MANIFEST}). Run "cleanup" first, or delete it.`);
    process.exit(1);
  }
  const t0 = Date.now();

  // -- resolve global catalog ------------------------------------------------
  const [sportsRows, formatsRows, rolesRows, discRows] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ select: { id: true, name: true } }),
    prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } }),
  ]);
  const sportId = new Map(sportsRows.map((s) => [s.name, s.id]));
  const formatId = new Map(formatsRows.map((f) => [f.name, f.id]));
  const roleId = new Map(rolesRows.map((r) => [r.name, r.id]));
  const discId = (sport: string, name: string) => {
    const sid = sportId.get(sport);
    const d = discRows.find((x) => x.sport_id === sid && x.name === name);
    if (!d) throw new Error(`discipline not found: ${sport} / ${name}`);
    return d.id;
  };
  for (const d of DRAWS) if (!sportId.get(d.sport)) throw new Error(`sport not found: ${d.sport}`);

  // -- championship + tournament + venue ------------------------------------
  const champId = randomUUID();
  const slug = `zz-seed-icebreaker-${Date.now().toString(36)}`;
  await prisma.championships.create({ data: {
    id: champId, name: `${TAG} — Icebreaker Test (delete me)`, slug,
    description: 'Disposable end-to-end test championship. Safe to delete via the seed cleanup.',
    venue: 'IIM Bangalore', start_date: new Date('2026-06-24'), end_date: new Date('2026-06-28'), status: 'ongoing',
  } });
  track('championships', champId);

  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'IIMB Sports Complex', city: 'Bengaluru' } });
  track('venues', venueId);
  const grounds = ['Indoor Court', 'Main Field', 'Pool / Track'].map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));
  const groundIds = grounds.map((g) => g.id);

  // championship default standings rule = placement (rulebook: W10 / RU7 / SF4 / Part1)
  const ruleId = randomUUID();
  await prisma.standings_rules.create({ data: {
    id: ruleId, championship_id: champId, scope_type: 'championship', scope_id: null,
    config: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
  } });
  track('standings_rules', ruleId);

  // -- tournament_sports (one per distinct sport) + tournament_disciplines ----
  const tsBySport = new Map<string, string>();
  const tsData: any[] = [];
  let order = 0;
  for (const sport of new Set(DRAWS.map((d) => d.sport))) {
    const id = randomUUID();
    tsBySport.set(sport, id);
    tsData.push({ id, tournament_id: tournamentId, sport_id: sportId.get(sport), format_id: formatId.get('Knockout'), display_order: order++ });
  }
  await prisma.tournament_sports.createMany({ data: tsData });
  track('tournament_sports', tsData.map((t) => t.id));

  type DrawCtx = Draw & { tdId: string; label: string };
  const drawCtx: DrawCtx[] = [];
  const tdData: any[] = [];
  for (const d of DRAWS) {
    const tdId = randomUUID();
    let scoring: any = undefined;
    if (d.structure === 'tie') scoring = tieTemplateFor(d.sport);
    else if (d.structure === 'event') scoring = eventTemplateFor(d.sport);
    else if (d.mode) scoring = { fixtureType: 'single', scoringMode: d.mode };
    tdData.push({
      id: tdId, tournament_sport_id: tsBySport.get(d.sport), discipline_id: d.discipline ? discId(d.sport, d.discipline) : null,
      format_id: formatId.get(d.format), venue_id: venueId, status: 'ongoing', display_order: drawCtx.length,
      format_config: scoring ? { scoring } : {},
    });
    drawCtx.push({ ...d, tdId, label: d.discipline ? `${d.sport} ${d.discipline}` : `${d.sport}` });
  }
  await prisma.tournament_disciplines.createMany({ data: tdData });
  track('tournament_disciplines', tdData.map((t) => t.id));

  // -- organizations + POC owners -------------------------------------------
  const codeSuffix = Date.now().toString(36).slice(-4);
  const orgs = ORG_NAMES.map((n, i) => ({ id: randomUUID(), name: `${TAG} — ${n}`, short_name: n.replace('Section ', 'Sec '), code: `ZZSEED-${String.fromCharCode(65 + i)}-${codeSuffix}`, city: 'Bengaluru' }));
  await prisma.organizations.createMany({ data: orgs });
  track('organizations', orgs.map((o) => o.id));

  const staffHash = await bcrypt.hash(PASSWORD, 10);
  const userData: any[] = [];
  const pocs = orgs.map((o, i) => {
    const id = randomUUID();
    userData.push({ id, name: `POC ${o.short_name}`, email: `seed.poc.${String.fromCharCode(97 + i)}@iimb.test`, password_hash: staffHash, organization_id: o.id, account_type: 'institution' });
    return { id, orgId: o.id };
  });
  const hostId = randomUUID();
  userData.push({ id: hostId, name: 'Seed Host (Organiser)', email: 'seed.host@iimb.test', password_hash: staffHash, is_super_admin: true });
  const officials = [0, 1, 2].map((i) => {
    const id = randomUUID();
    userData.push({ id, name: `Seed Official ${i + 1}`, email: `seed.official${i + 1}@iimb.test`, password_hash: staffHash });
    return id;
  });

  // -- teams + players + entries (team-based draws only) ---------------------
  const teamDraws = drawCtx.filter((d) => d.structure !== 'event');
  const teamData: any[] = [];
  const memberData: any[] = [];
  const entryData: any[] = [];
  // teamIdsByDraw[tdId] = [8 team ids aligned to orgs]
  const teamIdsByDraw = new Map<string, string[]>();
  let playerSeq = 0;
  for (const d of teamDraws) {
    const ids: string[] = [];
    for (let o = 0; o < orgs.length; o++) {
      const teamId = randomUUID();
      teamData.push({ id: teamId, sport_id: sportId.get(d.sport), organization_id: orgs[o].id, name: `${orgs[o].short_name} ${d.label}`, status: 'approved' });
      ids.push(teamId);
      for (let p = 0; p < PLAYERS_PER_TEAM; p++) {
        const uid = randomUUID();
        userData.push({ id: uid, name: `Player ${++playerSeq}`, email: `seed.p${playerSeq}@iimb.test`, organization_id: orgs[o].id });
        memberData.push({ id: randomUUID(), team_id: teamId, user_id: uid, role: p === 0 ? 'captain' : 'player', jersey_number: p + 1 });
      }
    }
    teamIdsByDraw.set(d.tdId, ids);
  }

  await prisma.users.createMany({ data: userData });
  track('users', userData.map((u) => u.id));
  const omData = pocs.map((p) => ({ id: randomUUID(), user_id: p.id, organization_id: p.orgId, role: 'owner' }));
  await prisma.organization_members.createMany({ data: omData });
  track('organization_members', omData.map((o) => o.id));
  const coIds = orgs.map((o) => ({ id: randomUUID(), championship_id: champId, organization_id: o.id, applied_by: hostId, status: 'approved', reviewed_by: hostId, reviewed_at: new Date() }));
  await prisma.championship_organizations.createMany({ data: coIds });
  track('championship_organizations', coIds.map((c) => c.id));
  const coByOrg = new Map(coIds.map((c) => [c.organization_id, c.id]));

  await prisma.teams.createMany({ data: teamData });
  track('teams', teamData.map((t) => t.id));
  await prisma.team_members.createMany({ data: memberData });
  track('team_members', memberData.map((m) => m.id));

  for (const d of teamDraws) {
    const ids = teamIdsByDraw.get(d.tdId)!;
    ids.forEach((teamId, o) => entryData.push({
      id: randomUUID(), team_id: teamId, organization_id: orgs[o].id, championship_id: champId,
      championship_organization_id: coByOrg.get(orgs[o].id), tournament_discipline_id: d.tdId, status: 'approved',
    }));
  }
  await prisma.team_entries.createMany({ data: entryData });
  track('team_entries', entryData.map((e) => e.id));

  // roles: host -> Organiser, officials -> Official; championship_officials rows
  const ucr: any[] = [];
  if (roleId.get('Organiser')) ucr.push({ id: randomUUID(), user_id: hostId, championship_id: champId, role_id: roleId.get('Organiser'), assigned_by: hostId });
  for (const oid of officials) if (roleId.get('Official')) ucr.push({ id: randomUUID(), user_id: oid, championship_id: champId, role_id: roleId.get('Official'), assigned_by: hostId });
  if (ucr.length) { await prisma.user_championship_roles.createMany({ data: ucr }); track('user_championship_roles', ucr.map((r) => r.id)); }
  const coffs = officials.map((oid) => ({ id: randomUUID(), championship_id: champId, user_id: oid, assigned_by: hostId }));
  await prisma.championship_officials.createMany({ data: coffs });
  track('championship_officials', coffs.map((c) => c.id));

  // -- fixtures --------------------------------------------------------------
  let slot = 0;
  const slotAt = () => { const base = new Date('2026-06-24T03:30:00Z').getTime(); return new Date(base + (slot++) * 30 * 60000); };
  let offRR = 0;
  const nextOfficial = () => officials[offRR++ % officials.length];
  let grRR = 0;
  const nextGround = () => groundIds[grRR++ % groundIds.length];

  const fixtures: any[] = [];
  const awards: any[] = [];
  const base = (tdId: string, extra: any) => ({ id: randomUUID(), tournament_discipline_id: tdId, official_id: nextOfficial(), venue_ground_id: nextGround(), scheduled_at: slotAt(), ...extra });

  teamDraws.forEach((d, di) => {
    const T = teamIdsByDraw.get(d.tdId)!; // 8 teams
    const pattern = di % 3; // 0 completed, 1 in-progress, 2 scheduled (with walkover/bye injected)
    const [ws, ls] = scorePair(d.sport);
    const completedHeadline = (winner: string, loser: string) => {
      if (d.structure === 'tie') { const c = tieCompleted(d.sport); return { home_team_id: winner, away_team_id: loser, status: 'completed', winner_team_id: winner, home_score: c.home_score, away_score: c.away_score, live_state: c.live_state }; }
      return { home_team_id: winner, away_team_id: loser, status: 'completed', winner_team_id: winner, home_score: ws, away_score: ls };
    };

    // Quarter-finals: pairs (0,1)(2,3)(4,5)(6,7); lower index wins.
    const qfWinners = [T[0], T[2], T[4], T[6]];
    for (let q = 0; q < 4; q++) {
      const home = T[q * 2], away = T[q * 2 + 1];
      let extra: any;
      if (pattern === 0) extra = completedHeadline(home, away);
      else if (pattern === 1) extra = completedHeadline(home, away);
      else { // scheduled - inject a walkover (q0) and a bye (q1)
        if (q === 0) extra = { home_team_id: home, away_team_id: away, status: 'walkover', winner_team_id: home };
        else if (q === 1) extra = { home_team_id: home, away_team_id: null, status: 'bye', winner_team_id: home };
        else extra = { home_team_id: home, away_team_id: away, status: 'scheduled' };
      }
      fixtures.push(base(d.tdId, { round: 'Quarter-final', bracket_position: q + 1, ...extra }));
    }

    // Semi-finals
    const sfPairs = [[qfWinners[0], qfWinners[1]], [qfWinners[2], qfWinners[3]]];
    const sfWinners = [qfWinners[0], qfWinners[2]];
    sfPairs.forEach(([h, a], s) => {
      let extra: any;
      if (pattern === 0) extra = completedHeadline(h, a);
      else if (pattern === 1) extra = s === 0
        ? (d.structure === 'tie' ? { home_team_id: h, away_team_id: a, status: 'live', ...tieLive(d.sport) } : { home_team_id: h, away_team_id: a, status: 'live', home_score: Math.ceil(ws / 2), away_score: Math.floor(ls / 2) })
        : { home_team_id: h, away_team_id: a, status: 'scheduled' };
      else extra = { home_team_id: null, away_team_id: null, status: 'scheduled' };
      fixtures.push(base(d.tdId, { round: 'Semi-final', bracket_position: s + 1, ...extra }));
    });

    // Final + 3rd place
    const finalExtra = pattern === 0 ? completedHeadline(sfWinners[0], sfWinners[1]) : { home_team_id: null, away_team_id: null, status: 'scheduled' };
    const finalId = randomUUID();
    fixtures.push({ ...base(d.tdId, { round: 'Final', bracket_position: 1, ...finalExtra }), id: finalId });
    fixtures.push(base(d.tdId, { round: 'Third-place', bracket_position: 1, ...(pattern === 0 ? completedHeadline(qfWinners[1], qfWinners[3]) : { home_team_id: null, away_team_id: null, status: 'scheduled' }) }));

    // Player-of-the-match award on a completed final (showcase)
    if (pattern === 0) {
      const champMember = memberData.find((m) => m.team_id === sfWinners[0]);
      if (champMember) awards.push({ id: randomUUID(), fixture_id: finalId, recipient_user_id: champMember.user_id, award_name: 'Player of the Tournament' });
    }
  });

  // Event fixtures (swimming/powerlifting): one team-less fixture each, with seeded marks.
  for (const d of drawCtx.filter((x) => x.structure === 'event')) {
    const spec = eventTemplateFor(d.sport)!.event!;
    const mark = (i: number, j: number) => (spec.result.winnerIs === 'min' ? 12 + i + j * 0.3 : 200 - i * 5 + j * 10);
    const participants = orgs.slice(0, 5).map((o, i) => {
      const baseP = { id: `p${i}`, name: `Athlete ${i + 1}`, org: o.name, orgId: o.id };
      if (spec.pickOne) {
        // One weight class per lifter, one total. Alternate two classes so each class
        // has several lifters - the demo then shows real within-class ranking.
        const cat = spec.subEvents[i % 2].key;
        return { ...baseP, category: cat, marks: { [cat]: mark(i, 0) } };
      }
      const subs = spec.subEvents.slice(0, 3).map((s) => s.key);
      return { ...baseP, marks: Object.fromEntries(subs.map((k, j) => [k, mark(i, j)])) };
    });
    fixtures.push(base(d.tdId, { round: 'Event', status: 'live', home_team_id: null, away_team_id: null, live_state: { event: { participants } } }));
  }

  // Inject a postponed fixture for status coverage.
  fixtures[2] = { ...fixtures[2], status: 'postponed', winner_team_id: null, home_score: null, away_score: null };

  await prisma.fixtures.createMany({ data: fixtures });
  track('fixtures', fixtures.map((f) => f.id));
  if (awards.length) { await prisma.fixture_awards.createMany({ data: awards }); track('fixture_awards', awards.map((a) => a.id)); }

  saveManifest();

  // -- recompute standings (and time it) ------------------------------------
  const tStand = Date.now();
  await recomputeStandings(prisma as any, champId);
  const standMs = Date.now() - tStand;
  const standingsRows = await prisma.standings.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('standings', standingsRows.map((s) => s.id));
  saveManifest();

  // -- summary --------------------------------------------------------------
  const counts = Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length]));
  console.log('\n================  SEED COMPLETE  ================');
  console.log('took', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('standings recompute:', standMs, 'ms over', counts.fixtures, 'fixtures');
  console.log('\nrow counts:', JSON.stringify(counts, null, 2));
  console.log('\nchampionship:', `${TAG} — Icebreaker Test`, '\n  id:', champId, '\n  slug:', slug, '\n  status: ongoing');
  console.log('\nLOGINS (password for all:', PASSWORD + ')');
  console.log('  Host/Organiser (super):  seed.host@iimb.test');
  console.log('  Officials:               seed.official1@iimb.test … official3');
  console.log('  Org POCs:                seed.poc.a@iimb.test … seed.poc.h');
  console.log('\nCleanup:  npx tsx scripts/seed-iimb.ts cleanup');
  console.log('================================================\n');
}

async function cleanup() {
  if (!existsSync(MANIFEST)) { console.error('No manifest found - nothing to clean up.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  // Reverse FK dependency order.
  const order = [
    'fixture_awards', 'standings', 'fixtures', 'team_entries', 'team_members',
    'championship_officials', 'user_championship_roles', 'championship_organizations',
    'organization_members', 'standings_rules', 'tournament_disciplines', 'tournament_sports',
    'venue_grounds', 'venues', 'tournaments', 'teams', 'championships', 'users', 'organizations',
  ];
  const t0 = Date.now();
  for (const table of order) {
    const ids = m[table];
    if (!ids?.length) continue;
    // organization_members / team_members cascade on org/user delete; others by id.
    const model: any = (prisma as any)[table];
    const res = await model.deleteMany({ where: { id: { in: ids } } });
    console.log(`deleted ${res.count}/${ids.length} ${table}`);
  }
  rmSync(MANIFEST);
  console.log(`\ncleanup done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Manifest removed.`);
}

const mode = process.argv[2] ?? 'seed';
(mode === 'cleanup' ? cleanup() : seed())
  .catch((e) => { console.error('\nFAILED:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
