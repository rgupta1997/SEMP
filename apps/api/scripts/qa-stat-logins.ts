/*
 * WHO TO SIGN IN AS, TO SEE A REAL STAT LINE.
 *
 *   npx tsx scripts/qa-stat-logins.ts
 *
 * One player per sport who actually has figures recorded, with the figures printed
 * beside them - so checking the profile screen is "sign in, open this match, expect
 * these numbers" rather than hunting through sixty-five draws for somebody who
 * happened to be attributed something.
 *
 * Reads the QA bench only, and writes nothing.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PW = 'Qa@2026';

interface Pick {
  sport: string;
  discipline: string;
  email: string;
  name: string;
  fixtureId: string;
  stats: Record<string, number>;
}

/** The two or three figures worth printing, biggest first - a headline, not a dump. */
function headline(stats: Record<string, unknown>): string {
  return Object.entries(stats)
    .filter(([k, v]) => typeof v === 'number' && v > 0
      && !['matches', 'wins', 'losses', 'draws'].includes(k))
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
    .join(', ');
}

async function main() {
  const champ = await prisma.championships.findFirst({
    where: { name: { contains: 'Claude QA' } },
    orderBy: { created_at: 'desc' },
    select: { id: true, name: true },
  });
  if (!champ) throw new Error('No QA bench found - seed it first.');

  const rows = await prisma.$queryRawUnsafe<Array<{
    sport: string; discipline: string; email: string; name: string;
    fixture_id: string; stats: any;
  }>>(`
    select distinct on (s.name)
           s.name as sport, di.name as discipline, u.email, u.name,
           m.fixture_id, m.stats
    from player_match_stats m
    join users u on u.id = m.user_id
    join fixtures f on f.id = m.fixture_id
    join tournament_disciplines td on td.id = f.tournament_discipline_id
    join tournament_sports ts on ts.id = td.tournament_sport_id
    join tournaments t on t.id = ts.tournament_id
    join sports s on s.id = ts.sport_id
    join disciplines di on di.id = td.discipline_id
    where t.championship_id = $1::uuid
      and m.played
      and m.stats <> '{}'::jsonb
      and m.superseded_at is null
      and u.email like '%@qa.test'
    order by s.name, jsonb_array_length(coalesce(jsonb_path_query_array(m.stats, '$.*'), '[]'::jsonb)) desc
  `, champ.id);

  const picks: Pick[] = rows.map((r) => ({
    sport: r.sport, discipline: r.discipline, email: r.email, name: r.name,
    fixtureId: r.fixture_id, stats: (r.stats ?? {}) as Record<string, number>,
  }));

  console.log(`\n${champ.name}`);
  console.log(`Championship  /championships/${champ.id}`);
  console.log(`Password for every account below: ${PW}\n`);
  console.log('Sign in, then open Profile > Matches > the named match. "Your statistics" is on that page.\n');

  const w = { s: 15, e: 20, n: 17 };
  console.log(`${'SPORT'.padEnd(w.s)} ${'LOGIN'.padEnd(w.e)} ${'PLAYER'.padEnd(w.n)} FIGURES ON THEIR MATCH PAGE`);
  console.log('-'.repeat(112));
  for (const p of picks) {
    console.log(
      `${p.sport.slice(0, w.s).padEnd(w.s)} ${p.email.padEnd(w.e)} ${p.name.slice(0, w.n).padEnd(w.n)} ${headline(p.stats)}`,
    );
  }
  console.log('-'.repeat(112));
  console.log(`\n${picks.length} sports, one player each, all with figures recorded.`);
  console.log('\nDirect links to the exact match page (same password):');
  for (const p of picks.slice(0, 6)) {
    console.log(`  ${p.sport.padEnd(15)} ${p.email.padEnd(20)} /profile/matches/${p.fixtureId}`);
  }
  console.log(`  ... and ${Math.max(0, picks.length - 6)} more; every one is reachable from Profile > Matches.`);

  console.log('\nStaff logins for the same championship:');
  console.log('  organiser@qa.test    Priya Menon   organiser - Setup, Schedule, Results, Standings');
  console.log('  official@qa.test     Rahul Das     official  - scores the matches assigned to them');
  console.log('  captain@qa.test      Neha Pillai   captain   - Riverside squads');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
