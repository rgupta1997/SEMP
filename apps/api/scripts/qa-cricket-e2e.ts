/*
 * CRICKET, END TO END: ball log → lock → player statistics.
 *
 *   npx tsx scripts/qa-cricket-e2e.ts
 *
 * The engine suite proves the fold is right. The browser harness proves the screen
 * is right. Neither touches the thing that actually decides whether a player's
 * figures appear tomorrow: the WRITE at lock time, which turns a ball log in
 * live_state into rows in player_match_stats and the four cricket tables.
 *
 * So this plays whole matches through the real API as the real official, locks them
 * as the organiser, and then checks every number in the database against the number
 * the engine derives from the same log. Anything that disagrees is a stat a player
 * would see and a scorer could not explain.
 *
 * It prints, at the end, the LOGINS of people who now have real figures - because
 * "the stats are written" is only believable when you can sign in as somebody and
 * see them.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  cricketScorecard, foldCricket, parseCricketFormat,
  type CricketEvent, type CricketFormat, type CricketLog,
} from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const PW = 'Qa@2026';
const LIST = path.join(process.cwd(), '..', 'web', 'scripts', 'qa-cricket.json');

const prisma = new PrismaClient();
const tokens = new Map<string, string>();
const checks: Array<{ scope: string; name: string; pass: boolean; detail: string }> = [];

function record(scope: string, name: string, pass: boolean, detail = '') {
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

/* --------------------------------------------------------------------------
 * Playing a match: the same taps a person would make, as events.
 * ------------------------------------------------------------------------ */

function rng(seed: number) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

/**
 * One innings, obeying the rules the console obeys.
 *
 * Deliberately NOT a random event stream: a log the console could never have
 * produced proves nothing about the console. So the bowler changes every over and
 * stays inside their allocation, a new batter is named at every wicket while one is
 * left, and the innings is closed when the bench runs out - which is what the deck
 * does when a format wants more players than the team sheet has.
 */
function playInnings(f: CricketFormat, seed: number, batters: string[], bowlers: string[]): CricketLog {
  const r = rng(seed);
  const log: CricketLog = [
    { t: 'setBatter', end: 'striker', batterId: batters[0] },
    { t: 'setBatter', end: 'nonStriker', batterId: batters[1] },
  ];
  let nextIn = 2;
  let wickets = 0;
  const perBowler = new Map<string, number>();
  let lastBowler = '';
  const overs = f.oversPerInnings ?? 6;

  for (let over = 0; over < overs; over += 1) {
    if (wickets >= f.wicketsToEndInnings) break;
    const pick = bowlers.find((b) => b !== lastBowler
      && (f.maxOversPerBowler === null || (perBowler.get(b) ?? 0) < f.maxOversPerBowler));
    if (!pick) break;
    perBowler.set(pick, (perBowler.get(pick) ?? 0) + 1);
    lastBowler = pick;
    log.push({ t: 'setBowler', bowlerId: pick });

    let legal = 0;
    let guard = 0;
    while (legal < f.ballsPerOver && guard < 30) {
      guard += 1;
      const d = r();
      if (d < 0.05) { log.push({ t: 'ball', runs: 0, extra: 'wide', extraRuns: 0 }); continue; }
      if (d < 0.09) { log.push({ t: 'ball', runs: r() < 0.4 ? 4 : 0, extra: 'noball', extraRuns: 0 }); continue; }
      legal += 1;
      // A wicket only while somebody is left to come in, or the innings closes and
      // the rest of the over would be scored into a shut innings.
      if (d < 0.15 && nextIn < batters.length && wickets < f.wicketsToEndInnings - 1) {
        wickets += 1;
        const how = r() < 0.25 ? 'run_out' : r() < 0.5 ? 'caught' : 'bowled';
        const ev: CricketEvent = {
          t: 'ball', runs: 0,
          wicket: {
            how: how as any,
            ...(how !== 'bowled' ? { fielderId: bowlers[Math.floor(r() * bowlers.length)] } : {}),
          },
          nextBatterId: batters[nextIn],
        };
        nextIn += 1;
        log.push(ev);
        continue;
      }
      if (d < 0.20) { log.push({ t: 'ball', runs: 0, extra: 'legbye', extraRuns: 1 }); continue; }
      if (d < 0.24) { log.push({ t: 'ball', runs: 0, extra: 'bye', extraRuns: 2 }); continue; }
      log.push({ t: 'ball', runs: [0, 0, 1, 1, 2, 3, 4, 6][Math.floor(r() * 8)] });
    }
  }
  return log;
}

interface Bench {
  preset: string; formatName: string; entryMode: string;
  sport: string; discipline: string; fixtureId: string;
  home: string; away: string;
  homeSquad: Array<{ id: string; name: string; email: string | null }>;
  awaySquad: Array<{ id: string; name: string; email: string | null }>;
}

async function main() {
  await login('organiser@qa.test');
  await login('official@qa.test');

  const bench: Bench[] = JSON.parse(readFileSync(LIST, 'utf8'))
    .filter((b: Bench) => b.entryMode !== 'summary');
  if (!bench.length) throw new Error('No bench — run scripts/qa-cricket-bench.ts first.');

  const showcase: Array<{ email: string; name: string; line: string; fixtureId: string; scope: string }> = [];

  for (const b of bench) {
    const scope = `${b.sport} · ${b.formatName}`;
    console.log(`\n${'='.repeat(74)}\n${scope}\n  ${b.home} v ${b.away}`);

    // The format the fixture will actually be scored under, read the way the
    // console reads it - the frozen snapshot if there is one, else the pinned row.
    const fx = await prisma.fixtures.findUnique({
      where: { id: b.fixtureId },
      select: { scoring_format_id: true, live_state: true, home_team_id: true, away_team_id: true },
    });
    const pinned = fx?.scoring_format_id
      ? await prisma.$queryRawUnsafe<Array<{ config: unknown }>>(
        'select config from scoring_formats where id = $1::uuid', fx.scoring_format_id)
      : [];
    const format = parseCricketFormat(pinned[0]?.config);
    if (!format) { record(scope, 'the fixture has a cricket format pinned', false); continue; }
    record(scope, 'the fixture has a cricket format pinned', true,
      `${format.oversPerInnings ?? '∞'} ov · ${format.ballsPerOver}-ball · ${format.playersPerSide} a side`);

    // ---- play it ----
    const A = b.homeSquad.map((x) => x.id);
    const B = b.awaySquad.map((x) => x.id);
    const log = [...playInnings(format, 11, A, B), ...playInnings(format, 29, B, A)];
    const state = foldCricket(format, log).state;

    const headline: [number, number] = [
      state.innings.filter((i) => i.battingSide === 'A').reduce((n, i) => n + i.runs, 0),
      state.innings.filter((i) => i.battingSide === 'B').reduce((n, i) => n + i.runs, 0),
    ];

    // ---- unlock, so the run is repeatable ----
    //
    // Locking is the step being tested, and a locked scorecard correctly refuses
    // both a score and a re-lock. Without this the harness passes exactly once and
    // then reports the product broken.
    const un = await call('POST', `/fixtures/${b.fixtureId}/unlock`,
      { reason: 'QA cricket end-to-end re-run' }, 'organiser@qa.test');
    if (un.status >= 400 && !/not locked|already/i.test(un.body?.error?.message ?? '')) {
      console.log(`  · unlock → ${un.status} ${un.body?.error?.message ?? ''}`);
    }

    // ---- save it as the official, through the real endpoint ----
    const saved = await call('PATCH', `/fixtures/${b.fixtureId}/live`, {
      live_state: { cricket: log, format },
      live_log: [],
      home_score: headline[0],
      away_score: headline[1],
      status: state.ended ? 'completed' : 'live',
      winner_team_id: !state.ended || !state.winner ? null
        : state.winner === 'A' ? fx?.home_team_id : fx?.away_team_id,
    }, 'official@qa.test');
    record(scope, 'the official can save the ball log', saved.status === 200, `PATCH /live → ${saved.status}`);
    record(scope, 'the match reached a result', state.ended, state.margin ?? 'still in progress');

    // ---- lock it as the organiser, which is what writes the statistics ----
    const locked = await call('POST', `/fixtures/${b.fixtureId}/lock`, {}, 'organiser@qa.test');
    record(scope, 'the organiser can lock the result', locked.status === 200 || locked.status === 201,
      `POST /lock → ${locked.status}${locked.status >= 400 ? ` ${JSON.stringify(locked.body)}` : ''}`);
    if (locked.status >= 400) continue;

    // ---- now check the database against the engine ----
    const card = cricketScorecard(state, { A, B });

    const innRows = await prisma.$queryRawUnsafe<Array<{
      innings: number; runs: number; wickets: number; balls: number;
      wides: number; no_balls: number; byes: number; leg_byes: number;
    }>>(`select innings, runs, wickets, balls, wides, no_balls, byes, leg_byes
         from cricket_innings where fixture_id = $1::uuid order by innings`, b.fixtureId);

    record(scope, 'an innings row per innings played', innRows.length === state.innings.length,
      `${innRows.length} rows for ${state.innings.length} innings`);

    let innOk = innRows.length > 0;
    for (const row of innRows) {
      const inn = state.innings.find((i) => i.innings === row.innings);
      if (!inn || row.runs !== inn.runs || row.wickets !== inn.wickets || row.balls !== inn.balls
        || row.wides !== inn.wides || row.no_balls !== inn.noBalls
        || row.byes !== inn.byes || row.leg_byes !== inn.legByes) {
        innOk = false;
        console.log(`      innings ${row.innings}: db ${row.runs}/${row.wickets} (${row.balls}b, `
          + `w${row.wides} nb${row.no_balls} b${row.byes} lb${row.leg_byes}) vs engine `
          + `${inn?.runs}/${inn?.wickets} (${inn?.balls}b, w${inn?.wides} nb${inn?.noBalls} `
          + `b${inn?.byes} lb${inn?.legByes})`);
      }
    }
    record(scope, 'every innings total matches the engine, extras included', innOk);

    const batRows = await prisma.$queryRawUnsafe<Array<{
      user_id: string; innings: number; runs: number; balls_faced: number;
      fours: number; sixes: number; dismissal: string;
    }>>(`select s.user_id, l.innings, l.runs, l.balls_faced, l.fours, l.sixes, l.dismissal
         from cricket_batting_lines l
         join player_match_stats s on s.id = l.line_id
         where s.fixture_id = $1::uuid and s.superseded_at is null`, b.fixtureId);
    const bowlRows = await prisma.$queryRawUnsafe<Array<{
      user_id: string; innings: number; balls_bowled: number; runs_conceded: number;
      wickets: number; maidens: number;
    }>>(`select s.user_id, l.innings, l.balls_bowled, l.runs_conceded, l.wickets, l.maidens
         from cricket_bowling_lines l
         join player_match_stats s on s.id = l.line_id
         where s.fixture_id = $1::uuid and s.superseded_at is null`, b.fixtureId);
    const fieldRows = await prisma.$queryRawUnsafe<Array<{
      user_id: string; innings: number; catches: number; stumpings: number; run_outs: number;
    }>>(`select s.user_id, l.innings, l.catches, l.stumpings, l.run_outs
         from cricket_fielding_lines l
         join player_match_stats s on s.id = l.line_id
         where s.fixture_id = $1::uuid and s.superseded_at is null`, b.fixtureId);

    record(scope, 'batting lines were written', batRows.length > 0, `${batRows.length} rows`);
    record(scope, 'bowling lines were written', bowlRows.length > 0, `${bowlRows.length} rows`);

    // Every engine batting line has a row saying exactly the same thing.
    const engineBat = card.batting.filter((x) => x.dismissal !== 'did_not_bat');
    let batOk = true;
    for (const want of engineBat) {
      const got = batRows.find((r) => r.user_id === want.userId && r.innings === want.innings);
      if (!got) { batOk = false; console.log(`      no batting row for ${want.userId} innings ${want.innings}`); continue; }
      if (got.runs !== want.runs || got.balls_faced !== want.ballsFaced
        || got.fours !== want.fours || got.sixes !== want.sixes) {
        batOk = false;
        console.log(`      ${want.userId} i${want.innings}: db ${got.runs}(${got.balls_faced}) `
          + `4s${got.fours} 6s${got.sixes} vs engine ${want.runs}(${want.ballsFaced}) `
          + `4s${want.fours} 6s${want.sixes}`);
      }
    }
    record(scope, 'every batter\'s runs, balls and boundaries match the engine', batOk,
      `${engineBat.length} innings checked`);

    let bowlOk = true;
    for (const want of card.bowling) {
      const got = bowlRows.find((r) => r.user_id === want.userId && r.innings === want.innings);
      if (!got) { bowlOk = false; console.log(`      no bowling row for ${want.userId} innings ${want.innings}`); continue; }
      if (got.balls_bowled !== want.ballsBowled || got.runs_conceded !== want.runsConceded
        || got.wickets !== want.wickets || got.maidens !== want.maidens) {
        bowlOk = false;
        console.log(`      ${want.userId} i${want.innings}: db ${got.balls_bowled}b `
          + `${got.runs_conceded}r ${got.wickets}w ${got.maidens}m vs engine ${want.ballsBowled}b `
          + `${want.runsConceded}r ${want.wickets}w ${want.maidens}m`);
      }
    }
    record(scope, 'every bowler\'s overs, runs, wickets and maidens match', bowlOk,
      `${card.bowling.length} spells checked`);

    let fieldOk = true;
    for (const want of card.fielding) {
      const got = fieldRows.find((r) => r.user_id === want.userId && r.innings === want.innings);
      if (!got || got.catches !== want.catches || got.stumpings !== want.stumpings
        || got.run_outs !== want.runOuts) {
        fieldOk = false;
        console.log(`      ${want.userId} i${want.innings}: db ${got ? `${got.catches}c ${got.stumpings}st ${got.run_outs}ro` : 'MISSING'} `
          + `vs engine ${want.catches}c ${want.stumpings}st ${want.runOuts}ro`);
      }
    }
    record(scope, 'catches, stumpings and run-outs are filed against the fielder', fieldOk,
      `${card.fielding.length} fielders checked`);

    // THE RUN-OUT RULE, checked in the database rather than only in the engine.
    const runOutRows = batRows.filter((r) => r.dismissal === 'run_out');
    if (runOutRows.length) {
      const bowlerWickets = bowlRows.reduce((n, r) => n + r.wickets, 0);
      const engineBowlerWickets = card.bowling.reduce((n, r) => n + r.wickets, 0);
      record(scope, 'a run-out is not credited to any bowler',
        bowlerWickets === engineBowlerWickets
        && bowlerWickets + runOutRows.length <= state.innings.reduce((n, i) => n + i.wickets, 0),
        `${runOutRows.length} run-outs, ${bowlerWickets} bowler wickets`);
    }

    // ---- the spine: does a player actually have a stat line to look at? ----
    const spine = await prisma.$queryRawUnsafe<Array<{
      user_id: string; played: boolean; stats: any;
    }>>(`select user_id, played, stats from player_match_stats
         where fixture_id = $1::uuid and superseded_at is null`, b.fixtureId);
    record(scope, 'a player_match_stats row exists for the people who played',
      spine.length > 0, `${spine.length} rows`);

    const named = new Set([...A, ...B]);
    const strangers = spine.filter((r) => !named.has(r.user_id));
    record(scope, 'nobody outside the two team sheets was given an appearance',
      strangers.length === 0, strangers.length ? `${strangers.length} strangers` : '');

    // Somebody worth signing in as: the top scorer with a real innings.
    const best = [...engineBat].sort((x, y) => y.runs - x.runs)[0];
    const topBowler = [...card.bowling].sort((x, y) => y.wickets - x.wickets || x.runsConceded - y.runsConceded)[0];
    for (const [who, line] of [
      [best?.userId, best ? `batted ${best.runs} (${best.ballsFaced}), ${best.fours}x4 ${best.sixes}x6` : null],
      [topBowler?.userId, topBowler ? `bowled ${topBowler.wickets}/${topBowler.runsConceded} off ${topBowler.ballsBowled} balls` : null],
    ] as const) {
      if (!who || !line) continue;
      const person = [...b.homeSquad, ...b.awaySquad].find((x) => x.id === who);
      if (person?.email) showcase.push({ email: person.email, name: person.name, line, fixtureId: b.fixtureId, scope });
    }
  }

  // ---- the verdict ----
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`CRICKET END TO END · ${passed}/${checks.length} checks passed`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.scope}\n    ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }

  if (showcase.length) {
    console.log(`\n${'='.repeat(74)}`);
    console.log(`SIGN IN AND SEE A REAL FIGURE (password ${PW})`);
    console.log('Profile → Matches → the named match → "Your statistics"\n');
    for (const s of showcase) {
      console.log(`  ${s.email.padEnd(24)} ${s.name.padEnd(20)} ${s.line}`);
      console.log(`  ${''.padEnd(24)} ${s.scope}`);
      console.log(`  ${''.padEnd(24)} /profile/matches/${s.fixtureId}\n`);
    }
  }

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
