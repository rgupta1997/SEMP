/*
 * THE CRICKET CONSOLE, IN A REAL BROWSER.
 *
 *   node scripts/qa-cricket-console.mjs
 *   QA_VIEWPORT=desktop node scripts/qa-cricket-console.mjs
 *
 * The engine suite proves the scorecard is right. This proves the SCREEN is right,
 * and specifically the three things a scorer standing at a boundary cares about:
 *
 *   NO SCROLL      the whole console fits the viewport, so the 4 is always reachable
 *   NOTHING MOVES  opening the wicket or extras panel does not shift the scoreboard
 *                  or resize the deck - the old deck grew a card at the bottom of a
 *                  scrolling column, which moved every button mid-over
 *   NOTHING BREAKS no page error, no failed request, and the innings can always be
 *                  given another ball
 *
 * It then plays a real innings through the buttons and checks the score on screen
 * against the score the engine would compute from the same taps.
 *
 * Reads apps/web/scripts/qa-cricket.json, written by the API-side bench script.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const PW = 'Qa@2026';
const WHO = 'official@qa.test';
const SHOTS = path.join(import.meta.dirname, 'qa-cricket-shots');
const LIST = path.join(import.meta.dirname, 'qa-cricket.json');
const DESKTOP = process.env.QA_VIEWPORT === 'desktop';
const VIEWPORT = DESKTOP ? { width: 1440, height: 900 } : { width: 390, height: 844 };

const checks = [];
const problems = [];

function record(scope, name, pass, detail = '') {
  checks.push({ scope, name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
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

/**
 * How far anything around the console can scroll. The point is that it stays at zero.
 *
 * NOT `document.documentElement.scrollHeight`. The app shell scrolls inside a
 * `<main class="overflow-auto">`, so the document never overflows however far the
 * content runs past the bottom - measuring the document alone reported a clean zero
 * while the shell was scrolling by 486px.
 */
const pageOverflow = (page) => page.evaluate(() => {
  let worst = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  let el = document.querySelector('[data-qa="cricket-deck"]');
  while (el && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') worst = Math.max(worst, el.scrollHeight - el.clientHeight);
    el = el.parentElement;
  }
  return worst;
});

/** Where the scoreboard is, so "did the layout move?" is a number and not a feeling. */
const geometry = (page) => page.evaluate(() => {
  const score = document.querySelector('[data-qa="cricket-scoreboard"]');
  const deck = document.querySelector('[data-qa="cricket-deck"]');
  const region = document.querySelector('[data-qa="cricket-region"]');
  const box = (el) => (el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(el.getBoundingClientRect()) : null);
  return { score: box(score), deck: box(deck), region: box(region) };
});

const near = (a, b) => Math.abs(a - b) <= 1;
/** Within a pixel. Sub-pixel layout rounds differently between two measurements;
 *  a panel that MOVES things moves them by tens of pixels, not by one. */
const same = (a, b) => !!a && !!b && near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
/** Size only. The deck's TOP can legitimately move when the chrome above it changes
 *  (a status badge going from "scheduled" to "live"); its SIZE opening a panel cannot. */
const sameSize = (a, b) => !!a && !!b && near(a.width, b.width) && near(a.height, b.height);

/** Tap a button by its visible text, inside the console only. */
async function tap(page, text, opts = {}) {
  const b = page.locator(`[data-qa="cricket-deck"] button`, { hasText: text }).first();
  await b.waitFor({ state: 'visible', timeout: opts.timeout ?? 8000 });
  await b.click();
  await page.waitForTimeout(opts.wait ?? 260);
}

/** Tap the run pad's exact digit, which `hasText` alone would match too loosely. */
async function tapRun(page, n) {
  const b = page.locator(`[data-qa="run-${n}"]`).first();
  await b.waitFor({ state: 'visible', timeout: 8000 });
  await b.click();
  await page.waitForTimeout(280);
}

/** The first person offered on a "who is…" panel. */
async function pickFirstPerson(page) {
  const panel = page.locator('[data-qa="pick-panel"]');
  if (!await panel.count()) return null;
  const btn = panel.locator('button').first();
  if (!await btn.count()) return null;
  const name = (await btn.innerText()).split('\n')[0].trim();
  await btn.click();
  await page.waitForTimeout(320);
  return name;
}

/** Whatever the console is asking for, answer it - openers, then a bowler. */
async function openTheInnings(page, limit = 6) {
  const named = [];
  for (let i = 0; i < limit; i += 1) {
    if (!await page.locator('[data-qa="pick-panel"]').count()) break;
    const who = await pickFirstPerson(page);
    if (!who) break;
    named.push(who);
    await settled(page);
  }
  return named;
}

const scoreText = (page) => page.locator('[data-qa="cricket-innings-line"]').first().innerText();

/**
 * Wipe the ball log before each run.
 *
 * Without this the harness is only correct the first time: a second run opens a
 * fixture that already has five overs on it, and every assertion about "three
 * deliveries reach the scoreboard" is measuring the previous run's score.
 */
async function resetFixture(page, fixtureId) {
  return page.evaluate(async (id) => {
    const API = 'http://localhost:4000/api';
    const token = localStorage.getItem('semp_token');

    // A LOCKED scorecard refuses a score, correctly - and the end-to-end harness
    // leaves every bench fixture locked. Unlocking needs the organiser, not the
    // official this browser is signed in as, so that one call is made directly.
    const org = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'organiser@qa.test', password: 'Qa@2026' }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (org?.token) {
      await fetch(`${API}/fixtures/${id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
        body: JSON.stringify({ reason: 'QA cricket console harness reset' }),
      }).catch(() => {});
    }

    const res = await fetch(`${API}/fixtures/${id}/live`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        live_state: { cricket: [] }, live_log: [],
        home_score: 0, away_score: 0, status: 'scheduled', winner_team_id: null,
      }),
    });
    return res.status;
  }, fixtureId);
}

async function run() {
  const targets = JSON.parse(readFileSync(LIST, 'utf8'))
    .filter((t) => t.entryMode !== 'summary');
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    // The reset unlocks first and a fixture that is not locked answers 400. That is
    // the harness tidying up, not the product failing.
    if (r.url().includes('/unlock')) return;
    if (r.status() >= 400 && r.url().includes('/api/')) problems.push(`${r.status()} ${r.url().split('/api/')[1]}`);
  });

  if (!await login(page)) { console.error('could not sign in'); process.exit(1); }
  console.log(`\nSigned in as ${WHO} · viewport ${VIEWPORT.width}x${VIEWPORT.height}\n`);

  for (const t of targets) {
    const scope = `${t.sport} · ${t.formatName}`;
    console.log(`\n${'='.repeat(70)}\n${scope}`);
    const before = problems.length;

    // Start from an unscored match, or every assertion measures the last run.
    const reset = await resetFixture(page, t.fixtureId);
    record(scope, 'the fixture resets to unscored before the run', reset === 200, `PATCH /live → ${reset}`);

    await page.goto(`${WEB}/score/${t.fixtureId}`, { waitUntil: 'domcontentloaded' });
    await settled(page);

    // The deck opens on the Detailed tab for a ball-by-ball format; click it if the
    // page landed elsewhere.
    const detailed = page.locator('button:has-text("Detailed")').first();
    if (await detailed.count() && !await page.locator('[data-qa="cricket-deck"]').count()) {
      await detailed.click();
      await settled(page);
    }

    const deckThere = await page.locator('[data-qa="cricket-deck"]').count() > 0;
    record(scope, 'the cricket deck renders', deckThere);
    if (!deckThere) {
      await page.screenshot({ path: path.join(SHOTS, `${t.preset}-${t.entryMode}-NODECK.png`), fullPage: false });
      continue;
    }

    // ---- 1. no scroll on arrival ----
    const overflow0 = await pageOverflow(page);
    record(scope, 'the console fits the viewport with no page scroll', overflow0 <= 1, `overflow ${overflow0}px`);

    // ---- 2. open the innings through the panels the console asks for ----
    const named = await openTheInnings(page);
    record(scope, 'the console asks for the openers and the bowler', named.length >= 3,
      named.length ? named.join(', ') : 'nothing was asked for');

    const padThere = await page.locator('[data-qa="run-4"]').count() > 0;
    record(scope, 'the run pad appears once everybody is named', padThere);
    if (!padThere) {
      await page.screenshot({ path: path.join(SHOTS, `${t.preset}-NOPAD.png`) });
      continue;
    }

    // ---- 3. score a few real deliveries ----
    await tapRun(page, 4);
    await tapRun(page, 1);
    await tapRun(page, 6);
    await settled(page);
    const after3 = await scoreText(page);
    record(scope, 'three deliveries reach the scoreboard', /11\/0/.test(after3), `reads "${after3.replace(/\n/g, ' ')}"`);

    // ---- 4. a wide is one tap and does not advance the over ----
    // The baseline for "nothing moves" is taken HERE, after the first deliveries have
    // flipped the fixture from scheduled to live and the chrome above has settled.
    // Taken before that, it measures the status change rather than the panels.
    const base = await geometry(page);

    const oversBefore = (after3.match(/\(([\d.]+)\)/) ?? [])[1];
    await tap(page, 'Wide');
    await settled(page);
    const afterWide = await scoreText(page);
    const oversAfter = (afterWide.match(/\(([\d.]+)\)/) ?? [])[1];
    record(scope, 'a wide is ONE tap and does not advance the over',
      oversBefore === oversAfter, `${oversBefore} → ${oversAfter}`);

    // ---- 5. THE PANELS SWAP IN PLACE ----
    for (const [label, opener] of [['Wicket', 'WICKET'], ['Extra', 'Bye / more'], ['Scorecard', 'Card'], ['More', 'More']]) {
      await tap(page, opener);
      const g = await geometry(page);
      const of = await pageOverflow(page);
      record(scope, `${label}: the scoreboard does not move`, same(base.score, g.score),
        `${JSON.stringify(base.score)} vs ${JSON.stringify(g.score)}`);
      record(scope, `${label}: the deck does not change size`, sameSize(base.deck, g.deck),
        `${base.deck?.width}x${base.deck?.height} vs ${g.deck?.width}x${g.deck?.height}`);
      record(scope, `${label}: the working region keeps its exact box`, same(base.region, g.region),
        `${JSON.stringify(base.region)} vs ${JSON.stringify(g.region)}`);
      record(scope, `${label}: still no page scroll`, of <= 1, `overflow ${of}px`);
      await page.screenshot({ path: path.join(SHOTS, `${t.preset}-${label.toLowerCase()}.png`) });
      // back to the pad
      const cancel = page.locator('[data-qa="cricket-deck"] button', { hasText: /^(Cancel|Close)$/ }).first();
      if (await cancel.count()) { await cancel.click(); await page.waitForTimeout(240); }
      else { await tap(page, opener); }
    }

    // ---- 6. a wicket, recorded through the form ----
    await tap(page, 'WICKET');
    const record4 = page.locator('[data-qa="cricket-deck"] button', { hasText: 'Record the wicket' }).first();
    if (await record4.count()) {
      // name a next batter if one is offered, so the innings carries on
      const nextChip = page.locator('[data-qa="wicket-next"] button').first();
      if (await nextChip.count()) { await nextChip.click(); await page.waitForTimeout(150); }
      await record4.click();
      await settled(page);
      const afterW = await scoreText(page);
      record(scope, 'a wicket recorded through the form reaches the scoreboard',
        /\/1/.test(afterW), `reads "${afterW.replace(/\n/g, ' ')}"`);
      const of = await pageOverflow(page);
      record(scope, 'still no page scroll after a wicket', of <= 1, `overflow ${of}px`);
    } else {
      record(scope, 'the wicket form offers "Record the wicket"', false);
    }

    // ---- 7. undo puts it back ----
    const undoThere = await page.locator('[data-qa="cricket-deck"] button', { hasText: 'Undo' }).count() > 0;
    if (undoThere) {
      const beforeUndo = await scoreText(page);
      await tap(page, 'Undo');
      await settled(page);
      const afterUndo = await scoreText(page);
      record(scope, 'undo takes the last ball back', beforeUndo !== afterUndo,
        `${beforeUndo.replace(/\n/g, ' ')} → ${afterUndo.replace(/\n/g, ' ')}`);
    }

    // ---- 8. bowl to the end of the over and be asked for a new bowler ----
    let guard = 0;
    while (guard < 14 && !await page.locator('[data-qa="pick-panel"]').count()) {
      guard += 1;
      if (!await page.locator('[data-qa="run-0"]').count()) break;
      await tapRun(page, 0);
    }
    const asked = await page.locator('[data-qa="pick-panel"]').count() > 0;
    record(scope, 'the end of the over asks who bowls the next one', asked,
      asked ? (await page.locator('[data-qa="pick-title"]').innerText()) : `after ${guard} dots`);
    if (asked) {
      const title = await page.locator('[data-qa="pick-title"]').innerText();
      // A one-over format runs out of overs inside this loop, so it is the NEXT
      // innings' openers that get asked for - equally correct, and still not a
      // stranded console.
      record(scope, 'and it names what it needs', /bowl|strike|other end/i.test(title), title);
      const of = await pageOverflow(page);
      record(scope, 'still no page scroll at the change of over', of <= 1, `overflow ${of}px`);
    }

    // ---- 9. TAKE WICKETS UNTIL THE BENCH IS EMPTY ----
    //
    // The scenario that strands a console. With `lastManStands` the survivor has to
    // keep batting alone; without it, the innings has to CLOSE when there is nobody
    // left to come in - which the engine cannot decide on its own, because it counts
    // wickets against the format and the format need not match the team sheet.
    // Either way the console must never reach a state that is neither scoreable nor
    // closeable.
    let stuck = null;
    let fell = 0;
    for (let i = 0; i < 24; i += 1) {
      // Answer whatever it asks for first.
      if (await page.locator('[data-qa="pick-panel"]').count()) {
        const who = await pickFirstPerson(page);
        if (!who) { stuck = 'a pick panel with nobody to pick'; break; }
        await settled(page);
        continue;
      }
      if (!await page.locator('[data-qa="run-0"]').count()) {
        // No pad and no pick panel: legitimate only if the innings or match is over
        // and the deck says so.
        const text = await page.locator('[data-qa="cricket-region"]').innerText();
        // Legitimate ends: the innings is shut, or the match is over and the deck is
        // offering the result and the sign-off.
        if (/closed|Sign off the result|won by|tied|No result/i.test(text)) break;
        stuck = `no pad, no question, and the deck says: ${text.slice(0, 120)}`;
        break;
      }
      await tap(page, 'WICKET');
      const rec = page.locator('[data-qa="cricket-deck"] button', { hasText: 'Record the wicket' }).first();
      if (!await rec.count()) { stuck = 'the wicket form did not open'; break; }
      const nextChip = page.locator('[data-qa="wicket-next"] button').first();
      if (await nextChip.count()) { await nextChip.click(); await page.waitForTimeout(120); }
      await rec.click();
      await settled(page);
      fell += 1;
    }
    record(scope, 'wickets can be taken until the bench is empty without stranding the console',
      stuck === null, stuck ?? `${fell} wickets taken, then the innings closed or moved on`);
    const ofEnd = await pageOverflow(page);
    record(scope, 'still no page scroll after an all-out', ofEnd <= 1, `overflow ${ofEnd}px`);
    await page.screenshot({ path: path.join(SHOTS, `${t.preset}-allout.png`) });

    await page.screenshot({ path: path.join(SHOTS, `${t.preset}-final.png`) });
    const mine = problems.slice(before);
    record(scope, 'no page errors or failed requests while scoring', mine.length === 0,
      mine.slice(0, 3).join(' | '));
  }

  await browser.close();

  // ---- the verdict table ----
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`CRICKET CONSOLE · ${pass}/${checks.length} checks passed · viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.scope}\n    ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  console.log(`\nScreenshots: ${SHOTS}`);
  writeFileSync(path.join(SHOTS, 'verdict.json'), JSON.stringify({ viewport: VIEWPORT, checks, problems }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
