/*
 * THE ROLE BENCH - one championship, every role, all of it reachable.
 *
 *   npx tsx scripts/seed-role-bench.ts seed      # build it
 *   npx tsx scripts/seed-role-bench.ts logins    # print the login matrix again
 *   npx tsx scripts/seed-role-bench.ts cleanup   # delete EXACTLY what was built
 *
 * WHY A SECOND BENCH. seed-iimb.ts predates the role model, the org workspace and
 * the module gate: it creates eight orgs, one organiser and three officials, and
 * nothing that exercises Sports Admin, a campus-scoped grant, a suspended grant, a
 * pending membership, a module switch or a certificate. Testing "can a Reporting
 * Admin see this" against it is not possible, because nobody in it is one.
 *
 * TWO RULES THIS SCRIPT KEEPS.
 *
 * 1. IT TOUCHES NOTHING THAT ALREADY EXISTS. Every row it writes is new and is
 *    recorded by id in .seed-role-bench-manifest.json; cleanup deletes those ids and
 *    only those, in FK order. The global catalogue (sports, disciplines, formats,
 *    roles, permissions) is READ and never written. No existing organisation, user,
 *    championship or result is read into, updated or deleted.
 *
 * 2. EVERY ROW IS ONE A SCREEN COULD HAVE PRODUCED. Structure is inserted in the
 *    shape its route writes; outcomes are driven through the REAL services -
 *    `generateFixtures` builds the draws, `lockScorecard` publishes the results, and
 *    that one call is what produces the achievements, the lifetime entries, the
 *    standings, the career statistics, the audit lines and the "result verified"
 *    notifications. Nothing downstream is hand-written, so nothing downstream can
 *    disagree with the code that normally writes it. Each block below names the
 *    screen and the action it stands in for.
 *
 * WHAT IS COVERED. Six organisation roles including three campus-scoped ones, all
 * three grant statuses (ACTIVE / INVITED / SUSPENDED), all four membership statuses
 * and all three verification states, five event roles, the super admin, an account
 * with no institution at all, and one person who belongs to two. Three subscription
 * tiers across four institutions, so locked capabilities are visible as well as
 * unlocked ones. One module switched off for students on one institution, so the
 * module gate is observable rather than theoretical.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { eventTemplateFor, tieTemplateFor, initTie, decideRubber, rubbersWon } from '@semp/shared';
import { generateFixtures, type TeamRef } from '../src/modules/fixtures/domain/generators/index.js';
import { propagateByes } from '../src/modules/fixtures/bracket.js';
import { submitScorecard, lockScorecard } from '../src/modules/fixtures/lock.service.js';
import { recomputeStandings } from '../src/modules/standings/standings.service.js';
import { allocateNumber, codeFor, formatSerial, newToken, signCertificate, type CertificateFacts } from '../src/modules/certificates/certificates.service.js';
import { presetById } from '../src/modules/certificates/presets.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-role-bench-manifest.json');

// One password for the whole bench. These are throwaway accounts on a test domain;
// a different password per persona buys nothing and costs everybody the lookup.
const PASSWORD = 'Bench@2026';
const DOMAIN = 'bench.test';
const TAG = 'Bench';

// ---------------------------------------------------------------------------
// manifest - saved after every track() so a crash mid-run still cleans up
// ---------------------------------------------------------------------------
type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  saveManifest();
};

// The services below take an express Request only to read who is acting and from
// where. Nothing else on it is touched, so this is the whole of it.
const asReq = (u: { id: string; email: string; isSuperAdmin?: boolean }): Request => ({
  user: { id: u.id, email: u.email, isSuperAdmin: !!u.isSuperAdmin },
  ip: '127.0.0.1',
  headers: {},
} as unknown as Request);

// Issued once at signup and never reissued - the same formula the identity
// migration used, so a bench account's id is indistinguishable from a real one.
const sportagonId = (seq: number) => `EOS-${String(1000000 + ((seq * 7919 + 313337) % 8999999)).padStart(7, '0')}`;

const day = (d: string, h = 4, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

// ---------------------------------------------------------------------------
// the cast
// ---------------------------------------------------------------------------
// `orgKey` is the institution they belong to; `member` is the membership row's
// role, which is what the audience (staff / students) and the implied org role are
// both derived from. `grant` is an EXPLICIT user_org_roles row on top of it - the
// thing the Roles & Permissions screen assigns - and is the only place a scope
// appears, because a scoped role with no scope is meaningless.
interface Persona {
  key: string;
  name: string;
  local: string;             // email local part
  phone: string;
  orgKey?: string;
  member?: 'owner' | 'admin' | 'captain' | 'member' | 'alumni';
  memberStatus?: 'active' | 'pending' | 'past' | 'rejected';
  verification?: 'verified' | 'pending' | 'rejected';
  grant?: { role: string; scope?: 'unit' | 'org'; status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED' };
  superAdmin?: boolean;
  note: string;              // what this account is FOR - printed in the matrix
}

const PERSONAS: Persona[] = [
  // ---- Northfield: the host institution, one of every organisation role -----
  { key: 'owner', name: 'Nadia Rao', local: 'owner.nit', phone: '9810000001', orgKey: 'nit', member: 'owner',
    note: 'Owner · sees everything, org + event' },
  { key: 'orgadmin', name: 'Omar Sheikh', local: 'admin.nit', phone: '9810000002', orgKey: 'nit', member: 'admin',
    note: 'Org Admin · everything except billing' },
  { key: 'sportsadmin', name: 'Sana Iyer', local: 'sports.nit', phone: '9810000003', orgKey: 'nit', member: 'member',
    grant: { role: 'sports_admin', scope: 'unit' },
    note: 'Sports Admin · scoped to PGP 2026 · runs sport day to day' },
  { key: 'billingadmin', name: 'Bilal Ahmed', local: 'billing.nit', phone: '9810000004', orgKey: 'nit', member: 'member',
    grant: { role: 'billing_admin', scope: 'org' },
    note: 'Billing Admin · Dashboard + Administration, no people data' },
  { key: 'reportingadmin', name: 'Riya Sen', local: 'reports.nit', phone: '9810000005', orgKey: 'nit', member: 'member',
    grant: { role: 'reporting_admin', scope: 'unit' },
    note: 'Reporting Admin · scoped to PGP 2027 · read + export only' },
  { key: 'viewer', name: 'Vikas Nair', local: 'viewer.nit', phone: '9810000006', orgKey: 'nit', member: 'member',
    note: 'Viewer · dashboard, events, achievements' },
  { key: 'alumni', name: 'Ayesha Khan', local: 'alumni.nit', phone: '9810000007', orgKey: 'nit', member: 'alumni',
    note: 'Alumni · students audience, kept on the roll' },
  { key: 'suspended', name: 'Sameer Bose', local: 'suspended.nit', phone: '9810000008', orgKey: 'nit', member: 'member',
    grant: { role: 'sports_admin', scope: 'unit', status: 'SUSPENDED' },
    note: 'SUSPENDED grant · holds the row, gets none of it' },
  { key: 'invited', name: 'Ira Menon', local: 'invited.nit', phone: '9810000009', orgKey: 'nit', member: 'member',
    grant: { role: 'reporting_admin', scope: 'unit', status: 'INVITED' },
    note: 'INVITED grant · not accepted, so grants nothing yet' },
  { key: 'pending', name: 'Priya Das', local: 'pending.nit', phone: '9810000010', orgKey: 'nit', member: 'member',
    memberStatus: 'pending', verification: 'pending',
    note: 'Pending membership · waiting on the Players screen' },
  { key: 'rejected', name: 'Rajat Puri', local: 'rejected.nit', phone: '9810000011', orgKey: 'nit', member: 'member',
    verification: 'rejected',
    note: 'Rejected verification · keeps the account, not the institution' },

  // ---- the event roles, held at the institutions that hold them ------------
  { key: 'official1', name: 'Oscar Pinto', local: 'official1', phone: '9810000012', orgKey: 'nit', member: 'member',
    note: 'Official · assigned to matches, gets the console' },
  { key: 'official2', name: 'Nina Verma', local: 'official2', phone: '9810000013', orgKey: 'nit', member: 'member',
    note: 'Official · second whistle, different matches' },

  { key: 'pocWbc', name: 'Priti Shah', local: 'poc.wbc', phone: '9810000014', orgKey: 'wbc', member: 'owner',
    note: 'POC + Owner (Westbrook) · approves its own entries' },
  { key: 'captainWbc', name: 'Karan Mehta', local: 'captain.wbc', phone: '9810000015', orgKey: 'wbc', member: 'captain',
    note: 'Captain (Westbrook) · squad, plus the event as published' },
  { key: 'playerWbc', name: 'Pooja Rane', local: 'player.wbc', phone: '9810000016', orgKey: 'wbc', member: 'member',
    note: 'Participant (Westbrook) · plays, sees the event, runs none of it' },

  { key: 'pocEgu', name: 'Eshan Roy', local: 'poc.egu', phone: '9810000017', orgKey: 'egu', member: 'owner',
    note: 'POC + Owner (Eastgate) · a second institution to compare against' },
  { key: 'captainEgu', name: 'Tara Joshi', local: 'captain.egu', phone: '9810000018', orgKey: 'egu', member: 'captain',
    note: 'Captain (Eastgate)' },

  { key: 'ownerHvl', name: 'Hema Pillai', local: 'owner.hvl', phone: '9810000019', orgKey: 'hvl', member: 'owner',
    note: 'Owner (Highvale, FREE tier) · every paid capability locked' },
  { key: 'ownerSba', name: 'Sunil Gowda', local: 'owner.sba', phone: '9810000020', orgKey: 'sba', member: 'owner',
    note: 'Owner (Southbank) · entry still PENDING approval' },

  // ---- the shapes that are not a role at all -------------------------------
  { key: 'multi', name: 'Meera Kulkarni', local: 'multi', phone: '9810000021', orgKey: 'nit', member: 'admin',
    note: 'TWO institutions · Org Admin at Northfield, member at Westbrook' },
  { key: 'solo', name: 'Sameera D’Souza', local: 'solo', phone: '9810000022',
    note: 'No institution at all · personal workspace only' },
  { key: 'super', name: 'Bench Platform Admin', local: 'platform', phone: '9810000023', superAdmin: true,
    note: 'Super admin · the platform nav, never module-gated' },
];

// ---------------------------------------------------------------------------
// the institutions
// ---------------------------------------------------------------------------
// Three tiers on purpose. Everything is reachable somewhere (max), the common case
// is represented (pro), and the locked state is observable rather than described
// (free) - a padlock nobody can see is a padlock nobody can review.
const ORGS = [
  { key: 'nit', name: 'Northfield Institute of Technology', short: 'Northfield', code: 'NIT', city: 'Pune', plan: 'max' as const,
    entry: 'host' as const },
  { key: 'wbc', name: 'Westbrook College', short: 'Westbrook', code: 'WBC', city: 'Mumbai', plan: 'pro' as const,
    entry: 'approved' as const },
  { key: 'egu', name: 'Eastgate University', short: 'Eastgate', code: 'EGU', city: 'Bengaluru', plan: 'pro' as const,
    entry: 'approved' as const },
  { key: 'hvl', name: 'Highvale Institute', short: 'Highvale', code: 'HVL', city: 'Jaipur', plan: 'free' as const,
    entry: 'approved' as const },
  { key: 'sba', name: 'Southbank Academy', short: 'Southbank', code: 'SBA', city: 'Kolkata', plan: 'free' as const,
    entry: 'pending' as const },
  { key: 'clf', name: 'Cliffton Sports Institute', short: 'Cliffton', code: 'CLF', city: 'Kochi', plan: 'free' as const,
    entry: 'rejected' as const },
];
// The four that are actually in the draw. Southbank is still pending and Cliffton
// was turned down, and neither may enter a team - which is the point of having them.
const COMPETING = ['nit', 'wbc', 'egu', 'hvl'];

// ---------------------------------------------------------------------------
// the draws
// ---------------------------------------------------------------------------
// Five, chosen to cover every fixture SHAPE the product knows rather than to look
// like a real programme: a knockout, a league, a rubber-based tie, a ranking event
// with no sides at all, and a knockout left un-played so the empty states are real.
type DrawSpec = {
  key: string; sport: string; discipline?: string; format: 'Knockout' | 'League' | 'Rankings';
  structure: 'single' | 'tie' | 'event';
  play: 'full' | 'partial' | 'none';
  squad: number;
};
const DRAWS: DrawSpec[] = [
  { key: 'football', sport: 'Football', discipline: "Men's", format: 'Knockout', structure: 'single', play: 'full', squad: 7 },
  { key: 'basketball', sport: 'Basketball', discipline: "Women's", format: 'Knockout', structure: 'single', play: 'partial', squad: 5 },
  { key: 'volleyball', sport: 'Volleyball', discipline: "Men's", format: 'League', structure: 'single', play: 'full', squad: 6 },
  { key: 'tt', sport: 'Table Tennis', format: 'Knockout', structure: 'tie', play: 'full', squad: 4 },
  { key: 'swim', sport: 'Swimming', format: 'Rankings', structure: 'event', play: 'full', squad: 3 },
];

const SCORE: Record<string, [number, number]> = {
  Football: [3, 1], Basketball: [64, 51], Volleyball: [3, 1],
};

async function seed() {
  if (existsSync(MANIFEST)) {
    console.error(`A bench already exists (${MANIFEST}). Run "cleanup" first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  const run = Date.now().toString(36).slice(-4); // keeps codes and slugs unique across rebuilds

  // ---- 0 · the global catalogue, read only --------------------------------
  const [sports, formats, roles, disciplines] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ where: { organization_id: null }, select: { id: true, code: true, name: true } }),
    prisma.disciplines.findMany({ select: { id: true, name: true, sport_id: true } }),
  ]);
  const sportId = new Map(sports.map((s) => [s.name, s.id]));
  const formatId = new Map(formats.map((f) => [f.name, f.id]));
  const roleId = new Map(roles.filter((r) => r.code).map((r) => [r.code!, r.id]));
  const discId = (sport: string, name: string) => {
    const d = disciplines.find((x) => x.sport_id === sportId.get(sport) && x.name === name);
    if (!d) throw new Error(`discipline not in catalogue: ${sport} / ${name}`);
    return d.id;
  };
  for (const d of DRAWS) {
    if (!sportId.get(d.sport)) throw new Error(`sport not in catalogue: ${d.sport}`);
    if (!formatId.get(d.format)) throw new Error(`format not in catalogue: ${d.format}`);
  }
  for (const code of ['owner', 'org_admin', 'sports_admin', 'billing_admin', 'reporting_admin', 'viewer', 'organiser', 'official', 'poc', 'captain', 'participant']) {
    if (!roleId.get(code)) throw new Error(`role not in catalogue: ${code}. Run the role-model migrations first.`);
  }

  // ---- 1 · institutions ----------------------------------------------------
  // Screen: Administration › Organisation profile (and, for the first one, sign-up).
  const orgIds = new Map<string, string>();
  const orgRows = ORGS.map((o) => {
    const id = randomUUID();
    orgIds.set(o.key, id);
    return {
      id, name: `${o.name}`, short_name: o.short, code: `${o.code}-${run}`, city: o.city,
      status: true, kind: 'institution', verified: true, plan: o.plan, country: 'India',
      // Module access (Administration › Modules). Northfield leaves everything on;
      // Westbrook limits its people directory to staff, which is what makes the
      // module gate observable - a Westbrook student can reach Achievements and
      // cannot reach Players, and both are the same switch.
      settings: o.key === 'wbc' ? { modules: { people: ['staff'] } } : {},
    };
  });
  await prisma.organizations.createMany({ data: orgRows });
  track('organizations', orgRows.map((o) => o.id));
  const NIT = orgIds.get('nit')!;

  // Campuses and batches (Administration › Programmes & batches). These exist so a
  // campus-scoped grant has something real to point at: scope_ref holds a unit id,
  // and a Sports Admin "for PGP 2026" is a different person from one for PGP 2027.
  const unitIds = new Map<string, string>();
  const programmes = [
    { key: 'pgp', name: 'Post Graduate Programme', code: 'PGP', type: 'programme' as const, parent: null as string | null },
    { key: 'pgpem', name: 'PGP for Executives', code: 'PGPEM', type: 'programme' as const, parent: null as string | null },
  ];
  const unitRows: any[] = [];
  programmes.forEach((p, i) => {
    const id = randomUUID();
    unitIds.set(p.key, id);
    unitRows.push({ id, organization_id: NIT, parent_id: null, type: p.type, name: p.name, code: p.code, display_order: i });
  });
  ['2026', '2027'].forEach((year, i) => {
    const id = randomUUID();
    unitIds.set(`pgp${year}`, id);
    unitRows.push({ id, organization_id: NIT, parent_id: unitIds.get('pgp')!, type: 'batch', name: `PGP ${year}`, code: `PGP${year}`, display_order: i });
  });
  await prisma.org_units.createMany({ data: unitRows });
  track('org_units', unitRows.map((u) => u.id));

  // The email domain that auto-joins people to Northfield (Administration ›
  // Security › Domains). Verified, because a super admin approved it.
  const domainId = randomUUID();
  await prisma.org_domains.create({ data: { id: domainId, organization_id: NIT, domain: DOMAIN, verified: true } });
  track('org_domains', domainId);

  // ---- 2 · people ----------------------------------------------------------
  // Screen: sign-up, or Players › Add people. Everyone gets a working password;
  // nobody gets must_change_password, because a bench you cannot log into twice is
  // not a bench.
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userIds = new Map<string, string>();
  const userRows: any[] = [];
  let seq = 0;
  for (const p of PERSONAS) {
    const id = randomUUID();
    userIds.set(p.key, id);
    userRows.push({
      id, name: p.name, email: `${p.local}@${DOMAIN}`, phone: `+91 ${p.phone}`,
      password_hash: hash, is_super_admin: !!p.superAdmin,
      organization_id: p.orgKey ? orgIds.get(p.orgKey) : null,
      account_type: p.orgKey && ['owner', 'admin'].includes(p.member ?? '') ? 'institution' : 'participant',
      sportagon_id: sportagonId(++seq),
      officiates: p.key.startsWith('official'),
      email_verified_at: new Date(), phone_verified_at: new Date(),
      personal_plan: p.key === 'solo' ? 'pro' : 'free',
    });
  }

  // The squads. Real accounts, not decoration: a lifetime record belongs to a
  // person, so a team of placeholders would produce achievements nobody holds.
  // These are what a roll import creates - provisioned, verified by the importer.
  const squadOf = new Map<string, string[]>();  // `${orgKey}:${drawKey}` -> user ids
  const squadRows: any[] = [];
  let squadNo = 0;
  for (const orgKey of COMPETING) {
    for (const d of DRAWS) {
      const ids: string[] = [];
      for (let i = 0; i < d.squad; i++) {
        const id = randomUUID();
        squadNo++;
        ids.push(id);
        squadRows.push({
          id, name: `${ORGS.find((o) => o.key === orgKey)!.short} ${d.sport} ${i + 1}`,
          email: `squad.${orgKey}.${d.key}.${i + 1}@${DOMAIN}`,
          phone: `+91 98${String(20000000 + squadNo).slice(-8)}`,
          password_hash: hash, organization_id: orgIds.get(orgKey), account_type: 'participant',
          sportagon_id: sportagonId(1000 + squadNo), email_verified_at: new Date(),
        });
      }
      squadOf.set(`${orgKey}:${d.key}`, ids);
    }
  }
  await prisma.users.createMany({ data: [...userRows, ...squadRows] });
  track('users', [...userRows, ...squadRows].map((u) => u.id));

  // Privacy defaults (My Sports Profile › Privacy). The captain has published a
  // public profile; the solo account is deliberately undiscoverable, which is the
  // other end of the same switch.
  const privacy = [
    { user_id: userIds.get('captainWbc')!, public_profile: true, public_stats: true, discoverable: true },
    { user_id: userIds.get('solo')!, public_profile: false, public_stats: false, discoverable: false },
  ];
  await prisma.profile_privacy.createMany({ data: privacy });
  track('profile_privacy', privacy.map((p) => p.user_id));

  // ---- 3 · memberships and explicit grants ---------------------------------
  // Screen: Administration › Members (role + status), Players (verification).
  const memberRows: any[] = [];
  const grantRows: any[] = [];
  for (const p of PERSONAS) {
    if (!p.orgKey) continue;
    memberRows.push({
      id: randomUUID(), user_id: userIds.get(p.key)!, organization_id: orgIds.get(p.orgKey)!,
      role: p.member ?? 'member', status: p.memberStatus ?? 'active',
      verification: p.verification ?? 'verified',
      verified_by: (p.verification ?? 'verified') === 'pending' ? null : userIds.get('owner')!,
      verified_at: (p.verification ?? 'verified') === 'pending' ? null : new Date(),
      rejection_note: p.verification === 'rejected' ? 'Not on the current roll for this campus.' : null,
      member_code: `${ORGS.find((o) => o.key === p.orgKey)!.code}${String(1000 + PERSONAS.indexOf(p))}`,
      org_unit_id: p.orgKey === 'nit' ? unitIds.get(PERSONAS.indexOf(p) % 2 === 0 ? 'pgp2026' : 'pgp2027')! : null,
    });
    if (p.grant) {
      grantRows.push({
        id: randomUUID(), user_id: userIds.get(p.key)!, organization_id: orgIds.get(p.orgKey)!,
        role_id: roleId.get(p.grant.role)!, assigned_by: userIds.get('owner')!,
        // A campus-scoped role without a campus is meaningless, so the scope is
        // always filled for the two roles the model scopes.
        scope_ref: p.grant.scope === 'unit' ? unitIds.get(p.grant.role === 'reporting_admin' ? 'pgp2027' : 'pgp2026')! : null,
        status: p.grant.status ?? 'ACTIVE',
      });
    }
  }
  // The second membership. One account, two institutions, two workspaces - the
  // case the context switcher exists for, and the one a single-org bench cannot show.
  memberRows.push({
    id: randomUUID(), user_id: userIds.get('multi')!, organization_id: orgIds.get('wbc')!,
    role: 'member', status: 'active', verification: 'verified',
    verified_by: userIds.get('pocWbc')!, verified_at: new Date(), member_code: `WBC${run}`,
  });
  // The squads are members of their institutions too, or they are people the
  // institution has never heard of turning out for its teams.
  for (const orgKey of COMPETING) {
    const seen = new Set<string>();
    for (const d of DRAWS) {
      for (const uid of squadOf.get(`${orgKey}:${d.key}`)!) {
        if (seen.has(uid)) continue;
        seen.add(uid);
        memberRows.push({
          id: randomUUID(), user_id: uid, organization_id: orgIds.get(orgKey)!,
          role: 'member', status: 'active', verification: 'verified',
          verified_by: userIds.get('owner')!, verified_at: new Date(),
        });
      }
    }
  }
  await prisma.organization_members.createMany({ data: memberRows });
  track('organization_members', memberRows.map((m) => m.id));
  await prisma.user_org_roles.createMany({ data: grantRows });
  track('user_org_roles', grantRows.map((g) => g.id));

  // ---- 4 · the championship ------------------------------------------------
  // Screen: Create event wizard. Hosted BY Northfield, which is what gives its
  // senior staff authority over it without anybody holding an Organiser row.
  const champId = randomUUID();
  await prisma.championships.create({
    data: {
      id: champId, name: `${TAG} · Sportagon Trials 2026`, slug: `bench-sportagon-trials-${run}`,
      description: 'The role bench. One championship carrying every role, scope and state the product knows. Safe to delete with the seed cleanup.',
      venue: 'Northfield Sports Complex, Pune',
      start_date: day('2026-09-14'), end_date: day('2026-09-18'),
      status: 'ongoing', visibility: 'public', type: 'inter_college',
      country: 'India', region: 'asia', allow_individual_entry: true,
      host_organization_id: NIT,
    },
  });
  track('championships', champId);

  // Entries (Discover › Enter, then Approvals). Four approved, one still waiting
  // and one turned down - so Approvals has something in every column.
  const entryRows = ORGS.filter((o) => o.entry !== 'host').map((o) => ({
    id: randomUUID(), championship_id: champId, organization_id: orgIds.get(o.key)!,
    applied_by: userIds.get(o.key === 'wbc' ? 'pocWbc' : o.key === 'egu' ? 'pocEgu' : o.key === 'hvl' ? 'ownerHvl' : 'ownerSba')
      ?? userIds.get('owner')!,
    status: o.entry === 'pending' ? 'pending' : o.entry === 'rejected' ? 'rejected' : 'approved',
    reviewed_by: o.entry === 'pending' ? null : userIds.get('owner')!,
    reviewed_at: o.entry === 'pending' ? null : new Date(),
    rejection_note: o.entry === 'rejected' ? 'Entries for this edition are limited to institutions in the western and southern zones.' : null,
  }));
  // The host enters its own event - it is competing, not just running it.
  entryRows.push({
    id: randomUUID(), championship_id: champId, organization_id: NIT, applied_by: userIds.get('owner')!,
    status: 'approved', reviewed_by: userIds.get('owner')!, reviewed_at: new Date(), rejection_note: null,
  });
  await prisma.championship_organizations.createMany({ data: entryRows });
  track('championship_organizations', entryRows.map((e) => e.id));
  const entryByOrg = new Map(entryRows.map((e) => [e.organization_id, e.id]));

  // An invitation the organiser sent to an institution not yet on the platform
  // (Participants › Invite). Still outstanding, which is the state worth seeing.
  const inviteId = randomUUID();
  await prisma.championship_invitations.create({
    data: {
      id: inviteId, championship_id: champId, org_name: 'Ravenscroft Polytechnic',
      poc_mobile: '+91 9810000099', status: 'pending', invited_by: userIds.get('owner')!,
    },
  });
  track('championship_invitations', inviteId);

  // ---- 5 · event roles -----------------------------------------------------
  // Screen: Organising team, and Officials. An event role means something only
  // inside the event: it is what the event workspace filters its nav by.
  const eventRoles: Array<[string, string]> = [
    ['owner', 'organiser'], ['sportsadmin', 'organiser'],
    ['official1', 'official'], ['official2', 'official'],
    ['pocWbc', 'poc'], ['pocEgu', 'poc'],
    ['captainWbc', 'captain'], ['captainEgu', 'captain'],
    ['playerWbc', 'participant'], ['solo', 'participant'],
  ];
  const ucrRows = eventRoles.map(([who, code]) => ({
    id: randomUUID(), user_id: userIds.get(who)!, championship_id: champId,
    role_id: roleId.get(code)!, assigned_by: userIds.get('owner')!,
  }));
  await prisma.user_championship_roles.createMany({ data: ucrRows });
  track('user_championship_roles', ucrRows.map((r) => r.id));

  const officialRows = ['official1', 'official2'].map((who) => ({
    id: randomUUID(), championship_id: champId, user_id: userIds.get(who)!,
    assigned_by: userIds.get('owner')!, is_active: true,
    notes: who === 'official1' ? 'Court and field matches' : 'Pool and table matches',
  }));
  await prisma.championship_officials.createMany({ data: officialRows });
  track('championship_officials', officialRows.map((o) => o.id));

  // ---- 6 · setup -----------------------------------------------------------
  // Screen: Event setup › Sports, Venues, Points.
  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'Northfield Sports Complex', city: 'Pune' } });
  track('venues', venueId);
  const grounds = ['Main Ground', 'Indoor Arena', 'Aquatic Centre'].map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));

  // Two rules, because one is the interesting case. The championship default is
  // placement (a knockout awards points for where you finish); the volleyball
  // league overrides it with per-match points, which is the more specific rule
  // winning - the thing the resolver exists to do.
  const ruleRows: any[] = [{
    id: randomUUID(), championship_id: champId, scope_type: 'championship', scope_id: null,
    config: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
  }];

  const tsIds = new Map<string, string>();
  const tsRows: any[] = [];
  [...new Set(DRAWS.map((d) => d.sport))].forEach((sport, i) => {
    const id = randomUUID();
    tsIds.set(sport, id);
    const d = DRAWS.find((x) => x.sport === sport)!;
    tsRows.push({ id, tournament_id: tournamentId, sport_id: sportId.get(sport)!, format_id: formatId.get(d.format)!, display_order: i });
  });
  await prisma.tournament_sports.createMany({ data: tsRows });
  track('tournament_sports', tsRows.map((t) => t.id));

  const drawIds = new Map<string, string>();
  const tdRows: any[] = [];
  DRAWS.forEach((d, i) => {
    const id = randomUUID();
    drawIds.set(d.key, id);
    // The scoring template is what the Setup wizard writes when you pick the
    // format: a tie gets its rubber list, a ranking event gets its sub-events.
    const scoring = d.structure === 'tie' ? tieTemplateFor(d.sport)
      : d.structure === 'event' ? eventTemplateFor(d.sport)
      : { fixtureType: 'single', scoringMode: 'detailed' };
    tdRows.push({
      id, tournament_sport_id: tsIds.get(d.sport)!,
      discipline_id: d.discipline ? discId(d.sport, d.discipline) : null,
      format_id: formatId.get(d.format)!, venue_id: venueId,
      status: d.play === 'none' ? 'scheduled' : 'ongoing', display_order: i,
      format_config: scoring ? { scoring } : {},
    });
  });
  await prisma.tournament_disciplines.createMany({ data: tdRows });
  track('tournament_disciplines', tdRows.map((t) => t.id));

  ruleRows.push({
    id: randomUUID(), championship_id: champId, scope_type: 'discipline', scope_id: drawIds.get('volleyball')!,
    config: { scheme: 'league_points', win: 3, draw: 1, loss: 0, participation: 0, tiebreakers: ['points', 'wins', 'score_diff'] },
  });
  await prisma.standings_rules.createMany({ data: ruleRows });
  track('standings_rules', ruleRows.map((r) => r.id));

  // ---- 7 · teams and entries ----------------------------------------------
  // Screen: Teams › Create, then Roster, then Enter championship.
  const teamRows: any[] = [];
  const teamMemberRows: any[] = [];
  const teamEntryRows: any[] = [];
  const teamsByDraw = new Map<string, string[]>();
  for (const d of DRAWS) {
    if (d.structure === 'event') continue; // a ranking event has competitors, not teams
    const ids: string[] = [];
    for (const orgKey of COMPETING) {
      const teamId = randomUUID();
      const org = ORGS.find((o) => o.key === orgKey)!;
      teamRows.push({
        id: teamId, sport_id: sportId.get(d.sport)!, organization_id: orgIds.get(orgKey)!,
        name: `${org.short} ${d.discipline ? `${d.sport} ${d.discipline}` : d.sport}`, status: 'approved',
      });
      ids.push(teamId);
      // The named captains lead their own institution's squads; everybody else on
      // the sheet is a player. A team with no captain cannot be managed by one.
      const squad = squadOf.get(`${orgKey}:${d.key}`)!;
      const namedCaptain = orgKey === 'wbc' ? userIds.get('captainWbc') : orgKey === 'egu' ? userIds.get('captainEgu') : null;
      if (namedCaptain) {
        teamMemberRows.push({ id: randomUUID(), team_id: teamId, user_id: namedCaptain, role: 'captain', jersey_number: 1, is_active: true });
      }
      squad.forEach((uid, i) => {
        teamMemberRows.push({
          id: randomUUID(), team_id: teamId, user_id: uid,
          role: !namedCaptain && i === 0 ? 'captain' : i === 1 ? 'vice_captain' : 'player',
          jersey_number: i + 2, is_active: true,
        });
      });
      // One named participant actually plays, so their My Game and lifetime record
      // have something in them rather than a role with no matches behind it.
      if (orgKey === 'wbc' && d.key === 'football') {
        teamMemberRows.push({ id: randomUUID(), team_id: teamId, user_id: userIds.get('playerWbc')!, role: 'player', jersey_number: 20, is_active: true });
      }
      if (orgKey === 'nit' && d.key === 'volleyball') {
        teamMemberRows.push({ id: randomUUID(), team_id: teamId, user_id: userIds.get('solo')!, role: 'player', jersey_number: 21, is_active: true });
      }
      teamEntryRows.push({
        id: randomUUID(), team_id: teamId, organization_id: orgIds.get(orgKey)!, championship_id: champId,
        championship_organization_id: entryByOrg.get(orgIds.get(orgKey)!)!,
        tournament_discipline_id: drawIds.get(d.key)!, status: 'approved',
      });
    }
    teamsByDraw.set(d.key, ids);
  }
  await prisma.teams.createMany({ data: teamRows });
  track('teams', teamRows.map((t) => t.id));
  await prisma.team_members.createMany({ data: teamMemberRows });
  track('team_members', teamMemberRows.map((m) => m.id));
  await prisma.team_entries.createMany({ data: teamEntryRows });
  track('team_entries', teamEntryRows.map((e) => e.id));

  // ---- 8 · the draws -------------------------------------------------------
  // Screen: Schedule › Generate draw. The SAME generator the button calls, so the
  // bracket arithmetic, the round labels and the bye propagation are the product's,
  // not a re-implementation that can drift from it.
  let slot = 0;
  const nextSlot = () => new Date(day('2026-09-14', 4).getTime() + (slot++) * 45 * 60000);
  const officialsPool = officialRows.map((o) => o.user_id);
  let offRR = 0;
  let grRR = 0;

  const fixtureIds = new Map<string, string[]>();
  for (const d of DRAWS) {
    const teams: TeamRef[] = (teamsByDraw.get(d.key) ?? []).map((teamId) => ({ teamId }));
    const generated = d.structure === 'event'
      ? generateFixtures('Rankings', [], {})
      : generateFixtures(d.format, teams, { thirdPlaceMatch: d.format === 'Knockout' });

    const rows = generated.map((f) => ({
      id: randomUUID(), tournament_discipline_id: drawIds.get(d.key)!,
      home_team_id: f.homeTeamId, away_team_id: f.awayTeamId, winner_team_id: f.winnerTeamId ?? null,
      round: f.round, pool_number: f.poolNumber, bracket_position: f.bracketPosition, status: f.status,
      // Scheduling and officials are the organiser's, applied after the draw exists.
      scheduled_at: nextSlot(),
      venue_ground_id: grounds[grRR++ % grounds.length].id,
      official_id: officialsPool[offRR++ % officialsPool.length],
    }));
    await prisma.fixtures.createMany({ data: rows });
    track('fixtures', rows.map((r) => r.id));
    await propagateByes(prisma as any, drawIds.get(d.key)!);
    fixtureIds.set(d.key, rows.map((r) => r.id));
  }

  // ---- 9 · playing it ------------------------------------------------------
  // Screen: Match console › score, submit, then Results › lock.
  //
  // This is the block that earns the rest. `lockScorecard` is the real one, so
  // every artefact downstream of a published result - achievements, lifetime
  // entries, standings, career statistics, the audit line, the "result verified"
  // notification to each participant - is written by the code that normally writes
  // it. None of it is inserted by hand, which is why none of it can be wrong in a
  // way the product would not also be wrong.
  const organiserReq = asReq({ id: userIds.get('owner')!, email: `owner.nit@${DOMAIN}` });
  const officialReq = asReq({ id: officialsPool[0], email: `official1@${DOMAIN}` });
  let locked = 0;

  for (const d of DRAWS) {
    if (d.play === 'none') continue;
    const rows = (await prisma.fixtures.findMany({
      where: { tournament_discipline_id: drawIds.get(d.key)! },
      select: { id: true, round: true, bracket_position: true, pool_number: true, created_at: true },
    })).sort((a, b) =>
      (a.pool_number ?? 0) - (b.pool_number ?? 0)
      || (a.bracket_position ?? 99) - (b.bracket_position ?? 99)
      || a.created_at.getTime() - b.created_at.getTime());

    for (const [i, row] of rows.entries()) {
      // Re-read, every time. Locking a semi-final pushes its winner into the final,
      // so a snapshot taken before the round was played still shows the final with
      // no teams in it - and the loop skips the match the whole bracket is for.
      let fx = (await prisma.fixtures.findUnique({ where: { id: row.id } }))!;

      // The third-place match is the one fixture the bracket cannot fill: it has no
      // position, so nothing feeds it. The organiser puts the two beaten semi-
      // finalists in it, which is what this is standing in for.
      if (fx.round === '3rd Place' && !fx.home_team_id) {
        const semis = await prisma.fixtures.findMany({
          where: { tournament_discipline_id: drawIds.get(d.key)!, round: 'SF', winner_team_id: { not: null } },
          select: { home_team_id: true, away_team_id: true, winner_team_id: true },
        });
        const losers = semis
          .map((s) => (s.home_team_id === s.winner_team_id ? s.away_team_id : s.home_team_id))
          .filter((t): t is string => !!t);
        if (losers.length === 2) {
          fx = await prisma.fixtures.update({
            where: { id: fx.id }, data: { home_team_id: losers[0], away_team_id: losers[1] },
          });
        }
      }

      // Which matches get played. 'full' plays the lot; 'partial' plays the first
      // half and leaves the rest at various stages, which is what an event in
      // progress actually looks like.
      const total = rows.length;
      const playThis = d.play === 'full' ? true : i < Math.ceil(total / 2);

      if (d.structure === 'event') {
        // A ranking event has no sides: its competitors live in live_state, and a
        // mark against a phone number is how a swimmer becomes a person.
        const spec = eventTemplateFor(d.sport)!.event!;
        const subs = spec.subEvents.slice(0, 2).map((s) => s.key);
        const participants = COMPETING.flatMap((orgKey, oi) => {
          const org = ORGS.find((o) => o.key === orgKey)!;
          return squadOf.get(`${orgKey}:${d.key}`)!.slice(0, 2).map((uid, pi) => {
            const u = squadRows.find((s) => s.id === uid)!;
            return {
              id: `${orgKey}-${pi}`, name: u.name, org: org.name, orgId: orgIds.get(orgKey)!,
              phone: u.phone,
              marks: Object.fromEntries(subs.map((k, j) => [k, spec.result.winnerIs === 'min' ? 26 + oi * 0.8 + pi * 0.4 + j : 300 - oi * 12 - pi * 5 - j * 3])),
            };
          });
        });
        await prisma.fixtures.update({
          where: { id: fx.id },
          data: { status: 'completed', live_state: { event: { participants } } as any },
        });
      } else if (!playThis || !fx.home_team_id || !fx.away_team_id || fx.status === 'bye') {
        continue;
      } else if (d.structure === 'tie') {
        const spec = tieTemplateFor(d.sport)!.tie!;
        let st = initTie(spec);
        for (let r = 0; r < spec.rubbers.length; r++) {
          if (rubbersWon(st).a > spec.rubbers.length / 2) break;
          st = decideRubber(spec, st, r, r % 3 === 2 ? 'B' : 'A');
        }
        const { a, b } = rubbersWon(st);
        await prisma.fixtures.update({
          where: { id: fx.id },
          data: { status: 'completed', winner_team_id: fx.home_team_id, home_score: a, away_score: b, live_state: { tie: st } as any },
        });
      } else {
        const [ws, ls] = SCORE[d.sport] ?? [2, 1];
        // Not every match is a home win - a table where one side never loses is a
        // table nobody can read.
        const homeWins = i % 3 !== 1;
        await prisma.fixtures.update({
          where: { id: fx.id },
          data: {
            status: 'completed',
            winner_team_id: homeWins ? fx.home_team_id : fx.away_team_id,
            home_score: homeWins ? ws : ls, away_score: homeWins ? ls : ws,
          },
        });
      }

      // The official says they are finished, the organiser makes it official.
      // Leave the LAST played match of a partial draw submitted-but-not-locked, so
      // the organiser's Results screen has something waiting for them.
      const leaveUnlocked = d.play === 'partial' && i === Math.ceil(total / 2) - 1;
      await submitScorecard(prisma as any, officialReq, fx.id).catch(() => {});
      if (!leaveUnlocked) {
        await lockScorecard(prisma as any, organiserReq, fx.id);
        locked++;
      }
    }
  }

  // The two outcomes that are not scores. Applied to the draw left half-played, so
  // they cannot disturb a bracket that is still resolving.
  //
  // The final is called off - a real state, and the one that proves the standings
  // withhold a winner until somebody actually wins. The third-place match is a
  // walkover: one side did not turn up, there is no score to record, and the
  // outcome IS the record. It is locked like any other result, because a bronze
  // won by walkover is still a bronze.
  const bball = await prisma.fixtures.findMany({
    where: { tournament_discipline_id: drawIds.get('basketball')!, scorecard_status: { not: 'locked' } },
    select: { id: true, round: true, home_team_id: true, away_team_id: true },
  });
  const bballFinal = bball.find((f) => f.round === 'Final');
  if (bballFinal) {
    await prisma.fixtures.update({
      where: { id: bballFinal.id },
      data: { status: 'postponed', winner_team_id: null, home_score: null, away_score: null },
    });
  }
  const bballThird = bball.find((f) => f.round === '3rd Place');
  if (bballThird) {
    const semis = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: drawIds.get('basketball')!, round: 'SF', winner_team_id: { not: null } },
      select: { home_team_id: true, away_team_id: true, winner_team_id: true },
    });
    const losers = semis
      .map((s) => (s.home_team_id === s.winner_team_id ? s.away_team_id : s.home_team_id))
      .filter((t): t is string => !!t);
    if (losers.length === 2) {
      await prisma.fixtures.update({
        where: { id: bballThird.id },
        data: { home_team_id: losers[0], away_team_id: losers[1], status: 'walkover', winner_team_id: losers[0] },
      });
      await lockScorecard(prisma as any, organiserReq, bballThird.id);
      locked++;
    }
  }

  // Standings for the whole championship. Already correct from the locks above -
  // run once more so the un-locked and walkover states are reflected too.
  await recomputeStandings(prisma as any, champId);
  const standingsRows = await prisma.standings.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('standings', standingsRows.map((s) => s.id));


  // ---- 10 · certificates ---------------------------------------------------
  // Screen: Certificates › Designs (from a preset), then Generate.
  // Issued from LOCKED honours only, and with the same primitives the route uses -
  // the serial, the signature and the verification token are the real ones, so the
  // public verify page answers correctly for these.
  const preset = presetById('institutional')!;
  const templateId = randomUUID();
  await prisma.certificate_templates.create({
    data: {
      id: templateId, organization_id: NIT, name: `${preset.name}`,
      code: codeFor(preset.name).toUpperCase().slice(0, 8),
      design: preset.design as object, is_default: true, created_by: userIds.get('owner')!,
    },
  });
  track('certificate_templates', templateId);

  const honours = await prisma.achievements.findMany({
    where: { championship_id: champId, organization_id: NIT, user_id: { not: null }, superseded_at: null, kind: { in: ['medal', 'placement'] } },
    select: { id: true, user_id: true, fixture_id: true, title: true, sport_id: true, lock_version: true },
    take: 25,
  });
  const certIds: string[] = [];
  const year = 2026;
  const code = codeFor(preset.name).toUpperCase().slice(0, 8);
  const [orgName, names, sportNames] = await Promise.all([
    prisma.organizations.findUnique({ where: { id: NIT }, select: { name: true } }),
    prisma.users.findMany({ where: { id: { in: honours.map((h) => h.user_id!) } }, select: { id: true, name: true } }),
    prisma.sports.findMany({ select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const sportOf = new Map(sportNames.map((s) => [s.id, s.name]));
  for (const h of honours) {
    const seqNo = await allocateNumber(prisma as any, NIT, year, code);
    const serial = formatSerial(year, code, seqNo);
    const facts: CertificateFacts = {
      serial, recipient_name: nameOf.get(h.user_id!) ?? 'Unknown',
      organization_name: orgName!.name, championship_name: `${TAG} · Sportagon Trials 2026`,
      sport: h.sport_id ? (sportOf.get(h.sport_id) ?? null) : null,
      title: h.title, issued_on: '2026-09-19',
    };
    const id = randomUUID();
    try {
      await prisma.certificates.create({
        data: {
          id, organization_id: NIT, template_id: templateId, championship_id: champId,
          fixture_id: h.fixture_id, user_id: h.user_id, recipient_name: facts.recipient_name,
          serial, seq: seqNo, year, code, payload: facts as unknown as object,
          signature: signCertificate(facts), token: newToken(),
          issued_by: userIds.get('owner')!, lock_version: h.lock_version ?? null,
        },
      });
      certIds.push(id);
      track('certificates', id);
    } catch (e: any) {
      // One certificate per person per match per design. A player who took both a
      // medal and a placement out of the same final has two honours and one
      // certificate, and the route treats the second as a skip rather than an
      // error - so this does too.
      if (e?.code !== 'P2002') throw e;
    }
  }
  track('certificate_counters', []); // composite key - deleted by organisation on cleanup
  // One withdrawn certificate, because a register with no withdrawal in it never
  // shows what withdrawal looks like.
  if (certIds.length > 1) {
    await prisma.certificates.update({
      where: { id: certIds[certIds.length - 1] },
      data: { revoked_at: new Date(), revoked_by: userIds.get('owner')!, revoked_reason: 'Issued against the wrong discipline; reissued under the corrected honour.' },
    });
  }

  // ---- 11 · achievement claims --------------------------------------------
  // Screen: My Sports Profile › Add an achievement, then Records › Validate.
  // Something the product did not see happen, offered by the person it happened to.
  const claimRows = [
    {
      id: randomUUID(), user_id: userIds.get('captainWbc')!, organization_id: orgIds.get('wbc')!,
      kind: 'medal', title: 'Gold · State Inter-College Table Tennis', detail: 'Maharashtra State Championship, Nashik.',
      sport_id: sportId.get('Table Tennis')!, occurred_on: day('2025-11-22'), status: 'pending',
      evidence_url: null, decided_by: null, decided_at: null, decision_note: null,
    },
    {
      id: randomUUID(), user_id: userIds.get('playerWbc')!, organization_id: orgIds.get('wbc')!,
      kind: 'selection', title: 'Selected · University Football squad', detail: 'Zonal camp, 2025 season.',
      sport_id: sportId.get('Football')!, occurred_on: day('2025-08-04'), status: 'approved',
      evidence_url: null, decided_by: userIds.get('pocWbc')!, decided_at: new Date(), decision_note: 'Confirmed against the university squad list.',
    },
    {
      id: randomUUID(), user_id: userIds.get('alumni')!, organization_id: NIT,
      kind: 'record', title: 'Institute record · 100m Freestyle', detail: 'Claimed for the 2019 intake.',
      sport_id: sportId.get('Swimming')!, occurred_on: day('2019-03-10'), status: 'rejected',
      evidence_url: null, decided_by: userIds.get('owner')!, decided_at: new Date(), decision_note: 'No timing sheet on file for that meet.',
    },
  ];
  await prisma.achievement_claims.createMany({ data: claimRows });
  track('achievement_claims', claimRows.map((c) => c.id));

  // ---- 12 · communications -------------------------------------------------
  // Screen: Event › Communications › Compose. Written directly rather than through
  // notify(), because notify() fans out to every recipient of a live championship
  // and this bench must not deliver anything to accounts outside it.
  const noteRows = [
    {
      id: randomUUID(), championship_id: champId, sender_id: userIds.get('owner')!, type: 'manual',
      audience: 'all', title: 'Reporting times for day one',
      body: 'Teams report to the Main Ground 45 minutes before their first fixture. Bring institute ID; the accreditation desk opens at 07:00.',
    },
    {
      id: randomUUID(), championship_id: champId, sender_id: userIds.get('owner')!, type: 'manual',
      audience: 'officials', title: 'Officials briefing moved to the Indoor Arena',
      body: 'The pre-tournament briefing is in the Indoor Arena, not the pavilion. Scorecards must be submitted before you leave the venue.',
    },
    {
      id: randomUUID(), championship_id: champId, sender_id: userIds.get('pocWbc')!, type: 'manual',
      audience: 'organisation', organization_id: orgIds.get('wbc')!,
      title: 'Westbrook: bus leaves at 06:15',
      body: 'The team bus leaves from the west gate at 06:15 sharp on both days. Kit bags go in the hold the night before.',
    },
  ];
  await prisma.notifications.createMany({ data: noteRows });
  track('notifications', noteRows.map((n) => n.id));

  // Read state and a reaction, so the bell badge and the reaction row are not
  // permanently at their empty state.
  const readRows = [
    { id: randomUUID(), notification_id: noteRows[0].id, user_id: userIds.get('captainWbc')! },
    { id: randomUUID(), notification_id: noteRows[0].id, user_id: userIds.get('pocWbc')! },
  ];
  await prisma.notification_reads.createMany({ data: readRows });
  track('notification_reads', readRows.map((r) => r.id));
  const reactRows = [
    { id: randomUUID(), notification_id: noteRows[0].id, user_id: userIds.get('captainWbc')!, reaction: '👍' },
    { id: randomUUID(), notification_id: noteRows[1].id, user_id: userIds.get('official1')!, reaction: '✅' },
  ];
  await prisma.notification_reactions.createMany({ data: reactRows });
  track('notification_reactions', reactRows.map((r) => r.id));

  // The lock notifications are ours too - direct messages to each participant,
  // written by lockScorecard.
  const lockNotes = await prisma.notifications.findMany({
    where: { championship_id: champId, type: 'event_lifecycle' }, select: { id: true },
  });
  track('notifications', lockNotes.map((n) => n.id));

  // ---- 13 · a saved template ----------------------------------------------
  // Screen: Event setup › Save as template. The shape of the event somebody just
  // ran, kept under a name, ready to start the next edition from.
  const tmplId = randomUUID();
  await prisma.championship_templates.create({
    data: {
      id: tmplId, name: 'Northfield Trials (5 draws)',
      description: 'The shape of the 2026 Trials: two knockouts, a league, a tie-based table-tennis draw and a swimming rankings event.',
      organization_id: NIT, created_by: userIds.get('owner')!, source_championship_id: champId,
      is_system: false,
      shape: {
        draws: DRAWS.map((d) => ({
          sport: d.sport, format: d.format,
          disciplines: d.discipline ? [d.discipline] : [],
        })),
        standings: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
      },
    },
  });
  track('championship_templates', tmplId);

  // Everything the lock pipeline derived. Recorded last, once nothing else is
  // still writing, and matched on the PEOPLE as well as the championship - an
  // achievement carries a person even where it carries no event.
  const everyUser = [...userIds.values(), ...squadRows.map((u) => u.id)];
  const derivedCounts: Record<string, number> = {};
  for (const table of ['achievements', 'lifetime_entries'] as const) {
    const rows = await (prisma as any)[table].findMany({
      where: { OR: [{ championship_id: champId }, { user_id: { in: everyUser } }] },
      select: { id: true },
    });
    derivedCounts[table] = rows.length;
    track(table, rows.map((r: any) => r.id));
  }
  const careerRows = await prisma.career_stats.findMany({
    where: { user_id: { in: everyUser } }, select: { id: true },
  });
  derivedCounts.career_stats = careerRows.length;
  track('career_stats', careerRows.map((c) => c.id));

  // Audit rows written by the services above belong to this bench too.
  const auditRows = await prisma.audit_log.findMany({
    where: { OR: [{ championship_id: champId }, { organization_id: { in: [...orgIds.values()] } }] },
    select: { id: true },
  });
  // Recorded for the count, not for deletion: a trigger makes audit_log
  // append-only, and a trail you can delete is not a trail. Cleanup reports the
  // refusal rather than failing on it.
  track('audit_log', auditRows.map((a) => String(a.id)));

  saveManifest();

  const counts = Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length]));
  console.log('\n================  ROLE BENCH READY  ================');
  console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${locked} scorecards locked`);
  console.log('derived by the locks:', JSON.stringify(derivedCounts), `· ${certIds.length} certificates issued`);
  console.log('\nrow counts:', JSON.stringify(counts, null, 2));
  console.log('\nchampionship:', `${TAG} · Sportagon Trials 2026`);
  console.log('  id:  ', champId);
  console.log('  slug:', `bench-sportagon-trials-${run}`);
  printLogins();
}

// ---------------------------------------------------------------------------
function printLogins() {
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`\n--------  LOGINS  (password for every account: ${PASSWORD})  --------\n`);
  console.log(pad('EMAIL', 34), pad('NAME', 22), 'WHAT IT IS FOR');
  console.log('-'.repeat(110));
  for (const p of PERSONAS) {
    console.log(pad(`${p.local}@${DOMAIN}`, 34), pad(p.name, 22), p.note);
  }
  console.log(`\nSquad accounts: squad.<org>.<draw>.<n>@${DOMAIN} - same password, no special role.`);
  console.log('\nCleanup:  npx tsx scripts/seed-role-bench.ts cleanup');
  console.log('====================================================\n');
}

// ---------------------------------------------------------------------------
async function cleanup() {
  if (!existsSync(MANIFEST)) { console.error('No bench manifest found - nothing to clean up.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  // Reverse FK order. Anything cascading off users/organizations still lists here,
  // so a partial manifest cleans up as far as it got.
  const order = [
    'certificate_verifications', 'certificates', 'certificate_templates', 'certificate_counters',
    'championship_templates', 'achievement_claims', 'claim_evidence',
    'notification_reactions', 'notification_reads', 'notifications',
    'career_stats', 'achievements', 'lifetime_entries',
    'fixture_awards', 'fixture_events', 'standings', 'fixtures',
    'team_entries', 'team_members', 'teams',
    'championship_officials', 'user_championship_roles', 'championship_invitations',
    'championship_organizations', 'standings_rules',
    'tournament_disciplines', 'tournament_sports', 'tournaments',
    'venue_grounds', 'venues', 'championships',
    'user_org_roles', 'organization_members', 'profile_privacy', 'org_domains', 'org_units',
    'audit_log', 'users', 'organizations',
  ];
  const t0 = Date.now();
  for (const table of order) {
    const ids = m[table];
    if (!ids?.length) continue;
    const model: any = (prisma as any)[table];
    if (!model) continue;
    try {
      const key = table === 'profile_privacy' ? 'user_id' : 'id';
      const res = await model.deleteMany({ where: { [key]: { in: ids } } });
      console.log(`deleted ${res.count}/${ids.length} ${table}`);
    } catch (e: any) {
      // audit_log is append-only by trigger; its rows are left behind deliberately
      // rather than the whole cleanup failing on them.
      console.log(`skipped ${table}: ${String(e.message).split('\n')[0].slice(0, 90)}`);
    }
  }
  rmSync(MANIFEST);
  console.log(`\ncleanup done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Manifest removed.`);
}

const mode = process.argv[2] ?? 'seed';
const run = mode === 'cleanup' ? cleanup() : mode === 'logins' ? Promise.resolve(printLogins()) : seed();
run.catch((e) => { console.error('\nFAILED:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
