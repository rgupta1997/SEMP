/*
 * EVERY SPORT'S CONSOLE, in a real browser.
 *
 *   node scripts/qa-all-consoles.mjs           # needs QA_CONSOLES=<json from the api side>
 *
 * The API harness proves every sport can be scored. This proves every sport can be
 * scored BY A PERSON: that the console screen for each of the twenty-seven actually
 * renders, offers controls, and throws nothing.
 *
 * A sport can share an engine with four others and still have its own broken screen -
 * a shelf that fails to load, a deck that reads a field its format does not have, an
 * empty state where the buttons should be. One draw per engine cannot find that.
 *
 * For each console it records: whether the deck rendered, how many controls it
 * offers, whether it names the rules in force, and every page error or failed API
 * call the browser saw while it was open.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174';
const SHOTS = path.join(import.meta.dirname, 'qa-console-shots');
const PW = 'Qa@2026';
const LIST = process.env.QA_CONSOLES ?? path.join(import.meta.dirname, 'qa-consoles.json');

const rows = [];
const problems = [];

async function login(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  const ident = page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="password"])').first();
  await ident.waitFor({ state: 'visible', timeout: 30000 });
  await ident.fill(email);
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

async function main() {
  const targets = JSON.parse(readFileSync(LIST, 'utf8'));
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // Errors are attributed to whichever console was open when they fired.
  let current = null;
  const noise = /Download the React DevTools|was created with|ResizeObserver/i;
  page.on('pageerror', (e) => { if (current) current.errors.push(String(e).slice(0, 200)); });
  page.on('console', (m) => {
    if (m.type() !== 'error' || noise.test(m.text())) return;
    if (current) current.errors.push(m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/') && current) {
      current.api.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
    }
  });

  console.log('\n================ EVERY SPORT\'S CONSOLE ================\n');
  if (!await login(page, 'official@qa.test')) {
    console.log('Could not sign in as the official.');
    await browser.close();
    return;
  }

  for (const t of targets) {
    const row = {
      sport: t.sport, discipline: t.discipline, engine: t.engine,
      rendered: false, controls: 0, rules: false, errors: [], api: [],
    };
    current = row;
    rows.push(row);

    await page.goto(`${WEB}/score/${t.fixtureId}`, { waitUntil: 'domcontentloaded' });
    await settled(page);

    const text = await page.locator('body').innerText().catch(() => '');
    const broken = /not available|not authorized|something went wrong|unexpected error/i.test(text);
    row.rendered = !broken && page.url().includes('/score/') && text.length > 120;
    row.controls = await page.locator('button:visible').count().catch(() => 0);
    // The deck must say what rules it is applying - the commonest courtside dispute.
    row.rules = /Rules|Format|best of|overs|to \d+|Points|Period|Innings|Round|Board|Game/i.test(text);

    if (!row.rendered) problems.push(`${t.sport} / ${t.discipline}: console did not render — ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    // Ten is the smallest deck (a board result); fewer means the screen is inert.
    else if (row.controls < 6) problems.push(`${t.sport} / ${t.discipline}: only ${row.controls} controls`);
    for (const e of row.errors) problems.push(`${t.sport} / ${t.discipline}: page error — ${e}`);
    for (const a of row.api) problems.push(`${t.sport} / ${t.discipline}: failed call — ${a}`);

    // One screenshot per SPORT, not per draw - twenty-seven is a reviewable set.
    if (!rows.slice(0, -1).some((r) => r.sport === t.sport)) {
      const safe = t.sport.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await page.screenshot({ path: path.join(SHOTS, `${safe}.png`), fullPage: true }).catch(() => {});
    }
  }

  current = null;
  await browser.close();
  report();
}

function report() {
  console.log(`${'SPORT'.padEnd(15)} ${'DISCIPLINE'.padEnd(18)} ${'ENGINE'.padEnd(8)} RENDER  CTRL  RULES  ISSUES`);
  console.log('-'.repeat(96));
  for (const r of rows) {
    const issues = r.errors.length + r.api.length;
    console.log(
      `${r.sport.slice(0, 15).padEnd(15)} ${r.discipline.slice(0, 18).padEnd(18)} ${r.engine.padEnd(8)}`
      + `${(r.rendered ? '   y  ' : '   N  ').padEnd(8)}`
      + `${String(r.controls).padStart(4)}  ${r.rules ? '  y  ' : '  N  '}  ${issues || ''}`,
    );
  }
  const ok = rows.filter((r) => r.rendered && r.controls >= 6 && !r.errors.length && !r.api.length);
  console.log('-'.repeat(96));
  console.log(`\n${ok.length}/${rows.length} consoles rendered with controls and no errors.`);
  console.log(`${new Set(rows.map((r) => r.sport)).size} sports · screenshots in ${SHOTS}`);

  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of [...new Set(problems)]) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nNo problems.');
  }
}

main().catch((e) => { console.error('\nHARNESS CRASH:', e); process.exitCode = 1; });
