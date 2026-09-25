/*
 * A LEVEL KNOCKOUT, ALL THE WAY TO THE LAST KICK.
 *
 *   node scripts/qa-football-knockout.mjs
 *
 * The main football harness plays a drawable league match, which is the common
 * case and stops at the final whistle. This one plays the case that only exists
 * because a knockout cannot go home level:
 *
 *   1-1 at full time            -> the kernel must NOT award it
 *   two halves of extra time    -> named "Extra time 1 of 2", not "Half 3 of 2"
 *   still 1-1                   -> a penalty shoot-out
 *   5-5 after five kicks each   -> sudden death
 *   split pair                  -> a winner, with the SCORELINE STILL 1-1
 *
 * That last point is the one worth guarding: a shoot-out decides who goes through,
 * it does not score a goal, and a console that records 2-1 has told the record a
 * lie about the match that was played.
 *
 * Pins the fixture to the `fest_2x10_ko` preset through live_state.format, which is
 * the ladder's top rung - so this runs against the real preset rather than a format
 * copied into this file that could drift away from it.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const API = process.env.QA_API_ORIGIN ?? 'http://localhost:4000';
const PW = 'Qa@2026';
const WHO = 'official@qa.test';
const SHOTS = path.join(import.meta.dirname, 'qa-knockout-shots');
const LIST = path.join(import.meta.dirname, 'qa-sports.json');
const VIEWPORT = process.env.QA_VIEWPORT === 'desktop'
  ? { width: 1440, height: 900 } : { width: 390, height: 844 };

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

/** The board's own text, whitespace-collapsed. */
const boardText = (page) =>
  page.locator('[data-qa="team-scoreboard"]').innerText()
    // The board CSS-uppercases its labels, and innerText returns them TRANSFORMED -
    // so every assertion here compares in lower case rather than against what the
    // JSX happens to spell.
    .then((t) => t.replace(/\s+/g, ' ').trim().toLowerCase());

/** End whatever period is in progress, through the confirm dialog. */
async function whistle(page) {
  const btn = page.locator('main button', { hasText: /^End / }).first();
  if (!await btn.count()) return false;
  await btn.click();
  await page.waitForTimeout(400);
  const confirm = page.locator('button', { hasText: /^End / }).last();
  if (await confirm.count()) await confirm.click();
  await settled(page);
  await page.waitForTimeout(400);
  return true;
}

/** Attribute to a player and fire one declared action. */
async function score(page, side) {
  await page.locator(`[data-qa="team-side-${side}"]`).click();
  await page.waitForTimeout(150);
  await page.locator(`[data-qa="actor-${side}"] button`).first().click();
  await page.waitForTimeout(150);
  await page.locator(`[data-qa="act-${side}-goal"]`).click();
  await settled(page);
}

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
  console.log(`\nKnockout · ${t.home} v ${t.away} · viewport ${VIEWPORT.width}x${VIEWPORT.height}\n`);

  // ---- pin the fixture to the knockout preset, straight from the API ----
  const setup = await page.evaluate(async ({ api, drawId, fixtureId }) => {
    const token = localStorage.getItem('semp_token');
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    const shelf = await fetch(`${api}/api/tournament-disciplines/${drawId}/scoring-formats`, { headers: auth })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const ko = (shelf?.presets ?? []).find((f) => f.presetKey === 'fest_2x10_ko');
    if (!ko) return { ok: false, why: `fest_2x10_ko not on the shelf (${(shelf?.presets ?? []).length} presets)` };

    const org = await fetch(`${api}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'organiser@qa.test', password: 'Qa@2026' }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (org?.token) {
      await fetch(`${api}/api/fixtures/${fixtureId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
        body: JSON.stringify({ reason: 'QA knockout harness reset' }),
      }).catch(() => {});
    }

    // THIS HARNESS SHARES ITS FIXTURE with the main football one, so run them
    // back to back and the reset can land while the previous run's sign-off still
    // holds the result lock - a 400 that means "too soon", not "broken". Unlock and
    // try again rather than reporting a product failure that is a race in the bench.
    const body = JSON.stringify({
      live_state: { format: ko }, live_log: [],
      home_score: 0, away_score: 0, status: 'scheduled', winner_team_id: null,
    });
    let res = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      res = await fetch(`${api}/api/fixtures/${fixtureId}/live`, { method: 'PATCH', headers: auth, body });
      if (res.status === 200) break;
      if (org?.token) {
        await fetch(`${api}/api/fixtures/${fixtureId}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
          body: JSON.stringify({ reason: 'QA knockout harness retry' }),
        }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    return {
      ok: res?.status === 200,
      status: res?.status,
      why: res?.status === 200 ? undefined : `PATCH kept returning ${res?.status} after unlocking`,
      minutes: ko.clock?.minutes,
      tie: ko.tieBreak,
    };
  }, { api: API, drawId: t.drawId, fixtureId: t.fixtureId });

  record('the knockout preset is on the shelf and pinned to the fixture',
    setup.ok, setup.why ?? `PATCH → ${setup.status}`);
  if (!setup.ok) { await browser.close(); return finish(); }
  record('it is two halves of 10 minutes', setup.minutes === 20, `${setup.minutes} min whole match`);
  record('with 2 x 5 minutes of extra time and a 5-kick shoot-out',
    setup.tie?.extraTime?.periods === 2 && setup.tie?.extraTime?.minutes === 5
      && setup.tie?.penalties?.kicks === 5, JSON.stringify(setup.tie));

  await page.goto(`${WEB}/score/${t.fixtureId}`, { waitUntil: 'domcontentloaded' });
  await settled(page);

  record('the board opens on the first half', (await boardText(page)).includes('half 1 of 2'),
    (await boardText(page)).slice(0, 60));

  // ---- 1-1 at full time ----
  await score(page, 'A');
  await score(page, 'B');
  await whistle(page);
  await whistle(page);
  await page.screenshot({ path: path.join(SHOTS, 'full-time.png') });

  const afterRegulation = await boardText(page);
  // THE POINT OF THE WHOLE FEATURE: the kernel does not award a level knockout.
  record('a level knockout is NOT decided at full time',
    !/wins|Drawn/i.test(await page.locator('main').innerText()),
    afterRegulation.slice(0, 70));
  record('it goes to EXTRA TIME, named as extra time',
    afterRegulation.includes('extra time 1 of 2'), afterRegulation.slice(0, 70));

  // ---- both halves of extra time, still level ----
  await whistle(page);
  const afterEt1 = await boardText(page);
  record('the second half of extra time follows the first',
    afterEt1.includes('extra time 2 of 2'), afterEt1.slice(0, 70));

  await whistle(page);
  await page.waitForTimeout(600);
  const shootThere = await page.locator('[data-qa="shootout"]').count() > 0;
  record('still level after extra time sends it to PENALTIES', shootThere);
  if (!shootThere) {
    await page.screenshot({ path: path.join(SHOTS, 'NOSHOOTOUT.png') });
    await browser.close();
    return finish();
  }

  // ---- five kicks each, all scored, so it must go to sudden death ----
  for (let i = 0; i < 10; i += 1) {
    await page.locator('[data-qa="shootout-scored"]').click();
    await settled(page);
  }
  const sudden = (await page.locator('[data-qa="shootout"]').innerText()).replace(/\s+/g, ' ');
  record('five each, all scored, goes to SUDDEN DEATH', /Sudden death/i.test(sudden),
    sudden.slice(0, 60));
  await page.screenshot({ path: path.join(SHOTS, 'sudden-death.png') });

  // ---- a split pair ends it ----
  await page.locator('[data-qa="shootout-scored"]').click();
  await settled(page);
  const midPair = await page.locator('[data-qa="shootout"]').innerText();
  record('one kick of a sudden-death pair does not end it',
    await page.locator('[data-qa="shootout-settle"]').count() === 0,
    midPair.replace(/\s+/g, ' ').slice(0, 50));

  await page.locator('[data-qa="shootout-missed"]').click();
  await settled(page);
  const settleThere = await page.locator('[data-qa="shootout-settle"]').count() > 0;
  record('the split pair decides it', settleThere);

  if (settleThere) {
    const line = (await page.locator('[data-qa="shootout"]').innerText()).replace(/\s+/g, ' ');
    record('and it is written as a penalties win', /on penalties/i.test(line), line.slice(0, 80));
    await page.locator('[data-qa="shootout-settle"]').click();
    await settled(page);
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: path.join(SHOTS, 'settled.png') });

  // ---- the record: a winner, but the SCORELINE IS STILL 1-1 ----
  const saved = await page.evaluate(async ({ api, id }) => {
    const token = localStorage.getItem('semp_token');
    // /live carries the log; the FIXTURE's own result lives on /scoring.
    const r = await fetch(`${api}/api/fixtures/${id}/scoring`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: r.status };
    const j = await r.json();
    return { status: j.status, home: j.home_score, away: j.away_score, winner: j.winner_team_id };
  }, { api: API, id: t.fixtureId });

  record('the shoot-out records a WINNER', !!saved.winner, JSON.stringify(saved));
  record('and leaves the scoreline at 1-1, because that is the match that was played',
    saved.home === 1 && saved.away === 1, `${saved.home}-${saved.away}`);
  record('the fixture is completed', saved.status === 'completed', String(saved.status));

  record('no page errors or failed requests', problems.length === 0, problems.slice(0, 3).join(' · '));
  await browser.close();
  finish();
}

function finish() {
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FOOTBALL KNOCKOUT · ${pass}/${checks.length} checks passed · ${VIEWPORT.width}x${VIEWPORT.height}`);
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
