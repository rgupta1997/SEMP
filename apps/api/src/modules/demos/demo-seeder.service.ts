// Seeds one demo sandbox: 4 client-branded championships frozen at different
// lifecycle stages (see demo-recipes.ts). Adapts the seed-iimb.ts machinery but
// runs in-process, tracks every created row id in the sandbox's DB manifest
// (flushed after each batch so a crash mid-seed still leaves a cleanable trail),
// and derives every name/email deterministically from the sandbox slug so a
// Reset reproduces the identical demo.

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  DEMO_DEFAULT_SPORTS, demoOrgNamesFor, detailedContributions,
  tieTemplateFor, eventTemplateFor, initTie, decideRubber, tieWinner, rubbersWon,
  type CreateDemoSandboxInput, type DemoChampKind,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { recomputeStandings } from '../standings/standings.service.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { makeNamePool, type NamePool } from './demo-names.js';
import { CHAMP_RECIPES, drawStructureFor, scorePair, type ChampRecipe } from './demo-recipes.js';

const PLAYERS_PER_TEAM = 5;
const DAY = 24 * 60 * 60 * 1000;

type Manifest = Record<string, string[]>;

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

export async function seedSandbox(prisma: Prisma, sandboxId: string): Promise<void> {
  const sandbox = await prisma.demo_sandboxes.findUnique({ where: { id: sandboxId } });
  if (!sandbox) throw new NotFoundError('Demo sandbox');
  const config = sandbox.config as unknown as CreateDemoSandboxInput;
  const clientName = sandbox.client_name.trim();
  const slug = sandbox.slug;

  const manifest: Manifest = {};
  const track = (table: string, ids: string | string[]) => {
    manifest[table] ??= [];
    manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  };
  const flush = () => prisma.demo_sandboxes.update({ where: { id: sandboxId }, data: { manifest, updated_at: new Date() } });

  const sports = (config.sports?.length ? config.sports : [...DEMO_DEFAULT_SPORTS]).map((s) => s.trim());
  const pool = makeNamePool(slug, clientName, sandbox.email_domain, config.custom_names ?? []);

  // -- resolve global catalog (never created, never deleted) -----------------
  const [sportsRows, formatsRows, rolesRows] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ select: { id: true, name: true } }),
  ]);
  const sportId = new Map(sportsRows.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const knockoutId = formatsRows.find((f) => f.name.toLowerCase().includes('knockout'))?.id;
  const organiserRoleId = rolesRows.find((r) => r.name === 'Organiser')?.id;
  const officialRoleId = rolesRows.find((r) => r.name === 'Official')?.id;
  if (!knockoutId) throw new BusinessRuleError('Knockout tournament format not found in catalog');
  if (!organiserRoleId) throw new BusinessRuleError('Organiser role not found in catalog');
  for (const s of sports) if (!sportId.get(s.toLowerCase())) throw new BusinessRuleError(`Sport not found in catalog: ${s}`);

  const passwordHash = sandbox.organiser_password ? await bcrypt.hash(sandbox.organiser_password, 10) : null;

  // -- organiser (the "prime organiser" who owns all 4 championships) --------
  let organiserId: string;
  if (config.organiser?.mode === 'attach') {
    const existing = await prisma.users.findUnique({ where: { email: config.organiser.email! } });
    if (!existing) throw new NotFoundError('User to attach as organiser');
    organiserId = existing.id;
  } else {
    organiserId = randomUUID();
    await prisma.users.create({ data: {
      id: organiserId, name: `${clientName} Organiser`, email: sandbox.organiser_email,
      password_hash: passwordHash, account_type: 'participant',
    } });
    track('users', organiserId);
    await flush();
  }

  // -- officials (shared by all 4 championships) ------------------------------
  const officialIds: string[] = [];
  const officialData = [1, 2, 3].map((i) => {
    const id = randomUUID();
    officialIds.push(id);
    const p = pool.person();
    return { id, name: p.name, email: pool.email(`official${i}`), password_hash: passwordHash };
  });
  await prisma.users.createMany({ data: officialData });
  track('users', officialIds);
  await flush();

  // -- one championship per recipe -------------------------------------------
  for (const recipe of CHAMP_RECIPES) {
    await seedChampionship(prisma, {
      sandboxId, slug, clientName, config, recipe, sports, pool,
      organiserId, officialIds, organiserRoleId, officialRoleId,
      knockoutId, sportId, passwordHash, track, flush,
    });
  }

  await prisma.demo_sandboxes.update({ where: { id: sandboxId }, data: {
    status: 'ready', error: null, manifest, organiser_user_id: organiserId,
    last_seeded_at: new Date(), updated_at: new Date(),
  } });
}

interface ChampCtx {
  sandboxId: string;
  slug: string;
  clientName: string;
  config: CreateDemoSandboxInput;
  recipe: ChampRecipe;
  sports: string[];
  pool: NamePool;
  organiserId: string;
  officialIds: string[];
  organiserRoleId: string;
  officialRoleId: string | undefined;
  knockoutId: string;
  sportId: Map<string, string>;
  passwordHash: string | null;
  track: (table: string, ids: string | string[]) => void;
  flush: () => Promise<unknown>;
}

async function seedChampionship(prisma: Prisma, ctx: ChampCtx): Promise<void> {
  const { recipe, clientName, slug, sports, pool, track, flush } = ctx;
  const { pattern } = recipe;
  const now = Date.now();
  const startAt = new Date(now + recipe.dateWindow.start * DAY);
  const endAt = new Date(now + recipe.dateWindow.end * DAY);

  // -- championship + tournament + venue -------------------------------------
  const champId = randomUUID();
  await prisma.championships.create({ data: {
    id: champId,
    name: `${clientName} ${recipe.nameSuffix}`,
    slug: `${slug}-${recipe.kind}-championship`,
    description: `${clientName} ${recipe.nameSuffix} — powered by Sportagon.`,
    venue: `${clientName} Sports Arena`,
    start_date: startAt, end_date: endAt,
    status: 'ongoing', // scoring requires ongoing; college flips to completed at the end
    visibility: ctx.config.visibility ?? 'public',
  } });
  track('championships', champId);

  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: `${clientName} Sports Arena` } });
  track('venues', venueId);
  const grounds = ['Indoor Court', 'Main Field', 'Court 2'].map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));

  const ruleId = randomUUID();
  await prisma.standings_rules.create({ data: {
    id: ruleId, championship_id: champId, scope_type: 'championship', scope_id: null,
    config: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
  } });
  track('standings_rules', ruleId);
  await flush();

  // -- draws: one tournament_sport + tournament_discipline per sport ---------
  const drawStatus = pattern === 'completed' ? 'completed' : pattern === 'fresh' ? 'upcoming' : 'ongoing';
  const tsData: any[] = [];
  const tdData: any[] = [];
  const draws: { sport: string; structure: ReturnType<typeof drawStructureFor>; tdId: string }[] = [];
  sports.forEach((sport, i) => {
    const tsId = randomUUID();
    tsData.push({ id: tsId, tournament_id: tournamentId, sport_id: ctx.sportId.get(sport.toLowerCase()), format_id: ctx.knockoutId, display_order: i });
    const structure = drawStructureFor(sport);
    const scoring = structure === 'tie' ? tieTemplateFor(sport) : structure === 'event' ? eventTemplateFor(sport) : undefined;
    const tdId = randomUUID();
    tdData.push({
      id: tdId, tournament_sport_id: tsId, discipline_id: null, format_id: ctx.knockoutId,
      venue_id: venueId, status: drawStatus, display_order: i, format_config: scoring ? { scoring } : {},
    });
    draws.push({ sport, structure, tdId });
  });
  await prisma.tournament_sports.createMany({ data: tsData });
  track('tournament_sports', tsData.map((t) => t.id));
  await prisma.tournament_disciplines.createMany({ data: tdData });
  track('tournament_disciplines', tdData.map((t) => t.id));
  await flush();

  // -- organizations + POCs ---------------------------------------------------
  const orgNames = demoOrgNamesFor(recipe.kind, clientName, orgOverridesFor(ctx.config, recipe.kind));
  // 3-letter kind tag: COL / SCH / COR / PUB ('college' vs 'corporate' share an initial).
  const codeBase = `DEMO-${slug.toUpperCase()}-${recipe.kind.slice(0, 3).toUpperCase()}`;
  const orgs = orgNames.map((name, i) => ({
    id: randomUUID(), name,
    short_name: name.replace(`${clientName} `, '').slice(0, 30) || name.slice(0, 30),
    code: `${codeBase}${i + 1}`,
  }));
  await prisma.organizations.createMany({ data: orgs });
  track('organizations', orgs.map((o) => o.id));

  const userData: any[] = [];
  const pocs = orgs.map((o, i) => {
    const id = randomUUID();
    const p = pool.person();
    userData.push({ id, name: p.name, email: pool.email(`poc.${recipe.kind}${i + 1}`), password_hash: ctx.passwordHash, organization_id: o.id, account_type: 'institution' });
    return { id, orgId: o.id };
  });

  // -- teams + players (team-based draws) -------------------------------------
  const teamDraws = draws.filter((d) => d.structure !== 'event');
  const teamData: any[] = [];
  const memberData: any[] = [];
  const teamIdsByDraw = new Map<string, string[]>();
  for (const d of teamDraws) {
    const ids: string[] = [];
    for (let o = 0; o < orgs.length; o++) {
      const teamId = randomUUID();
      teamData.push({ id: teamId, sport_id: ctx.sportId.get(d.sport.toLowerCase()), organization_id: orgs[o].id, name: pool.teamName(o), status: 'approved' });
      ids.push(teamId);
      for (let p = 0; p < PLAYERS_PER_TEAM; p++) {
        const person = pool.person();
        const uid = randomUUID();
        userData.push({ id: uid, name: person.name, email: person.email, organization_id: orgs[o].id });
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

  const coData = orgs.map((o) => ({
    id: randomUUID(), championship_id: champId, organization_id: o.id,
    applied_by: ctx.organiserId, status: 'approved', reviewed_by: ctx.organiserId, reviewed_at: new Date(),
  }));
  await prisma.championship_organizations.createMany({ data: coData });
  track('championship_organizations', coData.map((c) => c.id));
  const coByOrg = new Map(coData.map((c) => [c.organization_id, c.id]));

  await prisma.teams.createMany({ data: teamData });
  track('teams', teamData.map((t) => t.id));
  await prisma.team_members.createMany({ data: memberData });
  track('team_members', memberData.map((m) => m.id));

  const entryData: any[] = [];
  for (const d of teamDraws) {
    teamIdsByDraw.get(d.tdId)!.forEach((teamId, o) => entryData.push({
      id: randomUUID(), team_id: teamId, organization_id: orgs[o].id, championship_id: champId,
      championship_organization_id: coByOrg.get(orgs[o].id), tournament_discipline_id: d.tdId, status: 'approved',
    }));
  }
  await prisma.team_entries.createMany({ data: entryData });
  track('team_entries', entryData.map((e) => e.id));
  await flush();

  // -- roles: organiser on this championship, officials assigned --------------
  const ucr: any[] = [{ id: randomUUID(), user_id: ctx.organiserId, championship_id: champId, role_id: ctx.organiserRoleId, assigned_by: ctx.organiserId }];
  if (ctx.officialRoleId) for (const oid of ctx.officialIds) ucr.push({ id: randomUUID(), user_id: oid, championship_id: champId, role_id: ctx.officialRoleId, assigned_by: ctx.organiserId });
  await prisma.user_championship_roles.createMany({ data: ucr });
  track('user_championship_roles', ucr.map((r) => r.id));
  const coffs = ctx.officialIds.map((oid) => ({ id: randomUUID(), championship_id: champId, user_id: oid, assigned_by: ctx.organiserId }));
  await prisma.championship_officials.createMany({ data: coffs });
  track('championship_officials', coffs.map((c) => c.id));
  await flush();

  // -- fixtures ----------------------------------------------------------------
  let slot = 0;
  const slotBase = startAt.getTime() + 9 * 60 * 60 * 1000; // 9:00 on day 1
  const slotAt = () => new Date(slotBase + (slot++) * 30 * 60000);
  let offRR = 0;
  const nextOfficial = () => ctx.officialIds[offRR++ % ctx.officialIds.length];
  let grRR = 0;
  const groundIds = grounds.map((g) => g.id);
  const nextGround = () => groundIds[grRR++ % groundIds.length];

  const fixtures: any[] = [];
  const awards: any[] = [];
  const base = (tdId: string, extra: any) => ({
    id: randomUUID(), tournament_discipline_id: tdId, official_id: nextOfficial(),
    venue_ground_id: nextGround(), scheduled_at: slotAt(), ...extra,
  });

  teamDraws.forEach((d, di) => {
    const T = teamIdsByDraw.get(d.tdId)!;
    const [ws, ls] = scorePair(d.sport);
    const completedHeadline = (winner: string, loser: string) => {
      if (d.structure === 'tie') {
        const c = tieCompleted(d.sport);
        return { home_team_id: winner, away_team_id: loser, status: 'completed', winner_team_id: winner, home_score: c.home_score, away_score: c.away_score, live_state: c.live_state };
      }
      return { home_team_id: winner, away_team_id: loser, status: 'completed', winner_team_id: winner, home_score: ws, away_score: ls };
    };
    const liveHeadline = (h: string, a: string) => (d.structure === 'tie'
      ? { home_team_id: h, away_team_id: a, status: 'live', ...tieLive(d.sport) }
      : { home_team_id: h, away_team_id: a, status: 'live', home_score: Math.ceil(ws / 2), away_score: Math.floor(ls / 2) });

    // Bracket maths: QF pairs (0,1)(2,3)(4,5)(6,7); lower seed wins throughout.
    const qfWinners = [T[0], T[2], T[4], T[6]];
    const sfPairs: [string, string][] = [[qfWinners[0], qfWinners[1]], [qfWinners[2], qfWinners[3]]];
    const sfWinners = [qfWinners[0], qfWinners[2]];

    for (let q = 0; q < 4; q++) {
      const home = T[q * 2], away = T[q * 2 + 1];
      const played = pattern === 'completed' || pattern === 'half' || pattern === 'finals';
      const extra = played
        ? completedHeadline(home, away)
        : { home_team_id: home, away_team_id: away, status: 'scheduled' }; // fresh
      fixtures.push(base(d.tdId, { round: 'Quarter-final', bracket_position: q + 1, ...extra }));
    }

    sfPairs.forEach(([h, a], s) => {
      let extra: any;
      if (pattern === 'completed') extra = completedHeadline(h, a);
      else if (pattern === 'half') {
        // Even draws are decided; odd draws are mid-flight: one semi live, one upcoming.
        if (di % 2 === 0) extra = completedHeadline(h, a);
        else extra = s === 0 ? liveHeadline(h, a) : { home_team_id: h, away_team_id: a, status: 'scheduled' };
      } else if (pattern === 'finals') extra = { home_team_id: h, away_team_id: a, status: 'scheduled' }; // semis today, teams known
      else extra = { home_team_id: null, away_team_id: null, status: 'scheduled' }; // fresh
      fixtures.push(base(d.tdId, { round: 'Semi-final', bracket_position: s + 1, ...extra }));
    });

    const finalDecided = pattern === 'completed' || (pattern === 'half' && di % 2 === 0);
    const finalId = randomUUID();
    fixtures.push({
      ...base(d.tdId, {
        round: 'Final', bracket_position: 1,
        ...(finalDecided ? completedHeadline(sfWinners[0], sfWinners[1]) : { home_team_id: null, away_team_id: null, status: 'scheduled' }),
      }),
      id: finalId,
    });
    fixtures.push(base(d.tdId, {
      round: 'Third-place', bracket_position: 1,
      ...(finalDecided ? completedHeadline(qfWinners[1], qfWinners[3]) : { home_team_id: null, away_team_id: null, status: 'scheduled' }),
    }));

    if (finalDecided) {
      const champMember = memberData.find((m) => m.team_id === sfWinners[0] && m.role === 'captain');
      if (champMember) awards.push({ id: randomUUID(), fixture_id: finalId, recipient_user_id: champMember.user_id, award_name: 'Player of the Tournament' });
    }
  });

  // Event draws (swimming/powerlifting/athletics): one team-less fixture with seeded
  // marks; eventStandings precomputed so medal tallies and standings light up.
  for (const d of draws.filter((x) => x.structure === 'event')) {
    const spec = eventTemplateFor(d.sport)!.event!;
    const mark = (i: number, j: number) => (spec.result.winnerIs === 'min' ? 12 + i + j * 0.3 : 200 - i * 5 + j * 10);
    const participants = orgs.slice(0, 5).map((o, i) => {
      const person = pool.person();
      const baseP = { id: `p${i}`, name: person.name, org: o.name, orgId: o.id };
      if (spec.pickOne) {
        const cat = spec.subEvents[i % 2].key;
        return { ...baseP, category: cat, marks: { [cat]: mark(i, 0) } };
      }
      const subs = spec.subEvents.slice(0, 3).map((s) => s.key);
      return { ...baseP, marks: Object.fromEntries(subs.map((k, j) => [k, mark(i, j)])) };
    });
    const status = pattern === 'fresh' ? 'scheduled' : pattern === 'completed' ? 'completed' : 'live';
    const live_state = pattern === 'fresh'
      ? {}
      : { event: { participants }, eventStandings: detailedContributions(spec, { participants }) };
    fixtures.push(base(d.tdId, { round: 'Event', status, home_team_id: null, away_team_id: null, live_state }));
  }

  // One postponed fixture in the mid-flight championship for status coverage.
  if (pattern === 'half') {
    const idx = fixtures.findIndex((f) => f.status === 'scheduled' && f.home_team_id);
    if (idx >= 0) fixtures[idx] = { ...fixtures[idx], status: 'postponed' };
  }

  await prisma.fixtures.createMany({ data: fixtures });
  track('fixtures', fixtures.map((f) => f.id));
  if (awards.length) {
    await prisma.fixture_awards.createMany({ data: awards });
    track('fixture_awards', awards.map((a) => a.id));
  }
  await flush();

  // -- standings + final status ------------------------------------------------
  await recomputeStandings(prisma, champId);
  const standingsRows = await prisma.standings.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('standings', standingsRows.map((s) => s.id));

  if (recipe.status === 'completed') {
    await prisma.championships.update({ where: { id: champId }, data: { status: 'completed' } });
  }
  await flush();
}

function orgOverridesFor(config: CreateDemoSandboxInput, kind: DemoChampKind): string[] | undefined {
  return config.org_names?.[kind];
}
