/**
 * Screenshot harness.
 *
 *   node tools/shoot.mjs                       every surface, every viewport
 *   node tools/shoot.mjs --only players,results
 *   node tools/shoot.mjs --vp phone
 *   node tools/shoot.mjs --as sports.nit       sign in as a different bench persona
 *   node tools/shoot.mjs --out .shots/after    write somewhere else (for before/after)
 *
 * Signs in through the real UI once, reuses the storage state, then walks the app.
 * Output lands in apps/web/.shots/<viewport>/<name>.png — gitignored.
 *
 * The point is to look at the product the way a person on a phone does, rather than
 * at a desktop layout that has been told to be narrow. `phone` is the viewport that
 * matters; `desktop` is there to prove nothing regressed while we fixed it.
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const BASE = arg('--base', 'http://localhost:5173');
const API = arg('--api', 'http://localhost:4000');
const OUT = arg('--out', '.shots');
const PASSWORD = arg('--password', 'Bench@2026');
const LOGIN = `${arg('--as', 'owner.nit')}@bench.test`;
const ONLY = arg('--only', '')?.split(',').filter(Boolean) ?? [];
const VPS = arg('--vp', 'phone,tablet,desktop').split(',');
const FULL = !args.includes('--viewport-only');

const VIEWPORTS = {
  // A real device profile, not a resized desktop: touch, correct DPR, correct UA.
  phone: { ...devices['Pixel 7'] },
  tablet: { ...devices['iPad (gen 7)'] },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

/**
 * The surfaces worth looking at.
 *
 * `wait` is a selector that proves the page actually rendered its content rather
 * than its spinner - a screenshot of a loading state tells you nothing about the
 * design. `act` runs before the shot, for anything behind a click.
 */
const SURFACES = [
  { name: 'home',            path: '/home' },
  { name: 'discover',        path: '/discover' },
  { name: 'championships',   path: '/championships' },
  { name: 'profile',         path: '/profile' },
  { name: 'organizations',   path: '/organizations' },
  { name: 'notifications',   path: '/notifications' },
  { name: 'help',            path: '/help' },
  { name: 'host',            path: '/host' },
  { name: 'plan',            path: '/plan' },

  { name: 'org-overview',    path: '/organizations/:org/overview' },
  { name: 'org-players',     path: '/organizations/:org/students' },
  { name: 'org-campuses',    path: '/organizations/:org/campuses' },
  { name: 'org-teams',       path: '/organizations/:org/teams' },
  { name: 'org-events',      path: '/organizations/:org/events' },
  { name: 'org-achievements',path: '/organizations/:org/achievements' },
  { name: 'org-certificates',path: '/organizations/:org/certificates' },
  { name: 'org-reports',     path: '/organizations/:org/reports' },
  { name: 'org-admin',       path: '/organizations/:org/admin' },
  { name: 'org-admin-members', path: '/organizations/:org/admin?tab=members' },
  { name: 'org-admin-roles',   path: '/organizations/:org/admin?tab=roles' },
  { name: 'org-admin-billing', path: '/organizations/:org/admin?tab=billing' },

  { name: 'event-overview',  path: '/championships/:event' },
  { name: 'event-setup',     path: '/championships/:event/setup' },
  { name: 'event-schedule',  path: '/championships/:event/schedule' },
  { name: 'event-results',   path: '/championships/:event/results' },
  { name: 'event-standings', path: '/championships/:event/standings' },
  { name: 'event-participants', path: '/championships/:event/participants' },
  { name: 'event-organisers',path: '/championships/:event/organisers' },
  { name: 'event-comms',     path: '/championships/:event/communications' },
  { name: 'event-certs',     path: '/championships/:event/certificates' },
  { name: 'event-settings',  path: '/championships/:event/settings' },

  { name: 'officiating',     path: '/officiating' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sign in through the real form and keep the session. */
async function signIn(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

  // Subject first (the field takes a phone OR an email), then password. The ids are
  // the flow's own - si-subject / si-password - rather than input[type=email],
  // because the subject field is a plain text input on purpose.
  const subject = page.locator('#si-subject');
  await subject.waitFor({ timeout: 25000 });
  await subject.fill(LOGIN);
  await page.locator('button[type="submit"]').first().click();

  const pw = page.locator('#si-password');
  await pw.waitFor({ timeout: 25000 });
  await pw.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();

  // A subject can resolve to several accounts, in which case a chooser appears.
  await sleep(2000);
  const chooser = page.locator('button:has-text("@bench.test")').first();
  if (await chooser.isVisible().catch(() => false)) await chooser.click();

  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 });
  await sleep(1800);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Pull a real organisation id and championship id off the signed-in session. */
async function discoverIds(browser, storageState) {
  const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/organizations`, { waitUntil: 'networkidle' });
  // Asked of the API rather than scraped off the DOM: the ids have to be real, and a
  // link that happens to be on screen is whatever that page decided to render first.
  // `semp_token` holds the raw JWT - not JSON - and import.meta is not available
  // inside an evaluate, so the base is passed in.
  const ids = await page.evaluate(async (apiBase) => {
    const token = localStorage.getItem('semp_token') ?? '';
    const j = async (u) => (await fetch(`${apiBase}/api${u}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const [me, events] = await Promise.all([j('/auth/me'), j('/championships/mine')]);
    const active = (me?.organizations ?? []).find((m) => m.status === 'active') ?? me?.organizations?.[0];
    // Prefer an event with something to look at over whatever sorts first.
    const withRoles = (events ?? []).find((e) => (e.my_roles ?? []).includes('organiser')) ?? events?.[0];
    return { org: active?.organization_id ?? null, event: withRoles?.id ?? null };
  }, API).catch(() => ({ org: null, event: null }));
  await ctx.close();
  return ids;
}

async function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

  const browser = await chromium.launch();
  console.log(`signing in as ${LOGIN}…`);
  const storageState = await signIn(browser);

  const ids = await discoverIds(browser, storageState);
  console.log(`org=${ids.org ?? '—'} event=${ids.event ?? '—'}`);

  const wanted = SURFACES.filter((s) => !ONLY.length || ONLY.includes(s.name));

  for (const vp of VPS) {
    const profile = VIEWPORTS[vp];
    if (!profile) { console.log(`unknown viewport ${vp}`); continue; }
    const dir = path.join(OUT, vp);
    mkdirSync(dir, { recursive: true });

    const ctx = await browser.newContext({ ...profile, storageState });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`   ! ${e.message.split('\n')[0]}`));

    for (const s of wanted) {
      const url = s.path.replace(':org', ids.org ?? '').replace(':event', ids.event ?? '');
      if (url.includes('//') || /:(org|event)/.test(url)) { console.log(`   – ${vp}/${s.name} (no id)`); continue; }
      try {
        await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 25000 });
        // Give the query layer a beat past networkidle - React Query paints after.
        await sleep(900);
        await page.screenshot({ path: path.join(dir, `${s.name}.png`), fullPage: FULL });
        console.log(`   ✓ ${vp}/${s.name}`);
      } catch (e) {
        console.log(`   ✗ ${vp}/${s.name}  ${e.message.split('\n')[0]}`);
      }
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\nwrote ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
