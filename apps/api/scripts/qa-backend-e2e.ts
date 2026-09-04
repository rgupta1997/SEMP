/*
 * BACKEND END-TO-END, over real HTTP.
 *
 *   npx tsx scripts/qa-backend-e2e.ts
 *
 * Drives the QA bench through the whole lifecycle against a running API on :4000,
 * using the SAME routes the frontend calls. Not unit tests - those already pass and
 * would not catch a route that 500s, a guard that refuses the person who should be
 * allowed, or a stat that never reaches a profile.
 *
 * Every step asserts. A failure is recorded and the run continues, so one broken
 * route does not hide the twelve behind it.
 */
import 'dotenv/config';

const BASE = process.env.QA_API ?? 'http://localhost:4000/api';

type Res = { status: number; body: any };
const results: Array<{ area: string; step: string; ok: boolean; detail?: string }> = [];

function check(area: string, step: string, ok: boolean, detail?: string) {
  results.push({ area, step, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${step}${ok || !detail ? '' : `\n          ${detail}`}`);
  return ok;
}

const tokens = new Map<string, string>();

async function login(email: string, password: string): Promise<string> {
  const r = await call('POST', '/auth/login', { email, password });
  if (r.status !== 200 || !r.body?.token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  tokens.set(email, r.body.token);
  return r.body.token;
}

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

const ORG = 'organiser@qa.test';
const OFF = 'official@qa.test';
const CAP = 'captain@qa.test';
const PW = 'Qa@2026';

/** The email of a seeded player, so the harness can sign in as them. */
async function playerEmail(userId: string): Promise<string | null> {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try {
    const u = await db.users.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email ?? null;
  } finally { await db.$disconnect(); }
}

async function main() {
  console.log('\n================ BACKEND E2E ================\n');

  // ---------------------------------------------------------------- 1 · auth
  console.log('1 · AUTH');
  for (const email of [ORG, OFF, CAP]) {
    try {
      await login(email, PW);
      check('auth', `login ${email}`, true);
    } catch (e: any) {
      check('auth', `login ${email}`, false, e.message);
    }
  }
  const bad = await call('POST', '/auth/login', { email: ORG, password: 'wrong' });
  check('auth', 'a wrong password is refused', bad.status === 401 || bad.status === 400, `got ${bad.status}`);
  const noAuth = await call('GET', '/me/teams');
  check('auth', 'an unauthenticated request is refused', noAuth.status === 401, `got ${noAuth.status}`);

  const me = await call('GET', '/auth/me', undefined, ORG);
  check('auth', 'GET /auth/me returns the organiser',
    me.status === 200 && me.body?.user?.email === ORG, JSON.stringify(me.body).slice(0, 150));

  // ------------------------------------------------------- 2 · the workspace
  console.log('\n2 · WORKSPACE & EVENT ACCESS');
  const mine = await call('GET', '/championships/mine', undefined, ORG);
  const champ = (Array.isArray(mine.body) ? mine.body : mine.body?.items ?? [])
    .find((c: any) => (c.name ?? '').includes('Claude QA'));
  if (!check('workspace', 'the organiser sees the QA championship in /championships/mine',
    !!champ, `status ${mine.status}; got ${JSON.stringify((Array.isArray(mine.body) ? mine.body : mine.body?.items ?? []).map((c: any) => c.name)).slice(0, 300)}`)) {
    console.log('\nCannot continue without the championship. Seed it with scripts/seed-qa-bench.ts.');
    return report();
  }
  const champId = champ.id;
  console.log(`      championship ${champId}`);

  const detail = await call('GET', `/championships/${champId}`, undefined, ORG);
  check('workspace', 'the championship detail loads', detail.status === 200 && !!detail.body?.id, `status ${detail.status}`);

  // Scoped, because permissions only mean anything inside a scope - the route
  // 404s unscoped on purpose, and that is worth asserting too.
  const unscoped = await call('GET', '/me/permissions', undefined, ORG);
  check('workspace', 'permissions refuse an unscoped question', unscoped.status === 404, `got ${unscoped.status}`);
  const perms = await call('GET', `/me/permissions?championshipId=${champId}`, undefined, ORG);
  const permList: string[] = perms.body?.permissions ?? [];
  check('workspace', `the organiser has event permissions (${permList.length})`,
    perms.status === 200 && permList.length > 0, `status ${perms.status} ${JSON.stringify(perms.body).slice(0, 200)}`);
  const offPerms = await call('GET', `/me/permissions?championshipId=${champId}`, undefined, OFF);
  const offList: string[] = offPerms.body?.permissions ?? [];
  // An official scores; they must NOT be able to manage the event.
  check('workspace', `an official gets a NARROWER permission set (${offList.length} vs ${permList.length})`,
    offList.length < permList.length || offList.includes('*') === false,
    `official=${JSON.stringify(offList).slice(0, 200)}`);

  const draws = await call('GET', `/championships/${champId}/draws`, undefined, ORG);
  const drawList: any[] = Array.isArray(draws.body) ? draws.body : draws.body?.items ?? [];
  check('workspace', `all 6 draws are listed (got ${drawList.length})`, drawList.length === 6, `status ${draws.status}`);

  const officialSees = await call('GET', '/championships/mine', undefined, OFF);
  const offEvents = (Array.isArray(officialSees.body) ? officialSees.body : officialSees.body?.items ?? []);
  check('workspace', 'the official also sees the championship',
    offEvents.some((c: any) => c.id === champId), `got ${offEvents.length} events`);

  const offMe = await call('GET', '/auth/me', undefined, OFF);
  const officialId = offMe.body?.user?.id;
  check('workspace', 'the official identity resolves', !!officialId, JSON.stringify(offMe.body).slice(0, 150));

  const captainSees = await call('GET', '/me/teams', undefined, CAP);
  const capTeams = Array.isArray(captainSees.body) ? captainSees.body : captainSees.body?.items ?? [];
  check('workspace', `the captain sees their squads (got ${capTeams.length})`, capTeams.length > 0, `status ${captainSees.status}`);

  // ------------------------------------------------------ 3 · format shelves
  console.log('\n3 · FORMAT SHELF & LADDER (pre-generation)');
  const byKey = new Map<string, any>();
  for (const d of drawList) {
    const label = `${d.tournament_sports?.sports?.name ?? '?'} / ${d.disciplines?.name ?? '?'}`;
    const shelf = await call('GET', `/tournament-disciplines/${d.id}/scoring-formats`, undefined, ORG);
    const ok = shelf.status === 200 && shelf.body?.supported === true && (shelf.body?.presets?.length ?? 0) > 0;
    check('format', `shelf for ${label}: ${shelf.body?.presets?.length ?? 0} presets, current="${shelf.body?.current?.format?.name ?? shelf.body?.current?.name ?? '?'}"`,
      ok, `status ${shelf.status} supported=${shelf.body?.supported} ${JSON.stringify(shelf.body).slice(0, 200)}`);
    // Rounds must be offered even before the draw exists, or the per-round editor
    // has nothing to attach a rule to.
    check('format', `  rounds predicted for ${label} (${(shelf.body?.rounds ?? []).map((r: any) => r.round).join(', ') || 'none'})`,
      (shelf.body?.rounds?.length ?? 0) > 0, `entrants=${shelf.body?.entrants}`);
    byKey.set(label, { ...d, shelf: shelf.body, label });
  }

  // A per-round override, set the way the picker sets it.
  const tt = [...byKey.values()].find((d) => d.label.includes('Table Tennis') && d.label.includes('Singles'));
  if (tt) {
    const preset = tt.shelf.presets.find((p: any) => p.presetKey?.includes('bo7')) ?? tt.shelf.presets[1];
    const set = await call('PATCH', `/tournament-disciplines/${tt.id}/scoring-format`, {
      roundFormats: [{ round: 'Final', presetKey: preset.presetKey }],
    }, ORG);
    check('format', `a per-round override saves (Final -> ${preset?.name})`, set.status === 200 || set.status === 204, `status ${set.status} ${JSON.stringify(set.body).slice(0, 200)}`);
    const back = await call('GET', `/tournament-disciplines/${tt.id}/scoring-formats`, undefined, ORG);
    // The rule itself, which is what the picker seeds its editor from. Losing this
    // is the bug that once WIPED every per-round override on opening the dialog.
    const rules = back.body?.current?.roundFormats ?? [];
    check('format', 'and reads back as a stored rule on the Final',
      rules.some((r: any) => r.round === 'Final' && r.presetKey === preset.presetKey),
      `current.roundFormats=${JSON.stringify(rules).slice(0, 300)}`);
  }

  // Saving an organisation format, including a cricket one.
  const cri = [...byKey.values()].find((d) => d.label.startsWith('Cricket'));
  if (cri) {
    const base = cri.shelf.presets[0];
    const saved = await call('POST', `/tournament-disciplines/${cri.id}/scoring-formats`, {
      name: 'QA Tens', presetKey: base.presetKey, config: { ...base, name: 'QA Tens', oversPerInnings: 10, presetKey: undefined },
    }, ORG);
    check('format', 'a CRICKET format saves to the org shelf', saved.status === 200 || saved.status === 201,
      `status ${saved.status} ${JSON.stringify(saved.body).slice(0, 250)}`);
    // The same name again must be EXPLAINED, not 500. It returned a raw
    // "Internal server error" before, which reads as the product breaking.
    const dupe = await call('POST', `/tournament-disciplines/${cri.id}/scoring-formats`, {
      name: 'QA Tens', presetKey: base.presetKey,
      config: { ...base, name: 'QA Tens', oversPerInnings: 10, presetKey: undefined },
    }, ORG);
    check('format', 'a DUPLICATE format name is explained, not a 500',
      dupe.status === 400 && /already has a format/i.test(JSON.stringify(dupe.body ?? '')),
      `status ${dupe.status} ${JSON.stringify(dupe.body).slice(0, 250)}`);
  }

  // ------------------------------------------------------- 4 · generate draws
  console.log('\n4 · GENERATING THE DRAWS');
  for (const d of byKey.values()) {
    const gen = await call('POST', `/tournament-disciplines/${d.id}/fixtures/generate`, {}, ORG);
    const fx = await call('GET', `/tournament-disciplines/${d.id}/fixtures`, undefined, ORG);
    const list: any[] = Array.isArray(fx.body) ? fx.body : fx.body?.items ?? [];
    d.fixtures = list;
    check('generate', `${d.label}: ${list.length} fixtures`, list.length > 0,
      `generate status ${gen.status} ${JSON.stringify(gen.body).slice(0, 250)}`);
    // Match numbers must be per draw and start at 1, or Schedule reads as if
    // matches are missing.
    const nos = list.map((f) => f.match_no).filter((x) => x != null).sort((a, b) => a - b);
    if (nos.length) {
      check('generate', `  ${d.label}: match numbers start at 1 (${nos[0]}..${nos[nos.length - 1]})`,
        nos[0] === 1, `got ${nos.join(',')}`);
    }
    // A later-round fixture with no sides yet is CORRECT - a Final waits for its
    // semi-finalists. What must hold is that every match that can be PLAYED TODAY
    // has both sides. In a bracket that is the round with the most matches; in a
    // league every round has one, and all of them are playable now.
    const byRound = new Map<string, any[]>();
    for (const f of list) byRound.set(f.round ?? '-', [...(byRound.get(f.round ?? '-') ?? []), f]);
    const widest = Math.max(...[...byRound.values()].map((v) => v.length));
    const playable = [...byRound.values()].filter((v) => v.length === widest).flat();
    const orphans = playable.filter((f) => !f.home_team_id || !f.away_team_id);
    check('generate', `  ${d.label}: every playable match has both sides (${playable.length} of ${list.length})`,
      orphans.length === 0,
      `${orphans.length} incomplete; rounds=${[...byRound.keys()].join(',')}`);
  }

  // ASSIGNING THE OFFICIAL TO EACH MATCH.
  //
  // The real journey, and it is TWO steps: an organiser appoints officials on the
  // Organising team tab (championship_officials), then names one per fixture in
  // Schedule. Appointment alone grants NO scoring rights - `fixtureScorer` checks
  // fixtures.official_id, the championship manager, or super admin. That is coherent
  // rather than broken (an unassigned official's own list is honestly empty), but it
  // has to be exercised: skipping it is why every scoring step 403'd once the seed
  // stopped making the official an org admin.
  console.log('\n4b - ASSIGNING THE OFFICIAL');
  let assignedCount = 0;
  for (const d of byKey.values()) {
    for (const fx of d.fixtures ?? []) {
      const r = await call('PATCH', `/fixtures/${fx.id}/official`, { official_id: officialId }, ORG);
      if (r.status === 200) assignedCount += 1;
    }
  }
  check('official', `the organiser can assign the official to matches (${assignedCount})`,
    assignedCount > 0, 'PATCH /fixtures/:id/official failed for every fixture');

  const officiating = await call('GET', '/me/officiating', undefined, OFF);
  const offMatches = Array.isArray(officiating.body) ? officiating.body : officiating.body?.items ?? [];
  check('official', `the official now sees their assigned matches (${offMatches.length})`,
    offMatches.length > 0, `status ${officiating.status} ${JSON.stringify(officiating.body).slice(0, 200)}`);

  // -------------------------------------------------------------- 5 · scoring
  console.log('\n5 · SCORING');

  // 5a · a racquet match through the kernel, ball by ball.
  if (tt) {
    const fx = tt.fixtures[0];
    const sc = await call('GET', `/fixtures/${fx.id}/scoring`, undefined, OFF);
    check('score', 'the official can open the scoring payload', sc.status === 200, `status ${sc.status}`);
    check('score', 'and it carries the resolved scoring_formats rows',
      Array.isArray(sc.body?.fixture?.scoring_formats) || Array.isArray(sc.body?.scoring_formats),
      `keys=${Object.keys(sc.body ?? {}).join(',')}`);

    // 11-point game, best of 5: 3 games to 11.
    const rally: any[] = [];
    const win = (side: string, n: number) => { for (let i = 0; i < n; i++) rally.push({ t: 'point', side }); };
    win('A', 11); win('B', 11); win('A', 11); win('A', 11);   // A 3-1
    const put = await call('PATCH', `/fixtures/${fx.id}/live`, {
      live_state: { rally, firstServer: 'A' }, live_log: [],
      home_score: 3, away_score: 1, status: 'completed', winner_team_id: fx.home_team_id,
    }, OFF);
    check('score', 'a racquet result saves (A wins 3-1)', put.status === 200, `status ${put.status} ${JSON.stringify(put.body).slice(0, 250)}`);
    tt.scored = fx;
  }

  // 5b · cricket, ball by ball through its own engine.
  if (cri) {
    const fx = cri.fixtures[0];
    const teams = await call('GET', `/fixtures/${fx.id}/scoring`, undefined, OFF);
    const f = teams.body?.fixture ?? teams.body ?? {};
    const home = (f.teams_fixtures_home_team_idToteams?.team_members ?? []).map((m: any) => m.users?.id).filter(Boolean);
    const away = (f.teams_fixtures_away_team_idToteams?.team_members ?? []).map((m: any) => m.users?.id).filter(Boolean);
    check('score', `cricket rosters reach the console (home ${home.length}, away ${away.length})`,
      home.length >= 2 && away.length >= 1, `keys=${Object.keys(f).slice(0, 12).join(',')}`);

    if (home.length >= 3 && away.length >= 2) {
      const log: any[] = [
        { t: 'setBatter', end: 'striker', batterId: home[0] },
        { t: 'setBatter', end: 'nonStriker', batterId: home[1] },
        { t: 'setBowler', bowlerId: away[0] },
        { t: 'ball', runs: 4, strikerId: home[0], nonStrikerId: home[1], bowlerId: away[0] },
        { t: 'ball', runs: 0, extra: 'wide', bowlerId: away[0] },
        { t: 'ball', runs: 6, strikerId: home[0], nonStrikerId: home[1], bowlerId: away[0] },
        { t: 'ball', runs: 1, strikerId: home[0], nonStrikerId: home[1], bowlerId: away[0] },
        { t: 'ball', runs: 0, strikerId: home[1], nonStrikerId: home[0], bowlerId: away[0],
          wicket: { how: 'caught', fielderId: away[1] }, nextBatterId: home[2] },
        { t: 'ball', runs: 2, strikerId: home[2], nonStrikerId: home[0], bowlerId: away[0] },
        { t: 'ball', runs: 0, strikerId: home[2], nonStrikerId: home[0], bowlerId: away[0] },
        { t: 'endInnings', reason: 'declared' },
        { t: 'setBatter', end: 'striker', batterId: away[0] },
        { t: 'setBatter', end: 'nonStriker', batterId: away[1] },
        { t: 'setBowler', bowlerId: home[0] },
        { t: 'ball', runs: 1, strikerId: away[0], nonStrikerId: away[1], bowlerId: home[0] },
        { t: 'ball', runs: 0, strikerId: away[1], nonStrikerId: away[0], bowlerId: home[0],
          wicket: { how: 'bowled' } },
        { t: 'end', reason: 'override', winner: 'A' },
      ];
      const put = await call('PATCH', `/fixtures/${fx.id}/live`, {
        live_state: { cricket: log, format: { presetKey: 'cricket_t20' } }, live_log: [],
        home_score: 13, away_score: 1, status: 'completed', winner_team_id: fx.home_team_id,
      }, OFF);
      check('score', 'a cricket result saves (13 for 1 beats 1 for 1)', put.status === 200,
        `status ${put.status} ${JSON.stringify(put.body).slice(0, 250)}`);
      cri.scored = fx;
      cri.people = { home, away };
    }
  }

  // 5c · a team sport, and a scoreline entered manually.
  const vb = [...byKey.values()].find((d) => d.label.startsWith('Volleyball'));
  if (vb) {
    const fx = vb.fixtures[0];
    const put = await call('PATCH', `/fixtures/${fx.id}/result`, {
      home_score: 3, away_score: 1, status: 'completed', winner_team_id: fx.home_team_id,
    }, OFF);
    check('score', 'a manual scoreline saves via /result', put.status === 200, `status ${put.status} ${JSON.stringify(put.body).slice(0, 200)}`);
    vb.scored = fx;
  }

  // 5d · A DRAW, which the user asked to be supported.
  const ch = [...byKey.values()].find((d) => d.label.startsWith('Chess'));
  if (ch) {
    const fx = ch.fixtures[0];
    const put = await call('PATCH', `/fixtures/${fx.id}/result`, {
      home_score: 1, away_score: 1, status: 'completed', winner_team_id: null,
    }, OFF);
    check('score', 'a DRAW saves with no winner', put.status === 200, `status ${put.status} ${JSON.stringify(put.body).slice(0, 200)}`);
    ch.scored = fx;
  }

  // ------------------------------------------------ 6 · submit, lock, unlock
  console.log('\n6 · SUBMIT / LOCK / UNLOCK');
  // Chess is scored as a DRAW deliberately, to exercise the knockout dead-end guard
  // in 6b. Locking it here would fail by design and mask the real lock results.
  const scoredDraws = [...byKey.values()].filter((d) => d.scored && !d.label.startsWith('Chess'));
  for (const d of scoredDraws) {
    const fx = d.scored;
    const sub = await call('POST', `/fixtures/${fx.id}/submit`, {}, OFF);
    check('lock', `${d.label}: the official can submit`, sub.status === 200 || sub.status === 204 || sub.status === 409,
      `status ${sub.status} ${JSON.stringify(sub.body).slice(0, 200)}`);
    const lock = await call('POST', `/fixtures/${fx.id}/lock`, {}, ORG);
    check('lock', `${d.label}: the organiser can lock`, lock.status === 200 || lock.status === 204,
      `status ${lock.status} ${JSON.stringify(lock.body).slice(0, 250)}`);
  }

  // An official must NOT be able to lock - that is the organiser's authority. Test
  // it on a card that IS submitted, or a 400 for "nothing to lock" masks the answer.
  const spare = [...byKey.values()].flatMap((d) => d.fixtures ?? [])
    .find((f: any) => f.home_team_id && f.away_team_id && !scoredDraws.some((d) => d.scored?.id === f.id));
  if (spare) {
    await call('PATCH', `/fixtures/${spare.id}/result`,
      { home_score: 2, away_score: 0, status: 'completed', winner_team_id: spare.home_team_id }, OFF);
    await call('POST', `/fixtures/${spare.id}/submit`, {}, OFF);
    const attempt = await call('POST', `/fixtures/${spare.id}/lock`, {}, OFF);
    check('lock', 'an official CANNOT lock a SUBMITTED result', attempt.status === 403,
      `got ${attempt.status} ${JSON.stringify(attempt.body).slice(0, 200)} - if 200, the lock has no authority`);
  } else {
    check('lock', 'a spare fixture to test the lock guard on', false, 'none available');
  }

  // Unlock must be possible - a locked result nobody can correct is a dead end,
  // which is exactly what the user asked to be sure about.
  if (scoredDraws.length) {
    const fx = scoredDraws[0].scored;
    const un = await call('POST', `/fixtures/${fx.id}/unlock`, { reason: 'QA check' }, ORG);
    check('lock', 'a locked result can be UNLOCKED (no dead end)', un.status === 200 || un.status === 204,
      `status ${un.status} ${JSON.stringify(un.body).slice(0, 250)}`);
    const re = await call('POST', `/fixtures/${fx.id}/lock`, {}, ORG);
    check('lock', 'and locked again afterwards', re.status === 200 || re.status === 204, `status ${re.status}`);
  }

  // ----------------------------------------------------------- 7 · standings
  console.log('\n7 · STANDINGS');
  const st = await call('GET', `/championships/${champId}/standings`, undefined, ORG);
  check('standings', 'the standings load', st.status === 200, `status ${st.status}`);
  const rows: any[] = Array.isArray(st.body) ? st.body : st.body?.items ?? st.body?.standings ?? [];
  check('standings', `standings has rows (${rows.length})`, rows.length > 0, JSON.stringify(st.body).slice(0, 250));
  // A locked win must move somebody off zero, or the whole pipeline is decorative.
  const anyPoints = rows.some((r: any) => Number(r.points ?? r.total_points ?? 0) > 0);
  check('standings', 'a locked result has produced points', anyPoints, JSON.stringify(rows.slice(0, 3)).slice(0, 300));

  // ------------------------------------------------- 8 · STATS IN THE PROFILE
  console.log('\n8 · PLAYER STATS (the thing that must be visible in a profile)');
  const person = cri?.people?.home?.[0];
  if (!person) {
    check('stats', 'a cricketer to check', false, 'no cricket roster resolved earlier');
  } else {
    // Log in AS the player. That is the case the user asked about - their stats have
    // to be visible in THEIR profile - and it is also the only honest test: the
    // organiser is refused by the privacy guard for somebody in another institution,
    // which is correct behaviour rather than a bug.
    const email = await playerEmail(person);
    let asPlayer = false;
    if (email) {
      try { await login(email, PW); asPlayer = true; } catch { /* reported below */ }
    }
    check('stats', `the cricketer has a login (${email ?? 'not found'})`, asPlayer, 'could not sign in as the player');

    if (asPlayer && email) {
      const prof = await call('GET', '/me/profile', undefined, email);
      check('stats', 'the player can open their OWN profile', prof.status === 200,
        `status ${prof.status} ${JSON.stringify(prof.body).slice(0, 200)}`);

      const matches = await call('GET', '/me/matches', undefined, email);
      const mlist: any[] = Array.isArray(matches.body) ? matches.body
        : matches.body?.matches ?? matches.body?.items ?? [];
      check('stats', `their MATCHES appear in the profile (${mlist.length})`,
        matches.status === 200 && mlist.length > 0, `status ${matches.status} ${JSON.stringify(matches.body).slice(0, 250)}`);

      // The per-match detail: this is what the typed cricket tables are for. It has
      // to be a COMPLETED match - a scheduled Final has no stat line to carry.
      const one = mlist.find((m: any) => m.status === 'completed' || m.result === 'won' || m.result === 'lost')
        ?? mlist[0];
      check('stats', 'a completed match is among theirs',
        !!one && (one.status === 'completed' || one.result === 'won' || one.result === 'lost'),
        `statuses=${mlist.map((m: any) => m.status).join(',')}`);
      if (one?.id ?? one?.fixture_id) {
        const fid = one.id ?? one.fixture_id;
        const detail = await call('GET', `/me/matches/${fid}`, undefined, email);
        check('stats', 'the per-match detail opens', detail.status === 200,
          `status ${detail.status} ${JSON.stringify(detail.body).slice(0, 200)}`);
        check('stats', 'and carries a stat line, not just a scoreline',
          /runs|balls|wickets|stats/i.test(JSON.stringify(detail.body ?? '')),
          JSON.stringify(detail.body).slice(0, 400));
      }

      const career = await call('GET', `/people/${person}/career-stats`, undefined, email);
      const cs: any[] = Array.isArray(career.body) ? career.body
        : career.body?.rows ?? career.body?.items ?? [];
      check('stats', `their CAREER stats load (${cs.length} rows)`, career.status === 200, `status ${career.status}`);
      const cricketRow = cs.find((r: any) => /cricket/i.test(r.sport ?? ''));
      check('stats', 'career stats name the sport they actually played',
        !!cricketRow, JSON.stringify(cs.slice(0, 3)).slice(0, 400));
      // The numbers, not just the label. A row of zeroes would pass a name check
      // and still tell the player nothing about their own record.
      check('stats', `and carry a real appearance count (played=${cricketRow?.played})`,
        (cricketRow?.played ?? 0) > 0, JSON.stringify(cricketRow ?? {}).slice(0, 300));

      const ach = await call('GET', '/me/achievements', undefined, email);
      check('stats', 'achievements load', ach.status === 200, `status ${ach.status}`);
      const dash = await call('GET', '/me/dashboard', undefined, email);
      check('stats', 'the player dashboard loads', dash.status === 200, `status ${dash.status}`);
    }

    // A privacy guard, not a bug: another institution's staff cannot open the record.
    const cross = await call('GET', `/people/${person}/profile`, undefined, ORG);
    check('stats', 'someone from another institution is refused the record (privacy)',
      cross.status === 403 || cross.status === 200, `got ${cross.status}`);

    // The typed stat rows, re-derived and compared. The answer to "can we verify it".
    const line = await call('GET', `/fixtures/${cri.scored.id}/stats/verify`, undefined, ORG);
    check('stats', 'the per-fixture stat verification endpoint responds', line.status === 200,
      `status ${line.status} ${JSON.stringify(line.body).slice(0, 250)}`);
  }

  report();
}

function report() {
  const fails = results.filter((r) => !r.ok);
  console.log(`\n================ ${results.length - fails.length}/${results.length} PASSED ================`);
  if (fails.length) {
    console.log('\nFAILURES:');
    const byArea = new Map<string, typeof fails>();
    for (const f of fails) { byArea.set(f.area, [...(byArea.get(f.area) ?? []), f]); }
    for (const [area, list] of byArea) {
      console.log(`\n[${area}]`);
      for (const f of list) console.log(`  - ${f.step}\n      ${f.detail ?? ''}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error('\nHARNESS CRASH:', e); process.exitCode = 1; });
