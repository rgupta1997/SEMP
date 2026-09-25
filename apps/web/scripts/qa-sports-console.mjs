/*
 * EVERY SPORT'S CONSOLE, IN A REAL BROWSER.
 *
 *   node scripts/qa-sports-console.mjs
 *   QA_VIEWPORT=desktop node scripts/qa-sports-console.mjs
 *   QA_ONLY=badminton,kabaddi node scripts/qa-sports-console.mjs
 *
 * The engine suites prove the maths. This proves the SCREEN: that each of the
 * thirty sports opens the console it is supposed to, that the controls are there,
 * that a tap actually changes the score, that undo takes it back, and that nothing
 * throws while you do it.
 *
 * It replaces qa-all-consoles.mjs, which fails 62 of 65 - not because the product
 * is broken but because its fixture list was written once, months ago, against ids
 * that have since been re-seeded, and its base URL predates the move to /app. Every
 * one of those 62 "failures" is the harness. A harness that cries wolf is worse than
 * no harness, because it trains you to ignore it.
 *
 * Reads apps/web/scripts/qa-sports.json, written by scripts/qa-sports-bench.ts.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const API = process.env.QA_API_ORIGIN ?? 'http://localhost:4000';
const PW = 'Qa@2026';
const WHO = 'official@qa.test';
const SHOTS = path.join(import.meta.dirname, 'qa-sports-shots');
const LIST = path.join(import.meta.dirname, 'qa-sports.json');
const DESKTOP = process.env.QA_VIEWPORT === 'desktop';
const VIEWPORT = DESKTOP ? { width: 1440, height: 900 } : { width: 390, height: 844 };
const ONLY = (process.env.QA_ONLY ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const checks = [];
const problems = [];
let scope = '';

function record(name, pass, detail = '') {
  checks.push({ scope, name, pass, detail });
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

/** Unlock and wipe, so a second run measures the product and not the first run. */
async function resetFixture(page, fixtureId) {
  return page.evaluate(async ([id, api]) => {
    const token = localStorage.getItem('semp_token');
    const org = await fetch(`${api}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'organiser@qa.test', password: 'Qa@2026' }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (org?.token) {
      await fetch(`${api}/api/fixtures/${id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
        body: JSON.stringify({ reason: 'QA all-sports console harness reset' }),
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

/** The visible scoreline, however the console draws it. */
const bigNumbers = (page) => page.evaluate(() => {
  const el = document.querySelector('main');
  if (!el) return '';
  return (el.innerText || '').replace(/\s+/g, ' ').slice(0, 400);
});

const isLandingPage = (text) => /EVENT OPERATING SYSTEM|Run the whole meet/i.test(text);

/* --------------------------------------------------------------------------
 * One family at a time: what "score something" means differs per console.
 * ------------------------------------------------------------------------ */

async function driveRacquet(page) {
  const a = page.locator('[data-qa="rally-A"]');
  if (!await a.count()) return { drove: false, why: 'no rally buttons' };
  const before = await bigNumbers(page);
  await a.click();
  await settled(page);
  const after = await bigNumbers(page);
  return { drove: true, changed: before !== after, before, after };
}

async function driveTeam(page) {
  const btn = page.locator('[data-qa^="team-score-A-"]').first();
  if (!await btn.count()) return { drove: false, why: 'no scoring buttons' };
  const before = await bigNumbers(page);
  await btn.click();
  await settled(page);
  const after = await bigNumbers(page);
  return { drove: true, changed: before !== after, before, after };
}

/** The rankings console: place inputs / selects per org. */
async function driveEvent(page) {
  const inputs = page.locator('main input[type="number"], main select');
  const count = await inputs.count();
  if (!count) return { drove: false, why: 'no place inputs' };
  const before = await bigNumbers(page);
  const first = inputs.first();
  const tag = await first.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    const opts = await first.locator('option').count();
    if (opts > 1) await first.selectOption({ index: 1 });
  } else {
    await first.fill('1');
    await first.blur();
  }
  await settled(page);
  const after = await bigNumbers(page);
  return { drove: true, changed: before !== after, before, after };
}

/** The manual/result console: two score boxes and an apply. */
async function driveResult(page) {
  const inputs = page.locator('main input[type="number"], main input[inputmode="numeric"]');
  if (!await inputs.count()) return { drove: false, why: 'no score inputs' };
  const before = await bigNumbers(page);
  await inputs.first().fill('3');
  await inputs.first().blur();
  await settled(page);
  const after = await bigNumbers(page);
  return { drove: true, changed: before !== after, before, after };
}

/**
 * The tie console: one fixture holding five contests. Open a rubber, score in it,
 * and the tie's own tally is what has to move.
 */
async function driveTie(page) {
  const rubber = page.locator('main button', { hasText: /Singles|Doubles|Board \d/ }).first();
  if (!await rubber.count()) return { drove: false, why: 'no rubbers to open' };
  await rubber.click();
  await settled(page);
  // The WHOLE screen, not the header: the tie tally stays 0-0 until a rubber is
  // decided, and what a point moves is the rubber's own score further down.
  const whole = () => page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '));
  const before = await whole();
  // A rubber's own deck is the tie console's, not the racquet deck - its scoring
  // control is a plain "+1" per side.
  const pt = page.locator('[data-qa="rally-A"], [data-qa^="team-score-A-"]').first();
  const plus = page.locator('main button', { hasText: /^\+\d+$/ }).first();
  const target = await pt.count() ? pt : plus;
  if (!await target.count()) return { drove: false, why: 'the rubber opened no deck to score in' };
  await target.click();
  await settled(page);
  const after = await whole();
  return { drove: true, changed: before !== after, before, after };
}

const DRIVERS = {
  racquet: driveRacquet,
  team: driveTeam,
  event: driveEvent,
  result: driveResult,
  tie: driveTie,
  cricket: null,   // covered end-to-end by qa-cricket-console.mjs
};

/**
 * WHICH CONSOLE ACTUALLY RENDERED - detected, not predicted.
 *
 * Predicting it from the sport gets the combat and board sports wrong: chess, judo,
 * boxing, fencing, wrestling, taekwondo, arm wrestling and tug of war all run on the
 * rally kernel, so a sport-based guess says "team deck" - and the page correctly
 * opens the "Enter result" form instead, because a judo bout has no point stream
 * anybody wants to tap. A harness that predicts reports eight false failures; a
 * harness that detects reports what the official sees.
 */
async function detectConsole(page) {
  const head = await bigNumbers(page);
  // The tie is checked FIRST: it wraps a rubber whose own deck may be showing, so a
  // rally button inside a rubber would otherwise read as a plain racquet match.
  if (/rubbers played|FIRST TO \d+ RUBBERS/i.test(head)) return 'tie';
  if (await page.locator('[data-qa="cricket-deck"]').count()) return 'cricket';
  if (await page.locator('[data-qa="rally-A"]').count()) return 'racquet';
  if (await page.locator('[data-qa^="team-score-"]').count()) return 'team';
  const text = head;
  if (/Enter result|Save & complete/i.test(text)) return 'result';
  if (/rank|place|medal|heat|lift/i.test(text)
    && await page.locator('main input, main select').count()) return 'event';
  return 'unknown';
}

async function run() {
  let targets = JSON.parse(readFileSync(LIST, 'utf8'));
  if (ONLY.length) targets = targets.filter((t) => ONLY.includes(t.sport.toLowerCase()));
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/unlock')) return;   // expected 400 when not locked
    if (r.status() >= 400 && r.url().includes('/api/')) {
      problems.push(`${r.status()} ${r.url().split('/api/')[1]}`);
    }
  });

  if (!await login(page)) { console.error('could not sign in'); process.exit(1); }
  console.log(`\nSigned in as ${WHO} · viewport ${VIEWPORT.width}x${VIEWPORT.height} · ${targets.length} sports\n`);

  for (const t of targets) {
    scope = `${t.sport} (${t.engine})`;
    console.log(`\n${'='.repeat(70)}\n${scope} — ${t.discipline}`);
    const before = problems.length;

    const reset = await resetFixture(page, t.fixtureId);
    record('the fixture resets to unscored', reset === 200, `PATCH /live → ${reset}`);
    const before2 = problems.length;

    await page.goto(`${WEB}/score/${t.fixtureId}`, { waitUntil: 'domcontentloaded' });
    await settled(page);

    const text = await bigNumbers(page);

    // ---- 1. the right screen opened at all ----
    record('the console page opens (not the marketing site)', !isLandingPage(text),
      isLandingPage(text) ? text.slice(0, 80) : '');
    if (isLandingPage(text)) {
      await page.screenshot({ path: path.join(SHOTS, `${t.sport.replace(/\W+/g, '-')}-LANDING.png`) });
      continue;
    }

    // ---- 2. it is not an error / empty state ----
    const blocked = /can.t be recorded yet|aren.t set yet|Match not found|No cricket format|not available to you/i.test(text);
    record('the fixture is scoreable', !blocked, blocked ? text.slice(0, 110) : '');

    // ---- 3. controls exist ----
    const buttons = await page.locator('main button').count();
    const inputs = await page.locator('main input, main select').count();
    record('the console offers controls', buttons + inputs > 3, `${buttons} buttons, ${inputs} fields`);

    // ---- 4. it names the two sides it is scoring ----
    //
    // Better than looking for scoring vocabulary: "does this screen know whose match
    // it is" is the question, and every console answers it the same way.
    const names = [t.home, t.away].filter((x) => x && x !== '—');
    const namesSides = names.length === 0
      || names.every((nm) => text.toLowerCase().includes(String(nm).toLowerCase().slice(0, 12)));
    record('the screen names the sides it is scoring', namesSides,
      namesSides ? '' : `expected ${names.join(' v ')}`);

    // ---- 5. which console actually opened ----
    const got = await detectConsole(page);
    record('a known console rendered', got !== 'unknown',
      got === 'unknown' ? text.slice(0, 110) : `${got}${got === t.engine ? '' : ` (bench expected ${t.engine})`}`);

    // ---- 6. scoring actually moves the score ----
    const drive = DRIVERS[got];
    if (blocked) {
      record('a tap changes the score', false, 'skipped: the fixture is not scoreable');
    } else if (got === 'cricket') {
      record('a tap changes the score', true, 'covered by qa-cricket-console.mjs');
    } else if (!drive) {
      record('a tap changes the score', false, `no driver for a "${got}" console`);
    } else {
      const r = await drive(page);
      if (!r.drove) {
        record('a tap changes the score', false, r.why);
      } else {
        record('a tap changes the score', !!r.changed,
          r.changed ? '' : `screen unchanged after the tap: ${String(r.after).slice(0, 90)}`);
      }
    }

    // ---- 7. the ball-by-ball deck, where the manual form was only the default ----
    //
    // A sport that opens on "Enter result" usually still HAS a live deck behind the
    // Detailed toggle, and an official can switch to it mid-match. That path is as
    // real as the default one.
    const detailed = page.locator('main button', { hasText: /Detailed/ }).first();
    if (!blocked && got === 'result' && await detailed.count()) {
      await detailed.click();
      await settled(page);
      const deck = await detectConsole(page);
      record('the Detailed toggle opens a live deck', deck === 'team' || deck === 'racquet',
        `switching to Detailed gave a "${deck}" console`);
      const d2 = DRIVERS[deck];
      if (d2) {
        const r2 = await d2(page);
        record('and that deck scores', r2.drove && !!r2.changed,
          r2.drove ? (r2.changed ? '' : 'the screen did not change') : r2.why);
      }
    }

    // ---- 7b. THE TEAM TIE, where the sport has one ----
    //
    // A tie is one fixture holding five contests, and it is the only console where
    // the fixture can be finished with nothing left to play and no winner - the
    // shipped chess template is four boards decided by a majority of three, so 2-2
    // is an ordinary result. That used to be a dead end: sign-off refused, telling
    // the official to "record rubber results until one side reaches 3" with no
    // rubbers left to record.
    if (t.hasTieTemplate && !blocked) {
      const tieTab = page.locator('main button', { hasText: /Team tie/i }).first();
      if (await tieTab.count()) {
        await tieTab.click();
        await settled(page);
        const tieText = await bigNumbers(page);
        const rubberButtons = await page.locator('main button').count();
        record('the team tie console renders', rubberButtons > 3 && !isLandingPage(tieText),
          tieText.slice(0, 70));

        // Decide a rubber and check the tally moves.
        const wonBtn = page.locator('main button', { hasText: /won$|^Won/i }).first();
        if (await wonBtn.count()) {
          const before = await bigNumbers(page);
          await wonBtn.click();
          await settled(page);
          const after = await bigNumbers(page);
          record('deciding a rubber moves the tie', before !== after,
            before === after ? 'the screen did not change' : '');
        }
        const tieErrors = problems.slice(before2);
        record('the tie console throws nothing', tieErrors.length === 0,
          tieErrors.slice(0, 2).join(' | '));
      }
    }

    // ---- 8. undo is offered wherever points are tapped ----
    const nowShowing = await detectConsole(page);
    if (nowShowing === 'racquet' || nowShowing === 'team') {
      const undo = page.locator('main button', { hasText: /^Undo$/ }).first();
      const hasUndo = await undo.count() > 0;
      record('undo is offered', hasUndo);
      if (hasUndo && await undo.isEnabled()) {
        const b = await bigNumbers(page);
        await undo.click();
        await settled(page);
        const a = await bigNumbers(page);
        record('undo takes the point back', b !== a, a === b ? 'the screen did not change' : '');
      }
    }

    // ---- 7. nothing threw ----
    await page.screenshot({ path: path.join(SHOTS, `${t.sport.replace(/\W+/g, '-')}.png`) });
    const mine = problems.slice(before);
    record('no page errors or failed requests', mine.length === 0, mine.slice(0, 3).join(' | '));
  }

  await browser.close();

  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`ALL SPORTS · ${pass}/${checks.length} checks passed · viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    const bySport = new Map();
    for (const f of failed) {
      if (!bySport.has(f.scope)) bySport.set(f.scope, []);
      bySport.get(f.scope).push(f);
    }
    for (const [sport, rows] of bySport) {
      console.log(`  ${sport}`);
      for (const r of rows) console.log(`    ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }
  console.log(`\nScreenshots: ${SHOTS}`);
  writeFileSync(path.join(SHOTS, 'verdict.json'), JSON.stringify({ viewport: VIEWPORT, checks, problems }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
