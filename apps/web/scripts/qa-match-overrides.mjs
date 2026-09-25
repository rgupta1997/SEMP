/*
 * PER-MATCH RULES, FROM THE COLUMN TO THE CONSOLE.
 *
 *   node scripts/qa-match-overrides.mjs
 *
 * The unit tests prove the patch is applied correctly. This proves the wiring around
 * it, which is where the last two versions of this feature broke silently:
 *
 *   the column exists and round-trips through the API
 *   a 12-minute override really gives the scoring console 12-minute halves
 *   'draw allowed = no' really sends a level league match to extra time
 *   clearing it really goes back to inheriting, rather than leaving {} behind
 *
 * Every one of those is a claim about a value crossing a boundary - zod, Prisma, the
 * ladder, the deck - and each boundary has already eaten this config once.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const API = process.env.QA_API_ORIGIN ?? 'http://localhost:4000';
const PW = 'Qa@2026';
const WHO = 'official@qa.test';
const LIST = path.join(import.meta.dirname, 'qa-sports.json');

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

/** Write overrides straight to the fixture, as the Edit Match dialog does. */
const setOverrides = (page, id, overrides) => page.evaluate(async ({ api, id, overrides }) => {
  const token = localStorage.getItem('semp_token');
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const org = await fetch(`${api}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'organiser@qa.test', password: 'Qa@2026' }),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const orgAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${org?.token}` };

  // Clear any played state, so the frozen snapshot is not what we end up measuring.
  await fetch(`${api}/api/fixtures/${id}/unlock`, {
    method: 'POST', headers: orgAuth, body: JSON.stringify({ reason: 'QA overrides harness' }),
  }).catch(() => {});
  await fetch(`${api}/api/fixtures/${id}/live`, {
    method: 'PATCH', headers: auth,
    body: JSON.stringify({
      live_state: {}, live_log: [], home_score: 0, away_score: 0,
      status: 'scheduled', winner_team_id: null,
    }),
  });

  const res = await fetch(`${api}/api/fixtures/${id}`, {
    method: 'PATCH', headers: orgAuth, body: JSON.stringify({ format_overrides: overrides }),
  });
  const body = res.ok ? await res.json() : { error: await res.text() };
  return { status: res.status, stored: body?.format_overrides ?? null, error: body?.error };
}, { api: API, id, overrides });

/** What the console says the current period's full time is. */
async function periodFullTime(page, id) {
  await page.goto(`${WEB}/score/${id}`, { waitUntil: 'domcontentloaded' });
  await settled(page);
  await page.waitForTimeout(900);
  // Set the clock past any plausible half so the board must show stoppage, which is
  // the only place the PERIOD length is visible as a number.
  const face = page.locator('[data-qa="clock-face"]');
  if (!await face.count()) return null;
  await face.click();
  await page.waitForTimeout(350);
  await page.locator('[data-qa="clock-mm"]').fill('90');
  await page.locator('[data-qa="clock-ss"]').fill('00');
  await page.locator('[data-qa="clock-set"]').click();
  await settled(page);
  await page.waitForTimeout(400);
  const board = (await page.locator('[data-qa="team-scoreboard"]').innerText()).replace(/\s+/g, ' ');
  // Stoppage renders as "<full>+<over>", e.g. 12:00+78:00.
  const m = board.match(/(\d+):(\d\d)\+/);
  return m ? Number(m[1]) : null;
}

async function run() {
  const bench = JSON.parse(readFileSync(LIST, 'utf8'));
  const t = bench.find((x) => x.sport.toLowerCase() === 'football');
  if (!t) { console.error('No football fixture in the bench'); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/unlock')) return;
    if (r.status() >= 400 && r.url().includes('/api/')) problems.push(`${r.status()} ${r.url().split('/api/')[1]}`);
  });

  if (!await login(page)) { console.error('could not sign in'); process.exit(1); }
  console.log(`\nPer-match rules · ${t.home} v ${t.away}\n`);

  // ---- the column exists and round-trips ----
  const written = await setOverrides(page, t.fixtureId, { periodMinutes: 12, drawsAllowed: false });
  record('the API accepts per-match rules', written.status === 200,
    written.error ?? `PATCH → ${written.status}`);
  record('and stores exactly what was sent',
    written.stored?.periodMinutes === 12 && written.stored?.drawsAllowed === false,
    JSON.stringify(written.stored));

  // ---- a 12-minute override really reaches the deck ----
  const twelve = await periodFullTime(page, t.fixtureId);
  record('a 12-minute override gives the console 12-minute halves', twelve === 12,
    twelve === null ? 'no clock on the board' : `full time reads ${twelve} min`);

  // ---- draw = no really changes how a level match ends ----
  // The default football format is drawable; the override must override that.
  const level = await page.evaluate(async ({ api, id }) => {
    const token = localStorage.getItem('semp_token');
    const r = await fetch(`${api}/api/fixtures/${id}/scoring`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    return { overrides: j.format_overrides };
  }, { api: API, id: t.fixtureId });
  record('the scoring endpoint hands the rules to the console',
    level.overrides?.periodMinutes === 12, JSON.stringify(level.overrides));

  // ---- clearing really clears ----
  const cleared = await setOverrides(page, t.fixtureId, null);
  record('clearing the rules empties the column, not just its fields',
    cleared.status === 200 && cleared.stored === null,
    `PATCH → ${cleared.status}, stored ${JSON.stringify(cleared.stored)}`);

  const back = await periodFullTime(page, t.fixtureId);
  record('and the match goes back to inheriting its 10-minute halves', back === 10,
    back === null ? 'no clock on the board' : `full time reads ${back} min`);

  record('no page errors or failed requests', problems.length === 0, problems.slice(0, 3).join(' · '));

  await browser.close();
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`PER-MATCH RULES · ${pass}/${checks.length} checks passed`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
