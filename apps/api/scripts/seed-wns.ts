/*
 * WNS GLOBAL SERVICES — an INTRA-organisation football cup, built once.
 *
 *   npx tsx scripts/seed-wns.ts seed      # build it
 *   npx tsx scripts/seed-wns.ts logins    # print the login sheet again
 *   npx tsx scripts/seed-wns.ts retime    # re-apply the format + schedule in place
 *   npx tsx scripts/seed-wns.ts cleanup   # delete EXACTLY what was built
 *
 * WHAT IT BUILDS
 *
 *   One organisation  WNS Global Services
 *   One campus        Pune
 *   64 batches        each named after a football club, each with 6 people
 *   384 players       every one with a working login
 *   One sport         Football (Men's), Knockout, 64 squads
 *   64 fixtures       R64 -> R32 -> R16 -> QF -> SF -> Final, plus a 3rd-place match
 *
 * The batches compete against each other, so this is an INTRA event:
 * `entry_level = 'department'` confined to the Pune campus by
 * `entry_scope_unit_id`. The competing contingent is the batch, never the
 * organisation — which is what stops 64 squads collapsing into one standings row.
 *
 * THE MATCH FORMAT is a saved org format rather than a built-in preset: two halves
 * of ten minutes, then ONE period of five minutes' extra time, then five kicks
 * each. Stored on the draw, so every match console in this championship opens on
 * it. Change `HALF_MINUTES` and run `retime` to re-apply it to a standing bench
 * without rebuilding — the urls, the logins and the results all survive.
 *
 * THE STATE OF PLAY, as asked for:
 *   20 completed and locked   R64 matches 1-20
 *   10 live                   R64 matches 21-30
 *   34 not started            the last 2 of R64, then every later round
 *
 * WHY THE NAMES LOOK LIKE THAT. Every player is `<CODE> Player <n>` on
 * `<code>.player<n>@wns.test` — so "who scored" is answerable by reading the
 * scoreline, and a statistic can be checked against the person it belongs to
 * without a lookup. The scorers of every locked match are printed at the end and
 * written to `.seed-wns-results.json` for exactly that.
 *
 * TWO RULES THIS SCRIPT KEEPS, the same two the role bench keeps:
 *
 * 1. IT TOUCHES NOTHING THAT ALREADY EXISTS. Every row it writes is new and is
 *    recorded by id in `.seed-wns-manifest.json`; cleanup deletes those ids and
 *    only those, in FK order. The global catalogue (sports, disciplines, formats,
 *    roles) is READ and never written.
 *
 * 2. OUTCOMES GO THROUGH THE REAL SERVICES. `generateFixtures` draws the bracket
 *    and `lockScorecard` publishes each result — so the standings, the player
 *    statistics, the achievements, the lifetime entries and the audit trail are
 *    written by the code that normally writes them, and cannot disagree with it.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import {
  matchPresetByKey, foldRally, aggregateScore, matchFormatSchema,
  type ScoringFormat, type RallyLog, type RallyEvent, type Side,
} from '@semp/shared';
import { generateFixtures, type TeamRef } from '../src/modules/fixtures/domain/generators/index.js';
import { submitScorecard, lockScorecard } from '../src/modules/fixtures/lock.service.js';
import { recomputeStandings } from '../src/modules/standings/standings.service.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-wns-manifest.json');
const RESULTS = path.join(HERE, '.seed-wns-results.json');

// One password for every account on the bench. These are throwaway logins on a
// test domain; a different password per person buys nothing and costs the lookup.
const PASSWORD = 'Wns@2026';
const DOMAIN = 'wns.test';

// ---------------------------------------------------------------------------
// manifest — saved after every track() so a crash mid-run still cleans up
// ---------------------------------------------------------------------------
type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  saveManifest();
};

// The lock service takes an express Request only to read who is acting and from
// where. Nothing else on it is touched, so this is the whole of it.
const asReq = (u: { id: string; email: string }): Request => ({
  user: { id: u.id, email: u.email, isSuperAdmin: false },
  ip: '127.0.0.1',
  headers: {},
} as unknown as Request);

// Issued once at signup and never reissued — the same formula the identity
// migration used, so a seeded account's id is indistinguishable from a real one.
const sportagonId = (seq: number) => `EOS-${String(1000000 + ((seq * 7919 + 918273) % 8999999)).padStart(7, '0')}`;

/** A wall-clock moment in India, which is where this event is played. */
const ist = (date: string, hh: number, mm: number) =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);

// ---------------------------------------------------------------------------
// the 64 batches
// ---------------------------------------------------------------------------
// A batch is named after a football club and its code is the scoreboard
// abbreviation, the squad's short name AND the stem of all six of its members'
// logins — one string, so nothing has to be cross-referenced to read a statistic.
const BATCHES: Array<[name: string, code: string]> = [
  ['Arsenal', 'ARS'], ['Chelsea', 'CHE'], ['Liverpool', 'LIV'], ['Everton', 'EVE'],
  ['Tottenham', 'TOT'], ['Fulham', 'FUL'], ['Brentford', 'BRE'], ['Brighton', 'BHA'],
  ['Southampton', 'SOU'], ['Newcastle', 'NEW'], ['Sunderland', 'SUN'], ['Leeds', 'LEE'],
  ['Burnley', 'BUR'], ['Wolves', 'WOL'], ['Aston Villa', 'AVL'], ['Leicester', 'LEI'],
  ['Norwich', 'NOR'], ['Ipswich', 'IPS'], ['Watford', 'WAT'], ['Reading', 'RDG'],
  ['Bournemouth', 'BOU'], ['Crystal Palace', 'CRY'], ['West Ham', 'WHU'], ['Nottingham', 'NFO'],
  ['Sheffield', 'SHU'], ['Stoke', 'STK'], ['Swansea', 'SWA'], ['Cardiff', 'CAR'],
  ['Derby', 'DER'], ['Blackburn', 'BLB'], ['Bolton', 'BOL'], ['Preston', 'PRE'],
  ['Barcelona', 'BAR'], ['Valencia', 'VAL'], ['Sevilla', 'SEV'], ['Real Betis', 'BET'],
  ['Villarreal', 'VIL'], ['Celta Vigo', 'CEL'], ['Osasuna', 'OSA'], ['Getafe', 'GET'],
  ['Juventus', 'JUV'], ['AC Milan', 'MIL'], ['Inter Milan', 'INT'], ['AS Roma', 'ROM'],
  ['Lazio', 'LAZ'], ['Napoli', 'NAP'], ['Torino', 'TOR'], ['Atalanta', 'ATA'],
  ['Bayern Munich', 'BAY'], ['Dortmund', 'DOR'], ['Leverkusen', 'LEV'], ['Schalke', 'SCH'],
  ['Werder Bremen', 'BRM'], ['Freiburg', 'FRE'], ['Mainz', 'MAI'], ['Augsburg', 'AUG'],
  ['Ajax', 'AJA'], ['Feyenoord', 'FEY'], ['Porto', 'POR'], ['Benfica', 'BEN'],
  ['Sporting CP', 'SPO'], ['Lyon', 'LYO'], ['Marseille', 'MAR'], ['Monaco', 'MON'],
];

const SQUAD_SIZE = 6;

// ---------------------------------------------------------------------------
// the staff — one login per role, so every screen has somebody who can reach it
// ---------------------------------------------------------------------------
// `member` is the organization_members row, which is what the audience and the
// implied org role are both derived from. `grant` is an EXPLICIT user_org_roles
// row on top of it — the thing the Roles & Permissions screen assigns, and the
// only place a scope appears.
interface Staff {
  key: string;
  name: string;
  local: string;
  phone: string;
  member: 'owner' | 'admin' | 'member';
  grant?: { role: string; scopedToCampus?: boolean };
  eventRole?: string;
  officiates?: boolean;
  superAdmin?: boolean;
  note: string;
}

const STAFF: Staff[] = [
  { key: 'owner', name: 'Nandita Rao', local: 'owner', phone: '9820100001', member: 'owner',
    eventRole: 'organiser',
    note: 'Owner · everything, org + event. Also the event Organiser.' },
  { key: 'orgadmin', name: 'Omkar Shetty', local: 'orgadmin', phone: '9820100002', member: 'admin',
    note: 'Org Admin · everything except billing' },
  { key: 'sportsadmin', name: 'Sanya Iyer', local: 'sportsadmin', phone: '9820100003', member: 'member',
    grant: { role: 'sports_admin', scopedToCampus: true },
    note: 'Sports Admin · scoped to the Pune campus · runs sport day to day' },
  { key: 'billingadmin', name: 'Bilal Ahmed', local: 'billingadmin', phone: '9820100004', member: 'member',
    grant: { role: 'billing_admin' },
    note: 'Billing Admin · Dashboard + Administration, no people data' },
  { key: 'reportingadmin', name: 'Riya Sen', local: 'reportingadmin', phone: '9820100005', member: 'member',
    grant: { role: 'reporting_admin', scopedToCampus: true },
    note: 'Reporting Admin · scoped to the Pune campus · read + export only' },
  { key: 'viewer', name: 'Vikas Nair', local: 'viewer', phone: '9820100006', member: 'member',
    grant: { role: 'viewer' },
    note: 'Viewer · dashboard, events, achievements — read only' },
  { key: 'organiser', name: 'Farah Qureshi', local: 'organiser', phone: '9820100007', member: 'member',
    eventRole: 'organiser',
    note: 'Organiser · the event workspace, with no org role behind it' },
  { key: 'poc', name: 'Prateek Joshi', local: 'poc', phone: '9820100008', member: 'member',
    eventRole: 'poc',
    note: 'POC · the campus contact for the event' },
  // FOUR officials, not one: four matches are played at once on four pitches, and
  // a single whistle could not produce the schedule this event actually has.
  { key: 'official1', name: 'Rehan Kapoor', local: 'official1', phone: '9820100011', member: 'member',
    eventRole: 'official', officiates: true, note: 'Official · Pitch 1' },
  { key: 'official2', name: 'Meghna Bhat', local: 'official2', phone: '9820100012', member: 'member',
    eventRole: 'official', officiates: true, note: 'Official · Pitch 2' },
  { key: 'official3', name: 'Arjun Pillai', local: 'official3', phone: '9820100013', member: 'member',
    eventRole: 'official', officiates: true, note: 'Official · Pitch 3' },
  { key: 'official4', name: 'Divya Menon', local: 'official4', phone: '9820100014', member: 'member',
    eventRole: 'official', officiates: true, note: 'Official · Pitch 4' },
  { key: 'platform', name: 'WNS Platform Admin', local: 'platform', phone: '9820100099', member: 'member',
    superAdmin: true,
    note: 'Super admin · the /platform nav, never module-gated' },
];

// ---------------------------------------------------------------------------
// the scorelines
// ---------------------------------------------------------------------------
// Ten decisive results, cycled and alternately reversed, so no locked match is a
// draw (a knockout cannot go home level, and a level match under this format
// stays OPEN rather than inventing a winner) and no side wins every time.
const SCORELINES: Array<[number, number]> = [
  [1, 0], [2, 1], [3, 0], [2, 0], [3, 1],
  [1, 0], [4, 2], [2, 1], [3, 2], [2, 0],
];

/**
 * The taps an official would have made, for a match ending `home`-`away`.
 *
 * Deterministic on the match index, and documented here rather than derived from a
 * random seed, because the whole point of the naming convention is that a person
 * can read a statistic off the screen and check it by hand.
 *
 *   goal n of a side  scored by Player (n % 6) + 1, assisted by Player ((n+1) % 6) + 1
 *   every match       two saves by each side's Player 6 (the keeper)
 *   every match       one yellow card, alternating side by match
 *   every 4th match   the side's last goal is a converted penalty instead
 *   every 5th match   a red card to the away side's Player 5
 *   every 7th match   a penalty missed by the away side's Player 1
 *
 * The first half carries the first goal of each side and the cards; the rest falls
 * in the second. Two `endPeriod` markers close the match, which is what the
 * two-half aggregate format is waiting for.
 */
function buildLog(i: number, home: number, away: number, A: string[], B: string[]): RallyLog {
  const goal = (side: Side, squad: string[], n: number): RallyEvent => ({
    t: 'point', side, pts: 1, kind: 'goal', label: 'Goal',
    playerId: squad[n % SQUAD_SIZE], secondId: squad[(n + 1) % SQUAD_SIZE],
  });
  const pen = (side: Side, squad: string[], n: number): RallyEvent => ({
    t: 'point', side, pts: 1, kind: 'pen_scored', label: 'Penalty scored', playerId: squad[n % SQUAD_SIZE],
  });
  const nil = (kind: string, label: string) => (side: Side, who: string): RallyEvent =>
    ({ t: 'point', side, pts: 0, kind, label, playerId: who });
  const save = nil('save', 'Save');
  const yellow = nil('yellow', 'Yellow card');
  const red = nil('red', 'Red card');
  const penMissed = nil('pen_missed', 'Penalty missed');

  const penaltyMatch = i % 4 === 0;
  const homeGoals = Array.from({ length: home }, (_, n) =>
    (penaltyMatch && n === home - 1 ? pen('A', A, n) : goal('A', A, n)));
  const awayGoals = Array.from({ length: away }, (_, n) => goal('B', B, n));

  const first: RallyLog = [
    ...homeGoals.slice(0, 1),
    save('B', B[5]),
    ...awayGoals.slice(0, 1),
    save('A', A[5]),
    yellow(i % 2 === 0 ? 'A' : 'B', (i % 2 === 0 ? A : B)[3]),
  ];
  const second: RallyLog = [
    ...homeGoals.slice(1),
    save('B', B[5]),
    ...awayGoals.slice(1),
    save('A', A[5]),
    ...(i % 5 === 0 ? [red('B', B[4])] : []),
    ...(i % 7 === 0 ? [penMissed('B', B[0])] : []),
  ];
  return [...first, { t: 'endPeriod' }, ...second, { t: 'endPeriod' }];
}

/** The same match, abandoned partway through the second half — what `live` means. */
function buildLiveLog(i: number, A: string[], B: string[]): { log: RallyLog; home: number; away: number } {
  const goal = (side: Side, squad: string[], n: number): RallyEvent => ({
    t: 'point', side, pts: 1, kind: 'goal', label: 'Goal',
    playerId: squad[n % SQUAD_SIZE], secondId: squad[(n + 1) % SQUAD_SIZE],
  });
  const save = (side: Side, who: string): RallyEvent =>
    ({ t: 'point', side, pts: 0, kind: 'save', label: 'Save', playerId: who });

  // 0-0, 1-0, 1-1, 2-1 and back round — a spread of live states rather than one.
  const home = [0, 1, 1, 2][i % 4];
  const away = [0, 0, 1, 1][i % 4];
  const log: RallyLog = [
    ...Array.from({ length: home }, (_, n) => goal('A', A, n)),
    save('B', B[5]),
    ...Array.from({ length: away }, (_, n) => goal('B', B, n)),
    { t: 'endPeriod' },
    save('A', A[5]),
  ];
  return { log, home, away };
}

// ---------------------------------------------------------------------------
// the match format
// ---------------------------------------------------------------------------
// TEN MINUTES EACH HALF, then five minutes of extra time, then five kicks each.
//
// `clock.minutes` is the WHOLE MATCH, not the period — the deck divides it by the
// number of periods to get a half — so two halves of ten is `minutes: 20`. Getting
// that backwards is the difference between a ten-minute half and a five-minute one,
// and the console shows it as "HALF 1 OF 2 — 10:00".
//
// It is built from `fest_2x10_ko` (the nearest built-in: the same two-half shape,
// the same settlement chain) with the clock and the extra-time period set, and
// saved to the organisation's own shelf so the whole championship opens on it and a
// second event can reuse it.
const HALF_MINUTES = 10;
const HALVES = 2;
const EXTRA_TIME_MINUTES = 5;

function wnsScoringFormat(): ScoringFormat {
  const base = matchPresetByKey('fest_2x10_ko') as ScoringFormat;
  const format: ScoringFormat = {
    ...base,
    presetKey: 'wns_2x10_ko',
    name: `WNS Cup — ${HALVES} halves of ${HALF_MINUTES} minutes`,
    clock: { ...base.clock!, minutes: HALF_MINUTES * HALVES },
    tieBreak: { extraTime: { periods: 1, minutes: EXTRA_TIME_MINUTES }, penalties: { kicks: 5 } },
    rulesSheet: {
      ...(base.rulesSheet ?? {}),
      duration: `two halves of ${HALF_MINUTES} minutes`,
      extraTime: `one period of ${EXTRA_TIME_MINUTES} minutes, played out`,
      shootOut: 'five kicks each, then sudden death',
      offside: 'not adjudicated',
    },
  };
  const parsed = matchFormatSchema.safeParse(format);
  if (!parsed.success) throw new Error(`the WNS format does not validate: ${parsed.error.issues[0]?.message}`);
  return format;
}

/** What one match occupies on a pitch: the football, plus half-time and the changeover. */
const MATCH_MINUTES = HALF_MINUTES * HALVES;
const SLOT_MINUTES = MATCH_MINUTES + 10;

// ---------------------------------------------------------------------------
// the schedule
// ---------------------------------------------------------------------------
// Four pitches, one match per pitch per slot. A round does not start until the one
// before it has finished, and the two days are split so neither runs past the
// afternoon: the whole of the first round and the second on day one, and everything
// from the last sixteen on day two.
const PITCHES = 4;
const ROUND_STARTS: Record<string, { date: string; hh: number; mm: number }> = {
  R64: { date: '2026-10-03', hh: 9, mm: 0 },   // 32 matches -> 8 slots, 09:00-13:00
  R32: { date: '2026-10-03', hh: 14, mm: 0 },  // 16 matches -> 4 slots, 14:00-16:00
  R16: { date: '2026-10-04', hh: 9, mm: 0 },   //  8 matches -> 2 slots, 09:00-10:00
  QF: { date: '2026-10-04', hh: 10, mm: 30 },  //  4 matches -> 1 slot
  SF: { date: '2026-10-04', hh: 11, mm: 30 },  //  2 matches
  '3rd Place': { date: '2026-10-04', hh: 12, mm: 30 },
  Final: { date: '2026-10-04', hh: 13, mm: 30 },
};

/** Where a fixture of this round, the `n`th in it, is played and when. */
function slotFor(round: string, n: number) {
  const start = ROUND_STARTS[round] ?? ROUND_STARTS.Final;
  return {
    scheduled_at: new Date(ist(start.date, start.hh, start.mm).getTime()
      + Math.floor(n / PITCHES) * SLOT_MINUTES * 60000),
    pitch: n % PITCHES,
  };
}

const COMPLETED = 20;
const LIVE = 10;

// ===========================================================================
async function seed() {
  if (existsSync(MANIFEST)) {
    console.error(`A WNS bench already exists (${MANIFEST}). Run "cleanup" first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  const run = Date.now().toString(36).slice(-4); // keeps codes and slugs unique across rebuilds

  // ---- 0 · the global catalogue, read only --------------------------------
  const [sports, formats, roles] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ where: { organization_id: null }, select: { id: true, code: true } }),
  ]);
  const football = sports.find((s) => s.name === 'Football');
  if (!football) throw new Error('Football is not in the sports catalogue.');
  const knockout = formats.find((f) => f.name === 'Knockout');
  if (!knockout) throw new Error('Knockout is not in the tournament formats catalogue.');
  const discipline = await prisma.disciplines.findFirst({
    where: { sport_id: football.id, name: "Men's" }, select: { id: true },
  });
  if (!discipline) throw new Error("Football / Men's is not in the disciplines catalogue.");
  const roleId = new Map(roles.filter((r) => r.code).map((r) => [r.code!, r.id]));
  for (const code of ['owner', 'org_admin', 'sports_admin', 'billing_admin', 'reporting_admin',
    'viewer', 'organiser', 'official', 'poc', 'captain', 'participant']) {
    if (!roleId.get(code)) throw new Error(`role not in catalogue: ${code}`);
  }

  // ---- 1 · the organisation ------------------------------------------------
  // Screen: sign-up, then Administration › Organisation profile.
  // `unit_labels` is what makes the product say "Campus" and "Batch" throughout
  // instead of the structural defaults — the structure is fixed, the nouns are not.
  const orgId = randomUUID();
  await prisma.organizations.create({
    data: {
      id: orgId, name: 'WNS Global Services', short_name: 'WNS', code: `WNS-${run}`,
      city: 'Pune', country: 'India', status: true, kind: 'institution', verified: true,
      // Enterprise tier, so nothing in this bench is behind a padlock while it is
      // being reviewed. Drop it to 'free' to see the locked states instead.
      plan: 'max',
      settings: { unit_labels: { campus: 'Campus', department: 'Batch' } },
    },
  });
  track('organizations', orgId);

  // ---- 2 · the campus and its 64 batches -----------------------------------
  // Screen: Administration › Campuses & batches. The batch is the thing that
  // competes, so each one has to exist before a squad can hang off it.
  const campusId = randomUUID();
  await prisma.org_units.create({
    data: {
      id: campusId, organization_id: orgId, parent_id: null, type: 'campus',
      name: 'Pune', code: 'PUN', display_order: 0, status: 'ACTIVE',
    },
  });
  track('org_units', campusId);

  const batchId = new Map<string, string>(); // code -> unit id
  const batchRows = BATCHES.map(([name, code], i) => {
    const id = randomUUID();
    batchId.set(code, id);
    return {
      id, organization_id: orgId, parent_id: campusId, type: 'department',
      name, code, display_order: i, status: 'ACTIVE',
    };
  });
  await prisma.org_units.createMany({ data: batchRows });
  track('org_units', batchRows.map((b) => b.id));

  // ---- 3 · people ----------------------------------------------------------
  // Screen: sign-up for the staff, Players › Import roll for everyone else.
  // Nobody gets must_change_password: a bench you cannot log into twice is not one.
  const hash = await bcrypt.hash(PASSWORD, 10);
  let seq = 0;

  const staffId = new Map<string, string>();
  const staffRows = STAFF.map((s) => {
    const id = randomUUID();
    staffId.set(s.key, id);
    return {
      id, name: s.name, email: `${s.local}@${DOMAIN}`, phone: `+91 ${s.phone}`,
      password_hash: hash, is_super_admin: !!s.superAdmin, organization_id: orgId,
      account_type: s.member === 'member' ? 'participant' : 'institution',
      sportagon_id: sportagonId(++seq), officiates: !!s.officiates,
      email_verified_at: new Date(), phone_verified_at: new Date(),
    };
  });

  // The squads. Real accounts, not decoration: a lifetime record belongs to a
  // person, so a team of placeholders would produce statistics nobody holds.
  const squadOf = new Map<string, string[]>(); // batch code -> user ids, in shirt order
  const playerRows: any[] = [];
  let playerNo = 0;
  for (const [, code] of BATCHES) {
    const ids: string[] = [];
    for (let n = 1; n <= SQUAD_SIZE; n++) {
      const id = randomUUID();
      playerNo++;
      ids.push(id);
      playerRows.push({
        id,
        // THE CONVENTION. Name, login and squad all carry the same code, so a goal
        // on the scoreboard names the account that scored it with nothing to look up.
        name: `${code} Player ${n}`,
        email: `${code.toLowerCase()}.player${n}@${DOMAIN}`,
        phone: `+91 97${String(30000000 + playerNo).slice(-8)}`,
        password_hash: hash, organization_id: orgId, account_type: 'participant',
        sportagon_id: sportagonId(10000 + playerNo),
        email_verified_at: new Date(), phone_verified_at: new Date(),
      });
    }
    squadOf.set(code, ids);
  }
  await prisma.users.createMany({ data: [...staffRows, ...playerRows] });
  track('users', [...staffRows, ...playerRows].map((u) => u.id));

  // ---- 4 · memberships, unit placement and explicit grants -----------------
  // Screen: Administration › Members (role + status), Players (verification and
  // which campus/batch somebody is in).
  const ownerId = staffId.get('owner')!;
  const memberRows: any[] = STAFF.map((s, i) => ({
    id: randomUUID(), user_id: staffId.get(s.key)!, organization_id: orgId,
    role: s.member, status: 'active', verification: 'verified',
    verified_by: ownerId, verified_at: new Date(),
    member_code: `WNS-S${String(i + 1).padStart(3, '0')}`,
  }));
  const grantRows = STAFF.filter((s) => s.grant).map((s) => ({
    id: randomUUID(), user_id: staffId.get(s.key)!, organization_id: orgId,
    role_id: roleId.get(s.grant!.role)!, assigned_by: ownerId,
    // A campus-scoped role with no campus on it is meaningless, so the two roles
    // the model scopes always carry one.
    scope_ref: s.grant!.scopedToCampus ? campusId : null,
    status: 'ACTIVE',
  }));

  // Every player is a member of the organisation and of TWO units: the Pune campus
  // and their own batch. People hold many units by design — a person in a batch is
  // also in the campus above it, and squad eligibility asks whether any unit they
  // hold is at-or-under the squad's.
  const unitMemberRows: any[] = [];
  let memberNo = 0;
  for (const [, code] of BATCHES) {
    for (const uid of squadOf.get(code)!) {
      memberNo++;
      memberRows.push({
        id: randomUUID(), user_id: uid, organization_id: orgId,
        role: 'member', status: 'active', verification: 'verified',
        verified_by: ownerId, verified_at: new Date(),
        member_code: `WNS-${String(memberNo).padStart(4, '0')}`,
      });
      unitMemberRows.push(
        { id: randomUUID(), organization_id: orgId, org_unit_id: campusId, user_id: uid },
        { id: randomUUID(), organization_id: orgId, org_unit_id: batchId.get(code)!, user_id: uid },
      );
    }
  }
  // The staff belong to the campus too, or a campus-scoped grant points at a
  // campus its holder is not in.
  for (const s of STAFF) {
    unitMemberRows.push({ id: randomUUID(), organization_id: orgId, org_unit_id: campusId, user_id: staffId.get(s.key)! });
  }
  await prisma.organization_members.createMany({ data: memberRows });
  track('organization_members', memberRows.map((m) => m.id));
  await prisma.org_unit_members.createMany({ data: unitMemberRows, skipDuplicates: true });
  track('org_unit_members', unitMemberRows.map((m) => m.id));
  await prisma.user_org_roles.createMany({ data: grantRows });
  track('user_org_roles', grantRows.map((g) => g.id));

  // ---- 5 · the championship ------------------------------------------------
  // Screen: Create event wizard. `entry_level = 'department'` is THE signal: it
  // says the batches compete, not the organisation, and `entry_scope_unit_id`
  // confines the field to the ones under Pune.
  const champId = randomUUID();
  const CHAMP_NAME = 'WNS Pune Football Cup 2026';
  await prisma.championships.create({
    data: {
      id: champId, name: CHAMP_NAME, slug: `wns-pune-football-cup-${run}`,
      description: 'An internal knockout for the 64 batches of the Pune campus. '
        + 'Ten minutes a match, four pitches at a time, over the 3rd and 4th of October.',
      venue: 'WNS Pune Campus Sports Grounds',
      start_date: new Date('2026-10-03'), end_date: new Date('2026-10-04'),
      status: 'ongoing', visibility: 'public', type: 'single_sport',
      country: 'India', region: 'asia', allow_individual_entry: false,
      host_organization_id: orgId,
      entry_level: 'department', entry_scope_unit_id: campusId,
    },
  });
  track('championships', champId);

  // The host's own entry row. An intra event has exactly one, it is never shown,
  // and it exists only because `team_entries` hangs off an entry — the competitor
  // on screen is still the batch.
  const coId = randomUUID();
  await prisma.championship_organizations.create({
    data: {
      id: coId, championship_id: champId, organization_id: orgId,
      applied_by: ownerId, status: 'approved', reviewed_by: ownerId, reviewed_at: new Date(),
    },
  });
  track('championship_organizations', coId);

  // Screen: Participants › Invite batches. The gate that makes "invited" mean
  // something: a batch may only enter a draw if it was asked.
  const inviteRows = BATCHES.map(([name, code]) => ({
    id: randomUUID(), championship_id: champId, org_name: name,
    org_unit_id: batchId.get(code)!, status: 'accepted',
    invited_by: ownerId, accepted_by: ownerId, responded_at: new Date(),
  }));
  await prisma.championship_invitations.createMany({ data: inviteRows });
  track('championship_invitations', inviteRows.map((i) => i.id));

  // ---- 6 · event roles -----------------------------------------------------
  // Screen: Organising team, and Officials. An event role means something only
  // inside the event — it is what the event workspace filters its nav by.
  const ucrRows = STAFF.filter((s) => s.eventRole).map((s) => ({
    id: randomUUID(), user_id: staffId.get(s.key)!, championship_id: champId,
    role_id: roleId.get(s.eventRole!)!, assigned_by: ownerId,
  }));
  const officialKeys = STAFF.filter((s) => s.officiates).map((s) => s.key);
  const officialRows = officialKeys.map((key, i) => ({
    id: randomUUID(), championship_id: champId, user_id: staffId.get(key)!,
    assigned_by: ownerId, is_active: true, notes: `Pitch ${i + 1}`,
  }));

  // A captain and a participant who are REAL PLAYERS rather than extra staff, so
  // the squads stay exactly six. Arsenal's Player 1 leads their batch; Chelsea's
  // Player 1 is an ordinary competitor. Both logins are printed in the matrix.
  const captainUserId = squadOf.get('ARS')![0];
  const participantUserId = squadOf.get('CHE')![0];
  ucrRows.push(
    { id: randomUUID(), user_id: captainUserId, championship_id: champId, role_id: roleId.get('captain')!, assigned_by: ownerId },
    { id: randomUUID(), user_id: participantUserId, championship_id: champId, role_id: roleId.get('participant')!, assigned_by: ownerId },
  );
  await prisma.user_championship_roles.createMany({ data: ucrRows });
  track('user_championship_roles', ucrRows.map((r) => r.id));
  await prisma.championship_officials.createMany({ data: officialRows });
  track('championship_officials', officialRows.map((o) => o.id));

  // ---- 7 · setup -----------------------------------------------------------
  // Screen: Event setup › Sports, Venues, Points.
  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);

  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'WNS Pune Campus Sports Grounds', city: 'Pune' } });
  track('venues', venueId);
  const grounds = Array.from({ length: PITCHES }, (_, i) => ({
    id: randomUUID(), venue_id: venueId, name: `Pitch ${i + 1}`, ground_type: 'field', display_order: i,
  }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));

  // A knockout awards points for where a batch finishes, not per match.
  const ruleId = randomUUID();
  await prisma.standings_rules.create({
    data: {
      id: ruleId, championship_id: champId, scope_type: 'championship', scope_id: null,
      config: { scheme: 'placement', points: { winner: 10, runner_up: 7, semi_finalist: 4 }, participation: 1 },
    },
  });
  track('standings_rules', ruleId);

  // ---- 8 · the match format ------------------------------------------------
  // Screen: Event setup › Scoring format › Save a variation. Built above, so the
  // `retime` mode below can re-apply exactly the same thing to a bench that is
  // already standing.
  const wnsFormat = wnsScoringFormat();
  const formatRowId = randomUUID();
  await prisma.scoring_formats.create({
    data: {
      id: formatRowId, organization_id: orgId, sport_id: football.id,
      name: wnsFormat.name, preset_key: 'fest_2x10_ko',
      config: wnsFormat as unknown as object, is_system: false, created_by: ownerId,
    },
  });
  track('scoring_formats', formatRowId);

  const tsId = randomUUID();
  await prisma.tournament_sports.create({
    data: { id: tsId, tournament_id: tournamentId, sport_id: football.id, format_id: knockout.id, display_order: 0 },
  });
  track('tournament_sports', tsId);

  const drawId = randomUUID();
  await prisma.tournament_disciplines.create({
    data: {
      id: drawId, tournament_sport_id: tsId, discipline_id: discipline.id, format_id: knockout.id,
      venue_id: venueId, status: 'ongoing', display_order: 0,
      squad_min: SQUAD_SIZE, squad_max: SQUAD_SIZE,
      format_config: { scoring: { fixtureType: 'single', scoringMode: 'detailed' } },
      scoring_format_id: formatRowId,
    },
  });
  track('tournament_disciplines', drawId);

  // ---- 9 · squads ----------------------------------------------------------
  // Screen: Teams › Campus & batches › Create squad, then Roster, then Enter.
  // `org_unit_id` on BOTH the team and the entry is what keeps 64 competitors
  // apart: without it every squad resolves to WNS and the table is one row.
  const teamId = new Map<string, string>(); // batch code -> team id
  const teamRows: any[] = [];
  const teamMemberRows: any[] = [];
  const entryRows: any[] = [];
  for (const [name, code] of BATCHES) {
    const id = randomUUID();
    teamId.set(code, id);
    teamRows.push({
      id, sport_id: football.id, organization_id: orgId, org_unit_id: batchId.get(code)!,
      name, short_name: code, status: 'approved',
    });
    squadOf.get(code)!.forEach((uid, n) => teamMemberRows.push({
      id: randomUUID(), team_id: id, user_id: uid,
      // Player 1 leads, Player 2 deputises, Player 6 keeps goal (which is why the
      // saves in every log below belong to Player 6).
      role: n === 0 ? 'captain' : n === 1 ? 'vice_captain' : 'player',
      jersey_number: n + 1, is_active: true,
    }));
    entryRows.push({
      id: randomUUID(), team_id: id, organization_id: orgId, championship_id: champId,
      championship_organization_id: coId, tournament_discipline_id: drawId,
      status: 'approved', org_unit_id: batchId.get(code)!,
    });
  }
  await prisma.teams.createMany({ data: teamRows });
  track('teams', teamRows.map((t) => t.id));
  await prisma.team_members.createMany({ data: teamMemberRows });
  track('team_members', teamMemberRows.map((m) => m.id));
  await prisma.team_entries.createMany({ data: entryRows });
  track('team_entries', entryRows.map((e) => e.id));

  // ---- 10 · the draw -------------------------------------------------------
  // Screen: Schedule › Generate draw. The SAME generator the button calls, so the
  // bracket arithmetic and the round labels are the product's rather than a
  // re-implementation that can drift from it. 64 squads is an exact power of two,
  // so there are no byes: 63 matches, plus a 3rd-place play-off.
  const teams: TeamRef[] = BATCHES.map(([, code]) => ({ teamId: teamId.get(code)! }));
  const generated = generateFixtures('Knockout', teams, { thirdPlaceMatch: true });

  // Scheduling and officials are the organiser's, applied after the draw exists.
  // Matches are laid out four at a time — one per pitch — and a round waits for
  // the one before it.
  const perRound = new Map<string, number>();
  const fixtureRows = generated.map((f, i) => {
    const round = f.round ?? 'R64';
    const n = perRound.get(round) ?? 0;
    perRound.set(round, n + 1);
    const { scheduled_at, pitch } = slotFor(round, n);
    return {
      id: randomUUID(), tournament_discipline_id: drawId,
      home_team_id: f.homeTeamId, away_team_id: f.awayTeamId, winner_team_id: f.winnerTeamId ?? null,
      round, pool_number: f.poolNumber, bracket_position: f.bracketPosition, status: f.status,
      scheduled_at,
      duration_minutes: MATCH_MINUTES,
      venue_ground_id: grounds[pitch].id,
      official_id: staffId.get(officialKeys[pitch])!,
      match_no: i + 1,
    };
  });
  await prisma.fixtures.createMany({ data: fixtureRows });
  track('fixtures', fixtureRows.map((f) => f.id));

  // ---- 11 · playing it -----------------------------------------------------
  // Screen: Match console › score, submit, then Results › lock.
  //
  // This is the block that earns the rest. `lockScorecard` is the real one, so
  // everything downstream of a published result — the player statistics, the
  // achievements, the lifetime entries, the standings, the audit line and the
  // "result verified" notification — is written by the code that normally writes
  // it, and none of it can be wrong in a way the product would not also be wrong.
  const codeOfTeam = new Map([...teamId.entries()].map(([code, id]) => [id, code]));
  const organiserReq = asReq({ id: ownerId, email: `owner@${DOMAIN}` });

  const firstRound = fixtureRows
    .filter((f) => f.round === 'R64')
    .sort((a, b) => (a.bracket_position ?? 0) - (b.bracket_position ?? 0));

  const played: Array<Record<string, unknown>> = [];

  for (const [i, fx] of firstRound.entries()) {
    if (i >= COMPLETED + LIVE) break;
    const homeCode = codeOfTeam.get(fx.home_team_id!)!;
    const awayCode = codeOfTeam.get(fx.away_team_id!)!;
    const A = squadOf.get(homeCode)!;
    const B = squadOf.get(awayCode)!;

    if (i < COMPLETED) {
      // Alternate which side of the scoreline wins, so the bracket is not a list
      // of home victories.
      const [a, b] = SCORELINES[i % SCORELINES.length];
      const [home, away] = i % 2 === 0 ? [a, b] : [b, a];
      const log = buildLog(i, home, away, A, B);

      // The fold is the yardstick: if the taps below do not add up to the
      // scoreline they were built for, the bench is wrong and stops here rather
      // than seeding a number nobody could explain.
      const state = foldRally(wnsFormat, log, 'A').state;
      const total = aggregateScore(state);
      if (total[0] !== home || total[1] !== away || !state.ended) {
        throw new Error(`match ${i + 1} ${homeCode} v ${awayCode}: the log folds to ${total.join('-')} `
          + `(${state.ended ? 'ended' : 'still open'}), not ${home}-${away}`);
      }

      await prisma.fixtures.update({
        where: { id: fx.id },
        data: {
          status: 'completed',
          home_score: home, away_score: away,
          winner_team_id: home > away ? fx.home_team_id : fx.away_team_id,
          live_state: { rally: log, format: wnsFormat } as any,
          live_started_at: fx.scheduled_at,
          completed_at: new Date(fx.scheduled_at.getTime() + MATCH_MINUTES * 60000),
        },
      });
      // The official says they are finished; the organiser makes it official.
      await submitScorecard(prisma as any, asReq({ id: fx.official_id!, email: 'official@wns.test' }), fx.id);
      await lockScorecard(prisma as any, organiserReq, fx.id);

      played.push({
        match_no: fx.match_no, state: 'completed',
        fixture: `${homeCode} ${home} - ${away} ${awayCode}`,
        scorers: log.filter((e: any) => e.t === 'point' && e.pts > 0).map((e: any) =>
          `${(e.side === 'A' ? A : B).indexOf(e.playerId) >= 0
            ? `${e.side === 'A' ? homeCode : awayCode} Player ${(e.side === 'A' ? A : B).indexOf(e.playerId) + 1}`
            : e.playerId} (${e.kind})`),
      });
    } else {
      // LIVE. Status 'live', a clock that has started, a part-played log and no
      // scorecard submitted — which is exactly what an official's console shows
      // when they are halfway through a match.
      const { log, home, away } = buildLiveLog(i, A, B);
      await prisma.fixtures.update({
        where: { id: fx.id },
        data: {
          status: 'live',
          home_score: home, away_score: away,
          live_state: { rally: log, format: wnsFormat } as any,
          live_started_at: new Date(),
        },
      });
      played.push({
        match_no: fx.match_no, state: 'live',
        fixture: `${homeCode} ${home} - ${away} ${awayCode} (in progress)`,
        official: STAFF.find((s) => staffId.get(s.key) === fx.official_id)?.local,
      });
    }
  }

  // Standings for the whole championship. Already correct from the locks above —
  // run once more so the live and unplayed states are reflected too.
  await recomputeStandings(prisma as any, champId);
  const standingsRows = await prisma.standings.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('standings', standingsRows.map((s) => s.id));

  // Everything the lock pipeline derived belongs to this bench and must come out
  // with it. Recorded last, once nothing else is still writing.
  const everyUser = [...staffId.values(), ...playerRows.map((p) => p.id)];
  const derived: Record<string, number> = {};
  for (const table of ['achievements', 'lifetime_entries', 'career_stats'] as const) {
    const rows = await (prisma as any)[table].findMany({
      where: table === 'career_stats'
        ? { user_id: { in: everyUser } }
        : { OR: [{ championship_id: champId }, { user_id: { in: everyUser } }] },
      select: { id: true },
    });
    derived[table] = rows.length;
    track(table, rows.map((r: any) => r.id));
  }
  const lockNotes = await prisma.notifications.findMany({ where: { championship_id: champId }, select: { id: true } });
  track('notifications', lockNotes.map((n) => n.id));
  derived.notifications = lockNotes.length;
  const statLines = await prisma.player_match_stats.count({
    where: { fixture_id: { in: fixtureRows.map((f) => f.id) } },
  });
  derived.player_match_stats = statLines;

  writeFileSync(RESULTS, JSON.stringify({ championship: CHAMP_NAME, id: champId, matches: played }, null, 2));
  saveManifest();

  const counts = Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.length]));
  console.log('\n================  WNS BENCH READY  ================');
  console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\nfixtures:  ${COMPLETED} completed & locked · ${LIVE} live · ${fixtureRows.length - COMPLETED - LIVE} not started · ${fixtureRows.length} total`);
  console.log('derived by the locks:', JSON.stringify(derived));
  console.log('\nrow counts:', JSON.stringify(counts, null, 2));
  console.log(`\nchampionship: ${CHAMP_NAME}`);
  console.log('  id:  ', champId);
  console.log('  slug:', `wns-pune-football-cup-${run}`);
  console.log('  url: ', `/championships/${champId}`);
  console.log(`\nEvery locked result, with its scorers, is in ${path.basename(RESULTS)}.`);
  printLogins();
}

// ---------------------------------------------------------------------------
function printLogins() {
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`\n--------  LOGINS  (password for EVERY account: ${PASSWORD})  --------\n`);
  console.log(pad('EMAIL', 30), pad('NAME', 22), 'WHAT IT IS FOR');
  console.log('-'.repeat(112));
  for (const s of STAFF) {
    console.log(pad(`${s.local}@${DOMAIN}`, 30), pad(s.name, 22), s.note);
  }
  console.log(pad('ars.player1@wns.test', 30), pad('ARS Player 1', 22), 'Captain (Arsenal batch) · squad + the event as published');
  console.log(pad('che.player1@wns.test', 30), pad('CHE Player 1', 22), 'Participant (Chelsea batch) · plays, runs none of it');
  console.log(`\nAll 384 players:  <code>.player<1-6>@${DOMAIN}`);
  console.log('  e.g. ars.player1@wns.test … ars.player6@wns.test, che.player1@wns.test, …, mon.player6@wns.test');
  console.log('  Player 1 is the batch captain, Player 2 the vice-captain, Player 6 the goalkeeper.');
  console.log(`\n  The 64 batch codes, in seeding order:\n  ${BATCHES.map(([, c]) => c).join(' ')}`);
  console.log('\nCleanup:  npx tsx scripts/seed-wns.ts cleanup');
  console.log('===================================================\n');
}

// ---------------------------------------------------------------------------
/**
 * Re-apply the match format and the schedule to a bench that is already standing.
 *
 * WHY THIS EXISTS RATHER THAN "cleanup && seed". Rebuilding issues fresh ids, so
 * every url anybody has open — the championship, a match console, a squad — stops
 * resolving, and the twenty locked results are thrown away and replayed. The clock
 * is a SETTING: nothing downstream of a result depends on how long the match was.
 * So this changes the setting and leaves the results alone.
 *
 * What it touches, and nothing else:
 *   the saved scoring format        the config the console reads
 *   each fixture's live_state.format  the copy frozen onto a played match
 *   duration_minutes, scheduled_at  the schedule, recomputed from ROUND_STARTS
 *
 * The rally logs are untouched and cannot be affected: an event carries the minute
 * it happened at only where the clock was actually running, and none of the seeded
 * ones do.
 */
async function retime() {
  if (!existsSync(MANIFEST)) { console.error('No WNS manifest found — nothing to retime.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const format = wnsScoringFormat();

  const formatIds = m.scoring_formats ?? [];
  for (const id of formatIds) {
    await prisma.scoring_formats.update({
      where: { id }, data: { name: format.name, config: format as unknown as object },
    });
  }
  console.log(`format: ${format.name} · clock ${format.clock?.minutes} min over ${HALVES} halves `
    + `· ET ${format.tieBreak?.extraTime?.periods}x${format.tieBreak?.extraTime?.minutes} min (${formatIds.length} row)`);

  const fixtures = await prisma.fixtures.findMany({
    where: { id: { in: m.fixtures ?? [] } },
    select: { id: true, round: true, bracket_position: true, created_at: true, status: true, live_state: true },
  });
  // The nth match of a round, in the order the draw made them — the same order the
  // seed numbered them in, so a retime never reshuffles the schedule.
  const byRound = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    const list = byRound.get(f.round ?? 'R64') ?? [];
    list.push(f);
    byRound.set(f.round ?? 'R64', list);
  }
  let moved = 0;
  let reformatted = 0;
  for (const [round, list] of byRound) {
    list.sort((a, b) => (a.bracket_position ?? 99) - (b.bracket_position ?? 99)
      || a.created_at.getTime() - b.created_at.getTime());
    for (const [n, f] of list.entries()) {
      const { scheduled_at } = slotFor(round, n);
      // Only a fixture that already carries a frozen format gets a new one: writing
      // one onto an unplayed match would freeze it early, and an unplayed match is
      // supposed to resolve its format from the draw.
      const state = f.live_state as { rally?: unknown; format?: unknown } | null;
      const refreeze = state && typeof state === 'object' && state.format
        ? { live_state: { ...state, format } as any }
        : {};
      if (refreeze.live_state) reformatted++;
      await prisma.fixtures.update({
        where: { id: f.id },
        data: {
          scheduled_at, duration_minutes: MATCH_MINUTES,
          ...(f.status === 'completed'
            ? { completed_at: new Date(scheduled_at.getTime() + MATCH_MINUTES * 60000) }
            : {}),
          ...refreeze,
        },
      });
      moved++;
    }
  }
  console.log(`fixtures: ${moved} rescheduled at ${MATCH_MINUTES} min each in ${SLOT_MINUTES}-minute slots `
    + `· ${reformatted} played matches re-frozen onto the new format`);
  for (const [round, list] of byRound) {
    const first = slotFor(round, 0).scheduled_at;
    const last = slotFor(round, list.length - 1).scheduled_at;
    console.log(`  ${round.padEnd(10)} ${list.length} matches   ${first.toISOString()} -> ${last.toISOString()}`);
  }
}

// ---------------------------------------------------------------------------
async function cleanup() {
  if (!existsSync(MANIFEST)) { console.error('No WNS manifest found — nothing to clean up.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  // The fixture artefacts the lock pipeline wrote are keyed on the fixture, not
  // recorded one id at a time — they come out first, by fixture. The typed detail
  // rows (invasion_match_lines and its siblings) cascade off the spine row, so
  // deleting player_match_stats takes them with it.
  const fixtureIds = m.fixtures ?? [];
  if (fixtureIds.length) {
    for (const table of ['player_match_stats', 'fixture_events', 'fixture_awards'] as const) {
      try {
        const n = await (prisma as any)[table].deleteMany({ where: { fixture_id: { in: fixtureIds } } });
        console.log(`deleted ${n.count} ${table}`);
      } catch (e: any) { console.log(`skipped ${table}: ${String(e.message).split('\n')[0].slice(0, 80)}`); }
    }
  }

  // Reverse FK order. Anything cascading off users/organizations still lists here,
  // so a partial manifest cleans up as far as it got.
  const order = [
    'notification_reactions', 'notification_reads', 'notifications',
    'career_stats', 'achievements', 'lifetime_entries',
    'standings', 'fixtures',
    'team_entries', 'team_members', 'teams',
    'tournament_disciplines', 'tournament_sports', 'tournaments',
    'scoring_formats', 'standings_rules',
    'venue_grounds', 'venues',
    'championship_officials', 'user_championship_roles', 'championship_invitations',
    'championship_organizations', 'championships',
    'user_org_roles', 'org_unit_members', 'organization_members', 'org_units',
    'audit_log', 'users', 'organizations',
  ];
  const t0 = Date.now();
  for (const table of order) {
    const ids = m[table];
    if (!ids?.length) continue;
    const model: any = (prisma as any)[table];
    if (!model) continue;
    try {
      const res = await model.deleteMany({ where: { id: { in: ids } } });
      console.log(`deleted ${res.count}/${ids.length} ${table}`);
    } catch (e: any) {
      // audit_log is append-only by trigger; its rows are left behind deliberately
      // rather than the whole cleanup failing on them.
      console.log(`skipped ${table}: ${String(e.message).split('\n')[0].slice(0, 90)}`);
    }
  }
  rmSync(MANIFEST);
  if (existsSync(RESULTS)) rmSync(RESULTS);
  console.log(`\ncleanup done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Manifest removed.`);
}

const mode = process.argv[2] ?? 'seed';
const task = mode === 'cleanup' ? cleanup()
  : mode === 'retime' ? retime()
    : mode === 'logins' ? Promise.resolve(printLogins())
      : seed();
task.catch((e) => { console.error('\nFAILED:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
