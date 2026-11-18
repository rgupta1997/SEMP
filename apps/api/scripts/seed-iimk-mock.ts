/*
 * IIMK Mock - Inter-IIM 2026: a full SETUP of the IIMK championship on beta, for
 * testers to score in the browser. Nothing is played.
 *
 *   npx tsx scripts/seed-iimk-mock.ts seed       # build it (refuses if it already exists)
 *   npx tsx scripts/seed-iimk-mock.ts cleanup    # delete EXACTLY what was built
 *   npx tsx scripts/seed-iimk-mock.ts verify     # counts per draw, read back from the DB
 *
 * Two halves, on purpose:
 *   - people, institutes, entries: written directly, the same shape as matrix-import
 *     (approved championship_organizations -> a team per institute per draw ->
 *     team_entries -> team_members);
 *   - every CONFIG the UI owns (draws, tie layouts, saved formats, per-round formats,
 *     stage trees, the Point System, sport titles): sent through the app's own HTTP
 *     routes as the organiser, against an in-process copy of the API. The routes run
 *     their zod schemas and guards, so nothing lands that the screens cannot read back.
 *
 * Every id is recorded in scripts/.seed-iimk-mock-manifest.json; cleanup deletes those
 * ids in reverse-FK order, plus the notifications fixture generation wrote about them.
 * The audit log is left alone: it is append-only and holds no foreign keys.
 *
 * It refuses to run against any database but the beta Supabase project, and it never
 * creates or edits the global catalogue (sports, disciplines, formats, roles).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import {
  buildTieSpec, knobModelFor, matchPresetsFor, tieLayoutsFor,
  type MatchFormat, type StandingsTiebreaker, type TieRubberDraft,
} from '@semp/shared';
import { buildApp } from '../src/http/server.js';
import { signToken } from '../src/http/middleware/auth.js';
import { resolveRuleForDraw } from '../src/modules/standings/standings.service.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '.seed-iimk-mock-manifest.json');

/** The beta Supabase project. The seed stops on any other database. */
const BETA_PROJECT_REF = 'iwxgdttztfhabvufukob';

// ---------------------------------------------------------------------------
// CONFIG - the whole specification
// ---------------------------------------------------------------------------

type Gender = 'male' | 'female';
type Ranking = { win: number; draw: number; loss: number; tiebreakers: StandingsTiebreaker[] };
type Placing = 'default' | 'only_third' | 'eliminator';

/**
 * How a draw is played.
 *   groups  - pools, then the top `advance` of each into a knockout (`numGroups` 1 = a league)
 *   knockout - a straight bracket
 *   league  - one round robin, placings from the table (no knockout stage)
 *   rankings - one team-less event fixture, scored by the event console
 */
type Structure =
  | { kind: 'groups'; numGroups: number; advance: number; thirdPlace?: boolean }
  | { kind: 'knockout'; thirdPlace?: boolean }
  | { kind: 'league' }
  | { kind: 'rankings' };

/** A format the organiser varies from a preset and saves for the institution. */
type SavedFormat = { name: string; preset: string; knobs: Record<string, unknown> };
/** A draw's format: a built-in preset, or a saved one, by name. */
type FormatRef = { preset: string } | { saved: string };

interface DrawSpec {
  sport: string;
  discipline: string;
  entrants: number;
  /** Squad, by gender. */
  squad: { male: number; female: number };
  structure: Structure;
  /** The draw default (rung 4). */
  format?: FormatRef;
  /** Per-round overrides (rung 5): round is what the generator stamps - 'SF', 'Final', '3rd Place'. */
  rounds?: Array<{ round: string; stage: number; format: FormatRef }>;
  /** A team-tie layout: one of the sport's ready-made layouts by key, or rubbers by hand. */
  tie?: { layout?: string; rubbers?: TieRubberDraft[]; skipDeadInGroups: boolean; skipDeadInKnockouts: boolean };
  /** League / group points and tie-break order. Also the stage's own ranking. */
  ranking?: Ranking;
  placing?: Placing;
  /** Award placings from the league / group table where no knockout match decides them. */
  tablePlacings?: boolean;
  /** What the rulebook asks that the app cannot compute: left to a hand-picked order. */
  handPick?: string;
}

const CONFIG = {
  championship: {
    name: 'IIMK Mock - Inter-IIM 2026',
    venue: 'IIM Kozhikode',
    city: 'Kozhikode',
    description: 'Test data. A mock of the IIMK Inter-IIM 2026 championship, set up for end-to-end testing. Nothing here is real.',
    days: 3,
    /** Starts this many days from the run date, so nothing looks finished. */
    startsInDays: 7,
  },

  hostOrganization: 'Mock IIM Kozhikode',

  /** Entry order. A draw with fewer entrants takes the first N, starting from the host. */
  organizations: [
    { name: 'Mock IIM Kozhikode', short: 'IIMK', city: 'Kozhikode' },
    { name: 'Mock IIM Ahmedabad', short: 'IIMA', city: 'Ahmedabad' },
    { name: 'Mock IIM Bangalore', short: 'IIMB', city: 'Bengaluru' },
    { name: 'Mock IIM Calcutta', short: 'IIMC', city: 'Kolkata' },
    { name: 'Mock IIM Lucknow', short: 'IIML', city: 'Lucknow' },
    { name: 'Mock IIM Indore', short: 'IIMI', city: 'Indore' },
    { name: 'Mock IIM Trichy', short: 'IIMT', city: 'Tiruchirappalli' },
    { name: 'Mock IIM Udaipur', short: 'IIMU', city: 'Udaipur' },
  ],

  /** Athletes each institute has to draw squads from. People play several sports. */
  athletesPerOrganization: { male: 90, female: 60 },

  organiser: { name: 'Mock Organiser', email: 'organiser@iimk-mock.test' },
  password: 'IimkMock@2026',
  emailDomain: 'iimk-mock.test',

  /** Championship default placings rule. */
  points: {
    default: { winner: 10, runner_up: 7, third_place: 4, fourth_place: 4, semi_finalist: 4 },
    /** Only 3rd gets 4; 4th takes just the participation point. */
    only_third: { winner: 10, runner_up: 7, third_place: 4, fourth_place: 0, semi_finalist: 0 },
    /** Throwball / kho-kho: the eliminator loser is paid as the semi-finalist, i.e. 3rd. */
    eliminator: { winner: 10, runner_up: 7, third_place: 4, fourth_place: 0, semi_finalist: 4 },
    participation: 1,
  },

  /** Saved formats, varied from presets exactly as the format editor's knobs do. */
  savedFormats: [
    { name: 'IIMK 15', preset: 'cricket_t20', knobs: { oversPerInnings: 15, bowlerLimitEnabled: true, maxOversPerBowler: 3, powerplayEnabled: true, powerplayOvers: 5 } },
    { name: 'IIMK Mock - Frisbee league', preset: 'ultimate_to_15', knobs: { target: 13, clockEnabled: true, clockMinutes: 40, timeoutsEnabled: true, timeoutsCount: 1, timeoutsPer: 'match' } },
    { name: 'IIMK Mock - Frisbee final', preset: 'ultimate_to_15', knobs: { target: 13, clockEnabled: true, clockMinutes: 40, timeoutsEnabled: true, timeoutsCount: 1, timeoutsPer: 'match', extraTimeEnabled: true, extraTimePeriods: 1, extraTimeMinutes: 16 } },
    { name: 'IIMK Mock - Kabaddi KO', preset: 'kabaddi_ko_2x20_et', knobs: { goldenRaidEnabled: true } },
    { name: 'IIMK Mock - Throwball', preset: 'tb_bo3_25', knobs: { timeoutsEnabled: true, timeoutsCount: 2, timeoutsPer: 'game' } },
    { name: 'IIMK Mock - Kho-kho 7', preset: 'kho_2x7', knobs: { followOnCompulsoryEnabled: true, followOnCompulsoryAbove: 9 } },
    // Two innings of 9-minute turns. kho_2x9 is ONE innings, so this is kho_2x7 with a 4 x 9 cap.
    { name: 'IIMK Mock - Kho-kho 9', preset: 'kho_2x7', knobs: { clockMinutes: 36, followOnCompulsoryEnabled: true, followOnCompulsoryAbove: 9 } },
    { name: 'IIMK Mock - Volleyball bo3', preset: 'vb_bo3_25_all', knobs: { timeoutsEnabled: true, timeoutsCount: 2, timeoutsPer: 'game' } },
    { name: 'IIMK Mock - Volleyball final bo5', preset: 'fivb_25_bo5', knobs: { timeoutsEnabled: true, timeoutsCount: 2, timeoutsPer: 'game' } },
    { name: 'IIMK Mock - Basketball 4x10', preset: 'iim_4x10', knobs: { timeoutsEnabled: true } },
  ] as SavedFormat[],

  /*
   * The draws. Entrant counts and structures where the rulebook is silent are
   * assumptions. Pool, Badminton, Table Tennis, Tennis and Chess are ONE Mixed draw each
   * (the DB allows one draw per discipline per sport): Pool, Badminton and TT follow the
   * men's row, Tennis and Chess the women's row. Swimming and Powerlifting are one
   * "Whole sport" ranking draw each (no discipline), the only shape whose console offers
   * every men's and women's event - a named discipline narrows it to one event.
   */
  draws: [
    { sport: 'Basketball', discipline: 'Men', entrants: 8, squad: { male: 12, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { saved: 'IIMK Mock - Basketball 4x10' },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'head_to_head', 'score_diff'] } },
    { sport: 'Basketball', discipline: 'Women', entrants: 4, squad: { male: 0, female: 12 },
      structure: { kind: 'groups', numGroups: 1, advance: 2 },
      format: { preset: 'basketball_4x8' },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'head_to_head', 'score_diff'] } },
    { sport: 'Carrom', discipline: 'Mixed', entrants: 6, squad: { male: 4, female: 4 },
      structure: { kind: 'groups', numGroups: 2, advance: 1 },
      format: { preset: 'iim_4boards_16' },
      tie: { layout: 'iim_group', skipDeadInGroups: true, skipDeadInKnockouts: true },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_for'] },
      tablePlacings: true },
    { sport: 'Cricket', discipline: 'Men', entrants: 8, squad: { male: 16, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { saved: 'IIMK 15' },
      rounds: [{ round: 'Final', stage: 2, format: { preset: 'cricket_t20' } }] },
    { sport: 'Frisbee', discipline: 'Mixed', entrants: 6, squad: { male: 10, female: 4 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { saved: 'IIMK Mock - Frisbee league' },
      rounds: [{ round: 'Final', stage: 2, format: { saved: 'IIMK Mock - Frisbee final' } }],
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'head_to_head', 'score_diff'] } },
    { sport: 'Kabaddi', discipline: 'Men', entrants: 8, squad: { male: 12, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { preset: 'pkl_2x20' },
      rounds: [
        { round: 'SF', stage: 2, format: { saved: 'IIMK Mock - Kabaddi KO' } },
        { round: 'Final', stage: 2, format: { saved: 'IIMK Mock - Kabaddi KO' } },
      ] },
    { sport: 'Kabaddi', discipline: 'Women', entrants: 4, squad: { male: 0, female: 12 },
      structure: { kind: 'groups', numGroups: 1, advance: 2 },
      format: { preset: 'pkl_2x20' },
      placing: 'only_third', tablePlacings: true },
    { sport: 'Hockey', discipline: 'Men', entrants: 5, squad: { male: 10, female: 0 },
      structure: { kind: 'groups', numGroups: 1, advance: 2 },
      format: { preset: 'hockey5_4x8' },
      rounds: [{ round: 'Final', stage: 2, format: { preset: 'hockey5_4x8_final' } }],
      ranking: { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'score_for', 'head_to_head'] },
      placing: 'only_third', tablePlacings: true },
    { sport: 'Futsal', discipline: 'Women', entrants: 6, squad: { male: 0, female: 10 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { preset: 'futsal_2x10' },
      rounds: [
        { round: 'SF', stage: 2, format: { preset: 'futsal_ko_2x10' } },
        { round: 'Final', stage: 2, format: { preset: 'futsal_ko_2x10' } },
      ],
      ranking: { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'score_for', 'head_to_head'] } },
    { sport: 'Football', discipline: 'Men', entrants: 8, squad: { male: 16, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      // The preset already counts a 2-0 walkover in goal difference.
      format: { preset: 'football9_2x20' },
      rounds: [
        { round: 'SF', stage: 2, format: { preset: 'football9_ko_2x20' } },
        { round: 'Final', stage: 2, format: { preset: 'football9_final_2x30' } },
      ],
      ranking: { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'score_for', 'head_to_head'] } },
    // Page playoff approximated: league, then the top 3 into a knockout - 1st has a bye,
    // 2nd v 3rd is the eliminator (stamped 'SF', main has no 'Eliminator' round).
    { sport: 'Throwball', discipline: 'Women', entrants: 3, squad: { male: 0, female: 12 },
      structure: { kind: 'groups', numGroups: 1, advance: 3 },
      format: { saved: 'IIMK Mock - Throwball' },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'wins'] },
      placing: 'eliminator',
      handPick: 'sets quotient and points quotient are not computable; still level after matches won is a hand-picked order' },
    { sport: 'Pool/Snooker', discipline: 'Mixed', entrants: 6, squad: { male: 6, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { preset: 'frames_bo5' },
      tie: { layout: 'iim_men', skipDeadInGroups: false, skipDeadInKnockouts: true },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'frames_won', 'ball_diff'] } },
    { sport: 'Powerlifting', discipline: 'Whole sport', entrants: 6, squad: { male: 6, female: 6 },
      structure: { kind: 'rankings' },
      handPick: 'class points are the built-in 5 / 3 / 1, not 10 / 7 / 4 / 1: the Point System cannot reach a Whole-sport ranking draw' },
    { sport: 'Badminton', discipline: 'Mixed', entrants: 8, squad: { male: 8, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { preset: 'bwf_official_3x21' },
      tie: { layout: 'iim_men', skipDeadInGroups: false, skipDeadInKnockouts: true },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff'] } },
    { sport: 'Kho-Kho', discipline: 'Mixed', entrants: 5, squad: { male: 11, female: 4 },
      structure: { kind: 'groups', numGroups: 1, advance: 3 },
      format: { saved: 'IIMK Mock - Kho-kho 7' },
      rounds: [
        { round: 'SF', stage: 2, format: { saved: 'IIMK Mock - Kho-kho 9' } },
        { round: 'Final', stage: 2, format: { saved: 'IIMK Mock - Kho-kho 9' } },
      ],
      ranking: { win: 2, draw: 0, loss: 0, tiebreakers: ['points', 'adt'] },
      placing: 'eliminator' },
    { sport: 'Volleyball', discipline: "Men's", entrants: 8, squad: { male: 12, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { saved: 'IIMK Mock - Volleyball bo3' },
      rounds: [{ round: 'Final', stage: 2, format: { saved: 'IIMK Mock - Volleyball final bo5' } }],
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'wins'] },
      handPick: 'sets quotient and points quotient are not computable; still level after matches won is a hand-picked order' },
    { sport: 'Volleyball', discipline: "Women's", entrants: 6, squad: { male: 0, female: 12 },
      structure: { kind: 'groups', numGroups: 2, advance: 2, thirdPlace: true },
      format: { saved: 'IIMK Mock - Volleyball bo3' },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'wins'] },
      placing: 'only_third',
      handPick: 'sets quotient and points quotient are not computable; still level after matches won is a hand-picked order' },
    { sport: 'Squash', discipline: 'Mixed', entrants: 5, squad: { male: 3, female: 2 },
      structure: { kind: 'league' },
      format: { preset: 'iim_pars11_bo3_cap21' },
      tie: { rubbers: [{ label: "Men's Singles 1", size: 1 }, { label: "Women's Singles", size: 1 }, { label: "Men's Singles 2", size: 1 }], skipDeadInGroups: false, skipDeadInKnockouts: false },
      ranking: { win: 2, draw: 0, loss: 0, tiebreakers: ['points', 'wins', 'score_diff'] },
      placing: 'only_third', tablePlacings: true,
      handPick: 'point difference is not computable for a tie; still level after matches won (net) is a hand-picked order' },
    { sport: 'Swimming', discipline: 'Whole sport', entrants: 6, squad: { male: 6, female: 6 },
      structure: { kind: 'rankings' },
      handPick: 'the mixed relay cannot split 5 / 3.5 / 2 between Men and Women inside one Whole-sport draw; golds-then-silvers tie-break is a hand-picked order' },
    { sport: 'Tennis', discipline: 'Mixed', entrants: 4, squad: { male: 0, female: 3 },
      structure: { kind: 'knockout', thirdPlace: true },
      format: { preset: 'iim_women_set5_tb7' },
      tie: { layout: 'iim_women', skipDeadInGroups: true, skipDeadInKnockouts: true },
      placing: 'only_third' },
    { sport: 'Table Tennis', discipline: 'Mixed', entrants: 8, squad: { male: 6, female: 0 },
      structure: { kind: 'groups', numGroups: 2, advance: 2 },
      format: { preset: 'ittf_bo5_11' },
      tie: { layout: 'iim_men', skipDeadInGroups: false, skipDeadInKnockouts: true },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'head_to_head'] } },
    { sport: 'Chess', discipline: 'Mixed', entrants: 4, squad: { male: 0, female: 3 },
      structure: { kind: 'groups', numGroups: 1, advance: 2 },
      tie: { rubbers: [{ label: 'Board 1', size: 1 }, { label: 'Board 2', size: 1 }], skipDeadInGroups: false, skipDeadInKnockouts: false },
      ranking: { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_for'] },
      placing: 'only_third', tablePlacings: true },
  ] as DrawSpec[],

  /**
   * Ranking events convert their sport standing to a sport placing. The event points
   * themselves cannot be set: a ranking draw holding every event is a "Whole sport" draw
   * (no discipline), and the Point System reaches a ranking draw only through its
   * discipline - so it scores the built-in 5 / 3 / 1, relays 10 / 7 / 4 from the template.
   */
  rankingEvents: {
    Swimming: { titlePlaces: [10, 7, 4, 1] },
    Powerlifting: { titlePlaces: [10, 7, 4, 1] },
  } as Record<string, { titlePlaces: number[] }>,
};

const MALE = ['Aarav', 'Arjun', 'Kabir', 'Vivaan', 'Rohan', 'Aditya', 'Karan', 'Siddharth', 'Yash', 'Dev',
  'Ishaan', 'Pranav', 'Rahul', 'Varun', 'Nikhil', 'Harsh', 'Manav', 'Tanmay', 'Abhishek', 'Kunal'];
const FEMALE = ['Ananya', 'Rhea', 'Ishita', 'Meera', 'Sanya', 'Nikita', 'Tara', 'Diya', 'Nisha', 'Pooja',
  'Aditi', 'Kavya', 'Sneha', 'Riya', 'Shruti', 'Priya', 'Neha', 'Anjali', 'Divya', 'Lavanya'];
const LAST = ['Nair', 'Sharma', 'Iyer', 'Menon', 'Reddy', 'Gupta', 'Patel', 'Rao', 'Bose', 'Khanna',
  'Verma', 'Joshi', 'Pillai', 'Desai', 'Sinha', 'Kulkarni', 'Banerjee', 'Chatterjee', 'Mishra', 'Agarwal'];

/** Knuth multiplicative hash, salted per field, so first and last names decorrelate. */
const hashPick = (n: number, salt: number) => (Math.imul(n + salt * 7919, 2654435761) >>> 8) & 0xffff;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- manifest ---------------------------------------------------------------
type Manifest = Record<string, string[]>;
const manifest: Manifest = {};
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const track = (table: string, ids: string | string[]) => {
  manifest[table] ??= [];
  manifest[table].push(...(Array.isArray(ids) ? ids : [ids]));
  saveManifest();
};

// ---- safety -----------------------------------------------------------------
function assertBeta() {
  const url = process.env.DATABASE_URL ?? '';
  let host = '(unparseable)';
  try { host = new URL(url).host; } catch { /* reported below */ }
  console.log(`database host: ${host}`);
  if (!url.includes(BETA_PROJECT_REF)) {
    console.error(`REFUSING: DATABASE_URL is not the beta Supabase project (${BETA_PROJECT_REF}).`);
    process.exit(1);
  }
}

async function assertMigrations() {
  const checks: Array<[string, string]> = [
    ['20261023000000 kho-kho stats', `select 1 from information_schema.columns where table_name='raid_match_lines' and column_name='pole_dive_outs'`],
    ['20261025000000 standings_adjustments', `select 1 from information_schema.tables where table_name='standings_adjustments'`],
    ['20261028000000 hockey green cards', `select 1 from information_schema.columns where table_name='invasion_match_lines' and column_name='greens'`],
    ['20261028000010 hockey women', `select 1 from disciplines d join sports s on s.id=d.sport_id where lower(s.name)='hockey' and d.name='Women' and d.championship_id is null`],
  ];
  const missing: string[] = [];
  for (const [name, sql] of checks) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(sql);
    if (!rows.length) missing.push(name);
  }
  if (missing.length) {
    console.error(`REFUSING: migrations missing on this database: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('migrations present: kho-kho stats, standings_adjustments, hockey x2');
}

// ---- the API, in process ----------------------------------------------------
type Api = (method: string, url: string, body?: unknown) => Promise<any>;

async function startApi(user: { id: string; email: string; organizationId: string | null }) {
  const app = buildApp(prisma as any);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = signToken({ id: user.id, email: user.email, isSuperAdmin: false, organizationId: user.organizationId });
  const api: Api = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 600)}`);
    return json;
  };
  return { api, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ---- stage trees ------------------------------------------------------------
function stageConfigOf(s: Structure, ranking?: Ranking) {
  const knockout = (thirdPlace?: boolean) => ({ type: 'knockout', eliminationType: 'single', seeding: 'auto', thirdPlaceMatch: !!thirdPlace });
  if (s.kind === 'knockout') return { root: knockout(s.thirdPlace) };
  if (s.kind !== 'groups') throw new Error(`no stage tree for ${s.kind}`);
  return {
    root: {
      type: 'group',
      numGroups: s.numGroups,
      doubleRound: false,
      ...(ranking ? { tiebreakers: ranking.tiebreakers, points: { win: ranking.win, draw: ranking.draw, loss: ranking.loss } } : {}),
      branches: [{ id: 'b1', label: 'Knockout', rankFrom: 1, rankTo: s.advance, childStage: knockout(s.thirdPlace) }],
    },
  };
}

// ---------------------------------------------------------------------------
async function seed() {
  assertBeta();
  if (existsSync(MANIFEST)) {
    console.error(`REFUSING: a manifest already exists (${MANIFEST}). The mock is already seeded - run "cleanup" first.`);
    process.exit(1);
  }
  const C = CONFIG;
  if (await prisma.championships.findFirst({ where: { name: C.championship.name }, select: { id: true } })) {
    console.error(`REFUSING: a championship named "${C.championship.name}" already exists. Nothing written.`);
    process.exit(1);
  }
  await assertMigrations();
  const t0 = Date.now();

  // -- dates: a 3-day event starting a week from today ------------------------
  const today = new Date();
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startDate = new Date(midnight + C.championship.startsInDays * 86400000);
  const endDate = new Date(startDate.getTime() + (C.championship.days - 1) * 86400000);

  // -- the global catalogue, read only ----------------------------------------
  const [sportsRows, formatsRows, rolesRows, discRows] = await Promise.all([
    prisma.sports.findMany({ select: { id: true, name: true } }),
    prisma.tournament_formats.findMany({ select: { id: true, name: true } }),
    prisma.roles.findMany({ select: { id: true, code: true, scope: true } }),
    prisma.disciplines.findMany({ where: { championship_id: null }, select: { id: true, name: true, sport_id: true } }),
  ]);
  const sportId = (name: string) => {
    const s = sportsRows.find((x) => x.name === name);
    if (!s) throw new Error(`sport not in catalogue: ${name}`);
    return s.id;
  };
  const formatId = (name: string) => {
    const f = formatsRows.find((x) => x.name === name);
    if (!f) throw new Error(`format not in catalogue: ${name}`);
    return f.id;
  };
  /** A draw's catalogue discipline. Null for a "Whole sport" ranking draw, which has none. */
  const drawDiscipline = (d: DrawSpec) => (d.structure.kind === 'rankings' ? null : discId(d.sport, d.discipline));
  function discId(sport: string, name: string) {
    const d = discRows.find((x) => x.sport_id === sportId(sport) && x.name === name);
    if (!d) throw new Error(`discipline not in catalogue: ${sport} / ${name}`);
    return d.id;
  }
  const eventRole = (code: string) => {
    const r = rolesRows.find((x) => x.code === code && x.scope === 'single_event') ?? rolesRows.find((x) => x.code === code);
    if (!r) throw new Error(`role not in catalogue: ${code}`);
    return r.id;
  };
  const formatOfStructure = (s: Structure) =>
    s.kind === 'rankings' ? 'Rankings' : s.kind === 'league' ? 'League' : s.kind === 'knockout' ? 'Knockout' : 'Groups+Knockout';
  // Fail before writing anything if the catalogue cannot hold the spec.
  for (const d of C.draws) {
    drawDiscipline(d);
    formatId(formatOfStructure(d.structure));
    for (const ref of [d.format, ...(d.rounds ?? []).map((r) => r.format)]) {
      if (ref && 'preset' in ref && !matchPresetsFor(d.sport).some((p) => p.presetKey === ref.preset)) {
        throw new Error(`preset "${ref.preset}" is not a ${d.sport} preset`);
      }
      if (ref && 'saved' in ref && !C.savedFormats.some((f) => f.name === ref.saved)) throw new Error(`saved format "${ref.saved}" is not in CONFIG.savedFormats`);
    }
    if (d.tie?.layout && !tieLayoutsFor(d.sport).some((l) => l.key === d.tie!.layout)) throw new Error(`tie layout "${d.tie.layout}" is not a ${d.sport} layout`);
    if (d.entrants > C.organizations.length) throw new Error(`${d.sport} ${d.discipline}: more entrants than institutes`);
  }
  for (const r of ['organiser', 'poc']) eventRole(r);

  // -- institutes -------------------------------------------------------------
  const orgs = C.organizations.map((o) => ({
    id: randomUUID(), name: o.name, short_name: o.short, code: `MOCK-${o.short}`, city: o.city,
  }));
  await prisma.organizations.createMany({ data: orgs });
  track('organizations', orgs.map((o) => o.id));
  const hostOrg = orgs.find((o) => o.name === C.hostOrganization)!;

  // -- people -----------------------------------------------------------------
  const hash = await bcrypt.hash(C.password, 10);
  const users: any[] = [];
  const mk = (name: string, email: string, extra: Record<string, unknown>) => {
    const id = randomUUID();
    users.push({ id, name, email, password_hash: hash, email_verified_at: new Date(), ...extra });
    return id;
  };
  const logins: Array<{ role: string; name: string; email: string }> = [];

  const organiserId = mk(C.organiser.name, C.organiser.email, { account_type: 'institution', organization_id: hostOrg.id, gender: 'male' });
  logins.push({ role: 'Organiser (whole event)', name: C.organiser.name, email: C.organiser.email });

  const sportsInPlay = [...new Set(C.draws.map((d) => d.sport))];
  const scorers = sportsInPlay.map((sport, i) => {
    const email = `scorer.${slug(sport)}@${C.emailDomain}`;
    const name = `Mock Scorer ${sport}`;
    logins.push({ role: `Scorer (${sport} only)`, name, email });
    return { sport, id: mk(name, email, { account_type: 'institution', gender: i % 2 ? 'female' : 'male' }) };
  });

  const owners = orgs.map((o, i) => {
    const email = `owner.${o.short_name.toLowerCase()}@${C.emailDomain}`;
    const name = `Mock Owner ${o.short_name}`;
    logins.push({ role: `Institute owner + admin (${o.name})`, name, email });
    return { orgId: o.id, id: mk(name, email, { account_type: 'institution', organization_id: o.id, gender: i % 2 ? 'female' : 'male' }) };
  });

  // Athletes: every one has a gender, so Men / Women / Mixed eligibility is testable.
  const athletes = new Map<string, Record<Gender, string[]>>();
  let seq = 0;
  for (const o of orgs) {
    const pool: Record<Gender, string[]> = { male: [], female: [] };
    for (const g of ['male', 'female'] as Gender[]) {
      for (let i = 0; i < C.athletesPerOrganization[g]; i++) {
        seq++;
        const first = (g === 'male' ? MALE : FEMALE)[hashPick(seq, 1) % 20];
        const name = `${first} ${LAST[hashPick(seq, 2) % LAST.length]}`;
        pool[g].push(mk(name, `a${seq}@${C.emailDomain}`, { account_type: 'participant', organization_id: o.id, gender: g }));
      }
    }
    athletes.set(o.id, pool);
  }
  await prisma.users.createMany({ data: users });
  track('users', users.map((u) => u.id));

  const ownerOf = new Map(owners.map((o) => [o.orgId, o.id]));
  const members: any[] = owners.map((o) => ({
    id: randomUUID(), user_id: o.id, organization_id: o.orgId, role: 'owner',
    status: 'active', verification: 'verified', verified_at: new Date(),
  }));
  members.push({
    id: randomUUID(), user_id: organiserId, organization_id: hostOrg.id, role: 'admin',
    status: 'active', verification: 'verified', verified_by: ownerOf.get(hostOrg.id), verified_at: new Date(),
  });
  for (const o of orgs) {
    const pool = athletes.get(o.id)!;
    [...pool.male, ...pool.female].forEach((uid, i) => members.push({
      id: randomUUID(), user_id: uid, organization_id: o.id, role: 'member', status: 'active',
      verification: 'verified', verified_by: ownerOf.get(o.id), verified_at: new Date(),
      member_code: `${o.short_name}/${String(i + 1).padStart(4, '0')}`,
    }));
  }
  await prisma.organization_members.createMany({ data: members });
  track('organization_members', members.map((m) => m.id));

  // -- championship -----------------------------------------------------------
  const champId = randomUUID();
  await prisma.championships.create({
    data: {
      id: champId, name: C.championship.name, slug: `iimk-mock-inter-iim-2026-${Date.now().toString(36).slice(-4)}`,
      description: C.championship.description, venue: C.championship.venue,
      // Ongoing, not registration_open: the console refuses to score a championship that
      // has not started, and the testers' whole job is scoring.
      start_date: startDate, end_date: endDate, status: 'ongoing', visibility: 'private',
      host_organization_id: hostOrg.id, entry_level: 'organization',
    },
  });
  track('championships', champId);
  const tournamentId = randomUUID();
  await prisma.tournaments.create({ data: { id: tournamentId, championship_id: champId, name: 'Main', status: 'active' } });
  track('tournaments', tournamentId);
  const venueId = randomUUID();
  await prisma.venues.create({ data: { id: venueId, championship_id: champId, name: 'IIM Kozhikode Sports Complex', city: C.championship.city } });
  track('venues', venueId);
  const grounds = ['Main Ground', 'Indoor Arena', 'Court Complex', 'Pool and Gym']
    .map((name, i) => ({ id: randomUUID(), venue_id: venueId, name, display_order: i }));
  await prisma.venue_grounds.createMany({ data: grounds });
  track('venue_grounds', grounds.map((g) => g.id));

  const champOrgs = orgs.map((o) => ({
    id: randomUUID(), championship_id: champId, organization_id: o.id,
    applied_by: ownerOf.get(o.id)!, status: 'approved', reviewed_by: organiserId, reviewed_at: new Date(),
  }));
  await prisma.championship_organizations.createMany({ data: champOrgs });
  track('championship_organizations', champOrgs.map((c) => c.id));
  const champOrgOf = new Map(champOrgs.map((c) => [c.organization_id, c.id]));

  // Event roles. A scorer is an Organiser limited to one sport (user_championship_roles.sport_ids).
  const ucr = [
    { id: randomUUID(), user_id: organiserId, championship_id: champId, role_id: eventRole('organiser'), assigned_by: organiserId, sport_ids: [] as string[] },
    ...scorers.map((s) => ({ id: randomUUID(), user_id: s.id, championship_id: champId, role_id: eventRole('organiser'), assigned_by: organiserId, sport_ids: [sportId(s.sport)] })),
    ...owners.map((o) => ({ id: randomUUID(), user_id: o.id, championship_id: champId, role_id: eventRole('poc'), assigned_by: organiserId, sport_ids: [] as string[] })),
  ];
  await prisma.user_championship_roles.createMany({ data: ucr });
  track('user_championship_roles', ucr.map((r) => r.id));

  // Sports in the event. Sport-level rows are plumbing the Sports tab creates on first add.
  const tsOf = new Map<string, string>();
  const tsRows = sportsInPlay.map((sport, i) => {
    const id = randomUUID();
    tsOf.set(sport, id);
    const first = C.draws.find((d) => d.sport === sport)!;
    return { id, tournament_id: tournamentId, sport_id: sportId(sport), format_id: formatId(formatOfStructure(first.structure)), display_order: i };
  });
  await prisma.tournament_sports.createMany({ data: tsRows });
  track('tournament_sports', tsRows.map((t) => t.id));

  // ===========================================================================
  // Everything below goes through the API as the organiser.
  // ===========================================================================
  const { api, close } = await startApi({ id: organiserId, email: C.organiser.email, organizationId: hostOrg.id });
  const notes: string[] = [];
  const report: Array<{ draw: string; entrants: number; fixtures: number; tdId: string }> = [];
  try {
    // -- draws ------------------------------------------------------------------
    const tdOf = new Map<DrawSpec, string>();
    for (const [i, d] of C.draws.entries()) {
      const squadSize = d.squad.male + d.squad.female;
      const td = await api('POST', '/tournament-disciplines', {
        tournament_sport_id: tsOf.get(d.sport), discipline_id: drawDiscipline(d),
        format_id: formatId(formatOfStructure(d.structure)), venue_id: venueId,
        entry_type: 'team', squad_min: Math.min(squadSize, 1), squad_max: squadSize,
        status: 'upcoming', display_order: i,
      });
      tdOf.set(d, td.id);
      track('tournament_disciplines', td.id);
    }

    // -- entries: a team per institute per draw, squads by gender --------------
    const cursor = new Map(orgs.map((o) => [o.id, { male: 0, female: 0 }]));
    const teams: any[] = []; const squads: any[] = []; const entries: any[] = [];
    for (const d of C.draws) {
      for (const o of orgs.slice(0, d.entrants)) {
        const teamId = randomUUID();
        teams.push({ id: teamId, sport_id: sportId(d.sport), organization_id: o.id, name: `${o.name} ${d.sport} ${d.discipline}`, status: 'approved' });
        const pool = athletes.get(o.id)!; const at = cursor.get(o.id)!;
        const picked: string[] = [];
        for (const g of ['male', 'female'] as Gender[]) {
          for (let k = 0; k < d.squad[g]; k++) picked.push(pool[g][(at[g] + k) % pool[g].length]);
          at[g] = (at[g] + d.squad[g]) % pool[g].length;
        }
        picked.forEach((uid, k) => squads.push({ id: randomUUID(), team_id: teamId, user_id: uid, role: k === 0 ? 'captain' : 'player', jersey_number: k + 1 }));
        entries.push({
          id: randomUUID(), team_id: teamId, organization_id: o.id, championship_id: champId,
          championship_organization_id: champOrgOf.get(o.id), tournament_discipline_id: tdOf.get(d), status: 'approved',
        });
      }
    }
    await prisma.teams.createMany({ data: teams }); track('teams', teams.map((t) => t.id));
    await prisma.team_members.createMany({ data: squads }); track('team_members', squads.map((s) => s.id));
    await prisma.team_entries.createMany({ data: entries }); track('team_entries', entries.map((e) => e.id));

    // -- saved formats: preset + knobs, the format editor's own apply() --------
    const savedId = new Map<string, string>();
    for (const f of C.savedFormats) {
      const sport = sportsRows.find((s) => matchPresetsFor(s.name).some((p) => p.presetKey === f.preset))?.name;
      const d = C.draws.find((x) => x.sport === sport);
      if (!sport || !d) throw new Error(`no draw to save "${f.name}" against`);
      const base = matchPresetsFor(sport).find((p) => p.presetKey === f.preset) as MatchFormat;
      const model = knobModelFor(base);
      const knobs = { ...(model.read(base) as unknown as Record<string, unknown>) };
      for (const [k, v] of Object.entries(f.knobs)) {
        if (!(k in knobs)) throw new Error(`"${f.name}": ${f.preset} has no knob "${k}"`);
        knobs[k] = v;
      }
      const config = model.apply(base, knobs as never, f.name);
      const r = await api('POST', `/tournament-disciplines/${tdOf.get(d)}/scoring-formats`, { name: f.name, presetKey: f.preset, sportId: sportId(sport), config });
      savedId.set(f.name, r.id);
      track('scoring_formats', r.id);
      console.log(`  format  ${f.name.padEnd(36)} ${model.describe(model.read(config))}`);
    }
    const ref = (r: FormatRef) => ('saved' in r ? { formatId: savedId.get(r.saved)! } : { presetKey: r.preset });

    for (const d of C.draws) {
      const tdId = tdOf.get(d)!;
      const label = `${d.sport} ${d.discipline}`;

      // Tie layout (Sports tab -> edit draw -> Team tie layout).
      if (d.tie) {
        const rubbers = d.tie.rubbers ?? tieLayoutsFor(d.sport).find((l) => l.key === d.tie!.layout)!.rubbers;
        const spec = buildTieSpec(d.sport, rubbers, { skipDeadRubbers: d.tie.skipDeadInKnockouts, skipDeadInGroups: d.tie.skipDeadInGroups });
        await api('PATCH', `/tournament-disciplines/${tdId}`, { format_config: { scoring: { fixtureType: 'tie', scoringMode: 'detailed', tie: spec } } });
      }

      // Draw format and per-round overrides, BEFORE generation (as the format picker does).
      if (d.format || d.rounds?.length) {
        const def = d.format ? ('saved' in d.format ? { scoringFormatId: savedId.get(d.format.saved)! } : { presetKey: d.format.preset }) : {};
        await api('PATCH', `/tournament-disciplines/${tdId}/scoring-format`, {
          ...def,
          roundFormats: (d.rounds ?? []).map((r) => ({ stageSequence: r.stage, round: r.round, ...ref(r.format) })),
        });
      }

      // Fixtures for the first stage; later stages wait as placeholders for qualifiers.
      if (d.structure.kind === 'groups' || d.structure.kind === 'knockout') {
        await api('POST', `/tournament-disciplines/${tdId}/fixtures/generate-all`, { config: stageConfigOf(d.structure, d.ranking) });
      } else {
        await api('POST', `/tournament-disciplines/${tdId}/fixtures/generate`, { params: {} });
      }
      const fx = await prisma.fixtures.findMany({ where: { tournament_discipline_id: tdId }, select: { id: true } });
      track('fixtures', fx.map((f) => f.id));
      report.push({ draw: label, entrants: d.entrants, fixtures: fx.length, tdId });
      if (d.handPick) notes.push(`${label}: ${d.handPick}`);
    }

    // -- Point System -------------------------------------------------------------
    await api('PUT', `/championships/${champId}/standings-rules`, {
      scope_type: 'championship',
      config: { scheme: 'placement', points: C.points.default, participation: C.points.participation },
    });
    for (const d of C.draws) {
      if (d.structure.kind === 'rankings') {
        await api('PUT', `/championships/${champId}/sport-titles/${sportId(d.sport)}`, {
          enabled: true, events: {}, titles: { Overall: { places: C.rankingEvents[d.sport].titlePlaces, participation: 0 } },
        });
        continue;
      }
      if (!d.ranking && !d.placing && !d.tablePlacings) continue;
      // Keyed by the CATALOGUE discipline, as the Point System screen keys it - not the draw id.
      await api('PUT', `/championships/${champId}/standings-rules`, {
        scope_type: 'discipline', scope_id: drawDiscipline(d),
        config: {
          scheme: 'placement', points: C.points[d.placing ?? 'default'], participation: C.points.participation,
          ...(d.ranking ? { ranking: d.ranking } : {}),
          ...(d.tablePlacings ? { table_placings: true } : {}),
        },
      });
    }
    const rules = await prisma.standings_rules.findMany({ where: { championship_id: champId }, select: { id: true } });
    track('standings_rules', rules.map((r) => r.id));
  } finally {
    await close();
  }

  // -- summary ----------------------------------------------------------------
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  console.log('\n===============  IIMK MOCK SEEDED  ===============');
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`${C.championship.name}  id ${champId}`);
  console.log(`dates ${iso(startDate)} to ${iso(endDate)} · ${C.draws.length} draws · ${sportsInPlay.length} sports · ${users.length} users`);
  console.log('\nDRAWS');
  for (const r of report) console.log(`  ${r.draw.padEnd(26)} entrants ${String(r.entrants).padStart(2)}  fixtures ${String(r.fixtures).padStart(3)}`);
  console.log(`\nLOGINS (password for every account: ${C.password})`);
  for (const l of logins) console.log(`  ${l.role.padEnd(48)} ${l.email}`);
  console.log(`  Athletes: a1@${C.emailDomain} ... a${seq}@${C.emailDomain}`);
  if (notes.length) { console.log('\nLEFT TO A HAND-PICKED ORDER'); for (const n of notes) console.log(`  ${n}`); }
  console.log(`\nManifest: ${MANIFEST}\nCleanup:  npx tsx scripts/seed-iimk-mock.ts cleanup`);
}

// ---------------------------------------------------------------------------
async function cleanup() {
  assertBeta();
  if (!existsSync(MANIFEST)) { console.error('No manifest found - nothing to clean up.'); process.exit(1); }
  const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const t0 = Date.now();
  const champIds = m.championships ?? [];
  const userIds = m.users ?? [];

  // Rows the product wrote about the mock (fixture generation notifies, routes audit).
  // Not tracked by id because this script never made them; found by what IS tracked.
  for (const [label, sql] of [
    ['notification reads', `delete from notification_reads where notification_id in (select id from notifications where championship_id = any($1::uuid[]))`],
    ['notification reactions', `delete from notification_reactions where notification_id in (select id from notifications where championship_id = any($1::uuid[]))`],
    ['notifications', `delete from notifications where championship_id = any($1::uuid[])`],
    ['user notifications', `delete from notifications where target_user_id = any($2::uuid[]) or sender_id = any($2::uuid[])`],
  ] as const) {
    try {
      const n = await prisma.$executeRawUnsafe(sql, champIds, userIds);
      if (n) console.log(`deleted ${n} ${label} (written by the product)`);
    } catch (e) {
      // A table or column this database does not have is simply nothing to delete.
      const msg = e instanceof Error ? e.message.split('\n').find((l) => /does not exist|column/i.test(l)) ?? e.message.split('\n')[0] : String(e);
      console.log(`  - ${label}: skipped (${msg.trim().slice(0, 120)})`);
    }
  }

  const order = [
    'standings_rules', 'fixtures', 'team_entries', 'team_members', 'teams',
    'user_championship_roles', 'championship_organizations', 'tournament_disciplines',
    'scoring_formats', 'tournament_sports', 'venue_grounds', 'venues', 'tournaments',
    'championships', 'organization_members', 'users', 'organizations',
  ];
  for (const table of order) {
    const ids = m[table];
    if (!ids?.length) continue;
    // scoring_formats has no Prisma model (the routes use raw SQL), so neither do we.
    const n = table === 'scoring_formats'
      ? await prisma.$executeRawUnsafe(`delete from scoring_formats where id = any($1::uuid[])`, ids)
      : (await (prisma as any)[table].deleteMany({ where: { id: { in: ids } } })).count;
    console.log(`deleted ${n}/${ids.length} ${table}`);
  }
  rmSync(MANIFEST);
  console.log(`\ncleanup done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Manifest removed.`);
}

// ---------------------------------------------------------------------------
async function verify() {
  assertBeta();
  const champ = await prisma.championships.findFirst({ where: { name: CONFIG.championship.name }, select: { id: true } });
  if (!champ) { console.log('No mock championship on this database.'); return; }
  const tds = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { tournaments: { championship_id: champ.id } } },
    select: {
      id: true, discipline_id: true, format_id: true,
      disciplines: { select: { name: true } }, tournament_sports: { select: { format_id: true, sports: { select: { name: true } } } },
      _count: { select: { team_entries: true, fixtures: true } },
    },
    orderBy: { display_order: 'asc' },
  });
  console.log(`championship ${champ.id}: ${tds.length} draws`);
  for (const t of tds) {
    const sport = t.tournament_sports?.sports?.name ?? null;
    // The rule this draw's tables and placings will actually use - proves each one is keyed right.
    const rule = await resolveRuleForDraw(prisma as any, champ.id, t.discipline_id, t.format_id ?? t.tournament_sports?.format_id ?? null, undefined, sport);
    const said = rule.scheme === 'placement'
      ? `placement ${Object.values(rule.points).join('/')} +${rule.participation}${rule.ranking ? ` · ${rule.ranking.win}/${rule.ranking.draw}/${rule.ranking.loss} ${(rule.ranking.tiebreakers ?? []).join('>')}` : ''}${rule.table_placings ? ' · table placings' : ''}`
      : rule.scheme === 'ranking' ? `ranking ${rule.places.join('/')}` : rule.scheme;
    console.log(`  ${`${sport} ${t.disciplines?.name ?? 'Whole sport'}`.padEnd(26)} entries ${String(t._count.team_entries).padStart(2)}  fixtures ${String(t._count.fixtures).padStart(3)}  ${said}`);
  }
}

const mode = process.argv[2] ?? 'seed';
(mode === 'cleanup' ? cleanup() : mode === 'verify' ? verify() : seed())
  .catch((e) => { console.error('\nFAILED:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
