import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const champId = JSON.parse(readFileSync(path.join(HERE, '.seed-iimb-manifest.json'), 'utf8')).championships[0];
const BASE = 'http://localhost:4000/api';

async function main() {
  // login as the seeded host (super admin)
  let t = Date.now();
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'seed.host@iimb.test', password: 'Passw0rd!' }) });
  const loginMs = Date.now() - t;
  if (!login.ok) throw new Error('login failed: ' + login.status + ' ' + await login.text());
  const { token } = await login.json();
  const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  console.log('login:', loginMs, 'ms  (token ok)');

  // pick a scheduled two-team fixture
  const fx = await prisma.fixtures.findFirst({
    where: { status: 'scheduled', home_team_id: { not: null }, away_team_id: { not: null }, tournament_disciplines: { tournament_sports: { tournaments: { championship_id: champId } } } },
    select: { id: true, home_team_id: true },
  });
  if (!fx) throw new Error('no scorable fixture');

  // GET scoring console payload (what the console loads)
  t = Date.now();
  const scoring = await fetch(`${BASE}/fixtures/${fx.id}/scoring`, { headers: H });
  const scoringMs = Date.now() - t;
  console.log('GET /scoring:', scoringMs, 'ms  (status', scoring.status + ')');

  // point taps via the REAL /live endpoint (update + standings recompute server-side)
  const taps: number[] = [];
  for (let i = 1; i <= 8; i++) {
    const body = JSON.stringify({ live_state: { a: i, b: i - 1, seg: 1 }, live_log: [], home_score: i, away_score: i - 1, status: 'live' });
    const t0 = Date.now();
    const r = await fetch(`${BASE}/fixtures/${fx.id}/live`, { method: 'PATCH', headers: H, body });
    if (!r.ok) throw new Error('tap failed: ' + r.status + ' ' + await r.text());
    taps.push(Date.now() - t0);
  }

  // submit / sign-off
  t = Date.now();
  const submit = await fetch(`${BASE}/fixtures/${fx.id}/live`, { method: 'PATCH', headers: H, body: JSON.stringify({ live_state: { a: 8, b: 7, seg: 1 }, live_log: [], home_score: 8, away_score: 7, status: 'completed', winner_team_id: fx.home_team_id }) });
  const submitMs = Date.now() - t;
  if (!submit.ok) throw new Error('submit failed: ' + submit.status);

  // restore
  await prisma.fixtures.update({ where: { id: fx.id }, data: { status: 'scheduled', home_score: null, away_score: null, winner_team_id: null, live_state: {} } });

  const s = [...taps].sort((a, b) => a - b);
  console.log('\nPOINT TAP  (HTTP PATCH /fixtures/:id/live):', { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] }, 'ms  (n=8)');
  console.log('SUBMIT     (HTTP, status=completed)       :', submitMs, 'ms');
  console.log('\nNote: each tap round-trips HTTP + DB write + full standings recompute. The web console fires these in the background (optimistic UI), so the score updates on screen instantly; only sign-off blocks on the response.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
