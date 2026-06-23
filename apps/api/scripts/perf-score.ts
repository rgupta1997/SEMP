import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { recomputeStandingsForFixture } from '../src/modules/standings/standings.service.js';

const prisma = new PrismaClient();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const champId = JSON.parse(readFileSync(path.join(HERE, '.seed-iimb-manifest.json'), 'utf8')).championships[0];

const ms = (t: number) => `${(Date.now() - t)}ms`;
function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
}

async function main() {
  // a scheduled, two-team fixture to score
  const fx = await prisma.fixtures.findFirst({
    where: { status: 'scheduled', home_team_id: { not: null }, away_team_id: { not: null }, tournament_disciplines: { tournament_sports: { tournaments: { championship_id: champId } } } },
    select: { id: true, home_score: true, away_score: true, status: true, live_state: true },
  });
  if (!fx) throw new Error('no scorable fixture found');
  console.log('scoring fixture', fx.id, '\n');

  // warm the connection / query plans
  await recomputeStandingsForFixture(prisma as any, fx.id);

  // 1) a bare point-tap WRITE only (no standings) - the raw persistence cost
  const writeOnly: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const t = Date.now();
    await prisma.$executeRaw`update fixtures set live_state = ${JSON.stringify({ a: i, b: i - 1, seg: 1 })}::jsonb, home_score = ${i}, away_score = ${i - 1}, updated_at = now() where id = ${fx.id}::uuid`;
    writeOnly.push(Date.now() - t);
  }

  // 2) a full point-tap as the /live endpoint does it: update + standings recompute
  const tap: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const t = Date.now();
    await prisma.fixtures.update({ where: { id: fx.id }, data: { home_score: i, away_score: i - 1, status: 'live' } });
    await recomputeStandingsForFixture(prisma as any, fx.id);
    tap.push(Date.now() - t);
  }

  // 3) sign-off / submit: complete + recompute
  const tSubmit = Date.now();
  await prisma.fixtures.update({ where: { id: fx.id }, data: { status: 'completed', winner_team_id: (await prisma.fixtures.findUnique({ where: { id: fx.id }, select: { home_team_id: true } }))!.home_team_id } });
  await recomputeStandingsForFixture(prisma as any, fx.id);
  const submitMs = Date.now() - tSubmit;

  // restore the fixture so the seed stays pristine
  await prisma.fixtures.update({ where: { id: fx.id }, data: { status: 'scheduled', home_score: null, away_score: null, winner_team_id: null, live_state: {} } });
  await recomputeStandingsForFixture(prisma as any, fx.id);

  const fixtureCount = await prisma.fixtures.count({ where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: champId } } } } });
  console.log('fixtures in championship:', fixtureCount);
  console.log('\n1) WRITE only (point tap persistence, no standings):', stats(writeOnly), 'ms');
  console.log('2) FULL point tap  (update + standings recompute)   :', stats(tap), 'ms');
  console.log('3) SUBMIT / sign-off (complete + recompute)         :', submitMs, 'ms');
  console.log('\nThe recompute dominates: every score change rebuilds ALL standings for the championship.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
