/*
 * THE CRICKET BENCH — one fresh, assigned fixture per cricket format on the shelf.
 *
 *   npx tsx scripts/qa-cricket-bench.ts            # prepare and print
 *   npx tsx scripts/qa-cricket-bench.ts --print    # just print what is already set up
 *
 * Why this exists separately from qa-prepare-consoles.ts: that one prepares ONE
 * fixture per draw, which for cricket means one match under whatever format the
 * sport defaults to. Cricket's whole risk surface is the FORMAT - a four-ball over,
 * a two-run wide, a last batter who bats alone, a bowler capped at one over - and
 * none of that is exercised by a single default T20.
 *
 * So this pins a real format onto a real fixture, one per preset, and hands back the
 * console URL and the logins. Scoring them is then a person's job, or the browser
 * harness's.
 *
 * It WRITES: it creates org formats, attaches them to fixtures, assigns the official
 * and clears any half-scored live_state on the fixtures it picks. It only ever
 * touches fixtures in the QA bench championship.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { cricketPresetByKey } from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const PW = 'Qa@2026';
const OUT = path.join(process.cwd(), '..', 'web', 'scripts', 'qa-cricket.json');

const prisma = new PrismaClient();
const tokens = new Map<string, string>();

/**
 * One row per format worth proving, and the sport whose draws can carry it.
 *
 * `ballByBall` is forced on the box presets. They ship declaring `entryMode:
 * 'summary'` - a defensible default for a corporate game nobody can staff, and the
 * reason the console opens the TOTALS FORM rather than the deck for them. A bench
 * for testing the deck has to ask for the deck, so the override is explicit here
 * rather than hidden; the last row keeps one summary match so that path is covered
 * too.
 */
const WANTED: Array<{
  preset: string; sport: 'Cricket' | 'Box Cricket'; why: string;
  entryMode?: 'ballByBall' | 'summary'; suffix?: string;
}> = [
  { preset: 'cricket_t20', sport: 'Cricket', why: '20 overs, 6-ball, max 4 an over, free hit, super over on a tie' },
  { preset: 'cricket_super_over', sport: 'Cricket', why: 'one over a side, TWO wickets end the innings' },
  { preset: 'box_6ov_8', sport: 'Box Cricket', entryMode: 'ballByBall', suffix: 'ball by ball',
    why: '6 overs, 8 a side, 7 wickets, max 2 an over' },
  { preset: 'box_5ov_6_lms', sport: 'Box Cricket', entryMode: 'ballByBall', suffix: 'ball by ball',
    why: 'LAST MAN STANDS — 6 a side, the last batter bats alone' },
  { preset: 'box_4ov_4ball', sport: 'Box Cricket', entryMode: 'ballByBall', suffix: 'ball by ball',
    why: 'FOUR-BALL overs and a TWO-RUN wide' },
  { preset: 'box_6ov_8', sport: 'Box Cricket', entryMode: 'summary', suffix: 'totals only',
    why: 'the SUMMARY path — a totals form, no ball log, no player attribution' },
];

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

interface Prepared {
  preset: string;
  formatName: string;
  entryMode: string;
  why: string;
  sport: string;
  discipline: string;
  fixtureId: string;
  drawId: string;
  home: string;
  away: string;
  homeSquad: Array<{ id: string; name: string; email: string | null }>;
  awaySquad: Array<{ id: string; name: string; email: string | null }>;
  url: string;
}

async function teamName(teamId: string | null): Promise<string> {
  if (!teamId) return '—';
  const row = await prisma.teams.findUnique({ where: { id: teamId }, select: { name: true } });
  return row?.name ?? '—';
}

async function squadOf(teamId: string | null) {
  if (!teamId) return [];
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; email: string | null }>>(`
    select u.id, u.name, u.email
    from team_members m join users u on u.id = m.user_id
    where m.team_id = $1::uuid
    order by u.name`, teamId);
  return rows;
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

  // Every cricket draw in the bench, with its sport, so a format can be put on a
  // fixture whose sport the format actually belongs to.
  const draws = await prisma.$queryRawUnsafe<Array<{
    draw_id: string; sport: string; sport_id: string; discipline: string;
  }>>(`
    select td.id as draw_id, s.name as sport, s.id as sport_id, di.name as discipline
    from tournament_disciplines td
    join disciplines di on di.id = td.discipline_id
    join tournament_sports ts on ts.id = td.tournament_sport_id
    join sports s on s.id = ts.sport_id
    join tournaments t on t.id = ts.tournament_id
    where t.championship_id = $1::uuid and lower(s.name) in ('cricket', 'box cricket')
    order by s.name, di.name`, champ.id);

  const prepared: Prepared[] = [];
  const used = new Set<string>();

  for (const want of WANTED) {
    const base = cricketPresetByKey(want.preset);
    if (!base) { console.log(`  ! no such preset: ${want.preset}`); continue; }
    // A varied preset is no longer that preset, so the key is dropped with the change
    // - otherwise a later lookup resolves back to the shipped rules and the override
    // silently disappears.
    const preset = want.entryMode && want.entryMode !== base.entryMode
      ? { ...base, entryMode: want.entryMode, presetKey: undefined }
      : base;

    const pool = draws.filter((d) => d.sport.toLowerCase() === want.sport.toLowerCase());
    let picked: { draw: typeof draws[number]; fixture: any } | null = null;

    for (const draw of pool) {
      const fx = await call('GET', `/tournament-disciplines/${draw.draw_id}/fixtures`, undefined, 'organiser@qa.test');
      const list: any[] = Array.isArray(fx.body) ? fx.body : fx.body?.items ?? [];
      // DETERMINISTIC, and completed matches included.
      //
      // Picking "the first fixture that is not yet completed" made the bench
      // single-use: a second run found the first one played and locked, silently
      // moved to a different match, and left the previous run's format pinned to a
      // fixture the new sheet now described differently. Sorting by id and taking
      // whatever is not yet claimed THIS run means the same preset lands on the same
      // fixture every time; anything in the way is unlocked and wiped below.
      const target = list
        .filter((f) => f.home_team_id && f.away_team_id && !used.has(f.id))
        .sort((x, y) => String(x.id).localeCompare(String(y.id)))[0];
      if (!target) continue;
      picked = { draw, fixture: target };
      break;
    }
    if (!picked) { console.log(`  ! no free ${want.sport} fixture for ${want.preset}`); continue; }
    used.add(picked.fixture.id);

    const formatName = `QA · ${base.name}${want.suffix ? ` · ${want.suffix}` : ''}`;
    if (!printOnly) {
      // A locked scorecard refuses a format change and refuses a score - correctly,
      // since a locked result is immutable. For a BENCH that is just an obstacle, so
      // it is unlocked with a reason that lands in the audit trail like any other.
      const un = await call('POST', `/fixtures/${picked.fixture.id}/unlock`,
        { reason: 'QA cricket bench reset' }, 'organiser@qa.test');
      if (un.status >= 400 && un.status !== 404) {
        const msg = un.body?.error?.message ?? '';
        // "not locked" is the state we wanted anyway.
        if (!/not locked|already/i.test(msg)) console.log(`  · unlock ${want.preset}: ${un.status} ${msg}`);
      }

      // Save the format against the host org, then pin it to this fixture. Reusing a
      // name is a 400 by design, so an existing one is found and used instead.
      let formatId: string | null = null;
      const made = await call('POST', `/tournament-disciplines/${picked.draw.draw_id}/scoring-formats`,
        { name: formatName, sportId: picked.draw.sport_id, ...(preset.presetKey ? { presetKey: preset.presetKey } : {}), config: preset },
        'organiser@qa.test');
      if (made.status === 201) formatId = made.body?.id ?? null;
      if (!formatId) {
        // `saved` is the key - guessing at `formats`/`items` silently produced an
        // empty list, so the lookup always failed and the fixture kept whatever
        // format a previous run had pinned to it.
        const shelf = await call('GET', `/tournament-disciplines/${picked.draw.draw_id}/scoring-formats`,
          undefined, 'organiser@qa.test');
        const rows: any[] = Array.isArray(shelf.body?.saved) ? shelf.body.saved : [];
        formatId = rows.find((r) => r.name === formatName)?.id ?? null;
        if (!formatId) {
          console.log(`  ! ${want.preset}: "${formatName}" is not on the shelf `
            + `(${rows.length} saved formats: ${rows.map((r) => r.name).join(' | ')})`);
        }
      }
      if (!formatId) console.log(`  ! could not save the format for ${want.preset}: ${JSON.stringify(made.body)}`);

      // A half-scored fixture would open on somebody else's innings, and a frozen
      // format snapshot would override the one being pinned.
      await prisma.$executeRawUnsafe(`
        update fixtures
        set live_state = '{}'::jsonb, live_log = '[]'::jsonb,
            home_score = null, away_score = null, winner_team_id = null,
            status = 'scheduled'
        where id = $1::uuid`, picked.fixture.id);

      if (formatId) {
        const r = await call('PATCH', `/fixtures/${picked.fixture.id}/scoring-format`,
          { scoringFormatId: formatId }, 'organiser@qa.test');
        if (r.status !== 200) console.log(`  ! pin ${want.preset}: ${r.status} ${JSON.stringify(r.body)}`);
      }
      await call('PATCH', `/fixtures/${picked.fixture.id}/official`, { official_id: officialId }, 'organiser@qa.test');
    }

    // THE TEAM IDS COME FROM THE FIXTURE ROW, not from the list payload.
    //
    // The list is a view assembled for a screen and its team fields are not the
    // fixture's own columns; trusting them put one bench entry's squad against
    // another fixture's teams, so the end-to-end harness scored a ball log naming
    // eleven people who were not participants - they got no detail rows, and the
    // eleven who were became "strangers".
    const row = await prisma.fixtures.findUnique({
      where: { id: picked.fixture.id },
      select: { home_team_id: true, away_team_id: true },
    });

    prepared.push({
      preset: want.preset,
      formatName: `${base.name}${want.suffix ? ` · ${want.suffix}` : ''}`,
      entryMode: preset.entryMode,
      why: want.why,
      sport: picked.draw.sport,
      discipline: picked.draw.discipline,
      fixtureId: picked.fixture.id,
      drawId: picked.draw.draw_id,
      home: await teamName(row?.home_team_id ?? null),
      away: await teamName(row?.away_team_id ?? null),
      homeSquad: await squadOf(row?.home_team_id ?? null),
      awaySquad: await squadOf(row?.away_team_id ?? null),
      url: `${WEB}/score/${picked.fixture.id}`,
    });
  }

  writeFileSync(OUT, JSON.stringify(prepared, null, 2));

  // ---- the handover sheet ----
  console.log(`\n${champ.name}`);
  console.log(`Championship  ${WEB}/championships/${champ.id}`);
  console.log(`\nSIGN IN AS (password for every account: ${PW})`);
  console.log(`  official@qa.test    scores the matches below — this is the one to use`);
  console.log(`  organiser@qa.test   changes the format, locks the result, reads standings`);

  for (const p of prepared) {
    console.log(`\n${'='.repeat(78)}`);
    console.log(`${p.sport} · ${p.discipline} — ${p.formatName}`);
    console.log(`  ${p.why}`);
    console.log(`  entry: ${p.entryMode === 'summary' ? 'TOTALS FORM (Manual tab)' : 'BALL BY BALL (Detailed tab)'}`);
    console.log(`  ${p.home}  v  ${p.away}`);
    console.log(`  CONSOLE  ${p.url}`);
    const line = (who: string, squad: Prepared['homeSquad']) => {
      if (!squad.length) { console.log(`  ${who}: (no squad)`); return; }
      console.log(`  ${who} (${squad.length}):`);
      for (const s of squad) console.log(`      ${(s.email ?? '—').padEnd(34)} ${s.name}`);
    };
    line(p.home, p.homeSquad);
    line(p.away, p.awaySquad);
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('TO CHECK A PLAYER\'S FIGURES after scoring a match:');
  console.log('  1. organiser@qa.test → the fixture → Lock the result (stats are written at lock time)');
  console.log('  2. sign in as any player listed above');
  console.log('  3. Profile → Matches → the match → "Your statistics"');
  console.log(`\nWritten: ${OUT}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
