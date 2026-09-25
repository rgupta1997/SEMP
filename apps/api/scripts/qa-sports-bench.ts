/*
 * THE ALL-SPORTS BENCH — one fresh, assigned, scoreable fixture per sport.
 *
 *   npx tsx scripts/qa-sports-bench.ts            # prepare and print
 *   npx tsx scripts/qa-sports-bench.ts --print    # print what is already set up
 *
 * The cricket bench proved five cricket formats. This does the same job for
 * everything else on the shelf: every racquet sport, every net, invasion, raid,
 * board and combat sport, and the measured/ranking sports.
 *
 * It is DETERMINISTIC and REPEATABLE - the same sport lands on the same fixture
 * every run, and anything in the way is unlocked and wiped. The old
 * qa-consoles.json was written once, months ago, against fixture ids that have
 * since been re-seeded; 62 of its 65 entries now open the marketing site instead of
 * a console, which reads as "the product is broken" when it is the list that is
 * stale. A bench nobody can re-run is a bench nobody trusts.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  canonicalRacquetSport, isCricketSport, isKernelSport, isRankingSport,
  statSpecFor, tieTemplateFor,
} from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const PW = 'Qa@2026';
const OUT = path.join(process.cwd(), '..', 'web', 'scripts', 'qa-sports.json');

const prisma = new PrismaClient();
const tokens = new Map<string, string>();

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

/**
 * Which console a sport opens, resolved exactly the way MatchConsolePage resolves it.
 *
 * Duplicating the ladder here would be a second source of truth that drifts; these
 * are the same predicates the page calls, in the same order.
 */
function engineOf(sport: string): string {
  if (isRankingSport(sport)) return 'event';
  if (isCricketSport(sport)) return 'cricket';
  if (canonicalRacquetSport(sport)) return 'racquet';
  if (isKernelSport(sport)) return 'team';
  return 'result';
}

interface Prepared {
  sport: string;
  discipline: string;
  engine: string;
  /** 'single' | 'tie' - which structure tab this bench entry is for. */
  structure: string;
  hasTieTemplate: boolean;
  hasStatSpec: boolean;
  fixtureId: string;
  drawId: string;
  home: string;
  away: string;
  homeSquad: Array<{ id: string; name: string; email: string | null }>;
  awaySquad: Array<{ id: string; name: string; email: string | null }>;
  url: string;
}

async function teamName(id: string | null): Promise<string> {
  if (!id) return '—';
  return (await prisma.teams.findUnique({ where: { id }, select: { name: true } }))?.name ?? '—';
}

async function squadOf(teamId: string | null) {
  if (!teamId) return [];
  return prisma.$queryRawUnsafe<Array<{ id: string; name: string; email: string | null }>>(`
    select u.id, u.name, u.email
    from team_members m join users u on u.id = m.user_id
    where m.team_id = $1::uuid order by u.name limit 12`, teamId);
}

async function main() {
  const printOnly = process.argv.includes('--print');
  await login('organiser@qa.test');
  await login('official@qa.test');
  const me = await call('GET', '/auth/me', undefined, 'official@qa.test');
  const officialId = me.body?.user?.id as string;
  if (!officialId) throw new Error('could not resolve the official');

  const champ = await prisma.championships.findFirst({
    where: { name: { contains: 'Claude QA All Sports' } },
    select: { id: true, name: true },
  });
  if (!champ) throw new Error('Seed it first: QA_ALL=1 npx tsx scripts/seed-qa-bench.ts seed');

  // One draw per SPORT - the first by name, deterministically. A sport with six
  // disciplines does not need six benches; it needs one that is definitely fresh.
  const draws = await prisma.$queryRawUnsafe<Array<{
    draw_id: string; sport: string; discipline: string; structure: string;
  }>>(`
    select distinct on (s.name) td.id as draw_id, s.name as sport, di.name as discipline,
           'single' as structure
    from tournament_disciplines td
    join disciplines di on di.id = td.discipline_id
    join tournament_sports ts on ts.id = td.tournament_sport_id
    join sports s on s.id = ts.sport_id
    join tournaments t on t.id = ts.tournament_id
    where t.championship_id = $1::uuid
    order by s.name, di.name`, champ.id);

  // A TEAM TIE NEEDS A TEAM DISCIPLINE.
  //
  // The console only offers the Team tie tab when the DISCIPLINE is a team entry -
  // a Men's Doubles draw is one contest between two pairs, not five rubbers, and
  // offering the tie there once asked an official to score Women's Doubles inside a
  // men's singles match. So the tie console is unreachable from the draws above,
  // and testing it means picking a draw that can actually carry one.
  const tieDraws = await prisma.$queryRawUnsafe<Array<{
    draw_id: string; sport: string; discipline: string; structure: string;
  }>>(`
    select distinct on (s.name) td.id as draw_id, s.name as sport, di.name as discipline,
           'tie' as structure
    from tournament_disciplines td
    join disciplines di on di.id = td.discipline_id
    join tournament_sports ts on ts.id = td.tournament_sport_id
    join sports s on s.id = ts.sport_id
    join tournaments t on t.id = ts.tournament_id
    where t.championship_id = $1::uuid and di.entry_type = 'team'
    order by s.name, di.name`, champ.id);

  for (const d of tieDraws) {
    if (!tieTemplateFor(d.sport)) continue;          // only sports with a tie shelf
    if (draws.some((x) => x.draw_id === d.draw_id)) continue;
    draws.push(d);
  }

  const prepared: Prepared[] = [];
  const skipped: string[] = [];

  for (const draw of draws) {
    const fx = await call('GET', `/tournament-disciplines/${draw.draw_id}/fixtures`, undefined, 'organiser@qa.test');
    const list: any[] = Array.isArray(fx.body) ? fx.body : fx.body?.items ?? [];
    // Deterministic: sorted by id, first with two real sides. Completed and locked
    // ones are INCLUDED and reset below, so a second run picks the same fixture
    // rather than drifting onto a different one each time.
    // A RANKING SPORT HAS NO TWO SIDES. A medal table is not a head-to-head, and the
    // console's own guard relaxes the "both teams set" rule for these - so requiring
    // two sides here skipped swimming, athletics and powerlifting entirely, which is
    // how the one console that produces the medal table ended up with no bench.
    const needsTwoSides = !isRankingSport(draw.sport);
    const target = list
      .filter((f) => (needsTwoSides ? (f.home_team_id && f.away_team_id) : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (!target) {
      skipped.push(`${draw.sport} (${needsTwoSides ? 'no fixture with two sides' : 'no fixture at all'})`);
      continue;
    }

    if (!printOnly) {
      const un = await call('POST', `/fixtures/${target.id}/unlock`,
        { reason: 'QA all-sports bench reset' }, 'organiser@qa.test');
      if (un.status >= 400 && !/not locked|already/i.test(un.body?.error?.message ?? '')) {
        console.log(`  · ${draw.sport}: unlock ${un.status} ${un.body?.error?.message ?? ''}`);
      }
      await prisma.$executeRawUnsafe(`
        update fixtures
        set live_state = '{}'::jsonb, live_log = '[]'::jsonb,
            home_score = null, away_score = null, winner_team_id = null,
            status = 'scheduled'
        where id = $1::uuid`, target.id);
      await call('PATCH', `/fixtures/${target.id}/official`, { official_id: officialId }, 'organiser@qa.test');
    }

    const row = await prisma.fixtures.findUnique({
      where: { id: target.id },
      select: { home_team_id: true, away_team_id: true },
    });

    prepared.push({
      sport: draw.sport,
      discipline: draw.discipline,
      structure: draw.structure ?? 'single',
      engine: engineOf(draw.sport),
      hasTieTemplate: !!tieTemplateFor(draw.sport),
      hasStatSpec: !!statSpecFor(draw.sport),
      fixtureId: target.id,
      drawId: draw.draw_id,
      home: await teamName(row?.home_team_id ?? null),
      away: await teamName(row?.away_team_id ?? null),
      homeSquad: await squadOf(row?.home_team_id ?? null),
      awaySquad: await squadOf(row?.away_team_id ?? null),
      url: `${WEB}/score/${target.id}`,
    });
  }

  writeFileSync(OUT, JSON.stringify(prepared, null, 2));

  const byEngine = new Map<string, Prepared[]>();
  for (const p of prepared) {
    if (!byEngine.has(p.engine)) byEngine.set(p.engine, []);
    byEngine.get(p.engine)!.push(p);
  }

  console.log(`\n${champ.name}`);
  console.log(`Championship  ${WEB}/championships/${champ.id}`);
  console.log(`\nSIGN IN AS (password for every account: ${PW})`);
  console.log('  official@qa.test    scores every match below');
  console.log('  organiser@qa.test   locks the result, reads standings\n');

  for (const [engine, rows] of [...byEngine.entries()].sort()) {
    console.log(`${'='.repeat(78)}`);
    console.log(`${engine.toUpperCase()} console — ${rows.length} sport${rows.length === 1 ? '' : 's'}`);
    for (const r of rows) {
      const flags = [
        r.hasStatSpec || r.engine === 'cricket' || r.engine === 'event' ? '' : 'NO STAT SPEC',
        r.hasTieTemplate ? 'tie available' : '',
      ].filter(Boolean).join(', ');
      console.log(`  ${r.sport.padEnd(16)} ${r.discipline.padEnd(16)} ${r.home} v ${r.away}`
        + `  squads ${r.homeSquad.length}/${r.awaySquad.length}`
        + `${r.structure === 'tie' ? '  [TEAM TIE]' : ''}${flags ? `  [${flags}]` : ''}`);
      console.log(`  ${''.padEnd(16)} ${r.url}`);
    }
    console.log('');
  }

  if (skipped.length) {
    console.log(`SKIPPED (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  console.log(`\n${prepared.length} sports prepared. Written: ${OUT}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
