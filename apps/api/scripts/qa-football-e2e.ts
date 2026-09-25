/*
 * FOOTBALL, END TO END: attributed taps → lock → the row a profile reads.
 *
 *   npx tsx scripts/qa-football-e2e.ts
 *
 * The all-sports end-to-end scores football with plain unattributed points, which
 * proves the scoreline and nothing about the people. That is the half that matters
 * for an event: a goal belongs to a PERSON, and no fold of a scoreline can recover
 * who.
 *
 * So this plays a real match - goals with assists, a converted penalty, a missed
 * one, saves, cards and an own goal - through the API as the official, locks it as
 * the organiser, and then checks THREE places agree:
 *
 *   the fixture        the scoreline standings read
 *   player_match_stats the appearance and the stat bag
 *   invasion_match_lines  the typed columns a profile actually renders
 *
 * Anything that disagrees is a number a player would see and a scorer could not
 * explain.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  aggregateScore, deriveTeamStats, foldRally, headline, matchPresetByKey,
  resultEnvelope, toCategoryRow,
  type RallyEvent, type RallyLog, type ScoringFormat, type Side,
} from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const PW = 'Qa@2026';
const LIST = path.join(process.cwd(), '..', 'web', 'scripts', 'qa-sports.json');

const prisma = new PrismaClient();
const tokens = new Map<string, string>();
const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

function record(name: string, pass: boolean, detail = '') {
  checks.push({ name, pass, detail });
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
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  tokens.set(email, r.body.token);
}

async function main() {
  await login('organiser@qa.test');
  await login('official@qa.test');

  const bench = JSON.parse(readFileSync(LIST, 'utf8'));
  const t = bench.find((b: { sport: string }) => b.sport.toLowerCase() === 'football');
  if (!t) throw new Error('No football fixture — run scripts/qa-sports-bench.ts first.');

  console.log(`\nFootball · ${t.home} v ${t.away}\n${t.url}\n`);

  const A: Array<{ id: string; name: string }> = t.homeSquad;
  const B: Array<{ id: string; name: string }> = t.awaySquad;
  if (A.length < 5 || B.length < 5) throw new Error('both squads need at least five players');

  const un = await call('POST', `/fixtures/${t.fixtureId}/unlock`,
    { reason: 'QA football end-to-end re-run' }, 'organiser@qa.test');
  if (un.status >= 400 && !/not locked|already/i.test(un.body?.error?.message ?? '')) {
    console.log(`  · unlock → ${un.status}`);
  }

  const format = matchPresetByKey('fifa_2x45') as ScoringFormat;
  record('the football format resolves', !!format, format?.name);

  // ---- the taps an official makes ----
  const goal = (side: Side, by: string, assist?: string): RallyEvent => ({
    t: 'point', side, pts: 1, kind: 'goal', label: 'Goal', playerId: by,
    ...(assist ? { secondId: assist } : {}),
  });
  const pen = (side: Side, by: string): RallyEvent =>
    ({ t: 'point', side, pts: 1, kind: 'pen_scored', label: 'Penalty scored', playerId: by });
  const nil = (kind: string) => (side: Side, by: string): RallyEvent =>
    ({ t: 'point', side, pts: 0, kind, label: kind, playerId: by });
  const save = nil('save'); const yellow = nil('yellow');
  const red = nil('red'); const penMissed = nil('pen_missed');
  /** Fired against the side that BENEFITS, carrying the player who put it in. */
  const ownGoal = (conceded: Side, by: string): RallyEvent => ({
    t: 'point', side: conceded === 'A' ? 'B' : 'A', pts: 1,
    kind: 'own_goal', label: 'Own goal', playerId: by,
  });

  const log: RallyLog = [
    goal('A', A[0].id, A[1].id),
    save('B', B[4].id),
    yellow('B', B[2].id),
    goal('B', B[0].id, B[1].id),
    penMissed('A', A[3].id),
    { t: 'endPeriod' },
    pen('A', A[1].id),
    red('A', A[2].id),
    ownGoal('B', B[3].id),          // B put it in; the goal is A's
    save('B', B[4].id),
    { t: 'endPeriod' },
  ];

  const state = foldRally(format, log, 'A').state;
  const env = resultEnvelope(format, state);
  const total = aggregateScore(state);

  record('the match reaches a result', state.ended, `${total[0]}-${total[1]} ${state.outcome}`);
  record('the scoreline counts the goals, the own goal included',
    total[0] === 3 && total[1] === 1, `${total[0]}-${total[1]} (expected 3-1)`);
  record('the headline standings read equals the goals',
    JSON.stringify(headline(format, state)) === JSON.stringify(total),
    `${headline(format, state).join('-')}`);

  // What the shared fold says the people did - the yardstick for the database.
  const sideOf = new Map<string, Side>([
    ...A.map((p) => [p.id, 'A'] as [string, Side]),
    ...B.map((p) => [p.id, 'B'] as [string, Side]),
  ]);
  const derived = deriveTeamStats('football', log, {
    sideOf,
    roster: [...A.map((p) => ({ userId: p.id, side: 'A' as Side })),
      ...B.map((p) => ({ userId: p.id, side: 'B' as Side }))],
  });
  const want = new Map(derived.players.map((p) => [p.userId, p.stats]));
  record('the fold credits the people who did something', want.size >= 8, `${want.size} players`);

  const fx = await prisma.fixtures.findUnique({
    where: { id: t.fixtureId }, select: { home_team_id: true, away_team_id: true },
  });

  const saved = await call('PATCH', `/fixtures/${t.fixtureId}/live`, {
    live_state: { rally: log, format },
    live_log: [],
    home_score: total[0], away_score: total[1],
    status: 'completed',
    winner_team_id: state.winner === 'A' ? fx?.home_team_id
      : state.winner === 'B' ? fx?.away_team_id : null,
  }, 'official@qa.test');
  record('the official can save the attributed log', saved.status === 200, `PATCH /live → ${saved.status}`);
  if (saved.status !== 200) { await prisma.$disconnect(); process.exit(1); }

  const locked = await call('POST', `/fixtures/${t.fixtureId}/lock`, {}, 'organiser@qa.test');
  record('the organiser can lock the result',
    locked.status === 200 || locked.status === 201,
    `POST /lock → ${locked.status}${locked.status >= 400 ? ` ${JSON.stringify(locked.body?.error?.message)}` : ''}`);
  if (locked.status >= 400) { await prisma.$disconnect(); process.exit(1); }

  // ---- 1 · the fixture ----
  const after = await prisma.fixtures.findUnique({
    where: { id: t.fixtureId },
    select: { home_score: true, away_score: true, status: true, locked_at: true, winner_team_id: true },
  });
  record('the fixture is completed and locked',
    after?.status === 'completed' && !!after?.locked_at,
    `status=${after?.status} locked=${!!after?.locked_at}`);
  record('the persisted scoreline is the one the goals produced',
    after?.home_score === total[0] && after?.away_score === total[1],
    `db ${after?.home_score}-${after?.away_score}`);
  record('the winning side is the one recorded',
    after?.winner_team_id === fx?.home_team_id, after?.winner_team_id === fx?.home_team_id ? '' : 'wrong team');

  // ---- 2 · the spine ----
  const spine = await prisma.$queryRawUnsafe<Array<{
    id: string; user_id: string; played: boolean; outcome: string | null; stats: any;
  }>>(`select id, user_id, played, outcome, stats from player_match_stats
       where fixture_id = $1::uuid and superseded_at is null`, t.fixtureId);

  record('every squad member has an appearance row',
    spine.length === A.length + B.length, `${spine.length} rows for ${A.length + B.length} on the sheets`);

  const strangers = spine.filter((r) => !sideOf.has(r.user_id));
  record('nobody outside the two team sheets appears', strangers.length === 0,
    strangers.length ? `${strangers.length} strangers` : '');

  const wins = spine.filter((r) => r.outcome === 'won').length;
  const losses = spine.filter((r) => r.outcome === 'lost').length;
  record('the whole winning side is marked as having won',
    wins === A.length && losses === B.length, `${wins} won / ${losses} lost`);

  // ---- 3 · THE STAT BAG MATCHES THE FOLD ----
  let bagsOk = true;
  for (const [userId, expected] of want) {
    const row = spine.find((r) => r.user_id === userId);
    if (!row) { bagsOk = false; console.log(`      no row for ${userId}`); continue; }
    for (const [k, v] of Object.entries(expected)) {
      if ((row.stats?.[k] ?? 0) !== v) {
        bagsOk = false;
        console.log(`      ${userId}.${k}: db ${row.stats?.[k] ?? 0}, fold ${v}`);
      }
    }
  }
  record('every attributed figure reached the stat bag', bagsOk, `${want.size} players checked`);

  // ---- 4 · THE TYPED ROW a profile actually renders ----
  const lines = await prisma.$queryRawUnsafe<Array<{
    user_id: string; goals: number; assists: number; own_goals: number;
    saves: number; yellows: number; reds: number; pens_scored: number; pens_missed: number;
  }>>(`select s.user_id, l.goals, l.assists, l.own_goals, l.saves, l.yellows, l.reds,
              l.pens_scored, l.pens_missed
       from invasion_match_lines l
       join player_match_stats s on s.id = l.line_id
       where s.fixture_id = $1::uuid and s.superseded_at is null`, t.fixtureId);

  record('a typed football row was written', lines.length > 0, `${lines.length} rows`);

  const col = (id: string) => lines.find((l) => l.user_id === id);
  const expectCol = (label: string, id: string, field: keyof NonNullable<ReturnType<typeof col>>, value: number) => {
    const row = col(id);
    const got = row ? Number(row[field] ?? 0) : null;
    record(label, got === value, `${field} = ${got}, expected ${value}`);
  };

  expectCol('the opening scorer has his goal', A[0].id, 'goals', 1);
  expectCol('the penalty taker has his goal', A[1].id, 'goals', 1);
  expectCol('the assist reached the team-mate', A[1].id, 'assists', 1);
  expectCol('the converted penalty is in the penalty column too', A[1].id, 'pens_scored', 1);
  expectCol('the missed penalty is recorded and is not a goal', A[3].id, 'pens_missed', 1);
  expectCol('and that player has no goal from it', A[3].id, 'goals', 0);
  expectCol('the red card reached the player', A[2].id, 'reds', 1);
  expectCol('the yellow reached the other side', B[2].id, 'yellows', 1);
  expectCol('the keeper has both saves', B[4].id, 'saves', 2);
  expectCol('THE OWN GOAL is against the player who put it in', B[3].id, 'own_goals', 1);
  expectCol('and is NOT counted as a goal for him', B[3].id, 'goals', 0);

  // ---- 5 · the goals in the columns add up to the scoreline ----
  const goalsA = lines.filter((l) => sideOf.get(l.user_id) === 'A')
    .reduce((s, l) => s + Number(l.goals ?? 0), 0);
  const ownGoalsB = lines.filter((l) => sideOf.get(l.user_id) === 'B')
    .reduce((s, l) => s + Number(l.own_goals ?? 0), 0);
  record('THE COLUMNS ADD UP TO THE SCOREBOARD',
    goalsA + ownGoalsB === total[0],
    `${goalsA} goals + ${ownGoalsB} own goals gifted = ${goalsA + ownGoalsB}, scoreboard ${total[0]}`);

  // ---- 6 · every metric reached a column ----
  let unmapped: string[] = [];
  for (const [, stats] of want) {
    const mapped = toCategoryRow('football', stats as Record<string, number>, {});
    for (const k of mapped?.unmapped ?? []) if (!unmapped.includes(k)) unmapped.push(k);
  }
  record('no football metric is dropped for want of a column', unmapped.length === 0,
    unmapped.join(', '));

  // ---- the handover line ----
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`FOOTBALL END TO END · ${pass}/${checks.length} checks passed`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  } else {
    console.log(`\nSIGN IN AND CHECK A PROFILE (password ${PW})`);
    console.log('My Sports Profile → Matches → this match\n');
    for (const id of [A[0].id, A[1].id, A[2].id, B[3].id, B[4].id]) {
      const who = [...A, ...B].find((p) => p.id === id);
      const line = col(id);
      if (!who?.email || !line) continue;
      const bits = Object.entries(line)
        .filter(([k, v]) => k !== 'user_id' && Number(v) > 0)
        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`);
      console.log(`  ${String(who.email).padEnd(22)} ${String(who.name).padEnd(20)} ${bits.join(', ')}`);
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
