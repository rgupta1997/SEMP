/*
 * The seeding engine: a blueprint in, a fully-populated championship out.
 *
 * This is the ONE implementation. The super-admin builder posts a blueprint and
 * this runs it; `scripts/seed-inter-iim.ts` is a thin CLI over the same function.
 * Two engines would drift, and the way that fails is a demo that behaves
 * differently depending on which door built it.
 *
 * It reuses the GLOBAL catalogue (sports / disciplines / formats / roles) and never
 * creates or deletes any of it. Every row it does create is tracked, so teardown
 * removes exactly what was made and nothing else.
 *
 * Runs detached - a full build is minutes, not seconds, and the API has a 15s
 * ceiling on Lambda. The row's `status` is the progress signal the UI polls.
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { SeedBlueprint } from '@semp/shared';
import { KNOCKOUT_ROUND, tieTemplateFor, eventTemplateFor, initTie, decideRubber, tieWinner, rubbersWon } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { recomputeStandings } from '../standings/standings.service.js';
import { resolveFixtureParticipants } from '../fixtures/participants.js';
import { writeLifetimeEntries, deriveAchievements, writeStatLines } from '../fixtures/downstream.js';
import { catalogAwardTypeIds } from '../awards/award-types.service.js';
import { refreshCareerStatsForFixture } from '../records/career-stats.service.js';

/**
 * Minimum squad each sport actually needs, when a draw does not state one. A
 * Cricket XI with five players is the kind of detail that collapses a demo under
 * a question.
 */
const SQUAD_SIZE: Record<string, number> = {
  Cricket: 11, Football: 11, Hockey: 11, 'Box Cricket': 8, 'Kho-Kho': 9,
  Kabaddi: 7, Throwball: 7, Frisbee: 7, Volleyball: 6, Basketball: 5, Futsal: 5,
};
const DEFAULT_SQUAD = 4; // racquet / board ties: enough bodies for every rubber

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

/**
 * Knuth multiplicative hash, salted per field.
 *
 * Any LINEAR mix of the sequence number and the roster index collapses, because
 * the two are linearly dependent within an organisation (i = seq - 1): `seq*7 + i`
 * is `8*seq - 1`, which mod 16 surnames only ever lands on two of them. The first
 * version of this produced a captains list where everyone was called Rao.
 */
const hashPick = (n: number, salt: number) => (Math.imul(n + salt * 7919, 2654435761) >>> 8) & 0xffff;

/**
 * Relative strength, assigned by position in the organisation list.
 *
 * Results have to depend on WHO a team is, not which bracket seat it sits in: a
 * purely positional bracket gives every organisation the same placement points once
 * the seeding rotates, and the medal table comes out a flat tie. The jitter below
 * must EXCEED the strength spread, or the weakest entrants never win anything.
 */
const strengthOf = (index: number, total: number) => total - index;
const jitter = (di: number, round: number, pos: number, short: string) =>
  (di * 31 + round * 17 + pos * 7 + short.charCodeAt(Math.min(3, short.length - 1))) % 7;

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

/** Mid-tie: one rubber banked, the next on court. Used for the live final-day fixtures. */
function tieLive(sport: string) {
  const spec = tieTemplateFor(sport)!.tie!;
  let st = initTie(spec);
  st = decideRubber(spec, st, 0, 'A');
  if (st.rubbers[1]) { st.rubbers[1].status = 'live'; st.rubbers[1].state.a = 8; st.rubbers[1].state.b = 6; }
  const { a, b } = rubbersWon(st);
  return { home_score: a, away_score: b, live_state: { tie: st } };
}

export interface SeedTracker {
  track: (table: string, ids: string | string[]) => void;
  flush: () => Promise<unknown>;
  /** Progress line for the UI; safe to no-op. */
  note?: (message: string) => void;
}

export interface BlueprintResult {
  championshipId: string;
  slug: string;
  startDate: Date;
  endDate: Date;
  counts: Record<string, number>;
  logins: Array<{ role: string; workspace: string; name: string; email: string; detail?: string }>;
}

export async function buildFromBlueprint(
  prisma: Prisma,
  bp: SeedBlueprint,
  slugBase: string,
  tracker: SeedTracker,
): Promise<BlueprintResult> {
  const { track, flush } = tracker;
  const note = tracker.note ?? (() => {});

  // -- dates -----------------------------------------------------------------
  // The last day is the day it was built unless fixed_start pins it, so a demo
  // always opens on a championship in progress rather than one that finished weeks
  // ago - or, worse, one whose results are dated in the future.
  const midnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const startDate = bp.championship.fixed_start
    ? midnight(new Date(bp.championship.fixed_start))
    : midnight(new Date(Date.now() - (bp.championship.days - 1) * 86400000));
  const dayDate = (day: number) => new Date(startDate.getTime() + (day - 1) * 86400000);
  const endDate = dayDate(bp.championship.days);
  const PLAYED = Math.min(bp.championship.played_through_day, bp.championship.days);

  // -- global catalogue ------------------------------------------------------
  const [sportsRows, formatsRows, rolesRows, discRows] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ select: { id: true, code: true, scope: true } }),
    prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } }),
  ]);
  const sportId = new Map(sportsRows.map((s) => [s.name, s.id]));
  const formatId = new Map(formatsRows.map((f) => [f.name, f.id]));
  // Resolved by CODE and single_event scope: names repeat across scopes in this
  // catalogue, so looking one up by name alone silently picks whichever sorts first.
  const eventRole = (code: string) =>
    rolesRows.find((r) => r.code === code && r.scope === 'single_event')?.id
    ?? rolesRows.find((r) => r.code === code)?.id ?? null;

  const discId = (sport: string, name: string) => {
    const sid = sportId.get(sport);
    const d = discRows.find((x) => x.sport_id === sid && x.name === name);
    if (!d) throw new Error(`Discipline not found: ${sport} / ${name}`);
    return d.id;
  };
  for (const d of bp.draws) {
    if (!sportId.get(d.sport)) throw new Error(`Sport not in catalogue: ${d.sport}`);
    if (!formatId.get(d.format)) throw new Error(`Format not in catalogue: ${d.format}`);
  }

  // -- organizations ---------------------------------------------------------
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  const prefix = slugBase.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'SEED';
  const orgs = bp.organizations.map((o, i) => ({
    id: randomUUID(), name: o.name, short_name: o.short,
    code: `${prefix}-${o.short}-${suffix}`, city: o.city ?? null, _i: i,
  }));
  await prisma.organizations.createMany({ data: orgs.map(({ _i, ...o }) => o) });
  track('organizations', orgs.map((o) => o.id));
  const orgByName = new Map(orgs.map((o) => [o.name, o]));
  const hostOrg = orgByName.get(bp.host_organization);
  if (!hostOrg) throw new Error(`Host "${bp.host_organization}" is not one of the organizations`);
  await flush();
  note(`${orgs.length} organizations`);

  // -- championship ----------------------------------------------------------
  const champId = randomUUID();
  const slug = `${slugBase}-${suffix.toLowerCase()}`;
  await prisma.championships.create({
    data: {
      id: champId, name: bp.championship.name, slug,
      description: bp.championship.description ?? null,
      venue: bp.championship.venue ?? null,
      start_date: startDate, end_date: endDate, status: 'ongoing',
      visibility: bp.championship.visibility, host_organization_id: hostOrg.id,
      entry_level: 'organization',
    },
  });
  track('championships', champId);

  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({
    data: {
      id: venueId, championship_id: champId,
      name: `${bp.championship.venue ?? bp.championship.name} Sports Complex`,
      city: bp.championship.city ?? null,
    },
  });
  track('venues', venueId);
  const grounds = ['Indoor Arena', 'Main Ground', 'Athletics & Pool', 'Court Complex']
    .map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));
  const groundIds = grounds.map((g) => g.id);

  const ruleId = randomUUID();
  await prisma.standings_rules.create({
    data: {
      id: ruleId, championship_id: champId, scope_type: 'championship', scope_id: null,
      config: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
    },
  });
  track('standings_rules', ruleId);
  await flush();

  // -- draws -----------------------------------------------------------------
  const tsBySport = new Map<string, string>();
  const tsData: any[] = [];
  let order = 0;
  for (const sport of new Set(bp.draws.map((d) => d.sport))) {
    const id = randomUUID();
    tsBySport.set(sport, id);
    tsData.push({ id, tournament_id: tournamentId, sport_id: sportId.get(sport), format_id: formatId.get('Knockout'), display_order: order++ });
  }
  await prisma.tournament_sports.createMany({ data: tsData });
  track('tournament_sports', tsData.map((t) => t.id));

  type DrawCtx = { sport: string; label: string; tdId: string; kind: 'single' | 'tie' | 'event'; squad: number };
  const draws: DrawCtx[] = [];
  const tdData: any[] = [];
  for (const d of bp.draws) {
    const tdId = randomUUID();
    // How a sport is scored is a property of the sport, not of the blueprint: the
    // shared templates decide, exactly as discipline setup does in the product.
    const kind: DrawCtx['kind'] = tieTemplateFor(d.sport) ? 'tie' : eventTemplateFor(d.sport) ? 'event' : 'single';
    const scoring = kind === 'tie' ? tieTemplateFor(d.sport) : kind === 'event' ? eventTemplateFor(d.sport) : undefined;
    const squad = d.squad ?? SQUAD_SIZE[d.sport] ?? DEFAULT_SQUAD;
    tdData.push({
      id: tdId, tournament_sport_id: tsBySport.get(d.sport), discipline_id: discId(d.sport, d.discipline),
      format_id: formatId.get(d.format), venue_id: venueId, status: 'ongoing', display_order: draws.length,
      entry_type: kind === 'event' ? 'individual' : 'team',
      squad_min: kind === 'event' ? null : squad,
      format_config: scoring ? { scoring } : {},
    });
    draws.push({ sport: d.sport, label: `${d.sport} ${d.discipline}`, tdId, kind, squad });
  }
  await prisma.tournament_disciplines.createMany({ data: tdData });
  track('tournament_disciplines', tdData.map((t) => t.id));
  await flush();
  note(`${draws.length} draws`);

  // -- people ----------------------------------------------------------------
  const hash = await bcrypt.hash(bp.password, 10);
  const userData: any[] = [];
  const mk = (name: string, email: string, extra: any = {}) => {
    const id = randomUUID();
    userData.push({ id, name, email, password_hash: hash, email_verified_at: new Date(), ...extra });
    return id;
  };

  const organiserId = mk(bp.accounts.organiser.name, bp.accounts.organiser.email, {
    account_type: 'institution', organization_id: hostOrg.id,
  });
  const officialIds = Array.from({ length: bp.officials }, (_, i) =>
    mk(`Official ${i + 1}`, `official${i + 1}@${bp.email_domain}`, { account_type: 'institution' }));

  const adminOrg = orgByName.get(bp.accounts.institution_admin.organization) ?? hostOrg;
  const pocs = orgs.map((o) => {
    const named = o.id === adminOrg.id;
    const id = named
      ? mk(bp.accounts.institution_admin.name, bp.accounts.institution_admin.email, { account_type: 'institution', organization_id: o.id })
      : mk(`POC ${o.short_name}`, `poc.${o.short_name.toLowerCase()}@${bp.email_domain}`, { account_type: 'institution', organization_id: o.id });
    return { id, orgId: o.id };
  });

  const playerOrg = orgByName.get(bp.accounts.player.organization) ?? hostOrg;
  const roster = new Map<string, string[]>();
  let seq = 0;
  for (const o of orgs) {
    const ids: string[] = [];
    for (let i = 0; i < bp.participants_per_organization; i++) {
      seq++;
      if (o.id === playerOrg.id && i === 0) {
        ids.push(mk(bp.accounts.player.name, bp.accounts.player.email, { account_type: 'participant', organization_id: o.id }));
        continue;
      }
      const name = `${FIRST[hashPick(seq, 1) % FIRST.length]} ${LAST[hashPick(seq, 2) % LAST.length]}`;
      ids.push(mk(name, `p${seq}@${bp.email_domain}`, { account_type: 'participant', organization_id: o.id }));
    }
    roster.set(o.id, ids);
  }

  await prisma.users.createMany({ data: userData });
  track('users', userData.map((u) => u.id));
  await flush();
  note(`${userData.length} people`);

  // EVERY person needs an organization_members row, not just a users.organization_id:
  // the Org Space people list reads organization_members and nothing else, while
  // events reach players through team_members. Setting only the column gives you a
  // championship full of players and an organisation with nobody in it.
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
  // The organiser runs this championship FOR the host, so they belong to it - as an
  // admin, not an owner: the POC still owns the organisation.
  members.push({
    id: randomUUID(), user_id: organiserId, organization_id: hostOrg.id, role: 'admin',
    status: 'active', verification: 'verified', verified_by: pocByOrg.get(hostOrg.id)!, verified_at: new Date(),
  });
  await prisma.organization_members.createMany({ data: members });
  track('organization_members', members.map((m) => m.id));

  // Campus and batches, with every participant placed in one - without these the
  // campus and roll surfaces are empty even once the people list fills up.
  const units: any[] = [];
  const unitMembers: any[] = [];
  for (const o of orgs) {
    const campusId = randomUUID();
    units.push({ id: campusId, organization_id: o.id, type: 'campus', name: `${o.name} Campus`, code: `${o.short_name}-CAMP`, status: 'ACTIVE', display_order: 0, admin_user_id: pocByOrg.get(o.id)! });
    const batches = ['Batch A', 'Batch B', 'Batch C'].map((name, i) => ({
      id: randomUUID(), organization_id: o.id, parent_id: campusId, type: 'department',
      name, code: `${o.short_name}-${name.replace(/\W/g, '')}`, status: 'ACTIVE', display_order: i + 1,
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
  await flush();

  // -- teams, squads, entries ------------------------------------------------
  const teamDraws = draws.filter((d) => d.kind !== 'event');
  const teams: any[] = [];
  const squads: any[] = [];
  const entries: any[] = [];
  const teamsByDraw = new Map<string, string[]>();
  // One cursor per organisation walking its roster, so squads are drawn from the
  // whole roll rather than the same handful appearing in every sport.
  const cursor = new Map(orgs.map((o) => [o.id, 0]));

  for (const d of teamDraws) {
    const ids: string[] = [];
    for (const o of orgs) {
      const teamId = randomUUID();
      teams.push({ id: teamId, sport_id: sportId.get(d.sport), organization_id: o.id, name: `${o.short_name} ${d.label}`, status: 'approved' });
      ids.push(teamId);
      const pool = roster.get(o.id)!;
      const at = cursor.get(o.id)!;
      for (let i = 0; i < Math.min(d.squad, pool.length); i++) {
        squads.push({ id: randomUUID(), team_id: teamId, user_id: pool[(at + i) % pool.length], role: i === 0 ? 'captain' : 'player', jersey_number: i + 1 });
      }
      cursor.set(o.id, (at + d.squad) % pool.length);
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
  await flush();
  note(`${teams.length} teams`);

  // -- roles -----------------------------------------------------------------
  const ucr: any[] = [];
  const addRole = (userId: string, code: string) => {
    const rid = eventRole(code);
    if (rid) ucr.push({ id: randomUUID(), user_id: userId, championship_id: champId, role_id: rid, assigned_by: organiserId });
  };
  addRole(organiserId, 'organiser');
  officialIds.forEach((id) => addRole(id, 'official'));
  pocs.forEach((p) => addRole(p.id, 'poc'));
  if (ucr.length) { await prisma.user_championship_roles.createMany({ data: ucr }); track('user_championship_roles', ucr.map((r) => r.id)); }
  if (officialIds.length) {
    const coffs = officialIds.map((id) => ({ id: randomUUID(), championship_id: champId, user_id: id, assigned_by: organiserId }));
    await prisma.championship_officials.createMany({ data: coffs });
    track('championship_officials', coffs.map((c) => c.id));
  }

  // -- fixtures --------------------------------------------------------------
  // N entrants seeded strongest-first: the top two bye into the semis and the rest
  // play a quarter, which is what a real small draw does.
  let offRR = 0;
  const nextOfficial = () => (officialIds.length ? officialIds[offRR++ % officialIds.length] : null);
  // Slots are allocated PER DAY and spread across the grounds in parallel, so a
  // day's play stays inside that day. One running counter overflowed the quarters
  // into the next two days and dated finals after the championship's own end_date.
  const perDay = new Map<number, number>();
  const slotOn = (day: number) => {
    const n = perDay.get(day) ?? 0;
    perDay.set(day, n + 1);
    return {
      // 03:30Z = 09:00 IST, four grounds concurrently, 20 minutes a round.
      at: new Date(dayDate(day).getTime() + (210 + Math.floor(n / groundIds.length) * 20) * 60000),
      ground: groundIds[n % groundIds.length],
    };
  };

  const fixtures: any[] = [];
  const awards: any[] = [];
  const potmTypeId = (await catalogAwardTypeIds(prisma, ['player_of_the_match'])).get('player_of_the_match') ?? null;
  let liveBudget = bp.championship.live_finals;

  teamDraws.forEach((d, di) => {
    const base6 = teamsByDraw.get(d.tdId)!;
    const shortOf = new Map(base6.map((id, i) => [id, orgs[i].short_name]));
    const strength = new Map(base6.map((id, i) => [id, strengthOf(i, base6.length)]));
    const T = [...base6].sort((a, b) => strength.get(b)! - strength.get(a)!);
    const pick = (a: string, b: string, round: number, pos: number) =>
      strength.get(a)! + jitter(di, round, pos, shortOf.get(a)!)
        >= strength.get(b)! + jitter(di, round, pos, shortOf.get(b)!) ? [a, b] : [b, a];

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

    // Quarters: the top two bye, the rest pair off from the bottom.
    const byes = Math.max(0, 4 - Math.max(0, T.length - 4));
    for (let i = 0; i < Math.min(byes, T.length); i++) {
      fixtures.push(base(1, { round: 'Quarter-final', bracket_position: i + 1, home_team_id: T[i], away_team_id: null, status: 'bye', winner_team_id: T[i] }));
    }
    const qfWinners: string[] = T.slice(0, Math.min(byes, T.length));
    let pos = byes;
    for (let i = byes; i + 1 < T.length; i += 2) {
      const [w, l] = pick(T[i], T[i + 1], 1, ++pos);
      fixtures.push(base(1, { round: 'Quarter-final', bracket_position: pos, ...won(w, l) }));
      qfWinners.push(w);
    }

    // Which day a draw CONCLUDES. Most finish earlier, a third run finals on the
    // last day - which is how a real multi-day meet runs, and it is also what makes
    // the medal table work: placement points are only awarded once a draw is
    // finished, so a championship where every final is unplayed scores nothing but
    // participation and the table comes out dead level.
    const finishesOn = di % 3 === 0 ? bp.championship.days : Math.max(1, Math.min(PLAYED, bp.championship.days - 1));
    const sfDay = Math.max(1, finishesOn - 1);

    const [s1w, s1l] = pick(qfWinners[0] ?? T[0], qfWinners[3] ?? qfWinners[1] ?? T[1], 2, 1);
    const [s2w, s2l] = pick(qfWinners[1] ?? T[1], qfWinners[2] ?? T[2] ?? T[0], 2, 2);
    fixtures.push(base(sfDay, { round: 'Semi-final', bracket_position: 1, ...won(s1w, s1l) }));
    fixtures.push(base(sfDay, { round: 'Semi-final', bracket_position: 2, ...won(s2w, s2l) }));

    const [fw, fl] = pick(s1w, s2w, 3, 1);
    const [tw, tl] = pick(s1l, s2l, 3, 2);
    const finalId = randomUUID();

    if (finishesOn <= PLAYED) {
      fixtures.push({ ...base(finishesOn, { round: KNOCKOUT_ROUND.final, bracket_position: 1, ...won(fw, fl) }), id: finalId });
      fixtures.push(base(finishesOn, { round: 'Third-place', bracket_position: 1, ...won(tw, tl) }));
    } else {
      const goLive = liveBudget > 0;
      if (goLive) liveBudget--;
      const live = d.kind === 'tie'
        ? { home_team_id: s1w, away_team_id: s2w, status: 'live', ...tieLive(d.sport) }
        : { home_team_id: s1w, away_team_id: s2w, status: 'live', home_score: Math.ceil(ws / 2), away_score: Math.floor(ls / 2) };
      fixtures.push({
        ...base(bp.championship.days, { round: KNOCKOUT_ROUND.final, bracket_position: 1, ...(goLive ? live : { home_team_id: s1w, away_team_id: s2w, status: 'scheduled' }) }),
        id: finalId,
      });
      fixtures.push(base(bp.championship.days, { round: 'Third-place', bracket_position: 1, home_team_id: s1l, away_team_id: s2l, status: 'scheduled' }));
    }

    if (finishesOn <= PLAYED && di % 4 === 0) {
      const cap = squads.find((s) => s.team_id === fw && s.role === 'captain');
      if (cap) awards.push({ id: randomUUID(), fixture_id: finalId, recipient_user_id: cap.user_id, award_name: 'Player of the Match', award_type_id: potmTypeId });
    }
  });

  // Rankings events: no teams, marks per athlete.
  for (const d of draws.filter((x) => x.kind === 'event')) {
    const spec = eventTemplateFor(d.sport)!.event!;
    const mark = (i: number, j: number) => (spec.result.winnerIs === 'min' ? 12 + i + j * 0.3 : 200 - i * 5 + j * 10);
    const participants = orgs.map((o, i) => {
      const pool = roster.get(o.id)!;
      const uid = pool[pool.length - 1 - (i % pool.length)];
      const who = userData.find((u) => u.id === uid)!;
      const seat = { id: uid, name: who.name, org: o.name, orgId: o.id };
      if (spec.pickOne) {
        const cat = spec.subEvents[i % Math.max(1, spec.subEvents.length)].key;
        return { ...seat, category: cat, marks: { [cat]: mark(i, 0) } };
      }
      const subs = spec.subEvents.slice(0, 3).map((s) => s.key);
      return { ...seat, marks: Object.fromEntries(subs.map((k, j) => [k, mark(i, j)])) };
    });
    const slot = slotOn(Math.max(1, PLAYED));
    fixtures.push({
      id: randomUUID(), tournament_discipline_id: d.tdId, official_id: nextOfficial(),
      venue_ground_id: slot.ground, scheduled_at: slot.at, round: 'Event',
      status: PLAYED >= 1 ? 'completed' : 'scheduled',
      home_team_id: null, away_team_id: null, live_state: { event: { participants } },
    });
  }

  await prisma.fixtures.createMany({ data: fixtures });
  track('fixtures', fixtures.map((f) => f.id));
  if (awards.length) { await prisma.fixture_awards.createMany({ data: awards }); track('fixture_awards', awards.map((a) => a.id)); }
  await flush();
  note(`${fixtures.length} fixtures`);

  // -- downstream records ----------------------------------------------------
  // A completed match is not just a score: it is a line on every player's lifetime
  // timeline, a medal where one was won, a per-player stat row and a career total.
  // Rather than fabricate those, run the SAME derivations the scorecard lock runs
  // (lock.service.ts steps 5-7) - so the records are the product's own output and
  // agree with the results by construction.
  //
  // The lock's own orchestration is deliberately NOT reused: it would re-run
  // advanceWinnerStrict against a bracket already built here, and its audit step
  // wants an HTTP actor there is none of.
  const played = fixtures.filter((f) => f.status === 'completed');
  if (bp.derive_records && played.length) {
    // Locked FIRST: career stats are derived from locked results, and locking after
    // deriving silently produced no career rows at all.
    await prisma.fixtures.updateMany({
      where: { id: { in: played.map((f) => f.id) } },
      data: { scorecard_status: 'locked', locked_at: new Date(), locked_by: officialIds[0] ?? organiserId },
    });

    let done = 0;
    const deriveOne = async (f: any) => {
      try {
        const participants = await resolveFixtureParticipants(prisma as any, f.id);
        await writeLifetimeEntries(prisma as any, f.id, { participants });
        await deriveAchievements(prisma as any, f.id, { participants });
        await writeStatLines(prisma as any, f.id, { participants });
        await refreshCareerStatsForFixture(prisma as any, f.id);
      } catch (e) {
        // One sport's stat shape failing must not cost the build its records.
        console.warn(`[blueprint] records for ${f.id}:`, e instanceof Error ? e.message : e);
      }
      done++;
    };
    // Batched: each fixture is independent and the cost is round-trips to a remote
    // pooler, not work. Serially this step alone ran for ten minutes.
    for (let i = 0; i < played.length; i += 8) {
      await Promise.all(played.slice(i, i + 8).map(deriveOne));
      note(`records ${done}/${played.length}`);
    }
  }

  await recomputeStandings(prisma as any, champId);
  const standingsRows = await prisma.standings.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('standings', standingsRows.map((s) => s.id));
  await flush();

  const counts: Record<string, number> = {
    organizations: orgs.length, people: userData.length, teams: teams.length,
    draws: draws.length, fixtures: fixtures.length, played: played.length,
  };

  return {
    championshipId: champId,
    slug,
    startDate,
    endDate,
    counts,
    logins: [
      { role: 'Organiser', workspace: 'Events Space', name: bp.accounts.organiser.name, email: bp.accounts.organiser.email },
      { role: 'Player', workspace: 'Personal Space', name: bp.accounts.player.name, email: bp.accounts.player.email, detail: bp.accounts.player.organization },
      { role: 'Institution Admin', workspace: 'Org Space', name: bp.accounts.institution_admin.name, email: bp.accounts.institution_admin.email, detail: bp.accounts.institution_admin.organization },
      ...orgs
        .filter((o) => o.id !== adminOrg.id)
        .map((o) => ({ role: 'POC', workspace: 'Org Space', name: `POC ${o.short_name}`, email: `poc.${o.short_name.toLowerCase()}@${bp.email_domain}`, detail: o.name })),
      ...officialIds.map((_, i) => ({ role: 'Official', workspace: 'Events Space', name: `Official ${i + 1}`, email: `official${i + 1}@${bp.email_domain}` })),
    ],
  };
}
