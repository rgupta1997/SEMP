// Inter and intra championships, end to end, through the real HTTP API.
//
// The model this proves, in the user's own terms:
//
//   INTER  organisations compete. The host is asked at creation whether it is
//          taking part too. Public, in Discover. Chain: organisation -> team ->
//          player. Standings by organisation.
//
//   INTRA  the host's own campuses and batches compete. People belong to SEVERAL
//          units at once. Squads are formed per unit and enter directly - there is
//          no enrolment step, because the squad IS the entry. Standings list the
//          units. Invisible to any organisation outside the host.
//
// Everything created is prefixed ZZE2E and torn down at the end, so this can be run
// repeatedly against a live database. Requires the API running (npm run dev).

import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const cfg = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '').trim().replace(/^"|"$/g, '');
process.env.DATABASE_URL = cfg('DATABASE_URL');

const BASE = `http://localhost:${cfg('PORT') || 4000}/api`;
const EMAIL = process.env.E2E_EMAIL || 'owner.nit@bench.test';
const PASSWORD = process.env.E2E_PASSWORD || 'Bench@2026';
const TAG = 'ZZE2E';

const prisma = new PrismaClient();
let token = null;
let pass = 0;
const failures = [];

const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { failures.push(`${l}${d ? ` — ${d}` : ''}`); console.log(`  ✗ ${l}${d ? `\n      ${d}` : ''}`); };
const check = (l, c, d) => (c ? ok(l) : bad(l, d));

async function call(method, path, body, asToken) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...((asToken ?? token) ? { authorization: `Bearer ${asToken ?? token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, raw: text };
}

async function must(method, path, body) {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.body?.error?.message ?? r.raw?.slice(0, 200)}`);
  return r.body;
}

async function cleanup(orgId) {
  const champs = await prisma.championships.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = champs.map((c) => c.id);
  if (ids.length) {
    await prisma.standings.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.team_entries.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.fixtures.deleteMany({ where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: { in: ids } } } } } });
    await prisma.tournament_disciplines.deleteMany({ where: { tournament_sports: { tournaments: { championship_id: { in: ids } } } } });
    await prisma.tournament_sports.deleteMany({ where: { tournaments: { championship_id: { in: ids } } } });
    await prisma.tournaments.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.championship_organizations.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.user_championship_roles.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.notifications.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.venues.deleteMany({ where: { championship_id: { in: ids } } });
    await prisma.championships.deleteMany({ where: { id: { in: ids } } });
  }
  const teams = await prisma.teams.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  if (teams.length) {
    await prisma.team_members.deleteMany({ where: { team_id: { in: teams.map((t) => t.id) } } });
    await prisma.teams.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
  }
  if (orgId) {
    const units = await prisma.org_units.findMany({ where: { organization_id: orgId, name: { startsWith: TAG } }, select: { id: true } });
    if (units.length) {
      await prisma.org_unit_members.deleteMany({ where: { org_unit_id: { in: units.map((u) => u.id) } } });
      await prisma.org_units.deleteMany({ where: { id: { in: units.map((u) => u.id) } } });
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nInter & intra championships, end to end\n${'='.repeat(62)}`);

  console.log('\nSign in');
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status >= 400) throw new Error(`login failed: ${login.status} ${login.raw?.slice(0, 200)}`);
  token = login.body.token ?? login.body.session?.token;
  check('signed in', !!token);

  const me = await must('GET', '/auth/me');
  const orgId = me.organizations?.find((m) => m.role === 'owner')?.organization_id ?? me.organizations?.[0]?.organization_id;
  check('owns an organisation', !!orgId);
  await cleanup(orgId);

  const stamp = Date.now().toString(36);

  // ---- 1 · structure -----------------------------------------------------
  console.log('\n1 · Campuses and batches');
  const blr = await must('POST', `/organizations/${orgId}/units`, { type: 'campus', name: `${TAG} Bangalore`, code: 'ZBLR', status: 'ACTIVE' });
  const mum = await must('POST', `/organizations/${orgId}/units`, { type: 'campus', name: `${TAG} Mumbai`, code: 'ZMUM', status: 'ACTIVE' });
  const sales = await must('POST', `/organizations/${orgId}/units`, { type: 'department', name: `${TAG} Sales`, code: 'ZSLS', parent_id: blr.id });
  ok('two campuses and a batch beneath one of them');

  // ---- 2 · a person belongs to SEVERAL units -----------------------------
  console.log('\n2 · Multi-unit membership');
  const members = await prisma.organization_members.findMany({
    where: { organization_id: orgId, status: 'active' },
    select: { id: true, user_id: true }, take: 8,
  });
  if (members.length < 4) throw new Error('need at least 4 members on the bench org');
  const [p1, p2, p3, p4] = members;

  // p1 is in the campus AND the batch inside it - the case a single column could
  // not express and the whole reason placement moved to its own table.
  await must('PUT', `/organizations/${orgId}/people/${p1.user_id}/units`, { unit_ids: [blr.id, sales.id] });
  await must('PUT', `/organizations/${orgId}/people/${p2.user_id}/units`, { unit_ids: [blr.id] });
  await must('PUT', `/organizations/${orgId}/people/${p3.user_id}/units`, { unit_ids: [mum.id] });
  await must('PUT', `/organizations/${orgId}/people/${p4.user_id}/units`, { unit_ids: [] });

  const people = await must('GET', `/organizations/${orgId}/people`);
  const row1 = people.find((x) => x.user_id === p1.user_id);
  check('one person can hold several units at once', (row1?.units ?? []).length === 2,
    `got ${(row1?.units ?? []).length}`);
  check('and the directory prints them all', (row1?.org_unit_names ?? '').includes('Bangalore') && (row1?.org_unit_names ?? '').includes('Sales'));

  const bulk = await must('POST', `/organizations/${orgId}/units/${mum.id}/members`, { user_ids: [p4.user_id] });
  check('people can be added to a unit in bulk', bulk.added === 1, JSON.stringify(bulk));
  const inMum = await must('GET', `/organizations/${orgId}/units/${mum.id}/members`);
  check('and the unit lists them', inMum.some((m) => m.user_id === p4.user_id));
  await must('DELETE', `/organizations/${orgId}/units/${mum.id}/members/${p4.user_id}`);
  ok('and they can be removed again');

  // ---- 3 · INTER: the host may take part -------------------------------
  console.log('\n3 · Inter championship');
  const inter = await must('POST', '/championships', {
    name: `${TAG} Open Meet`, slug: `zze2e-open-${stamp}`, venue: 'Bangalore',
    start_date: '2026-09-01', end_date: '2026-09-05',
    host_organization_id: orgId, host_participates: true,
  });
  check('defaults to organisation level', inter.entry_level === 'organization');

  const interEntries = await prisma.championship_organizations.findMany({ where: { championship_id: inter.id } });
  check('ticking "take part yourself" enters the host automatically', interEntries.length === 1,
    `got ${interEntries.length} entries`);
  check('and it is approved on arrival, not queued', interEntries[0]?.status === 'approved');

  const notPlaying = await must('POST', '/championships', {
    name: `${TAG} Hosted Only`, slug: `zze2e-hosted-${stamp}`, venue: 'Bangalore',
    start_date: '2026-09-01', end_date: '2026-09-05',
    host_organization_id: orgId, host_participates: false,
  });
  const none = await prisma.championship_organizations.count({ where: { championship_id: notPlaying.id } });
  check('leaving it unticked enters nobody', none === 0, `got ${none}`);

  const discover = await must('GET', '/championships');
  check('an open championship is listed in Discover', discover.some((c) => c.id === inter.id));

  // ---- 4 · INTRA: created, and invisible outside -------------------------
  console.log('\n4 · Intra championship');
  const intra = await must('POST', '/championships', {
    name: `${TAG} Inter-Campus Meet`, slug: `zze2e-campus-${stamp}`, venue: 'Bangalore',
    start_date: '2026-09-01', end_date: '2026-09-05',
    host_organization_id: orgId, entry_level: 'campus',
  });
  check('created at campus level', intra.entry_level === 'campus');

  const detail = await must('GET', `/championships/${intra.id}`);
  check('and reports itself as internal', detail.entry?.intra === true);

  const hostEntry = await prisma.championship_organizations.findMany({ where: { championship_id: intra.id } });
  check('one standing host entry is created, invisible to the organiser', hostEntry.length === 1,
    'squads hang off it; there is no enrolment step');
  check('there is no per-campus entrant row', hostEntry.every((e) => e.org_unit_id === null),
    'campuses do not "enter" - their squads are the entries');

  const enrolAttempt = await call('POST', `/championships/${intra.id}/enroll`, { organization_id: orgId });
  check('applying to an internal championship is refused outright', enrolAttempt.status === 400,
    `got ${enrolAttempt.status}: ${enrolAttempt.body?.error?.message}`);
  if (enrolAttempt.status === 400) console.log(`      refusal reads: "${enrolAttempt.body?.error?.message}"`);

  // An outsider must not see it at all.
  const outsider = await prisma.users.findFirst({
    where: {
      is_super_admin: false,
      organization_members: { none: { organization_id: orgId } },
      password_hash: { not: null },
      email: { endsWith: '@bench.test' },
    },
    select: { id: true, email: true },
  });
  if (outsider) {
    const oLogin = await call('POST', '/auth/login', { email: outsider.email, password: PASSWORD });
    if (oLogin.status < 400) {
      const oTok = oLogin.body.token ?? oLogin.body.session?.token;
      const seen = await call('GET', `/championships/${intra.id}`, undefined, oTok);
      check('an outsider cannot open it by id', seen.status === 404,
        `got ${seen.status} for ${outsider.email}`);
      const oDiscover = await call('GET', '/championships', undefined, oTok);
      check('and it is absent from their Discover', !(oDiscover.body ?? []).some((c) => c.id === intra.id));
      const oOpen = (oDiscover.body ?? []).some((c) => c.id === inter.id);
      check('while the open championship IS visible to them', oOpen,
        'the exclusion must be specific to internal events, not a blanket hide');
    } else { console.log(`      (skipped outsider checks - could not sign in as ${outsider.email})`); }
  }

  // ---- 5 · squads enter directly -----------------------------------------
  console.log('\n5 · Campus squads enter directly');
  const sport = await prisma.sports.findFirst({ where: { name: { in: ['Football', 'Cricket'] } }, select: { id: true, name: true } })
    ?? await prisma.sports.findFirst({ select: { id: true, name: true } });
  const format = await prisma.tournament_formats.findFirst({ select: { id: true } });
  const tournament = await prisma.tournaments.findFirst({ where: { championship_id: intra.id }, select: { id: true } });
  const ts = await prisma.tournament_sports.create({ data: { tournament_id: tournament.id, sport_id: sport.id, format_id: format.id } });
  const discipline = await prisma.disciplines.findFirst({ where: { sport_id: sport.id }, select: { id: true } });
  const draw = await prisma.tournament_disciplines.create({
    data: { tournament_sport_id: ts.id, discipline_id: discipline?.id ?? null, format_id: format.id },
  });
  const entryId = hostEntry[0].id;

  // The organiser names which campuses take part. This is an INVITATION, not an
  // entrant row - accepting one creates nothing, and the squad remains the thing
  // that competes.
  const invitable = await must('GET', `/championships/${intra.id}/invitable`);
  check('the invite picker offers the host’s own campuses', invitable.intra === true
    && invitable.units.some((u) => u.name === `${TAG} Bangalore`)
    && invitable.units.some((u) => u.name === `${TAG} Mumbai`),
    `got: ${(invitable.units ?? []).map((u) => u.name).join(', ')}`);

  const uninvitedSquad = await call('POST', '/teams', {
    name: `${TAG} Uninvited`, sport_id: sport.id, organization_id: orgId, org_unit_id: blr.id,
    championship_id: intra.id, championship_organization_id: entryId, tournament_discipline_id: draw.id,
  });
  check('a squad of an UNINVITED campus is refused', uninvitedSquad.status === 400,
    `got ${uninvitedSquad.status}: ${uninvitedSquad.body?.error?.message}`);
  if (uninvitedSquad.status === 400) console.log(`      refusal reads: "${uninvitedSquad.body?.error?.message}"`);

  const invBlr = await must('POST', `/championships/${intra.id}/invitations`, { org_unit_id: blr.id });
  await must('POST', `/championships/${intra.id}/invitations`, { org_unit_id: mum.id });
  check('campuses can be added', !!invBlr.id && invBlr.org_unit_id === blr.id);
  check('and are taking part immediately, with no accept step', invBlr.status === 'accepted',
    `got status "${invBlr.status}" - there is nobody outside the organisation to accept`);

  const dupeInvite = await call('POST', `/championships/${intra.id}/invitations`, { org_unit_id: blr.id });
  check('and cannot be added twice', dupeInvite.status === 400,
    `got ${dupeInvite.status} - the uniqueness must cover accepted rows, not only pending ones`);

  const orgInvite = await call('POST', `/championships/${intra.id}/invitations`, { organization_id: orgId });
  check('an ORGANISATION cannot be invited to an internal championship', orgInvite.status === 400,
    `got ${orgInvite.status}: ${orgInvite.body?.error?.message}`);

  // The notification must name the CAMPUS. Reusing `enrollment_approved` here
  // announced "Northfield has joined the championship" on an event contested
  // between Northfield's own campuses.
  const notes = await prisma.notifications.findMany({
    where: { championship_id: intra.id },
    select: { type: true, title: true, body: true },
    orderBy: { created_at: 'desc' },
  });
  const addedAll = notes.filter((n) => n.type === 'contingent_added');
  check('adding a campus notifies about the CAMPUS', addedAll.length === 2,
    `expected one per campus added; types seen: ${notes.map((n) => n.type).join(', ') || 'none'}`);
  // Each names its OWN campus - both were added, so both must be named.
  check('and each names the campus it is about',
    addedAll.some((n) => n.title.includes(`${TAG} Bangalore`))
    && addedAll.some((n) => n.title.includes(`${TAG} Mumbai`)),
    `titles were: ${addedAll.map((n) => n.title).join(' | ')}`);
  const added = addedAll[0];
  check('and never announces the organisation instead',
    !notes.some((n) => n.type === 'enrollment_approved'),
    'the host organisation joining its own internal event is not news');
  if (added) console.log(`      reads: "${added.title}" / "${added.body}"`);

  const invList = await must('GET', `/championships/${intra.id}/invitations`);
  check('the invitation list names the campus, not the institution',
    invList.some((i) => i.target === `${TAG} Bangalore` && i.is_unit === true),
    `got: ${invList.map((i) => i.target).join(', ')}`);

  const teamBlr = await must('POST', '/teams', {
    name: `${TAG} Bangalore ${sport.name}`, sport_id: sport.id, organization_id: orgId,
    org_unit_id: blr.id,
    championship_id: intra.id, championship_organization_id: entryId, tournament_discipline_id: draw.id,
  });
  const teamMum = await must('POST', '/teams', {
    name: `${TAG} Mumbai ${sport.name}`, sport_id: sport.id, organization_id: orgId,
    org_unit_id: mum.id,
    championship_id: intra.id, championship_organization_id: entryId, tournament_discipline_id: draw.id,
  });
  check('two campus squads enter the same draw', !!teamBlr.id && !!teamMum.id);
  check('each records the campus it plays for', teamBlr.org_unit_id === blr.id && teamMum.org_unit_id === mum.id);

  const noUnit = await call('POST', '/teams', {
    name: `${TAG} Nameless`, sport_id: sport.id, organization_id: orgId,
    championship_id: intra.id, championship_organization_id: entryId, tournament_discipline_id: draw.id,
  });
  check('a whole-organisation squad cannot enter an internal event', noUnit.status === 400,
    `got ${noUnit.status}: ${noUnit.body?.error?.message}`);

  // The real-world mistake: a BATCH squad sent at a CAMPUS-level championship. It
  // used to be refused with "has not been invited", which sent people hunting for an
  // invitation that could never have been the right answer - the batch cannot
  // compete against campuses at all.
  const batchSquad = await call('POST', '/teams', {
    name: `${TAG} Sales Wrong Level`, sport_id: sport.id, organization_id: orgId, org_unit_id: sales.id,
    championship_id: intra.id, championship_organization_id: entryId, tournament_discipline_id: draw.id,
  });
  check('a BATCH squad is refused from a CAMPUS-level championship', batchSquad.status === 400,
    `got ${batchSquad.status}`);
  const msg = batchSquad.body?.error?.message ?? '';
  check('and the refusal names the level, not the invitation',
    /contested between campuses/i.test(msg) && !/has not been invited/i.test(msg),
    `message was: "${msg}"`);
  check('and it names the campus to enter instead', msg.includes(`${TAG} Bangalore`),
    `the way out has to be in the message; got: "${msg}"`);
  console.log(`      refusal reads: "${msg}"`);

  const orgSquadEarly = await must('POST', '/teams', {
    name: `${TAG} Org Picker`, sport_id: sport.id, organization_id: orgId,
  });

  // ---- 6 · eligibility across several units ------------------------------
  console.log('\n6 · Who may be picked');
  const okPick = await call('POST', `/teams/${teamBlr.id}/members`, { user_id: p2.user_id, role: 'player' });
  check('somebody in that campus can be picked', okPick.status < 400, `${okPick.status}: ${okPick.body?.error?.message}`);

  const multiPick = await call('POST', `/teams/${teamBlr.id}/members`, { user_id: p1.user_id, role: 'player' });
  check('somebody in the campus AND its batch is eligible for the campus squad', multiPick.status < 400,
    `${multiPick.status}: ${multiPick.body?.error?.message}`);

  const wrong = await call('POST', `/teams/${teamBlr.id}/members`, { user_id: p3.user_id, role: 'player' });
  check('somebody from the other campus is refused', wrong.status === 400,
    `got ${wrong.status}: ${wrong.body?.error?.message}`);
  if (wrong.status === 400) console.log(`      refusal reads: "${wrong.body?.error?.message}"`);

  const unplacedPick = await call('POST', `/teams/${teamMum.id}/members`, { user_id: p4.user_id, role: 'player' });
  check('somebody in no unit at all is refused', unplacedPick.status === 400,
    `got ${unplacedPick.status}: ${unplacedPick.body?.error?.message}`);

  await must('POST', `/teams/${teamMum.id}/members`, { user_id: p3.user_id, role: 'player' });
  ok('and the other campus can field its own');

  // A batch squad is stricter than its campus.
  const teamSales = await must('POST', '/teams', {
    name: `${TAG} Sales ${sport.name}`, sport_id: sport.id, organization_id: orgId, org_unit_id: sales.id,
  });
  const inBatch = await call('POST', `/teams/${teamSales.id}/members`, { user_id: p1.user_id, role: 'player' });
  check('a batch squad accepts somebody in that batch', inBatch.status < 400, `${inBatch.status}: ${inBatch.body?.error?.message}`);
  const campusOnly = await call('POST', `/teams/${teamSales.id}/members`, { user_id: p2.user_id, role: 'player' });
  check('but refuses somebody in the campus only', campusOnly.status === 400,
    'a campus includes its batches; a batch does not include its campus');

  // ---- 6b · the picker offers exactly what the guard accepts --------------
  //
  // The squad-building screen asks the server who may be picked rather than
  // filtering the member list itself. If the two ever disagree, somebody is offered
  // a name, ticks it, and is refused on save - so this asserts they are the same
  // list, not merely that each is plausible.
  console.log('\n6b · Who the picker offers');
  const forBlr = await must('GET', `/teams/${teamBlr.id}/eligible-players`);
  const blrIds = forBlr.map((u) => u.id);
  check('the campus picker offers people of that campus', blrIds.includes(p2.user_id));
  check('and people of a batch INSIDE it', blrIds.includes(p1.user_id),
    'a campus includes its batches - this is the rule a client would get wrong');
  check('but not the other campus', !blrIds.includes(p3.user_id));
  check('and not somebody placed nowhere', !blrIds.includes(p4.user_id));

  const forSales = await must('GET', `/teams/${teamSales.id}/eligible-players`);
  const salesIds = forSales.map((u) => u.id);
  check('the batch picker offers people of that batch', salesIds.includes(p1.user_id));
  check('but NOT somebody in the campus only', !salesIds.includes(p2.user_id),
    'a batch does not include its campus');

  // The multi-unit case, stated directly: p1 is in Bangalore AND Sales, so they are
  // offered by both pickers. Under the old single-column placement they could only
  // ever have appeared in one.
  check('a person in two units appears in BOTH pickers',
    blrIds.includes(p1.user_id) && salesIds.includes(p1.user_id));

  // The list offered and the list accepted must be the same list.
  const guardAccepts = [];
  for (const u of [p1, p2, p3, p4]) {
    const r = await call('POST', `/teams/${teamSales.id}/members`, { user_id: u.user_id, role: 'player' });
    if (r.status < 400) {
      guardAccepts.push(u.user_id);
      await call('DELETE', `/teams/${teamSales.id}/members/${r.body?.id}`);
    }
  }
  const offered = new Set(salesIds);
  check('everyone the guard accepts was offered by the picker',
    guardAccepts.every((id) => offered.has(id)),
    `guard accepted ${guardAccepts.length}, picker offered ${salesIds.length} - a name offered and then refused is the failure this prevents`);

  const orgPicker = await must('GET', `/teams/${orgSquadEarly.id}/eligible-players`);
  check('a whole-organisation squad still draws from everybody', orgPicker.length >= 4,
    `got ${orgPicker.length} - scoping must not leak into organisation squads`);

  // ---- 7 · standings -----------------------------------------------------
  console.log('\n7 · Standings');
  await must('PATCH', `/championships/${intra.id}/status`, { status: 'registration_open' });
  await must('PATCH', `/championships/${intra.id}/status`, { status: 'ongoing' });
  const fixture = await prisma.fixtures.create({
    data: {
      tournament_discipline_id: draw.id,
      home_team_id: teamBlr.id, away_team_id: teamMum.id,
      status: 'scheduled', scheduled_at: new Date('2026-09-02T10:00:00Z'),
    },
  });
  await must('PATCH', `/fixtures/${fixture.id}/result`, {
    home_score: 3, away_score: 1, winner_team_id: teamBlr.id, status: 'completed',
  });

  const table = await must('GET', `/championships/${intra.id}/standings?scope=championship`);
  const rows = table.standings ?? table;
  check('the table has one row per campus, not one for the institution', rows.length === 2,
    `got ${rows.length}`);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  check('rows are named after the campuses', !!byName[`${TAG} Bangalore`] && !!byName[`${TAG} Mumbai`],
    `got: ${rows.map((r) => r.name).join(', ')}`);
  check('the winner ranks first', byName[`${TAG} Bangalore`]?.rank === 1);
  check('each played one match', rows.every((r) => r.played === 1));

  // ---- 8 · the two kinds of squad do not mix -----------------------------
  console.log('\n8 · Squads stay in their own kind of championship');
  await must('PATCH', `/championships/${inter.id}/status`, { status: 'registration_open' });
  const orgSquad = await must('POST', '/teams', {
    name: `${TAG} Institute ${sport.name}`, sport_id: sport.id, organization_id: orgId,
  });
  check('a whole-organisation squad has no unit', orgSquad.org_unit_id === null);

  const campusIntoOpen = await call('POST', `/teams/${teamBlr.id}/entries`, {
    entries: [{ championship_organization_id: interEntries[0].id, tournament_discipline_id: null }],
  });
  check('a campus squad cannot enter an OPEN championship', campusIntoOpen.status === 400,
    `got ${campusIntoOpen.status}: ${campusIntoOpen.body?.error?.message}`);
  if (campusIntoOpen.status === 400) console.log(`      refusal reads: "${campusIntoOpen.body?.error?.message}"`);

  const orgIntoIntra = await call('POST', `/teams/${orgSquad.id}/entries`, {
    entries: [{ championship_organization_id: entryId, tournament_discipline_id: null }],
  });
  check('and an organisation squad cannot enter an INTERNAL one', orgIntoIntra.status === 400,
    `got ${orgIntoIntra.status}: ${orgIntoIntra.body?.error?.message}`);

  // ---- 8b · moving a squad between campuses and batches -------------------
  //
  // The remedy for the commonest real mistake: a squad built for a batch when the
  // championship is contested between campuses. Before this the only way out was to
  // delete it and lose the roster.
  console.log('\n8b · Moving a squad between campuses and batches');
  const movable = await must('POST', '/teams', {
    name: `${TAG} Movable`, sport_id: sport.id, organization_id: orgId, org_unit_id: sales.id,
  });
  check('a squad starts on the batch it was built for', movable.org_unit_id === sales.id);

  const moved = await call('PATCH', `/teams/${movable.id}`, { org_unit_id: blr.id });
  check('and can be moved up to its campus', moved.status < 400 && moved.body?.org_unit_id === blr.id,
    `${moved.status}: ${moved.body?.error?.message}`);

  const toOrg = await call('PATCH', `/teams/${movable.id}`, { org_unit_id: null });
  check('and back to the whole organisation', toOrg.status < 400 && toOrg.body?.org_unit_id === null,
    `${toOrg.status}: ${toOrg.body?.error?.message}`);

  const otherOrgUnit = await prisma.org_units.findFirst({
    where: { organization_id: { not: orgId } }, select: { id: true },
  });
  if (otherOrgUnit) {
    const elsewhere = await call('PATCH', `/teams/${movable.id}`, { org_unit_id: otherOrgUnit.id });
    check('but never into another organisation’s structure', elsewhere.status >= 400, `got ${elsewhere.status}`);
  }

  // Stranding check: p3 belongs to Mumbai only, so a Mumbai squad holding them
  // cannot move to Bangalore.
  const stranding = await must('POST', '/teams', {
    name: `${TAG} Stranding`, sport_id: sport.id, organization_id: orgId, org_unit_id: mum.id,
  });
  await must('POST', `/teams/${stranding.id}/members`, { user_id: p3.user_id, role: 'player' });
  const strand = await call('PATCH', `/teams/${stranding.id}`, { org_unit_id: blr.id });
  check('a move that would strand a picked player is refused', strand.status === 400,
    `got ${strand.status}: ${strand.body?.error?.message}`);
  check('and the refusal names who', /belongs to/i.test(strand.body?.error?.message ?? ''),
    `"${strand.body?.error?.message}" - "some players are ineligible" is not actionable`);
  if (strand.status === 400) console.log(`      refusal reads: "${strand.body?.error?.message}"`);

  // teamBlr is entered in the intra championship from section 5.
  const afterEntry = await call('PATCH', `/teams/${teamBlr.id}`, { org_unit_id: mum.id });
  check('and a squad that has already entered cannot be moved at all', afterEntry.status === 400,
    `got ${afterEntry.status}: ${afterEntry.body?.error?.message}`);
  if (afterEntry.status === 400) console.log(`      refusal reads: "${afterEntry.body?.error?.message}"`);

  const rename = await call('PATCH', `/teams/${teamBlr.id}`, { name: `${TAG} Bangalore Renamed` });
  check('though renaming it still works', rename.status < 400,
    'the guard must bite on the MOVE, not on every edit');

  // ---- 9 · the campus administrator --------------------------------------
  //
  // The person named as Administrator on a campus runs THAT campus's squads and
  // nothing else. Until now that column was decorative - written by the admin
  // screen and read by no authorisation code - so the named administrator could
  // not even edit their own campus's team.
  console.log('\n9 · The campus administrator');

  // A member who is NOT an org owner/admin, so the only thing that can grant them
  // anything here is the campus itself.
  const plain = await prisma.organization_members.findFirst({
    where: {
      organization_id: orgId, status: 'active', role: { notIn: ['owner', 'admin'] },
      users: { password_hash: { not: null }, email: { endsWith: '@bench.test' } },
    },
    select: { user_id: true, users: { select: { email: true } } },
  });

  if (!plain) {
    console.log('      (skipped - no non-admin bench member with a password to sign in as)');
  } else {
    await prisma.org_units.update({ where: { id: blr.id }, data: { admin_user_id: plain.user_id } });
    const cLogin = await call('POST', '/auth/login', { email: plain.users.email, password: PASSWORD });
    if (cLogin.status >= 400) {
      console.log(`      (skipped - could not sign in as ${plain.users.email})`);
    } else {
      const cTok = cLogin.body.token ?? cLogin.body.session?.token;
      console.log(`      acting as ${plain.users.email}, administrator of ${TAG} Bangalore`);

      const mine = await call('POST', '/teams', {
        name: `${TAG} Blr Second XI`, sport_id: sport.id, organization_id: orgId, org_unit_id: blr.id,
      }, cTok);
      check('a campus administrator can create a squad for their campus', mine.status < 400,
        `${mine.status}: ${mine.body?.error?.message}`);

      const theirs = await call('POST', '/teams', {
        name: `${TAG} Mum Second XI`, sport_id: sport.id, organization_id: orgId, org_unit_id: mum.id,
      }, cTok);
      check('but NOT for another campus', theirs.status >= 400,
        `got ${theirs.status} - this would let one campus build another's squad`);

      const orgLevel = await call('POST', '/teams', {
        name: `${TAG} Blr Org Level`, sport_id: sport.id, organization_id: orgId,
      }, cTok);
      check('nor a whole-organisation squad', orgLevel.status >= 400,
        `got ${orgLevel.status} - a campus administrator does not speak for the institution`);

      if (mine.status < 400) {
        const pick = await call('POST', `/teams/${mine.body.id}/members`, { user_id: p2.user_id, role: 'player' }, cTok);
        check('and can pick their own campus’s people into it', pick.status < 400,
          `${pick.status}: ${pick.body?.error?.message}`);

        const outsider2 = await call('POST', `/teams/${mine.body.id}/members`, { user_id: p3.user_id, role: 'player' }, cTok);
        check('while eligibility still refuses the other campus’s people', outsider2.status === 400,
          'the administrator gains reach, not an exemption from the squad rules');
      }

      const otherTeam = await call('PATCH', `/teams/${teamMum.id}`, { name: `${TAG} Hijacked` }, cTok);
      check('and cannot edit another campus’s existing squad', otherTeam.status >= 400,
        `got ${otherTeam.status}`);
    }
    await prisma.org_units.update({ where: { id: blr.id }, data: { admin_user_id: null } });
  }
}

// ---------------------------------------------------------------------------

try {
  await main();
} catch (e) {
  bad('run aborted', e.message);
} finally {
  try {
    const me = token ? await call('GET', '/auth/me') : null;
    await cleanup(me?.body?.organizations?.[0]?.organization_id ?? null);
    console.log('\nCleaned up.');
  } catch (e) { console.log(`\nCleanup problem: ${e.message}`); }
  await prisma.$disconnect();
  console.log(`\n${'='.repeat(62)}`);
  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFAILURES');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}
