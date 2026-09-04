/*
 * FRONTEND END-TO-END, in a real browser.
 *
 *   node scripts/qa-frontend-e2e.mjs            # against http://localhost:5174
 *   QA_WEB=http://localhost:5173 node scripts/...
 *
 * Drives the QA bench through the actual screens as each role. The backend E2E
 * proves the routes work; this proves a person can REACH them - which is a different
 * question, and the one that produces "I came to score a match but there is no
 * sign-off button".
 *
 * WHAT IT WATCHES FOR, besides the assertions:
 *   * any uncaught page error or console error - a screen that throws is broken
 *     even if it looks fine
 *   * any failed network request (>=400) - a silent 500 behind a spinner
 *   * a screen stuck on a loading spinner, which is how a dead end usually looks
 *
 * Screenshots of every step land in scripts/qa-shots/ for the report.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const WEB = process.env.QA_WEB ?? 'http://localhost:5174';
const SHOTS = path.join(import.meta.dirname, 'qa-shots');
const PW = 'Qa@2026';

const results = [];
const pageErrors = [];
const netErrors = [];

function check(area, step, ok, detail) {
  results.push({ area, step, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${step}${ok || !detail ? '' : `\n          ${detail}`}`);
}

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  const file = path.join(SHOTS, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

/** Wait for the app to settle: no spinner, and something rendered. */
async function settled(page, { timeout = 15000 } = {}) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  // A spinner still on screen after the network went quiet is a stuck screen.
  await page.waitForFunction(
    () => !document.querySelector('[role="status"],.animate-spin'),
    null, { timeout: 5000 },
  ).catch(() => {});
}

/**
 * Sign in. TWO STEPS, which is worth stating because the first version of this
 * harness assumed one and hung for thirty seconds looking for a password box that
 * only appears after the identifier is accepted: enter a phone or email, press
 * Continue, then the password.
 */
async function login(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await settled(page);

  // Broad on purpose: the identifier accepts a phone OR an email, so the input is
  // whatever the app chose (text/tel/email). Waiting for the ELEMENT rather than
  // for network-idle matters - the panel mounts a beat after the page settles, and
  // a networkidle-based wait raced it and found nothing.
  const ident = page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="password"])').first();
  await ident.waitFor({ state: 'visible', timeout: 30000 });
  await ident.fill(email);
  await page.locator('button:has-text("Continue"), button[type="submit"]').first().click();

  // The password field is the signal that step one was accepted.
  const pass = page.locator('input[type="password"]').first();
  try {
    await pass.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    const t = await page.locator('body').innerText().catch(() => '');
    console.log(`      (no password step for ${email}: ${t.slice(0, 200).replace(/\s+/g, ' ')})`);
    return false;
  }
  await pass.fill(PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 }).catch(() => {}),
    page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")').first().click(),
  ]);
  await settled(page);
  return !page.url().includes('/login');
}

/**
 * Sign out properly between roles.
 *
 * Clearing cookies alone is not enough - the token lives in localStorage, so the
 * previous role stays signed in and every later assertion tests the wrong person.
 * The origin has to be loaded before localStorage is reachable at all.
 */
async function signOut(page, ctx) {
  await ctx.clearCookies();
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked, fine */ }
  }).catch(() => {});
}

async function main() {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Everything the browser complains about, attributed to the URL it happened on.
  page.on('pageerror', (e) => pageErrors.push({ url: page.url(), message: String(e).slice(0, 300) }));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // React's dev-only key/prop warnings are noise for this purpose; a thrown
    // error or a failed fetch is not.
    if (/Download the React DevTools|was created with/i.test(t)) return;
    pageErrors.push({ url: page.url(), message: t.slice(0, 300) });
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) {
      netErrors.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status(), on: page.url() });
    }
  });

  console.log('\n================ FRONTEND E2E ================\n');

  // ------------------------------------------------------------ 1 · the app loads
  console.log('1 · THE APP LOADS');
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await settled(page);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  check('boot', 'the landing page renders text (not a blank SPA)', bodyText.trim().length > 40,
    `got ${bodyText.trim().length} chars - a blank page usually means a missing env var`);
  await shot(page, 'landing');

  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await settled(page);
  await page.locator('input:not([type="hidden"]):not([type="checkbox"])').first()
    .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const identBox = await page.locator('input:not([type="hidden"]):not([type="checkbox"])').count();
  const continueBtn = await page.locator('button:has-text("Continue")').count();
  check('boot', 'the sign-in form is present (identifier + Continue)',
    identBox > 0 && continueBtn > 0, `inputs=${identBox} continue=${continueBtn}`);
  await shot(page, 'login');

  // ------------------------------------------------------------ 2 · the organiser
  console.log('\n2 · THE ORGANISER');
  check('organiser', 'can sign in', await login(page, 'organiser@qa.test'));
  await shot(page, 'organiser-home');

  const home = await page.locator('body').innerText();

  // An organiser lands on the PERSONAL space ("Priya's game"), not on an event -
  // the championship is a click away under My Events. Worth recording as a finding
  // rather than treated as a failure: it is a navigation choice, not a break.
  check('organiser', 'the personal home renders',
    /My Space|My Game|My Events/i.test(home), home.slice(0, 160).replace(/\s+/g, ' '));

  // My Events must list it, because that is the only route in.
  await page.goto(`${WEB}/championships`, { waitUntil: 'domcontentloaded' });
  await settled(page);
  await shot(page, 'organiser-my-events');
  const listText = await page.locator('body').innerText();
  check('organiser', 'My Events lists the QA championship',
    /Claude QA/i.test(listText), listText.slice(0, 250).replace(/\s+/g, ' '));

  // Straight to the event by id: guessing at link text is what made the last run
  // click a personal-nav item and then assert against the wrong screen.
  const eventId = process.env.QA_EVENT;
  if (!eventId) {
    check('organiser', 'QA_EVENT was supplied to the harness', false,
      'pass QA_EVENT=<championship id> so the event screens can be opened directly');
  } else {
    for (const [tab, must] of [
      ['schedule', /Cricket|Table Tennis|Volleyball|Chess|Football|fixture|match/i],
      ['results', /result|score|Cricket|Table Tennis/i],
      ['standings', /standing|points|played|team/i],
      ['participants', /team|squad|participant/i],
      ['setup', /sport|discipline|venue|setup/i],
    ]) {
      await page.goto(`${WEB}/championships/${eventId}/${tab}`, { waitUntil: 'domcontentloaded' });
      await settled(page);
      await shot(page, `organiser-${tab}`);
      const t = await page.locator('body').innerText();
      const broken = /something went wrong|unexpected error|not found|no access/i.test(t);
      check('organiser', `the ${tab} tab opens and renders content`,
        !broken && must.test(t), broken ? 'error state on screen' : t.slice(0, 220).replace(/\s+/g, ' '));
    }

    // THE control that matters: a way into scoring from the schedule. Its absence
    // is what produced "7 scheduled matches are not shown here".
    await page.goto(`${WEB}/championships/${eventId}/schedule`, { waitUntil: 'domcontentloaded' });
    await settled(page);
    const scoreControls = await page.locator('a[href*="/score/"], a:has-text("Score"), button:has-text("Score")').count();
    check('organiser', `a Score entry point is on the schedule (${scoreControls})`, scoreControls > 0,
      'no Score control - an organiser would have to guess the URL');

    // And the format picker, which runs before generation.
    const formatBtn = await page.locator('button:has-text("Format")').count();
    check('organiser', `the Format control is on the schedule (${formatBtn})`, formatBtn > 0,
      'no Format button - the scoring rules would be unreachable');
  }

  // ------------------------------------------------------------- 3 · the official
  console.log('\n3 · THE OFFICIAL');
  await signOut(page, ctx);
  check('official', 'can sign in', await login(page, 'official@qa.test'));
  await shot(page, 'official-home');
  const offText = await page.locator('body').innerText();
  // The assigned matches, which the backend E2E assigned. An official who sees
  // nothing here has no way into their job.
  check('official', 'sees matches to officiate',
    /Cricket|Table Tennis|Volleyball|Chess|match/i.test(offText),
    offText.slice(0, 250).replace(/\s+/g, ' '));

  // The official's own list lives on its own route.
  await page.goto(`${WEB}/officiating`, { waitUntil: 'domcontentloaded' });
  await settled(page);
  await shot(page, 'official-officiating');
  const offList = await page.locator('body').innerText();
  check('official', 'the officiating list names assigned matches',
    /Cricket|Table Tennis|Volleyball|Chess|Football/i.test(offList),
    offList.slice(0, 250).replace(/\s+/g, ' '));

  // The console opens through navigate() on a BUTTON, not an anchor - so looking for
  // a link found nothing and reported a dead end that was not one.
  const openConsole = page.locator('button:has-text("Open console"), button:has-text("View scorecard")').first();
  if (await openConsole.count()) {
    await openConsole.click();
    await settled(page);
    await shot(page, 'official-console');
    const consoleText = await page.locator('body').innerText();
    check('official', 'the match console opens',
      page.url().includes('/score/') && !/not available|not authorized/i.test(consoleText),
      `${page.url()} :: ${consoleText.slice(0, 200).replace(/\s+/g, ' ')}`);
    // Something to press. A console with no control is the dead end that mattered:
    // "I came to score a match but there is no sign-off button".
    const buttons = await page.locator('button:visible').count();
    check('official', `the console offers controls (${buttons} buttons)`, buttons >= 3);
    check('official', 'the console identifies the match it is scoring',
      /vs|:|Chess|Cricket|Table Tennis|Volleyball|Football/i.test(consoleText),
      consoleText.slice(0, 250).replace(/\s+/g, ' '));
  } else {
    check('official', 'a match is openable from the officiating list', false,
      'no "Open console" / "View scorecard" control found');
  }

  // ------------------------------------------------------------- 4 · the player
  console.log('\n4 · THE PLAYER (stats in their own profile)');
  await signOut(page, ctx);
  const playerEmail = process.env.QA_PLAYER ?? 'ash.p4@qa.test';
  check('player', `can sign in (${playerEmail})`, await login(page, playerEmail));
  await shot(page, 'player-home');

  // Their matches, by route.
  await page.goto(`${WEB}/profile/matches`, { waitUntil: 'domcontentloaded' });
  await settled(page);
  await shot(page, 'player-matches');
  const pmText = await page.locator('body').innerText();
  check('player', 'their match list shows a played match',
    /won|lost|completed|Cricket/i.test(pmText), pmText.slice(0, 250).replace(/\s+/g, ' '));

  // The match detail. A COMPLETED match is the one that matters - a scheduled fixture
  // has no stat line, so asserting on it would prove nothing. The list navigates by
  // click rather than by href, so the fixture ids come from the API instead.
  const ids = await page.evaluate(async () => {
    const token = localStorage.getItem('token') ?? localStorage.getItem('semp_token') ?? '';
    const res = await fetch('http://localhost:4000/api/me/matches', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.matches ?? []).filter((m) => m.status === 'completed').map((m) => m.id);
  }).catch(() => []);
  check('player', `a completed match of theirs is identifiable (${ids.length})`, ids.length > 0);
  if (ids.length) {
    // Open the one they actually have a LINE in. A player on five squads may have
    // been attributed nothing in four of them - the card correctly says so there,
    // and asserting on that would be asserting on the wrong screen.
    const withStats = await page.evaluate(async (list) => {
      const token = localStorage.getItem('semp_token') ?? '';
      for (const id of list) {
        const res = await fetch(`http://localhost:4000/api/me/matches/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) continue;
        const body = await res.json();
        if ((body.my_stats?.groups ?? []).length) return id;
      }
      return null;
    }, ids).catch(() => null);
    check('player', 'one of their matches carries a stat line', !!withStats,
      `none of ${ids.length} matches had figures for them`);
    await page.goto(`${WEB}/profile/matches/${withStats ?? ids[0]}`, { waitUntil: 'domcontentloaded' });
    await settled(page);
    await shot(page, 'player-match-detail');
    const detail = await page.locator('body').innerText();
    check('player', 'the match detail opens', detail.length > 80 && !/not available/i.test(detail));
    // THE requirement: a player's own numbers on their own screen.
    check('player', 'their OWN statistics appear on the match',
      /Your statistics/i.test(detail),
      detail.slice(0, 400).replace(/\s+/g, ' '));
    check('player', 'and it shows real numbers, or says plainly why there are none',
      /Runs|Wickets|Points won|Overs|Goals|Raid|did not bat/i.test(detail),
      detail.slice(0, 400).replace(/\s+/g, ' '));
  } else {
    check('player', 'a match detail is reachable', false, 'no completed match to open');
  }

  // The profile / career record.
  for (const [label, hrefs] of [
    ['profile', ['a[href*="/profile"]', 'a:has-text("Profile")']],
    ['record', ['a[href*="/record"]', 'a:has-text("Record")', 'a:has-text("Achievements")']],
  ]) {
    const loc = page.locator(hrefs.join(', ')).first();
    if (await loc.count()) {
      await loc.click();
      await settled(page);
      await shot(page, `player-${label}`);
      const t = await page.locator('body').innerText();
      check('player', `the ${label} screen renders`, t.length > 60 && !/something went wrong/i.test(t),
        t.slice(0, 200).replace(/\s+/g, ' '));
    }
  }

  await browser.close();
  report();
}

function report() {
  const fails = results.filter((r) => !r.ok);
  console.log(`\n================ ${results.length - fails.length}/${results.length} PASSED ================`);

  if (fails.length) {
    console.log('\nFAILURES:');
    for (const f of fails) console.log(`  [${f.area}] ${f.step}\n      ${f.detail ?? ''}`);
  }
  if (pageErrors.length) {
    console.log(`\nPAGE / CONSOLE ERRORS (${pageErrors.length}):`);
    const seen = new Set();
    for (const e of pageErrors) {
      const k = e.message.slice(0, 120);
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  on ${e.url.replace(WEB, '')}\n    ${e.message}`);
    }
  }
  if (netErrors.length) {
    console.log(`\nFAILED API CALLS (${netErrors.length}):`);
    const seen = new Set();
    for (const e of netErrors) {
      const k = `${e.status} ${e.url}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${e.status}  ${e.url}\n      seen on ${e.on.replace(WEB, '')}`);
    }
  }
  console.log(`\nScreenshots: ${SHOTS}`);
  if (fails.length) process.exitCode = 1;
}

main().catch((e) => { console.error('\nHARNESS CRASH:', e); process.exitCode = 1; });
