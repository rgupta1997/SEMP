/*
 * Inter IIM - 2026: the standing client demo.
 *
 *   npx tsx scripts/seed-inter-iim.ts seed       # build it
 *   npx tsx scripts/seed-inter-iim.ts cleanup    # delete EXACTLY what was built
 *
 * Everything this creates is recorded by id in scripts/.seed-inter-iim-manifest.json
 * and cleanup deletes only those ids, in reverse-FK order. It reuses the GLOBAL
 * catalogue (sports / disciplines / formats / roles) and never creates or deletes
 * any of it, so it cannot damage the real IIMB ICE BREAKER - 2026 it is modelled on.
 *
 * CONFIG below is the whole specification. It is deliberately one plain object with
 * no logic in it, because it is also the payload the super-admin seeding screen will
 * POST once that exists - this script is the engine, the screen will be the form.
 * Changing the demo should mean editing CONFIG, never the code under it.
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
import { resolveFixtureParticipants } from '../src/modules/fixtures/participants.js';
import { writeLifetimeEntries, deriveAchievements, writeStatLines } from '../src/modules/fixtures/downstream.js';
import { refreshCareerStatsForFixture } from '../src/modules/records/career-stats.service.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-inter-iim-manifest.json');

// ---------------------------------------------------------------------------
// CONFIG - the demo specification
// ---------------------------------------------------------------------------

const CONFIG = {
  championship: {
    name: 'Inter IIM - 2026',
    venue: 'IIM Kozhikode',
    city: 'Kozhikode',
    description: 'The inter-IIM championship, hosted by IIM Kozhikode.',
    days: 3,
    /**
     * Dates are RELATIVE to the run date so the demo is always mid-event: the last
     * day is today, the days before it are played. A fixed Nov 13-15 would show
     * completed results on dates weeks in the future, which is the one thing a
     * sharp viewer notices. Set `fixedStart` to pin real dates instead.
     */
    fixedStart: null as string | null, // e.g. '2026-11-13'
    /** How many of the `days` are finished. The rest are still to play. */
    playedThroughDay: 2,
  },

  /** The host institution. Gets championships.host_organization_id. */
  hostOrganization: 'IIM Kozhikode',

  organizations: [
    { name: 'IIM Bangalore', short: 'IIMB', city: 'Bengaluru' },
    { name: 'IIM Kozhikode', short: 'IIMK', city: 'Kozhikode' },
    { name: 'IIM Visakhapatnam', short: 'IIMV', city: 'Visakhapatnam' },
    { name: 'IIM Nagpur', short: 'IIMN', city: 'Nagpur' },
    { name: 'IIM Mumbai', short: 'IIMM', city: 'Mumbai' },
    { name: 'IIM Shillong', short: 'IIMS', city: 'Shillong' },
  ],

  participantsPerOrganization: 200,

  /** The three accounts the demo is driven from, one per workspace. */
  accounts: {
    organiser: { name: 'Akash Manglekar', email: 'akash.manglekar@interiim.demo' },
    player: { name: 'Rhea Nair', email: 'rhea.nair@interiim.demo', organization: 'IIM Kozhikode' },
    institutionAdmin: { name: 'Priya Menon', email: 'priya.menon@interiim.demo', organization: 'IIM Kozhikode' },
  },

  officials: 4,
  password: 'InterIIM@2026',
  emailDomain: 'interiim.demo',

  /**
   * The 23 draws of IIMB ICE BREAKER - 2026, read from that championship rather
   * than written from memory: 20 sports, 23 draws, disciplines named Men / Women /
   * Mixed, everything Knockout except the two Rankings events.
   */
  draws: [
    { sport: 'Badminton', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Basketball', discipline: 'Men', format: 'Knockout' },
    { sport: 'Basketball', discipline: 'Women', format: 'Knockout' },
    { sport: 'Box Cricket', discipline: 'Women', format: 'Knockout' },
    { sport: 'Carrom', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Chess', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Cricket', discipline: 'Men', format: 'Knockout' },
    { sport: 'Football', discipline: 'Men', format: 'Knockout' },
    { sport: 'Frisbee', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Futsal', discipline: 'Women', format: 'Knockout' },
    { sport: 'Hockey', discipline: 'Men', format: 'Knockout' },
    { sport: 'Kabaddi', discipline: 'Men', format: 'Knockout' },
    { sport: 'Kabaddi', discipline: 'Women', format: 'Knockout' },
    { sport: 'Kho-Kho', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Pool/Snooker', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Powerlifting', discipline: 'Mixed', format: 'Rankings' },
    { sport: 'Squash', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Swimming', discipline: 'Mixed', format: 'Rankings' },
    { sport: 'Table Tennis', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Tennis', discipline: 'Mixed', format: 'Knockout' },
    { sport: 'Throwball', discipline: 'Men', format: 'Knockout' },
    { sport: 'Throwball', discipline: 'Women', format: 'Knockout' },
    { sport: 'Volleyball', discipline: 'Mixed', format: 'Knockout' },
  ] as Array<{ sport: string; discipline: string; format: 'Knockout' | 'League' | 'Rankings' }>,
};

/**
 * Minimum squad each sport actually needs. "Fulfil the minimum required criteria
 * of each sport" is this table - a Cricket XI with five players is the kind of
 * detail that collapses a demo under a question.
 */
const SQUAD_SIZE: Record<string, number> = {
  Cricket: 11, Football: 11, Hockey: 11, 'Box Cricket': 8, 'Kho-Kho': 9,
  Kabaddi: 7, Throwball: 7, Frisbee: 7, Volleyball: 6, Basketball: 5, Futsal: 5,
};
const DEFAULT_SQUAD = 4; // racquet / board ties: enough bodies for every rubber

/**
 * Relative strength, used to decide who wins. Results have to depend on WHO a team
 * is, not which bracket seat it sits in: a purely positional bracket gives every
 * organisation the same placement points once the seeding rotates, and the medal
 * table comes out a flat six-way tie. With a strength order plus the jitter below,
 * the stronger institutions win more without sweeping everything.
 */
const STRENGTH: Record<string, number> = { IIMB: 6, IIMK: 5, IIMM: 4, IIMV: 3, IIMN: 2, IIMS: 1 };

/**
 * Deterministic upset noise, big enough to beat a one-step strength gap but not a
 * large one. Same inputs give the same winner on every reseed, so a demo rehearsed
 * on Sunday is the demo that runs on Monday.
 */
const jitter = (di: number, round: number, pos: number, short: string) =>
  (di * 31 + round * 17 + pos * 7 + short.charCodeAt(3)) % 7;

const SCORES: Record<string, [number, number]> = {
  Basketball: [58, 49], Football: [3, 1], Futsal: [4, 2], Hockey: [3, 2], Frisbee: [13, 9],
  'Kho-Kho': [12, 9], Kabaddi: [34, 28], Cricket: [142, 131], 'Box Cricket': [88, 79],
  Volleyball: [3, 1], Throwball: [3, 1],
};
const scorePair = (sport: string): [number, number] => SCORES[sport] ?? [2, 1];

const FIRST = ['Aarav', 'Rhea', 'Kabir', 'Ananya', 'Vivaan', 'Ishita', 'Arjun', 'Meera', 'Rohan', 'Sanya',
  'Dev', 'Nikita', 'Aditya', 'Tara', 'Karan', 'Diya', 'Yash', 'Nisha', 'Siddharth', 'Pooja'];
const LAST = ['Nair', 'Sharma', 'Iyer', 'Menon', 'Reddy', 'Gupta', 'Patel', 'Rao', 'Bose', 'Khanna',
  'Verma', 'Joshi', 'Pillai', 'Desai', 'Sinha', 'Kulkarni'];

/** Knuth multiplicative hash, salted per field. Deterministic, and decorrelated. */
const hashPick = (n: number, salt: number) => (Math.imul(n + salt * 7919, 2654435761) >>> 8) & 0xffff;

// ---- manifest ---------------------------------------------------------------
// Saved after every track() so a crash mid-seed still leaves a cleanable trail.
type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  saveManifest();
};

/** A fully-played tie (winner = home), for a completed rubber-based fixture. */
function tieCompleted(sport: string) {
  const spec = tieTemplateFor(sport)!.tie!;
  let st = initTie(spec);
  for (let i = 0; i < spec.rubbers.length; i++) {
    if (tieWinner(spec, st)) break;
    st = decideRubber(spec, st, i, i % 3 === 2 ? 'B' : 'A');
  }
  const { a, b } = rubbersWon(st);
  return { home_score: a, away_score: b, live_state: { tie: st } };
}

/** Mid-tie: one rubber banked, the next on court. Used for the live day-3 fixtures. */
function tieLive(sport: string) {
  const spec = tieTemplateFor(sport)!.tie!;
  let st = initTie(spec);
  st = decideRubber(spec, st, 0, 'A');
  if (st.rubbers[1]) { st.rubbers[1].status = 'live'; st.rubbers[1].state.a = 8; st.rubbers[1].state.b = 6; }
  const { a, b } = rubbersWon(st);
  return { home_score: a, away_score: b, live_state: { tie: st } };
}

async function seed() {
  if (existsSync(MANIFEST)) {
    console.error(`Manifest already exists (${MANIFEST}). Run "cleanup" first, or delete it.`);
    process.exit(1);
  }
  const t0 = Date.now();
  const C = CONFIG;

  // -- dates ----------------------------------------------------------------
  // Day `days` is today unless fixedStart pins it, so the demo always opens on a
  // championship in progress rather than one that finished last month.
  const midnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const startDate = C.championship.fixedStart
    ? midnight(new Date(C.championship.fixedStart))
    : midnight(new Date(Date.now() - (C.championship.days - 1) * 86400000));
  const dayDate = (day: number) => new Date(startDate.getTime() + (day - 1) * 86400000);
  const endDate = dayDate(C.championship.days);

  // -- resolve the global catalogue -----------------------------------------
  const [sportsRows, formatsRows, rolesRows, discRows] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ select: { id: true, code: true, scope: true } }),
    prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } }),
  ]);
  const sportId = new Map(sportsRows.map((s) => [s.name, s.id]));
  const formatId = new Map(formatsRows.map((f) => [f.name, f.id]));
  // Roles are resolved by CODE + single_event scope: names repeat across scopes in
  // this catalogue (three 'Viewer' rows, several null-scope duplicates), so looking
  // one up by name alone silently picks whichever row sorts first.
  const eventRole = (code: string) =>
    rolesRows.find((r) => r.code === code && r.scope === 'single_event')?.id
    ?? rolesRows.find((r) => r.code === code)?.id ?? null;

  const discId = (sport: string, name: string) => {
    const sid = sportId.get(sport);
    const d = discRows.find((x) => x.sport_id === sid && x.name === name);
    if (!d) throw new Error(`discipline not found: ${sport} / ${name}`);
    return d.id;
  };
  for (const d of C.draws) {
    if (!sportId.get(d.sport)) throw new Error(`sport not in catalogue: ${d.sport}`);
    if (!formatId.get(d.format)) throw new Error(`format not in catalogue: ${d.format}`);
  }

  // -- organizations ---------------------------------------------------------
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  const orgs = C.organizations.map((o) => ({
    id: randomUUID(), name: o.name, short_name: o.short,
    code: `IIM-${o.short}-${suffix}`, city: o.city,
  }));
  await prisma.organizations.createMany({ data: orgs });
  track('organizations', orgs.map((o) => o.id));
  const orgByName = new Map(orgs.map((o) => [o.name, o]));
  const hostOrg = orgByName.get(C.hostOrganization);
  if (!hostOrg) throw new Error(`hostOrganization "${C.hostOrganization}" is not in organizations`);

  // -- championship + tournament + venue ------------------------------------
  const champId = randomUUID();
  const slug = `inter-iim-2026-${suffix.toLowerCase()}`;
  await prisma.championships.create({
    data: {
      id: champId, name: C.championship.name, slug, description: C.championship.description,
      venue: C.championship.venue, start_date: startDate, end_date: endDate,
      status: 'ongoing', visibility: 'public', host_organization_id: hostOrg.id,
      entry_level: 'organization',
    },
  });
  track('championships', champId);

  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: `${C.championship.venue} Sports Complex`, city: C.championship.city } });
  track('venues', venueId);
  const grounds = ['Indoor Arena', 'Main Ground', 'Athletics & Pool', 'Court Complex']
    .map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));
  const groundIds = grounds.map((g) => g.id);

  // Placement scoring: winner 10 / runner-up 7 / semi-finalist 4 / participation 1.
  const ruleId = randomUUID();
  await prisma.standings_rules.create({
    data: {
      id: ruleId, championship_id: champId, scope_type: 'championship', scope_id: null,
      config: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
    },
  });
  track('standings_rules', ruleId);

  // -- tournament_sports + tournament_disciplines ---------------------------
  const tsBySport = new Map<string, string>();
  const tsData: any[] = [];
  let order = 0;
  for (const sport of new Set(C.draws.map((d) => d.sport))) {
    const id = randomUUID();
    tsBySport.set(sport, id);
    tsData.push({ id, tournament_id: tournamentId, sport_id: sportId.get(sport), format_id: formatId.get('Knockout'), display_order: order++ });
  }
  await prisma.tournament_sports.createMany({ data: tsData });
  track('tournament_sports', tsData.map((t) => t.id));

  type DrawCtx = { sport: string; discipline: string; label: string; tdId: string; kind: 'single' | 'tie' | 'event' };
  const draws: DrawCtx[] = [];
  const tdData: any[] = [];
  for (const d of C.draws) {
    const tdId = randomUUID();
    // How a sport is scored is a property of the sport, not of this demo: the
    // shared templates decide, exactly as discipline setup does in the product.
    const kind: DrawCtx['kind'] = tieTemplateFor(d.sport) ? 'tie' : eventTemplateFor(d.sport) ? 'event' : 'single';
    const scoring = kind === 'tie' ? tieTemplateFor(d.sport) : kind === 'event' ? eventTemplateFor(d.sport) : undefined;
    tdData.push({
      id: tdId, tournament_sport_id: tsBySport.get(d.sport), discipline_id: discId(d.sport, d.discipline),
      format_id: formatId.get(d.format), venue_id: venueId, status: 'ongoing', display_order: draws.length,
      entry_type: kind === 'event' ? 'individual' : 'team',
      squad_min: kind === 'event' ? null : (SQUAD_SIZE[d.sport] ?? DEFAULT_SQUAD),
      format_config: scoring ? { scoring } : {},
    });
    draws.push({ sport: d.sport, discipline: d.discipline, label: `${d.sport} ${d.discipline}`, tdId, kind });
  }
  await prisma.tournament_disciplines.createMany({ data: tdData });
  track('tournament_disciplines', tdData.map((t) => t.id));

  // -- people ----------------------------------------------------------------
  const hash = await bcrypt.hash(C.password, 10);
  const userData: any[] = [];
  const mk = (name: string, email: string, extra: any = {}) => {
    const id = randomUUID();
    userData.push({ id, name, email, password_hash: hash, email_verified_at: new Date(), ...extra });
    return id;
  };

  const organiserId = mk(C.accounts.organiser.name, C.accounts.organiser.email, { account_type: 'institution', organization_id: hostOrg.id });
  const officialIds = Array.from({ length: C.officials }, (_, i) =>
    mk(`Official ${i + 1}`, `official${i + 1}@${C.emailDomain}`, { account_type: 'institution' }));

  // One POC per organisation; the host's POC is the named Institutional Admin so
  // the Org Space demo opens on a real person rather than "POC IIMK".
  const adminOrg = orgByName.get(C.accounts.institutionAdmin.organization)!;
  const pocs = orgs.map((o) => {
    const named = o.id === adminOrg.id;
    const id = named
      ? mk(C.accounts.institutionAdmin.name, C.accounts.institutionAdmin.email, { account_type: 'institution', organization_id: o.id })
      : mk(`POC ${o.short_name}`, `poc.${o.short_name.toLowerCase()}@${C.emailDomain}`, { account_type: 'institution', organization_id: o.id });
    return { id, orgId: o.id };
  });

  // Rosters. The named player is seat 0 of their own organisation so Personal Space
  // has a real roster behind it.
  const playerOrg = orgByName.get(C.accounts.player.organization)!;
  const roster = new Map<string, string[]>();
  let seq = 0;
  for (const o of orgs) {
    const ids: string[] = [];
    for (let i = 0; i < C.participantsPerOrganization; i++) {
      seq++;
      if (o.id === playerOrg.id && i === 0) {
        ids.push(mk(C.accounts.player.name, C.accounts.player.email, { account_type: 'participant', organization_id: o.id }));
        continue;
      }
      // Hashed, not strided. Any LINEAR mix of seq and i collapses, because the two
      // are linearly dependent (i = seq - 1 within an organisation): `seq * 7 + i`
      // is `8 * seq - 1`, which mod 16 surnames only ever lands on two of them - a
      // captains list where everyone was called Rao. Knuth's multiplicative hash,
      // salted differently per field, decorrelates the two properly.
      const name = `${FIRST[hashPick(seq, 1) % FIRST.length]} ${LAST[hashPick(seq, 2) % LAST.length]}`;
      ids.push(mk(name, `p${seq}@${C.emailDomain}`, { account_type: 'participant', organization_id: o.id }));
    }
    roster.set(o.id, ids);
  }

  await prisma.users.createMany({ data: userData });
  track('users', userData.map((u) => u.id));

  // EVERY person in an organisation needs an organization_members row, not just a
  // users.organization_id. The Org Space people list reads organization_members and
  // nothing else, while events reach players through team_members - so setting only
  // the column gives you a championship full of players and an organisation with
  // nobody in it.
  const members: any[] = pocs.map((p) => ({
    id: randomUUID(), user_id: p.id, organization_id: p.orgId, role: 'owner',
    status: 'active', verification: 'verified', verified_at: new Date(),
  }));
  const pocByOrg = new Map(pocs.map((p) => [p.orgId, p.id]));
  for (const o of orgs) {
    const poc = pocByOrg.get(o.id)!;
    roster.get(o.id)!.forEach((uid, i) => members.push({
      id: randomUUID(), user_id: uid, organization_id: o.id, role: 'member',
      status: 'active', verification: 'verified', verified_by: poc, verified_at: new Date(),
      member_code: `${o.short_name}/${String(i + 1).padStart(4, '0')}`,
    }));
  }
  // The organiser runs this championship FOR the host institution, so he belongs to
  // it - as an admin, not an owner: the POC still owns the organisation.
  members.push({
    id: randomUUID(), user_id: organiserId, organization_id: hostOrg.id, role: 'admin',
    status: 'active', verification: 'verified', verified_by: pocByOrg.get(hostOrg.id)!, verified_at: new Date(),
  });
  await prisma.organization_members.createMany({ data: members });
  track('organization_members', members.map((m) => m.id));

  // Campus + batches, and every participant placed in one. Without these the Org
  // Space campus and roll surfaces are empty even once the people list fills up.
  const units: any[] = [];
  const unitMembers: any[] = [];
  for (const o of orgs) {
    const campusId = randomUUID();
    units.push({ id: campusId, organization_id: o.id, type: 'campus', name: `${o.name} Campus`, code: `${o.short_name}-CAMP`, status: 'ACTIVE', display_order: 0, admin_user_id: pocByOrg.get(o.id)! });
    const batches = ['MBA 2026', 'MBA 2027', 'PGP-FABM'].map((name, i) => ({
      id: randomUUID(), organization_id: o.id, parent_id: campusId, type: 'department',
      name, code: `${o.short_name}-${name.replace(/[^A-Z0-9]/g, '')}`, status: 'ACTIVE', display_order: i + 1,
    }));
    units.push(...batches);
    roster.get(o.id)!.forEach((uid, i) => unitMembers.push({
      id: randomUUID(), organization_id: o.id, org_unit_id: batches[i % batches.length].id, user_id: uid,
    }));
  }
  await prisma.org_units.createMany({ data: units });
  track('org_units', units.map((u) => u.id));
  await prisma.org_unit_members.createMany({ data: unitMembers });
  track('org_unit_members', unitMembers.map((u) => u.id));

  const champOrgs = orgs.map((o) => ({
    id: randomUUID(), championship_id: champId, organization_id: o.id,
    applied_by: organiserId, status: 'approved', reviewed_by: organiserId, reviewed_at: new Date(),
  }));
  await prisma.championship_organizations.createMany({ data: champOrgs });
  track('championship_organizations', champOrgs.map((c) => c.id));
  const champOrgByOrg = new Map(champOrgs.map((c) => [c.organization_id, c.id]));

  // -- teams, squads, entries ------------------------------------------------
  const teamDraws = draws.filter((d) => d.kind !== 'event');
  const teams: any[] = [];
  const squads: any[] = [];
  const entries: any[] = [];
  const teamsByDraw = new Map<string, string[]>();
  // One cursor per organisation walking its roster, so squads are drawn from the
  // whole 200 rather than the same handful appearing in all 21 sports.
  const cursor = new Map(orgs.map((o) => [o.id, 0]));

  for (const d of teamDraws) {
    const size = SQUAD_SIZE[d.sport] ?? DEFAULT_SQUAD;
    const ids: string[] = [];
    for (const o of orgs) {
      const teamId = randomUUID();
      teams.push({ id: teamId, sport_id: sportId.get(d.sport), organization_id: o.id, name: `${o.short_name} ${d.label}`, status: 'approved' });
      ids.push(teamId);

      const pool = roster.get(o.id)!;
      let at = cursor.get(o.id)!;
      for (let i = 0; i < size; i++) {
        const uid = pool[(at + i) % pool.length];
        squads.push({ id: randomUUID(), team_id: teamId, user_id: uid, role: i === 0 ? 'captain' : 'player', jersey_number: i + 1 });
      }
      cursor.set(o.id, (at + size) % pool.length);

      entries.push({
        id: randomUUID(), team_id: teamId, organization_id: o.id, championship_id: champId,
        championship_organization_id: champOrgByOrg.get(o.id), tournament_discipline_id: d.tdId, status: 'approved',
      });
    }
    teamsByDraw.set(d.tdId, ids);
  }

  await prisma.teams.createMany({ data: teams });
  track('teams', teams.map((t) => t.id));
  await prisma.team_members.createMany({ data: squads });
  track('team_members', squads.map((s) => s.id));
  await prisma.team_entries.createMany({ data: entries });
  track('team_entries', entries.map((e) => e.id));

  // -- event roles -----------------------------------------------------------
  const ucr: any[] = [];
  const addRole = (userId: string, code: string) => {
    const rid = eventRole(code);
    if (rid) ucr.push({ id: randomUUID(), user_id: userId, championship_id: champId, role_id: rid, assigned_by: organiserId });
  };
  addRole(organiserId, 'organiser');
  officialIds.forEach((id) => addRole(id, 'official'));
  pocs.forEach((p) => addRole(p.id, 'poc'));
  if (ucr.length) { await prisma.user_championship_roles.createMany({ data: ucr }); track('user_championship_roles', ucr.map((r) => r.id)); }

  const coffs = officialIds.map((id) => ({ id: randomUUID(), championship_id: champId, user_id: id, assigned_by: organiserId }));
  await prisma.championship_officials.createMany({ data: coffs });
  track('championship_officials', coffs.map((c) => c.id));

  // -- fixtures --------------------------------------------------------------
  // Six entrants, so the standard bracket is: seeds 1 and 2 bye into the semis,
  // 3v6 and 4v5 play the quarters. Day 1 quarters, day 2 semis, day 3 the finals.
  const PLAYED = C.championship.playedThroughDay;
  let offRR = 0; const nextOfficial = () => officialIds[offRR++ % officialIds.length];

  // Slots are allocated PER DAY and spread across the grounds in parallel, so a
  // day's play stays inside that day. A single running counter at 25 minutes a
  // slot overflowed 84 quarter-finals into the next two days - finals ended up
  // dated after the championship's own end_date.
  const perDay = new Map<number, number>();
  const slotOn = (day: number) => {
    const n = perDay.get(day) ?? 0;
    perDay.set(day, n + 1);
    return {
      // 03:30Z = 09:00 IST. Four grounds run concurrently, 20 minutes a round.
      at: new Date(dayDate(day).getTime() + (210 + Math.floor(n / groundIds.length) * 20) * 60000),
      ground: groundIds[n % groundIds.length],
    };
  };

  const fixtures: any[] = [];
  const awards: any[] = [];
  let liveBudget = 6; // a handful of day-3 matches in progress, for the live demo

  teamDraws.forEach((d, di) => {
    const base6 = teamsByDraw.get(d.tdId)!; // teams in organisation order
    const shortOf = new Map(base6.map((id, i) => [id, orgs[i].short_name]));
    // Seeded strongest first, as a real draw would be - the same institutions are
    // top seeds across the championship, and upsets are what make it interesting.
    const T = [...base6].sort((a, b) => STRENGTH[shortOf.get(b)!] - STRENGTH[shortOf.get(a)!]);
    const pick = (a: string, b: string, round: number, pos: number) =>
      STRENGTH[shortOf.get(a)!] + jitter(di, round, pos, shortOf.get(a)!)
        >= STRENGTH[shortOf.get(b)!] + jitter(di, round, pos, shortOf.get(b)!) ? [a, b] : [b, a];
    const [ws, ls] = scorePair(d.sport);
    const base = (day: number, extra: any) => {
      const s = slotOn(day);
      return {
        id: randomUUID(), tournament_discipline_id: d.tdId, official_id: nextOfficial(),
        venue_ground_id: s.ground, scheduled_at: s.at, ...extra,
      };
    };
    const won = (winner: string, loser: string) => d.kind === 'tie'
      ? { home_team_id: winner, away_team_id: loser, status: 'completed', winner_team_id: winner, ...tieCompleted(d.sport) }
      : { home_team_id: winner, away_team_id: loser, status: 'completed', winner_team_id: winner, home_score: ws, away_score: ls };

    // Day 1 - quarter-finals. Seeds 1 and 2 are recorded as byes so the bracket
    // reads correctly rather than starting with two unexplained empty slots.
    fixtures.push(base(1, { round: 'Quarter-final', bracket_position: 1, home_team_id: T[0], away_team_id: null, status: 'bye', winner_team_id: T[0] }));
    fixtures.push(base(1, { round: 'Quarter-final', bracket_position: 2, home_team_id: T[1], away_team_id: null, status: 'bye', winner_team_id: T[1] }));
    const [q3w, q3l] = pick(T[2], T[5], 1, 3);
    const [q4w, q4l] = pick(T[3], T[4], 1, 4);
    fixtures.push(base(1, { round: 'Quarter-final', bracket_position: 3, ...won(q3w, q3l) }));
    fixtures.push(base(1, { round: 'Quarter-final', bracket_position: 4, ...won(q4w, q4l) }));

    // Which day a draw CONCLUDES. Most sports finish on day 2, a third run their
    // finals on the last day - which is how a real three-day meet actually runs,
    // and it is also what makes the medal table work: placement points (winner /
    // runner-up / semi-finalist) are only awarded once a draw is finished, so a
    // championship where every final is unplayed scores nothing but participation
    // and the table comes out dead level.
    const finishesOn = di % 3 === 0 ? 3 : 2;
    const sfDay = finishesOn === 3 ? 2 : 1;

    const [s1w, s1l] = pick(T[0], q4w, 2, 1);
    const [s2w, s2l] = pick(T[1], q3w, 2, 2);
    fixtures.push(base(sfDay, { round: 'Semi-final', bracket_position: 1, ...won(s1w, s1l) }));
    fixtures.push(base(sfDay, { round: 'Semi-final', bracket_position: 2, ...won(s2w, s2l) }));

    const [fw, fl] = pick(s1w, s2w, 3, 1);
    const [tw, tl] = pick(s1l, s2l, 3, 2);
    const finalId = randomUUID();

    if (finishesOn <= PLAYED) {
      // Done and dusted: a medal, a runner-up and a third place on the board.
      fixtures.push({ ...base(finishesOn, { round: 'Final', bracket_position: 1, ...won(fw, fl) }), id: finalId });
      fixtures.push(base(finishesOn, { round: 'Third-place', bracket_position: 1, ...won(tw, tl) }));
    } else {
      // Still to play today. A few are left mid-match for the live-scoring demo.
      const goLive = liveBudget > 0;
      if (goLive) liveBudget--;
      const live = d.kind === 'tie'
        ? { home_team_id: s1w, away_team_id: s2w, status: 'live', ...tieLive(d.sport) }
        : { home_team_id: s1w, away_team_id: s2w, status: 'live', home_score: Math.ceil(ws / 2), away_score: Math.floor(ls / 2) };
      fixtures.push({
        ...base(3, { round: 'Final', bracket_position: 1, ...(goLive ? live : { home_team_id: s1w, away_team_id: s2w, status: 'scheduled' }) }),
        id: finalId,
      });
      fixtures.push(base(3, { round: 'Third-place', bracket_position: 1, home_team_id: s1l, away_team_id: s2l, status: 'scheduled' }));
    }

    // Player of the Match on the finals that have actually been played, so the
    // awards surface has content without inventing one for an unplayed match.
    if (finishesOn <= PLAYED && di % 4 === 0) {
      const cap = squads.find((s) => s.team_id === fw && s.role === 'captain');
      if (cap) awards.push({ id: randomUUID(), fixture_id: finalId, recipient_user_id: cap.user_id, award_name: 'Player of the Match' });
    }
  });

  // Rankings events (Swimming, Powerlifting): no teams, marks per athlete.
  for (const d of draws.filter((x) => x.kind === 'event')) {
    const spec = eventTemplateFor(d.sport)!.event!;
    const mark = (i: number, j: number) => (spec.result.winnerIs === 'min' ? 12 + i + j * 0.3 : 200 - i * 5 + j * 10);
    const participants = orgs.map((o, i) => {
      const pool = roster.get(o.id)!;
      const uid = pool[pool.length - 1 - i];
      const who = userData.find((u) => u.id === uid)!;
      const seat = { id: uid, name: who.name, org: o.name, orgId: o.id };
      if (spec.pickOne) {
        // One weight class per lifter so each class has several entries and the
        // within-class ranking is real rather than a single name per category.
        const cat = spec.subEvents[i % 2].key;
        return { ...seat, category: cat, marks: { [cat]: mark(i, 0) } };
      }
      const subs = spec.subEvents.slice(0, 3).map((s) => s.key);
      return { ...seat, marks: Object.fromEntries(subs.map((k, j) => [k, mark(i, j)])) };
    });
    const slot = slotOn(2);
    fixtures.push({
      id: randomUUID(), tournament_discipline_id: d.tdId, official_id: nextOfficial(),
      venue_ground_id: slot.ground, scheduled_at: slot.at, round: 'Event',
      status: PLAYED >= 2 ? 'completed' : 'scheduled',
      home_team_id: null, away_team_id: null, live_state: { event: { participants } },
    });
  }

  await prisma.fixtures.createMany({ data: fixtures });
  track('fixtures', fixtures.map((f) => f.id));
  if (awards.length) { await prisma.fixture_awards.createMany({ data: awards }); track('fixture_awards', awards.map((a) => a.id)); }

  // -- downstream records ----------------------------------------------------
  // A completed match is not just a score: it is a line on every player's lifetime
  // timeline, a medal where one was won, a per-player stat row and a career total.
  // Rather than fabricate those, run the SAME derivations the scorecard lock runs
  // (lock.service.ts steps 5-7) over every played fixture - so the demo's records
  // are the product's own output and agree with the results by construction.
  //
  // The lock's own orchestration is deliberately NOT reused: it would re-run
  // advanceWinnerStrict against a bracket this seed has already built, and its
  // audit step wants an HTTP actor there is none of here.
  const played = fixtures.filter((f) => f.status === 'completed');
  let derived = 0;
  const deriveOne = async (f: any) => {
    try {
      const participants = await resolveFixtureParticipants(prisma as any, f.id);
      await writeLifetimeEntries(prisma as any, f.id, { participants });
      await deriveAchievements(prisma as any, f.id, { participants });
      await writeStatLines(prisma as any, f.id, { participants });
      await refreshCareerStatsForFixture(prisma as any, f.id);
      derived++;
    } catch (e) {
      // One sport's stat shape failing must not cost the whole demo its records.
      console.warn(`  ! records for ${f.id}: ${e instanceof Error ? e.message : e}`);
    }
  };
  // Eight at a time: each fixture is independent and the cost here is round-trips
  // to a remote pooler, not work. Serially this step alone took minutes.
  for (let i = 0; i < played.length; i += 8) {
    await Promise.all(played.slice(i, i + 8).map(deriveOne));
  }
  // Played fixtures read as verified, which is what makes the records above legible
  // in the UI - an unlocked card claims the result is still provisional.
  await prisma.fixtures.updateMany({
    where: { id: { in: played.map((f) => f.id) } },
    data: { scorecard_status: 'locked', locked_at: new Date(), locked_by: officialIds[0] },
  });
  console.log(`derived records for ${derived}/${played.length} played fixtures`);

  // -- standings -------------------------------------------------------------
  await recomputeStandings(prisma as any, champId);
  const standingsRows = await prisma.standings.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('standings', standingsRows.map((s) => s.id));
  saveManifest();

  // -- summary ---------------------------------------------------------------
  const counts = Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length]));
  const d = (x: Date) => x.toISOString().slice(0, 10);
  console.log('\n===============  INTER IIM 2026 SEEDED  ===============');
  console.log('took', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log(`\n${C.championship.name}`);
  console.log('  id      ', champId);
  console.log('  slug    ', slug);
  console.log('  dates   ', `${d(startDate)} → ${d(endDate)} (day ${C.championship.days} is today; days 1-${PLAYED} played)`);
  console.log('  host    ', hostOrg.name);
  console.log('  draws   ', `${C.draws.length} across ${new Set(C.draws.map((x) => x.sport)).size} sports`);
  console.log('\nrow counts:', JSON.stringify(counts, null, 2));
  console.log(`\nLOGINS (password for every account: ${C.password})`);
  console.log(`  Organiser      · Events Space    ${C.accounts.organiser.email}   (${C.accounts.organiser.name})`);
  console.log(`  Player         · Personal Space  ${C.accounts.player.email}   (${C.accounts.player.name}, ${C.accounts.player.organization})`);
  console.log(`  Inst. Admin    · Org Space       ${C.accounts.institutionAdmin.email}   (${C.accounts.institutionAdmin.name}, ${C.accounts.institutionAdmin.organization})`);
  console.log(`  Other POCs                       poc.iimb@${C.emailDomain} … poc.iims@${C.emailDomain}`);
  console.log(`  Officials                        official1@${C.emailDomain} … official${C.officials}@${C.emailDomain}`);

  // Named people worth opening on screen, picked from what was actually created:
  // a captain is only interesting if their team played, so these are read back
  // from the squads rather than guessed at.
  const byId = new Map(userData.map((u) => [u.id, u]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const playedTeamIds = new Set(played.flatMap((f) => [f.home_team_id, f.away_team_id]).filter(Boolean));
  // One per sport, not the first six rows - those are all the same draw, and six
  // badminton captains tells you nothing about a twenty-sport championship.
  const seenSport = new Set<string>();
  const captains = squads
    .filter((s) => s.role === 'captain' && playedTeamIds.has(s.team_id))
    .map((s) => ({ s, t: teamById.get(s.team_id)! }))
    .filter(({ t }) => (seenSport.has(t.sport_id) ? false : (seenSport.add(t.sport_id), true)))
    .slice(0, 6)
    .map(({ s, t }) => ({
      u: byId.get(s.user_id)!, team: t.name, org: orgById.get(t.organization_id)!.short_name,
    }));

  console.log('\n  CAPTAINS (teams that have played - these have records and stats)');
  for (const c of captains) console.log(`    ${String(c.u.email).padEnd(28)} ${c.u.name} · ${c.team}`);

  // A few plain players from the host institution, for the Personal Space story.
  const hostPlayers = roster.get(hostOrg.id)!.slice(1, 5).map((id) => byId.get(id)!);
  console.log(`\n  PLAYERS (${hostOrg.name})`);
  for (const u of hostPlayers) console.log(`    ${String(u.email).padEnd(28)} ${u.name}`);
  console.log(`\n  Every participant also logs in: p1@${C.emailDomain} … p${C.participantsPerOrganization * orgs.length}@${C.emailDomain}`);
  console.log('\nCleanup:  npx tsx scripts/seed-inter-iim.ts cleanup');
  console.log('=======================================================\n');
}

async function cleanup() {
  if (!existsSync(MANIFEST)) { console.error('No manifest found - nothing to clean up.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const order = [
    'fixture_awards', 'standings', 'fixtures', 'team_entries', 'team_members',
    'org_unit_members', 'org_units',
    'championship_officials', 'user_championship_roles', 'championship_organizations',
    'organization_members', 'standings_rules', 'tournament_disciplines', 'tournament_sports',
    'venue_grounds', 'venues', 'tournaments', 'teams', 'championships', 'users', 'organizations',
  ];
  const t0 = Date.now();

  // Derived records first, and NOT by manifest id: the lifetime timeline, medals and
  // per-player stat lines were written by the product's own derivations, so this
  // script never tracked their ids. They are found by the people and fixtures that
  // ARE tracked. Without this the users delete fails on
  // lifetime_entries_user_id_fkey and the cleanup strands everything behind it.
  const userIds = m.users ?? [];
  const fixtureIds = m.fixtures ?? [];
  for (const [table, where] of [
    ['player_match_stats', { user_id: { in: userIds } }],
    ['fixture_events', { fixture_id: { in: fixtureIds } }],
    ['career_stats', { user_id: { in: userIds } }],
    ['achievements', { user_id: { in: userIds } }],
    ['lifetime_entries', { user_id: { in: userIds } }],
  ] as const) {
    if (!userIds.length && !fixtureIds.length) break;
    try {
      const res = await (prisma as any)[table].deleteMany({ where });
      if (res.count) console.log(`deleted ${res.count} ${table} (derived)`);
    } catch (e) {
      console.warn(`  ! ${table}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
  }

  for (const table of order) {
    const ids = m[table];
    if (!ids?.length) continue;
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
