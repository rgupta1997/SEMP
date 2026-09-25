/*
 * FOOTBALL, THROUGH THE ACTUAL CONSOLE.
 *
 *   node scripts/qa-football.mjs
 *   QA_VIEWPORT=desktop node scripts/qa-football.mjs
 *
 * The all-sports harness proves the football console renders and a tap moves the
 * score. That is not enough for the sport an event is judged on. This one plays a
 * whole match through the buttons an official actually presses:
 *
 *   a goal, with the scorer and the assist picked from the team sheet
 *   a penalty scored, a penalty missed
 *   a save, a yellow, a red
 *   an OWN GOAL - the one action where the scoreboard and the player's record point
 *     in opposite directions
 *   the whistle at half time, and again at full time
 *
 * and checks the score on screen after every one of them. The score is the thing an
 * official is watching; if a save adds a goal to it, nothing else matters.
 *
 * Reads apps/web/scripts/qa-sports.json for the football fixture.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const API = process.env.QA_API_ORIGIN ?? 'http://localhost:4000';
const PW = 'Qa@2026';
const WHO = 'official@qa.test';
const SHOTS = path.join(import.meta.dirname, 'qa-football-shots');
const LIST = path.join(import.meta.dirname, 'qa-sports.json');
const DESKTOP = process.env.QA_VIEWPORT === 'desktop';
const VIEWPORT = DESKTOP ? { width: 1440, height: 900 } : { width: 390, height: 844 };

const checks = [];
const problems = [];

function record(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  const ident = page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="password"])').first();
  await ident.waitFor({ state: 'visible', timeout: 30000 });
  await ident.fill(WHO);
  await page.locator('button:has-text("Continue"), button[type="submit"]').first().click();
  const pass = page.locator('input[type="password"]').first();
  await pass.waitFor({ state: 'visible', timeout: 20000 });
  await pass.fill(PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 }).catch(() => {}),
    page.locator('button[type="submit"], button:has-text("Sign in")').first().click(),
  ]);
  return !page.url().includes('/login');
}

async function settled(page) {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('[role="status"],.animate-spin'),
    null, { timeout: 4000 },
  ).catch(() => {});
}

async function resetFixture(page, fixtureId) {
  return page.evaluate(async ([id, api]) => {
    const token = localStorage.getItem('semp_token');
    const org = await fetch(`${api}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'organiser@qa.test', password: 'Qa@2026' }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (org?.token) {
      await fetch(`${api}/api/fixtures/${id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
        body: JSON.stringify({ reason: 'QA football harness reset' }),
      }).catch(() => {});
    }
    const res = await fetch(`${api}/api/fixtures/${id}/live`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        live_state: {}, live_log: [],
        home_score: 0, away_score: 0, status: 'scheduled', winner_team_id: null,
      }),
    });
    return res.status;
  }, [fixtureId, API]);
}

/**
 * THE SCORE AS THE OFFICIAL SEES IT.
 *
 * Read off the two big numbers either side of the "Total" column, not from any
 * internal state - this harness exists to check the screen.
 */
const scoreOnScreen = (page) => page.evaluate(() => {
  const main = document.querySelector('main');
  if (!main) return null;
  const txt = (main.innerText || '').replace(/–|—/g, '-');
  // "Total" sits between the two side panels; the digits around it are the score.
  const m = txt.match(/(\d+)\s*\n?\s*Total[\s\S]{0,60}?\n\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const nums = [...txt.matchAll(/^\s*(\d+)\s*$/gm)].map((x) => Number(x[1]));
  return nums.length >= 2 ? [nums[0], nums[1]] : null;
});

/**
 * Pick the side, then the person (and optionally the second person).
 *
 * The deck asks whose action it is first, so the harness does the same - which is
 * also the check that the side tabs work at all.
 */
async function pickActor(page, side, index, secondIndex) {
  const tab = page.locator(`[data-qa="team-side-${side}"]`);
  await tab.waitFor({ state: 'visible', timeout: 8000 });
  await tab.click();
  await page.waitForTimeout(150);

  const actor = page.locator(`[data-qa="actor-${side}"] button`).nth(index);
  await actor.waitFor({ state: 'visible', timeout: 8000 });
  await actor.click();
  await page.waitForTimeout(150);

  if (secondIndex !== undefined) {
    // The assist picker is collapsed by default - a whole second squad grid open
    // underneath the scorer's pushed his own bottom row under the fold - so it has
    // to be disclosed before its players are there to click.
    const toggle = page.locator(`[data-qa="second-toggle-${side}"]`);
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(120); }
    const second = page.locator(`[data-qa="second-${side}"] button`).nth(secondIndex);
    if (await second.count()) { await second.click(); await page.waitForTimeout(120); }
  }
}

/** Fire one declared action and report the score before and after. */
async function act(page, side, key) {
  const before = await scoreOnScreen(page);
  const btn = page.locator(`[data-qa="act-${side}-${key}"]`);
  if (!await btn.count()) return { fired: false, why: `no ${key} button on side ${side}` };
  await btn.click();
  await settled(page);
  const after = await scoreOnScreen(page);
  return { fired: true, before, after };
}

const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/**
 * How far anything around the console can scroll.
 *
 * NOT the document: the app shell scrolls inside a `<main class="overflow-auto">`,
 * so the document reports a clean zero however far the content runs past the bottom.
 */
const overflow = (page) => page.evaluate(() => {
  let worst = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  let el = document.querySelector('[data-qa="team-deck"]');
  while (el && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') worst = Math.max(worst, el.scrollHeight - el.clientHeight);
    el = el.parentElement;
  }
  return worst;
});

async function run() {
  const bench = JSON.parse(readFileSync(LIST, 'utf8'));
  const t = bench.find((x) => x.sport.toLowerCase() === 'football');
  if (!t) { console.error('No football fixture in the bench — run qa-sports-bench.ts'); process.exit(1); }

  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/unlock')) return;
    if (r.status() >= 400 && r.url().includes('/api/')) problems.push(`${r.status()} ${r.url().split('/api/')[1]}`);
  });

  if (!await login(page)) { console.error('could not sign in'); process.exit(1); }
  console.log(`\nFootball · ${t.home} v ${t.away} · viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`${t.url}\n`);

  const reset = await resetFixture(page, t.fixtureId);
  record('the fixture resets to unscored', reset === 200, `PATCH /live → ${reset}`);

  await page.goto(`${WEB}/score/${t.fixtureId}`, { waitUntil: 'domcontentloaded' });
  await settled(page);

  // ---- the console is the football one ----
  const deckThere = await page.locator('[data-qa="team-deck"]').count() > 0;
  record('the football deck renders', deckThere);
  if (!deckThere) {
    await page.screenshot({ path: path.join(SHOTS, 'NODECK.png') });
    await browser.close();
    process.exit(1);
  }

  const start = await scoreOnScreen(page);
  record('the match starts level', same(start, [0, 0]), JSON.stringify(start));

  const of0 = await overflow(page);
  record('the console fits the screen with no scrolling', of0 <= 1, `overflow ${of0}px`);

  // ---- the team sheets are offered for attribution ----
  const panelA = await page.locator('[data-qa="team-side-A"]').count() > 0;
  const panelB = await page.locator('[data-qa="team-side-B"]').count() > 0;
  record('both team sheets are offered for attribution', panelA && panelB);

  const squadA = await page.locator('[data-qa="actor-A"] button').count();
  record('the home team sheet is populated', squadA > 1, `${squadA} players`);

  // The assist picker only appears once somebody is selected - it is per goal, and
  // asking for it before there is a scorer is noise.
  await pickActor(page, 'A', 0);
  const assistToggle = await page.locator('[data-qa="second-toggle-A"]').count() > 0;
  record('a second player can be named on the same tap', assistToggle);

  // Shut, the scorer's grid must be whole: every squad button on screen, no inner
  // scroll. This is the check that the collapse was FOR.
  const whoClipped = await page.evaluate(() => {
    const grid = document.querySelector('[data-qa^="actor-"]');
    if (!grid) return 'no grid';
    const box = grid.closest('.overflow-y-auto');
    if (!box) return 'ok';
    const over = box.scrollHeight - box.clientHeight;
    return over > 4 ? `${over}px of the squad is below the fold` : 'ok';
  });
  record('the whole squad is on screen without scrolling the picker',
    whoClipped === 'ok', String(whoClipped));

  // ---- 1 · a goal, with an assist ----
  await pickActor(page, 'A', 0, 1);
  let r = await act(page, 'A', 'goal');
  record('a goal is one on the board for the side that scored it',
    r.fired && same(r.after, [1, 0]), `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`);

  // ---- 2 · the non-scoring actions ----
  for (const [side, key, label] of [
    ['B', 'save', 'a save'],
    ['B', 'yellow', 'a yellow card'],
    ['A', 'pen_missed', 'a missed penalty'],
    ['B', 'red', 'a red card'],
  ]) {
    await pickActor(page, side, 1);
    const res = await act(page, side, key);
    record(`${label} changes no score`,
      res.fired && same(res.before, res.after),
      res.fired ? `${JSON.stringify(res.before)} → ${JSON.stringify(res.after)}` : res.why);
  }

  // ---- 2b · THE MATCH CLOCK ----
  //
  // The clock is derived from the log rather than held in a field, so the things
  // worth proving are that it starts, that it is still right after a RELOAD (the
  // whole point of deriving it), that an official can correct it, and that the
  // minute lands on the events.
  const face = page.locator('[data-qa="clock-face"]');
  record('the console shows a match clock', await face.count() > 0);

  if (await face.count()) {
    record('the clock starts stopped at 0:00', (await face.innerText()).trim().endsWith('0:00'),
      (await face.innerText()).trim());

    await page.locator('[data-qa="clock-toggle"]').click();
    await settled(page);
    await page.waitForTimeout(2300);
    const running = (await face.innerText()).trim();
    record('the clock runs once started', /0:0[23]/.test(running), running);

    // THE RELOAD. A clock kept in a browser interval dies here.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const afterReload = (await page.locator('[data-qa="clock-face"]').innerText()).trim();
    const secs = Number((afterReload.match(/(\d+):(\d+)/) || [])[2] ?? -1);
    record('THE CLOCK SURVIVES A RELOAD and keeps counting', secs >= 4, afterReload);

    // An official correcting a clock that ran away.
    await page.locator('[data-qa="clock-face"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-qa="clock-mm"]').fill('21');
    await page.locator('[data-qa="clock-ss"]').fill('00');
    await page.locator('[data-qa="clock-set"]').click();
    await settled(page);
    const corrected = (await page.locator('[data-qa="clock-face"]').innerText()).trim();
    record('an official can set the clock to an exact time', /21:0[0-9]/.test(corrected), corrected);

    // And a nudge on top of it. The panel is still open from the Set above - tapping
    // the face again would SHUT it, which is how this check first failed.
    const nudgeBtn = page.locator('[data-qa="clock-nudge--1m"]');
    record('the correction panel offers nudges', await nudgeBtn.count() > 0);
    const beforeNudge = (await page.locator('[data-qa="clock-face"]').innerText()).trim();
    await nudgeBtn.click();
    await settled(page);
    const nudged = (await page.locator('[data-qa="clock-face"]').innerText()).trim();
    // The clock is RUNNING, so the comparison is against what it read a moment ago,
    // not against a fixed 21:00 - a minute back from a moving clock is still a
    // minute back.
    const mins = (x) => Number((x.match(/(\d+):(\d+)/) || [])[1] ?? -1);
    record('a nudge moves the clock a minute back',
      mins(nudged) === mins(beforeNudge) - 1, `${beforeNudge} → ${nudged}`);
    const back = page.locator('main button', { hasText: /^Done$/ });
    if (await back.count()) { await back.first().click(); await page.waitForTimeout(250); }
  }

  // ---- 3 · a penalty scored ----
  await pickActor(page, 'B', 2);
  r = await act(page, 'B', 'pen_scored');
  record('a converted penalty is a goal on the board',
    r.fired && same(r.after, [1, 1]), `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`);

  // The minute must reach the LOG - that is what "stored minutes-wise" means, and
  // an event stamped only in memory is an event nobody can cite afterwards.
  await settled(page);
  await page.waitForTimeout(900);

  const logBtn = page.locator('main button', { hasText: /^Log/ }).first();
  if (await logBtn.count()) {
    await logBtn.click();
    await page.waitForTimeout(400);
    const logTxt = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    // The clock was set to 21:00 and a fest half is TEN minutes, so a goal there is
    // eleven minutes into stoppage: 10+11', not 21'. That notation is the proof the
    // period length is read per period - it used to be the 90-minute whole-match
    // total, so nothing ever reached stoppage at all.
    record('the log cites events by their match minute', logTxt.includes("10+11'"),
      (logTxt.match(/\d+\+?\d*'/g) || []).slice(0, 4).join(' ') || 'no minutes in the log');
    record('the clock correction is itself in the log', /Clock corrected to/.test(logTxt));
    await logBtn.click();
    await page.waitForTimeout(300);
  }

  // ---- 4 · AN OWN GOAL GOES TO THE OTHER SIDE ----
  await pickActor(page, 'A', 3);
  r = await act(page, 'A', 'own_goal');
  record('AN OWN GOAL by the home side scores for the away side',
    r.fired && same(r.after, [1, 2]),
    r.fired ? `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)} (expected 1-2)` : r.why);

  await page.screenshot({ path: path.join(SHOTS, 'first-half.png') });

  // ---- 5 · half time ----
  const whistle = page.locator('main button', { hasText: /^End half/ }).first();
  record('the whistle is offered, not a score target', await whistle.count() > 0);
  if (await whistle.count()) {
    await whistle.click();
    const confirm = page.locator('button', { hasText: /End half/ }).last();
    await page.waitForTimeout(400);
    if (await confirm.count()) await confirm.click();
    await settled(page);
    const afterHalf = await scoreOnScreen(page);
    record('the running total survives half time', same(afterHalf, [1, 2]),
      JSON.stringify(afterHalf));
    // Assert the BANKED HALF itself, not just that some text exists - a loose
    // regex over the whole page passes on the header and proves nothing.
    const txt = (await page.locator('main').innerText()).replace(/\s+/g, ' ').replace(/[–—]/g, '-');
    const h1 = txt.match(/H1\s*(\d+)-(\d+)/);
    record('the half just played is banked and shown',
      !!h1 && h1[1] === '1' && h1[2] === '2', h1 ? `H1 ${h1[1]}-${h1[2]}` : 'no half banked on screen');
  }

  // ---- 6 · second half, then full time ----
  await pickActor(page, 'A', 0, 2);
  r = await act(page, 'A', 'goal');
  record('a second-half goal adds to the match total, not the half alone',
    r.fired && same(r.after, [2, 2]), `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`);

  const whistle2 = page.locator('main button', { hasText: /^End half/ }).first();
  if (await whistle2.count()) {
    await whistle2.click();
    await page.waitForTimeout(400);
    const confirm = page.locator('button', { hasText: /End half/ }).last();
    if (await confirm.count()) await confirm.click();
    await settled(page);
  }

  const final = (await page.locator('main').innerText()).replace(/\s+/g, ' ').replace(/[–—]/g, '-');
  const halves = [...final.matchAll(/H(\d)\s*(\d+)-(\d+)/g)].map((m) => `${m[2]}-${m[3]}`);
  record('both halves are banked with their own scores',
    halves.length === 2 && halves[0] === '1-2' && halves[1] === '1-0', halves.join(' · ') || 'none');
  record('a two-all match is a DRAW, not a win',
    /Drawn/.test(final) && /Drawn 2-2/.test(final),
    final.match(/Drawn[^A-Za-z]*[\d-]*/)?.[0] ?? final.slice(0, 80));

  await page.screenshot({ path: path.join(SHOTS, 'full-time.png') });

  // ---- 6b · SIGNING THE RESULT OFF, which is what makes it official ----
  const confirmBtn = page.locator('[data-qa="team-signoff"]').first();
  record('the console offers a sign-off once the match has ended', await confirmBtn.count() > 0);
  if (await confirmBtn.count()) {
    // Wait for it rather than sampling: the button is disabled while a save is in
    // flight, and the last goal's save may still be landing.
    let pressable = false;
    for (let i = 0; i < 20 && !pressable; i += 1) {
      pressable = await confirmBtn.isEnabled();
      if (!pressable) await page.waitForTimeout(250);
    }
    record('and the sign-off becomes pressable', pressable,
      pressable ? '' : 'still disabled after 5s');
    await confirmBtn.click();
    await settled(page);
    await page.waitForTimeout(800);
    const signed = await page.evaluate(async ([id, api]) => {
      const token = localStorage.getItem('semp_token');
      const r = await fetch(`${api}/api/fixtures/${id}/scoring`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return { status: j.status, home: j.home_score, away: j.away_score, winner: j.winner_team_id };
    }, [t.fixtureId, API]);
    record('signing off records the drawn result on the fixture',
      !!signed && signed.status === 'completed' && signed.home === 2 && signed.away === 2
      && signed.winner === null,
      JSON.stringify(signed));
  }

  // ---- 7 · the log survived a reload ----
  // Signing off closes the console and returns to the officiating list - by design.
  // So persistence is checked by opening the match again, not by reloading whatever
  // page we were left on.
  await page.goto(`${WEB}/score/${t.fixtureId}`, { waitUntil: 'domcontentloaded' });
  await settled(page);
  const reloaded = (await page.locator('main').innerText()).replace(/\s+/g, ' ').replace(/[–—]/g, '-');
  record('the result survives a reload', /Drawn 2-2/.test(reloaded),
    reloaded.match(/Drawn[^A-Za-z]*[\d-]*/)?.[0] ?? reloaded.slice(0, 80));

  const ofEnd = await overflow(page);
  record('still no scrolling at the end of the match', ofEnd <= 1, `overflow ${ofEnd}px`);

  record('no page errors or failed requests', problems.length === 0, problems.slice(0, 3).join(' | '));

  await browser.close();

  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FOOTBALL CONSOLE · ${pass}/${checks.length} checks passed · ${VIEWPORT.width}x${VIEWPORT.height}`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  console.log(`\nScreenshots: ${SHOTS}`);
  writeFileSync(path.join(SHOTS, 'verdict.json'), JSON.stringify({ viewport: VIEWPORT, checks, problems }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
