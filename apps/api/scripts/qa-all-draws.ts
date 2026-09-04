/*
 * EVERY DRAW, EVERY SPORT - over real HTTP.
 *
 *   npx tsx scripts/qa-all-draws.ts
 *
 * The other harness covers the lifecycle deeply on six draws, one per scoring
 * engine. This one covers it BROADLY: all 65 draws across all 27 scored sports, each
 * one taken from an empty draw to a locked result with a per-player stat line.
 *
 * The question it answers is the one a deep test cannot: does each SPORT work, not
 * just each code path. A sport can share an engine and still be broken by its own
 * shelf, its own squad size, its own discipline shape, or - the actual bug this
 * found - having no per-player actions in the registry at all.
 *
 * Scores each draw through the engine its family really uses:
 *   racquet  - a rally log, point by point
 *   cricket  - a ball log through cricket's own engine
 *   other    - an attributed event log (goal, by Aarav, assisted by Kabir) plus the
 *              scoreline, which is how the period decks record
 *
 * Runs against the QA bench only. Never point it at the user's bench.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  ALL_STAT_SPECS, COLUMN_MAP, FAMILY_TABLE, canonicalRacquetSport, isCricketSport,
  matchPresetsFor, statSpecFor, toCategoryRow,
} from '@semp/shared';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';
const PW = 'Qa@2026';
const ORG = 'organiser@qa.test';
const OFF = 'official@qa.test';

const prisma = new PrismaClient();
const tokens = new Map<string, string>();

interface Res { status: number; body: any }

async function call(method: string, path: string, body?: any, as?: string): Promise<Res> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${tokens.get(as)}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
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

/** One row per draw, so the report reads like a results table. */
interface Row {
  sport: string;
  discipline: string;
  engine: 'racquet' | 'cricket' | 'events' | 'result';
  presets: number;
  fixtures: number;
  scored: boolean;
  locked: boolean;
  detailRows: number;
  statLine: string;
  note: string;
}

const rows: Row[] = [];
const problems: string[] = [];

const err = (row: Row, what: string) => {
  problems.push(`${row.sport} / ${row.discipline}: ${what}`);
  row.note = row.note ? `${row.note}; ${what}` : what;
};

/**
 * Every column the mapper can emit must EXIST in its table.
 *
 * This is a pure-vs-schema check, and it is here because the pure tests cannot do
 * it: `category-lines.test.ts` proves every metric has a mapping, and proved
 * nothing about whether the mapping named a real column. `combat_match_lines` had
 * no `position` column while the mapper emitted one, so every insert in that family
 * failed inside a best-effort try/catch - and boxing, judo, wrestling, taekwondo,
 * arm wrestling, tug of war and fencing all silently recorded nothing at all.
 */
async function preflightColumns(): Promise<string[]> {
  const bad: string[] = [];
  const actual = new Map<string, Set<string>>();
  for (const [family, table] of Object.entries(FAMILY_TABLE)) {
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns where table_name = $1`, table);
    if (!cols.length) { bad.push(`${table} does not exist`); continue; }
    actual.set(family, new Set(cols.map((c) => c.column_name)));
  }

  // What the mapping itself names.
  for (const [family, map] of Object.entries(COLUMN_MAP)) {
    const have = actual.get(family);
    if (!have) continue;
    for (const target of Object.values(map)) {
      const column = typeof target === 'string' ? target : target.column;
      // The two colour booleans are folded into `colour` and never written as-is.
      if (column === 'colour_is_white' || column === 'colour_is_black') continue;
      if (!have.has(column)) bad.push(`${FAMILY_TABLE[family as keyof typeof FAMILY_TABLE]}.${column} (mapped, missing)`);
    }
  }

  // And what the EXTRAS add - position, rubber_key, weight_class and the rest. Those
  // bypass COLUMN_MAP entirely, which is exactly how `position` slipped through.
  for (const spec of ALL_STAT_SPECS) {
    const mapped = toCategoryRow(spec.sport, {}, {
      position: 'x', rubber_key: 'x', partner_user_id: null, colour: 'white',
      weight_class: 'x', side_used: 'left', win_by: 'x', opponent_user_id: null,
    });
    if (!mapped) continue;
    const have = actual.get(mapped.family);
    if (!have) continue;
    for (const column of Object.keys(mapped.row)) {
      if (!have.has(column)) bad.push(`${mapped.table}.${column} (emitted for ${spec.sport}, missing)`);
    }
  }
  return [...new Set(bad)];
}

async function main() {
  const schemaGaps = await preflightColumns();
  if (schemaGaps.length) {
    console.log('\nSCHEMA / MAPPING MISMATCH - these inserts would fail silently:');
    for (const g of schemaGaps) console.log(`  - ${g}`);
    problems.push(...schemaGaps.map((g) => `schema: ${g}`));
  } else {
    console.log('\nPreflight: every mapped and emitted column exists in its table.');
  }

  await login(ORG);
  await login(OFF);
  const offMe = await call('GET', '/auth/me', undefined, OFF);
  const officialId = offMe.body?.user?.id as string;

  // QA_CHAMP names a different QA championship - the intra one, say. Defaults to the
  // all-sports bench.
  const wanted = process.env.QA_CHAMP ?? 'Claude QA All Sports';
  const champ = await prisma.championships.findFirst({
    where: { name: { contains: wanted } },
    select: { id: true, name: true },
  });
  if (!champ) throw new Error(`No championship matching "${wanted}". Seed it first.`);
  console.log(`\n${champ.name}\n${'='.repeat(78)}\n`);

  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { tournaments: { championship_id: champ.id } } },
    select: {
      id: true, squad_min: true,
      disciplines: { select: { name: true } },
      tournament_sports: { select: { sports: { select: { name: true } } } },
    },
    orderBy: { display_order: 'asc' },
  });

  for (const d of draws) {
    const sport = d.tournament_sports?.sports?.name ?? '?';
    const discipline = d.disciplines?.name ?? '-';
    const racquet = canonicalRacquetSport(sport);
    const cricket = isCricketSport(sport);
    const spec = statSpecFor(sport);
    const hasEvents = (spec?.events.length ?? 0) > 0;
    const row: Row = {
      sport, discipline,
      engine: racquet ? 'racquet' : cricket ? 'cricket' : hasEvents ? 'events' : 'result',
      presets: matchPresetsFor(sport).length,
      fixtures: 0, scored: false, locked: false, detailRows: 0, statLine: '', note: '',
    };
    rows.push(row);

    // ---- the shelf, before anything is generated --------------------------
    const shelf = await call('GET', `/tournament-disciplines/${d.id}/scoring-formats`, undefined, ORG);
    if (shelf.status !== 200) err(row, `shelf HTTP ${shelf.status}`);
    else {
      if (shelf.body?.supported !== true) err(row, 'shelf says the sport is unsupported');
      if (!(shelf.body?.presets?.length > 0)) err(row, 'shelf offered no presets');
      if (!(shelf.body?.rounds?.length > 0)) err(row, 'no rounds offered pre-generation');
    }

    // ---- generate ---------------------------------------------------------
    const gen = await call('POST', `/tournament-disciplines/${d.id}/fixtures/generate`, {}, ORG);
    const fxRes = await call('GET', `/tournament-disciplines/${d.id}/fixtures`, undefined, ORG);
    const fixtures: any[] = Array.isArray(fxRes.body) ? fxRes.body : fxRes.body?.items ?? [];
    row.fixtures = fixtures.length;
    if (!fixtures.length) { err(row, `generate HTTP ${gen.status}, no fixtures`); continue; }

    // The match to score: an opening-round one with both sides.
    const target = fixtures.find((f) => f.home_team_id && f.away_team_id && f.status !== 'completed');
    if (!target) { err(row, 'no playable fixture with two sides'); continue; }

    await call('PATCH', `/fixtures/${target.id}/official`, { official_id: officialId }, ORG);

    // ---- rosters, so events can be attributed to real people --------------
    const sc = await call('GET', `/fixtures/${target.id}/scoring`, undefined, OFF);
    const fx = sc.body?.fixture ?? sc.body ?? {};
    const home: string[] = (fx.teams_fixtures_home_team_idToteams?.team_members ?? [])
      .map((m: any) => m.users?.id).filter(Boolean);
    const away: string[] = (fx.teams_fixtures_away_team_idToteams?.team_members ?? [])
      .map((m: any) => m.users?.id).filter(Boolean);
    if (!home.length || !away.length) err(row, `roster missing (home ${home.length}, away ${away.length})`);

    // ---- score, through the engine this family really uses ----------------
    let payload: any = null;

    if (racquet) {
      // Three games to 11 - a straight best-of-five win.
      const rally: any[] = [];
      const win = (side: string, n: number) => { for (let i = 0; i < n; i++) rally.push({ t: 'point', side }); };
      win('A', 11); win('B', 11); win('A', 11); win('A', 11);
      payload = {
        live_state: { rally, firstServer: 'A' }, live_log: [],
        home_score: 3, away_score: 1, status: 'completed', winner_team_id: target.home_team_id,
      };
    } else if (cricket) {
      if (home.length >= 3 && away.length >= 2) {
        payload = {
          live_state: {
            format: { presetKey: 'cricket_t20' },
            cricket: [
              { t: 'setBatter', end: 'striker', batterId: home[0] },
              { t: 'setBatter', end: 'nonStriker', batterId: home[1] },
              { t: 'setBowler', bowlerId: away[0] },
              { t: 'ball', runs: 4, strikerId: home[0], nonStrikerId: home[1], bowlerId: away[0] },
              { t: 'ball', runs: 6, strikerId: home[0], nonStrikerId: home[1], bowlerId: away[0] },
              { t: 'ball', runs: 0, extra: 'wide', bowlerId: away[0] },
              { t: 'ball', runs: 1, strikerId: home[0], nonStrikerId: home[1], bowlerId: away[0] },
              { t: 'ball', runs: 0, strikerId: home[1], nonStrikerId: home[0], bowlerId: away[0],
                wicket: { how: 'caught', fielderId: away[1] }, nextBatterId: home[2] },
              { t: 'ball', runs: 2, strikerId: home[2], nonStrikerId: home[0], bowlerId: away[0] },
              { t: 'endInnings', reason: 'declared' },
              { t: 'setBatter', end: 'striker', batterId: away[0] },
              { t: 'setBatter', end: 'nonStriker', batterId: away[1] },
              { t: 'setBowler', bowlerId: home[0] },
              { t: 'ball', runs: 1, strikerId: away[0], nonStrikerId: away[1], bowlerId: home[0] },
              { t: 'end', reason: 'override', winner: 'A' },
            ],
          },
          live_log: [],
          home_score: 14, away_score: 1, status: 'completed', winner_team_id: target.home_team_id,
        };
      } else err(row, 'cricket roster too small to score');
    } else if (hasEvents && home.length && away.length) {
      // The period decks record an ATTRIBUTED action: who did it, and who assisted.
      const ev = spec!.events[0];
      const second = ev.secondPlayer && home.length > 1 ? home[1] : undefined;
      const rally: any[] = [
        { t: 'point', side: 'A', pts: 1, value: 1, kind: ev.key, playerId: home[0], ...(second ? { secondId: second } : {}) },
        { t: 'point', side: 'A', pts: 1, value: 1, kind: ev.key, playerId: home[0] },
        { t: 'point', side: 'B', pts: 1, value: 1, kind: ev.key, playerId: away[0] },
      ];
      payload = {
        live_state: { rally, firstServer: 'A' }, live_log: [],
        home_score: 2, away_score: 1, status: 'completed', winner_team_id: target.home_team_id,
      };
    } else if (home.length && away.length) {
      // No per-player actions exist for this sport - the RESULT is the statistic.
      payload = {
        live_state: {}, live_log: [],
        home_score: 3, away_score: 1, status: 'completed', winner_team_id: target.home_team_id,
      };
    }

    if (!payload) continue;
    const put = await call('PATCH', `/fixtures/${target.id}/live`, payload, OFF);
    if (put.status !== 200) { err(row, `score HTTP ${put.status} ${JSON.stringify(put.body).slice(0, 120)}`); continue; }
    row.scored = true;

    // ---- submit and lock --------------------------------------------------
    await call('POST', `/fixtures/${target.id}/submit`, {}, OFF);
    const lock = await call('POST', `/fixtures/${target.id}/lock`, {}, ORG);
    if (lock.status !== 200 && lock.status !== 204) {
      err(row, `lock HTTP ${lock.status} ${JSON.stringify(lock.body?.error?.message ?? lock.body).slice(0, 110)}`);
      continue;
    }
    row.locked = true;

    // ---- did a per-player stat line actually land? ------------------------
    const counted = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      select (
        (select count(*) from racquet_match_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from invasion_match_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from raid_match_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from net_match_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from board_match_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from combat_match_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from cricket_batting_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      + (select count(*) from cricket_bowling_lines l join player_match_stats m on m.id=l.line_id where m.fixture_id=$1::uuid)
      )::int as n`, target.id);
    row.detailRows = counted[0]?.n ?? 0;
    if (!row.detailRows) err(row, 'no typed detail row written');

    // The stat BAG on the spine - what a leaderboard reads, and what proves the
    // taps became numbers rather than being dropped at the last step.
    const bag = await prisma.$queryRawUnsafe<Array<{ user_id: string; stats: any }>>(`
      select user_id, stats from player_match_stats
      where fixture_id = $1::uuid and played = true and stats <> '{}'::jsonb limit 1`, target.id);
    if (bag.length) {
      const keys = Object.entries(bag[0].stats as Record<string, number>)
        .filter(([, v]) => typeof v === 'number')
        .slice(0, 3).map(([k, v]) => `${k} ${v}`);
      row.statLine = keys.join(', ');
    } else if (row.engine !== 'result' || true) {
      err(row, 'every stat bag was empty');
    }
  }

  report();
}

function report() {
  const w = { s: 15, d: 18, e: 8 };
  console.log(
    `${'SPORT'.padEnd(w.s)} ${'DISCIPLINE'.padEnd(w.d)} ${'ENGINE'.padEnd(w.e)} PRE  FX  SC LK  DET  STAT LINE`,
  );
  console.log('-'.repeat(112));
  for (const r of rows) {
    console.log(
      `${r.sport.slice(0, w.s).padEnd(w.s)} ${r.discipline.slice(0, w.d).padEnd(w.d)} `
      + `${r.engine.padEnd(w.e)} ${String(r.presets).padStart(3)} `
      + `${String(r.fixtures).padStart(3)} `
      + `${r.scored ? ' y' : ' N'} ${r.locked ? ' y' : ' N'} `
      + `${String(r.detailRows).padStart(4)}  ${r.statLine || (r.note ? `! ${r.note}` : '-')}`,
    );
  }

  const ok = rows.filter((r) => r.locked && r.detailRows > 0 && r.statLine);
  console.log('-'.repeat(112));
  console.log(`\n${ok.length}/${rows.length} draws went from empty to a locked result with a per-player stat line.`);
  console.log(`${new Set(rows.map((r) => r.sport)).size} sports covered.`);

  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nNo problems.');
  }
}

main()
  .catch((e) => { console.error('\nHARNESS CRASH:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
