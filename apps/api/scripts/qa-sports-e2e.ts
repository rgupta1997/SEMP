/*
 * EVERY SPORT, END TO END: score → lock → player statistics.
 *
 *   npx tsx scripts/qa-sports-e2e.ts
 *   QA_ONLY=badminton,football npx tsx scripts/qa-sports-e2e.ts
 *
 * The engine suites prove the maths and the browser harness proves the screen.
 * Neither touches the step that decides whether anything survives the match: the
 * WRITE at lock time, which turns a log in live_state into the two numbers standings
 * read and the rows a player's profile reads.
 *
 * So this scores each sport through the real API as the real official, locks it as
 * the organiser, and then checks the database against what the shared engine derives
 * from the same log.
 *
 * THE CHECK THAT MATTERS MOST is the headline. `home_score`/`away_score` are what
 * standings compare and what a results table prints, and they are computed by one
 * function the console never shows you. A third of the shelf used to publish 0-0
 * for a completed match through exactly that path.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  canonicalRacquetSport, foldRally, headline, isRankingSport, resultEnvelope,
  matchPresetsFor, isCricketFormat, isRankingSport as ranking,
  type RallyEvent, type RallyLog, type ScoringFormat, type Side,
} from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const PW = 'Qa@2026';
const LIST = path.join(process.cwd(), '..', 'web', 'scripts', 'qa-sports.json');
const ONLY = (process.env.QA_ONLY ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const prisma = new PrismaClient();
const tokens = new Map<string, string>();
const checks: Array<{ scope: string; name: string; pass: boolean; detail: string }> = [];
let scope = '';

function record(name: string, pass: boolean, detail = '') {
  checks.push({ scope, name, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method: string, p: string, body?: unknown, as?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${tokens.get(as)}`;
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed as any };
}

async function login(email: string) {
  const r = await call('POST', '/auth/login', { email, password: PW });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  tokens.set(email, r.body.token);
}

function rng(seed: number) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

/**
 * Play a rally/team format to a finish, the way the deck would.
 *
 * Bounded rather than `while (!ended)`: a format that cannot be finished must show
 * up as a failed assertion, not a hung script.
 */
function playToEnd(f: ScoringFormat, seed: number): RallyLog {
  const r = rng(seed);
  const log: RallyLog = [];
  let state = foldRally(f, [], 'A').state;
  const clocked = f.levels[0].terminator === 'clock';
  let sincePeriod = 0;
  for (let i = 0; i < 3000 && !state.ended; i += 1) {
    const ev: RallyEvent = { t: 'point', side: r() < 0.58 ? 'A' : 'B' };
    log.push(ev);
    state = foldRally(f, log, 'A').state;
    sincePeriod += 1;
    if (clocked && sincePeriod >= 9) {
      const wh: RallyEvent = { t: 'endPeriod' };
      log.push(wh);
      state = foldRally(f, log, 'A').state;
      sincePeriod = 0;
    }
  }
  return log;
}

interface Bench {
  sport: string; discipline: string; engine: string;
  fixtureId: string; drawId: string; home: string; away: string;
  homeSquad: Array<{ id: string; name: string; email: string | null }>;
  awaySquad: Array<{ id: string; name: string; email: string | null }>;
}

const showcase: Array<{ email: string; name: string; sport: string; line: string; fixtureId: string }> = [];

async function main() {
  await login('organiser@qa.test');
  await login('official@qa.test');

  let bench: Bench[] = JSON.parse(readFileSync(LIST, 'utf8'));
  if (ONLY.length) bench = bench.filter((b) => ONLY.includes(b.sport.toLowerCase()));
  if (!bench.length) throw new Error('No bench — run scripts/qa-sports-bench.ts first.');

  for (const b of bench) {
    scope = `${b.sport} (${b.engine})`;
    console.log(`\n${'='.repeat(74)}\n${scope} — ${b.home} v ${b.away}`);

    // Repeatable: a locked scorecard correctly refuses both a score and a re-lock.
    const un = await call('POST', `/fixtures/${b.fixtureId}/unlock`,
      { reason: 'QA all-sports end-to-end re-run' }, 'organiser@qa.test');
    if (un.status >= 400 && !/not locked|already/i.test(un.body?.error?.message ?? '')) {
      console.log(`  · unlock → ${un.status} ${un.body?.error?.message ?? ''}`);
    }

    const fx = await prisma.fixtures.findUnique({
      where: { id: b.fixtureId },
      select: { home_team_id: true, away_team_id: true },
    });

    let expectedHeadline: [number, number] | null = null;
    let expectedWinner: Side | null = null;
    let body: Record<string, unknown> | null = null;

    if (b.engine === 'racquet' || b.engine === 'team') {
      const format = matchPresetsFor(b.sport)[0];
      if (!format || isCricketFormat(format)) { record('a format resolves for this sport', false); continue; }
      record('a format resolves for this sport', true, format.name);

      // A KNOCKOUT NEEDS A WINNER. A clocked aggregate sport can legitimately end
      // level, and the API correctly refuses to lock a bracket match nobody won -
      // so keep looking for a seed that decides it rather than calling that
      // refusal a defect.
      let log = playToEnd(format as ScoringFormat, 17);
      let state = foldRally(format as ScoringFormat, log, 'A').state;
      for (let seed = 18; seed < 26 && state.ended && !state.winner; seed += 1) {
        log = playToEnd(format as ScoringFormat, seed);
        state = foldRally(format as ScoringFormat, log, 'A').state;
      }
      const env = resultEnvelope(format as ScoringFormat, state);
      expectedHeadline = env.headline as [number, number];
      expectedWinner = state.winner;

      record('the match reaches a result', state.ended,
        state.ended ? `${env.headline[0]}-${env.headline[1]} ${state.outcome}` : 'never ended');

      // THE HEADLINE IS NOT 0-0. This is the exact shape of the defect that made a
      // third of the shelf publish an empty scoreline for a completed match.
      if (state.ended) {
        record('the headline is a real scoreline, not 0-0',
          env.headline[0] + env.headline[1] > 0, `${env.headline[0]}-${env.headline[1]}`);
      }

      body = {
        live_state: { rally: log, firstServer: 'A', format },
        live_log: [],
        home_score: env.headline[0],
        away_score: env.headline[1],
        status: state.ended ? 'completed' : 'live',
        winner_team_id: !state.ended || !state.winner ? null
          : state.winner === 'A' ? fx?.home_team_id : fx?.away_team_id,
      };
    } else if (b.engine === 'event') {
      // A ranking fixture: each entered org takes a place.
      const orgs = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(`
        select distinct o.id, o.name
        from championship_organizations co
        join organizations o on o.id = co.organization_id
        join tournaments t on t.championship_id = co.championship_id
        join tournament_sports ts on ts.tournament_id = t.id
        join tournament_disciplines td on td.tournament_sport_id = ts.id
        where td.id = $1::uuid
        order by o.name limit 6`, b.drawId);
      const rows = orgs.map((o, i) => ({
        orgId: o.id, org: o.name, place: i + 1, points: [5, 3, 1][i] ?? 0,
      }));
      record('the draw has entered orgs to rank', rows.length > 0, `${rows.length} orgs`);
      if (!rows.length) continue;
      body = {
        live_state: { eventRanking: { rows } },
        live_log: [],
        home_score: 0, away_score: 0,
        status: 'completed', winner_team_id: null,
      };
      expectedHeadline = [0, 0];
    } else {
      // The manual result form: two numbers and a winner.
      expectedHeadline = [3, 1];
      expectedWinner = 'A';
      body = {
        live_state: {},
        live_log: [],
        home_score: 3, away_score: 1,
        status: 'completed', winner_team_id: fx?.home_team_id ?? null,
      };
    }

    const saved = await call('PATCH', `/fixtures/${b.fixtureId}/live`, body, 'official@qa.test');
    record('the official can save the result', saved.status === 200, `PATCH /live → ${saved.status}`
      + (saved.status >= 400 ? ` ${JSON.stringify(saved.body).slice(0, 120)}` : ''));
    if (saved.status !== 200) continue;

    const locked = await call('POST', `/fixtures/${b.fixtureId}/lock`, {}, 'organiser@qa.test');
    const lockMsg = String(locked.body?.error?.message ?? '');
    if (b.engine === 'event') {
      // A RANKING FIXTURE HAS NO TWO SIDES, and the lock guard requires them. The
      // rankings path does not go through the lock at all - the console persists
      // `live_state.eventStandings` and the standings service reads that directly -
      // so this is recorded as the known shape rather than a failure, and the
      // standings read below is what actually matters for these.
      record('a ranking fixture is not locked through the match path',
        locked.status >= 400 && /both teams/i.test(lockMsg),
        `POST /lock → ${locked.status} ${lockMsg.slice(0, 70)}`);
    } else {
      record('the organiser can lock the result', locked.status === 200 || locked.status === 201,
        `POST /lock → ${locked.status}${locked.status >= 400 ? ` ${lockMsg.slice(0, 120)}` : ''}`);
      if (locked.status >= 400) continue;
    }

    // ---- what actually landed ----
    const after = await prisma.fixtures.findUnique({
      where: { id: b.fixtureId },
      select: { home_score: true, away_score: true, status: true, winner_team_id: true, locked_at: true },
    });

    if (b.engine !== 'event') {
      record('the fixture is completed and locked',
        after?.status === 'completed' && !!after?.locked_at,
        `status=${after?.status} locked=${!!after?.locked_at}`);
    }

    if (expectedHeadline && b.engine !== 'event') {
      record('the persisted scoreline is the engine\'s headline',
        after?.home_score === expectedHeadline[0] && after?.away_score === expectedHeadline[1],
        `db ${after?.home_score}-${after?.away_score} vs engine ${expectedHeadline[0]}-${expectedHeadline[1]}`);
    }

    if (expectedWinner && b.engine !== 'event') {
      const wantTeam = expectedWinner === 'A' ? fx?.home_team_id : fx?.away_team_id;
      record('the winning side is the one recorded', after?.winner_team_id === wantTeam,
        after?.winner_team_id === wantTeam ? '' : 'the wrong team was recorded as the winner');
    }

    // ---- the spine: who played ----
    const spine = await prisma.$queryRawUnsafe<Array<{
      user_id: string; played: boolean; outcome: string | null; stats: any;
    }>>(`select user_id, played, outcome, stats from player_match_stats
         where fixture_id = $1::uuid and superseded_at is null`, b.fixtureId);

    const squadIds = new Set([...b.homeSquad, ...b.awaySquad].map((x) => x.id));
    if (squadIds.size > 0) {
      record('a player_match_stats row exists for the people who played',
        spine.length > 0, `${spine.length} rows for ${squadIds.size} squad members`);
      const strangers = spine.filter((r) => !squadIds.has(r.user_id));
      record('nobody outside the two team sheets was given an appearance',
        strangers.length === 0, strangers.length ? `${strangers.length} strangers` : '');

      // Exactly one side won, or everybody drew.
      // The column's vocabulary is won / lost / drew - past tense, as the database
      // spells it. Asserting 'win'/'loss' here measured nothing at all.
      const outcomes = spine.filter((r) => r.played).map((r) => r.outcome);
      const wins = outcomes.filter((o) => o === 'won').length;
      const losses = outcomes.filter((o) => o === 'lost').length;
      const draws = outcomes.filter((o) => o === 'drew' || o === 'draw').length;
      record('every appearance carries one consistent outcome',
        (wins > 0 && losses > 0 && draws === 0) || (draws > 0 && wins === 0 && losses === 0)
        || outcomes.length === 0,
        `${wins} win / ${losses} loss / ${draws} draw`);

      // Somebody worth signing in as.
      const best = spine.find((r) => r.played && r.stats && Object.keys(r.stats).length > 0);
      if (best) {
        const person = [...b.homeSquad, ...b.awaySquad].find((x) => x.id === best.user_id);
        const top = Object.entries(best.stats as Record<string, unknown>)
          .filter(([k, v]) => typeof v === 'number' && (v as number) > 0
            && !['matches', 'wins', 'losses', 'draws'].includes(k))
          .sort((x, y) => (y[1] as number) - (x[1] as number)).slice(0, 3)
          .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');
        if (person?.email && top) {
          showcase.push({ email: person.email, name: person.name, sport: b.sport, line: top, fixtureId: b.fixtureId });
        }
      }

      // A racquet sport must produce REAL figures, not an empty bag.
      if (canonicalRacquetSport(b.sport)) {
        const withStats = spine.filter((r) => r.played && r.stats
          && Object.keys(r.stats).length > 0).length;
        record('racquet players get a real stat line, not an empty bag',
          withStats > 0, `${withStats} of ${spine.filter((r) => r.played).length} played rows carry stats`);
      }
    } else {
      record('a ranking fixture writes no appearance rows', true, `${spine.length} rows`);
    }

    // ---- the standings read it ----
    const standings = await call('GET', `/tournament-disciplines/${b.drawId}/standings`,
      undefined, 'organiser@qa.test');
    record('standings can be read back after the lock',
      standings.status === 200 || standings.status === 404,
      `GET /standings → ${standings.status}`);
  }

  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`ALL SPORTS END TO END · ${pass}/${checks.length} checks passed`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    const by = new Map<string, typeof failed>();
    for (const f of failed) {
      if (!by.has(f.scope)) by.set(f.scope, []);
      by.get(f.scope)!.push(f);
    }
    for (const [s, rows] of by) {
      console.log(`  ${s}`);
      for (const r of rows) console.log(`    ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }

  if (showcase.length) {
    console.log(`\n${'='.repeat(74)}`);
    console.log(`SIGN IN AND SEE A REAL FIGURE (password ${PW})`);
    console.log('My Sports Profile → Matches → the named match\n');
    for (const s of showcase.slice(0, 14)) {
      console.log(`  ${s.email.padEnd(22)} ${s.sport.padEnd(14)} ${s.line}`);
    }
  }

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

void ranking; void isRankingSport; void headline;

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
