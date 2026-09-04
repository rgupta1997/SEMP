/*
 * Prepare one UNSCORED, assigned fixture per draw, and write the list the browser
 * harness walks.
 *
 *   npx tsx scripts/qa-prepare-consoles.ts
 *
 * Separate from qa-all-draws.ts because that one SCORES and LOCKS everything, and a
 * locked scorecard is not what a scoring console looks like. The screens have to be
 * opened in the state an official actually meets them in: generated, assigned, and
 * not yet played.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { canonicalRacquetSport, isCricketSport, statSpecFor } from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const PW = 'Qa@2026';
const OUT = path.join(process.cwd(), '..', 'web', 'scripts', 'qa-consoles.json');

const prisma = new PrismaClient();
const tokens = new Map<string, string>();

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

async function main() {
  await login('organiser@qa.test');
  await login('official@qa.test');
  const me = await call('GET', '/auth/me', undefined, 'official@qa.test');
  const officialId = me.body?.user?.id as string;

  const champ = await prisma.championships.findFirst({
    where: { name: { contains: 'Claude QA All Sports' } },
    select: { id: true, name: true },
  });
  if (!champ) throw new Error('Seed it first: QA_ALL=1 npx tsx scripts/seed-qa-bench.ts seed');

  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { tournaments: { championship_id: champ.id } } },
    select: {
      id: true,
      disciplines: { select: { name: true } },
      tournament_sports: { select: { sports: { select: { name: true } } } },
    },
    orderBy: { display_order: 'asc' },
  });

  const out: Array<Record<string, string>> = [];
  for (const d of draws) {
    const sport = d.tournament_sports?.sports?.name ?? '?';
    const discipline = d.disciplines?.name ?? '-';

    await call('POST', `/tournament-disciplines/${d.id}/fixtures/generate`, {}, 'organiser@qa.test');
    const fx = await call('GET', `/tournament-disciplines/${d.id}/fixtures`, undefined, 'organiser@qa.test');
    const list: any[] = Array.isArray(fx.body) ? fx.body : fx.body?.items ?? [];
    // Unscored, with both sides - the state an official meets a match in.
    const target = list.find((f) => f.home_team_id && f.away_team_id && f.status !== 'completed');
    if (!target) { console.log(`  (skipped ${sport} / ${discipline}: no playable fixture)`); continue; }

    await call('PATCH', `/fixtures/${target.id}/official`, { official_id: officialId }, 'organiser@qa.test');
    out.push({
      sport, discipline, fixtureId: target.id, drawId: d.id,
      engine: canonicalRacquetSport(sport) ? 'racquet'
        : isCricketSport(sport) ? 'cricket'
          : (statSpecFor(sport)?.events.length ?? 0) > 0 ? 'events' : 'result',
    });
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n${out.length} consoles prepared across ${new Set(out.map((o) => o.sport)).size} sports.`);
  console.log(`Written to ${OUT}`);
  console.log(`\nNow: cd ../web && node scripts/qa-all-consoles.mjs`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
