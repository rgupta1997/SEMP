/*
 * REOPENING AND RESCORING - does the career record follow?
 *
 *   npx tsx scripts/qa-rescore-check.ts
 *
 * The one property that matters about a career record: it must be a pure function of
 * the results that are currently official. Not a running total somebody adds to.
 *
 * So this walks a real fixture through the whole correction cycle and checks the
 * record after every step:
 *
 *   locked            -> the result counts
 *   unlocked          -> it stops counting, immediately
 *   rescored + locked -> the NEW result counts, and the old one is not still there
 *   locked twice      -> nothing doubles
 *
 * An incrementing implementation passes the first step and fails the rest, silently,
 * and the failure is permanent because nothing ever recomputes it.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const PW = 'Qa@2026';
const prisma = new PrismaClient();
const tokens = new Map<string, string>();

let failures = 0;
function check(step: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${step}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failures += 1;
}

async function call(method: string, p: string, body?: any, as?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${tokens.get(as)}`;
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function login(email: string) {
  const r = await call('POST', '/auth/login', { email, password: PW });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  tokens.set(email, r.body.token);
}

/** The career row a screen actually reads: this person, this sport, combined. */
async function record(userId: string, sportId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    tier: string; played: number; won: number; lost: number; stats: any;
  }>>(`
    select tier, sum(played)::int as played, sum(won)::int as won, sum(lost)::int as lost,
           (array_agg(stats order by played desc))[1] as stats
    from career_stats
    where user_id = $1::uuid and sport_id = $2::uuid and grain = 'sport'
    group by tier`, userId, sportId);
  const by = new Map(rows.map((r) => [r.tier, r]));
  const all = by.get('all');
  return {
    played: all?.played ?? 0,
    won: all?.won ?? 0,
    lost: all?.lost ?? 0,
    tiers: [...by.keys()].filter((t) => t !== 'all').sort().join('+') || 'none',
    runs: Number((all?.stats ?? {}).runs ?? 0),
  };
}

async function main() {
  await login('organiser@qa.test');
  await login('official@qa.test');

  // A LOCKED cricket fixture with a real stat line - cricket because its figures are
  // rich enough that a stale total would be obvious.
  const [fx] = await prisma.$queryRawUnsafe<Array<{
    fixture_id: string; user_id: string; sport_id: string; email: string; name: string;
  }>>(`
    select m.fixture_id, m.user_id, m.sport_id, u.email, u.name
    from cricket_batting_lines b
    join player_match_stats m on m.id = b.line_id
    join users u on u.id = m.user_id
    join fixtures f on f.id = m.fixture_id
    where b.runs > 0 and f.scorecard_status = 'locked' and u.email like '%@qa.test'
    limit 1`);
  if (!fx) throw new Error('No locked cricket fixture with a batting line - play the QA bench first.');

  console.log(`\n================ REOPEN / RESCORE ================\n`);
  console.log(`${fx.name} (${fx.email}) · fixture ${fx.fixture_id}\n`);

  const locked = await record(fx.user_id, fx.sport_id);
  console.log(`  baseline: ${JSON.stringify(locked)}\n`);
  check('the locked result is on the career record', locked.played > 0, JSON.stringify(locked));
  check('and the tier hierarchy is populated', locked.tiers !== 'none', `tiers=${locked.tiers}`);

  // ---- 1 - unlock -----------------------------------------------------------
  const un = await call('POST', `/fixtures/${fx.fixture_id}/unlock`, { reason: 'QA rescore check' }, 'organiser@qa.test');
  check('the organiser can unlock', un.status === 200 || un.status === 204, `HTTP ${un.status} ${JSON.stringify(un.body).slice(0, 160)}`);

  const after = await record(fx.user_id, fx.sport_id);
  console.log(`  after unlock: ${JSON.stringify(after)}`);
  check('the unlocked result STOPS counting', after.played === locked.played - 1,
    `expected ${locked.played - 1} played, got ${after.played}`);
  check('and its figures go with it', after.runs < locked.runs || locked.runs === 0,
    `runs ${locked.runs} -> ${after.runs}`);

  // ---- 2 - rescore and lock again ------------------------------------------
  const before = await prisma.fixtures.findUnique({
    where: { id: fx.fixture_id },
    select: { home_team_id: true, away_team_id: true, home_score: true, away_score: true, winner_team_id: true },
  });
  // Flip the result, so a stale total is unmistakable rather than a near-miss.
  const flipped = await call('PATCH', `/fixtures/${fx.fixture_id}/result`, {
    home_score: before!.away_score, away_score: before!.home_score,
    status: 'completed', winner_team_id: before!.away_team_id,
  }, 'organiser@qa.test');
  check('a rescore is accepted while unlocked', flipped.status === 200, `HTTP ${flipped.status}`);

  const relock = await call('POST', `/fixtures/${fx.fixture_id}/lock`, {}, 'organiser@qa.test');
  check('and it locks again', relock.status === 200 || relock.status === 204,
    `HTTP ${relock.status} ${JSON.stringify(relock.body?.error?.message ?? relock.body).slice(0, 160)}`);

  const rescored = await record(fx.user_id, fx.sport_id);
  console.log(`  after rescore: ${JSON.stringify(rescored)}`);
  check('the result is back on the record exactly once', rescored.played === locked.played,
    `expected ${locked.played} played, got ${rescored.played}`);
  check('the NEW outcome is the one recorded, not the old one',
    rescored.won !== locked.won || rescored.lost !== locked.lost,
    `was ${locked.won}W ${locked.lost}L, now ${rescored.won}W ${rescored.lost}L - a flipped result should have moved this`);

  // ---- 3 - locking twice must not double anything --------------------------
  const again = await call('POST', `/fixtures/${fx.fixture_id}/lock`, {}, 'organiser@qa.test');
  check('locking an already-locked card is refused', again.status === 400,
    `HTTP ${again.status} - a second lock must not run the pipeline twice`);
  const twice = await record(fx.user_id, fx.sport_id);
  check('and nothing doubled', twice.played === rescored.played,
    `${rescored.played} -> ${twice.played}`);

  // ---- 4 - put it back -----------------------------------------------------
  await call('POST', `/fixtures/${fx.fixture_id}/unlock`, { reason: 'QA restore' }, 'organiser@qa.test');
  await call('PATCH', `/fixtures/${fx.fixture_id}/result`, {
    home_score: before!.home_score, away_score: before!.away_score,
    status: 'completed', winner_team_id: before!.winner_team_id,
  }, 'organiser@qa.test');
  const restored = await call('POST', `/fixtures/${fx.fixture_id}/lock`, {}, 'organiser@qa.test');
  const final = await record(fx.user_id, fx.sport_id);
  check('the original result restores cleanly',
    (restored.status === 200 || restored.status === 204)
      && final.played === locked.played && final.won === locked.won,
    `${JSON.stringify(locked)} -> ${JSON.stringify(final)}`);

  console.log(`\n================ ${failures ? `${failures} FAILED` : 'ALL PASSED'} ================\n`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
