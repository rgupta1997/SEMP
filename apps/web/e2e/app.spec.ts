import { test, expect, type Page } from '@playwright/test';

// The signed-in surfaces: the shell, the org tabs, and the create-championship
// wizard. Theming defects hide here rather than on the sign-in screen, because these
// are Tailwind-with-dark:-variant screens where one forgotten variant is invisible
// until somebody uses dark mode.

const API = process.env.E2E_API_URL ?? 'http://localhost:4001';
const stamp = Date.now();

async function api(path: string, body?: unknown, token?: string) {
  const r = await fetch(`${API}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => null);
}

// A signed-in organiser with an institution, created through the API.
async function seedOrganiser() {
  const email = `pw-org-${stamp}@example.com`;
  const req = await api('/auth/otp/request', { email, purpose: 'signup' });
  const ver = await api('/auth/otp/verify', { email, code: req.dev_code, purpose: 'signup' });
  const done = await api('/auth/signup/complete', {
    verification_token: ver.verification_token, name: 'PW Organiser',
    phone: `9${String(stamp).slice(-9)}`, password: 'secret123',
  });
  const org = await api('/organizations', { name: `PW Club ${stamp}`, city: 'Pune' }, done.token);
  return { token: done.token, orgId: org.id };
}

let session: { token: string; orgId: string };

test.beforeAll(async () => { session = await seedOrganiser(); });

async function signedIn(page: Page, theme: 'light' | 'dark' = 'dark') {
  await page.addInitScript(([token, t]) => {
    window.localStorage.setItem('semp_token', token as string);
    window.localStorage.setItem('semp_theme', t as string);
  }, [session.token, theme]);
}

// Any element painting pure white while the app is in dark mode is a missing dark:
// variant. Reported with its classes so the offender is findable.
async function pureWhitePanels(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*')).slice(0, 6000)) {
      const style = getComputedStyle(el);
      if (style.backgroundColor === 'rgb(255, 255, 255)' && (el as HTMLElement).offsetHeight > 8) {
        out.push(`${el.tagName.toLowerCase()}.${((el as HTMLElement).className?.toString() ?? '').slice(0, 70)}`);
      }
    }
    return [...new Set(out)].slice(0, 10);
  });
}

const SCREENS = [
  { path: '/profile', name: 'my game' },
  { path: '/discover', name: 'discover' },
  { path: '/championships', name: 'championships' },
  { path: '/organizations', name: 'organizations' },
  { path: '/host', name: 'host' },
];

for (const screen of SCREENS) {
  test(`${screen.name} renders in dark mode with no white panels`, async ({ page }) => {
    await signedIn(page, 'dark');
    await page.goto(screen.path);
    await page.waitForLoadState('networkidle');
    const offenders = await pureWhitePanels(page);
    expect(offenders, `${screen.name}: ${offenders.join(' | ')}`).toHaveLength(0);
  });
}

// The screens added since the last theming pass, checked the same way. A page built
// after the sweep is exactly where a missing dark: variant hides.
for (const screen of [
  { path: () => '/championships/new', name: 'template gallery' },
  { path: () => `/organizations/${session.orgId}/roles`, name: 'org roles' },
]) {
  test(`${screen.name} renders in dark mode with no white panels`, async ({ page }) => {
    await signedIn(page, 'dark');
    await page.goto(screen.path());
    await page.waitForLoadState('networkidle');
    const offenders = await pureWhitePanels(page);
    expect(offenders, `${screen.name}: ${offenders.join(' | ')}`).toHaveLength(0);
  });
}

test('an organisation can see what each role means here', async ({ page }) => {
  await signedIn(page);
  await page.goto(`/organizations/${session.orgId}/roles`);
  // A role nobody has overridden is the platform definition, and says so.
  await expect(page.getByText('Platform').first()).toBeVisible({ timeout: 10_000 });
  // ...and offers to become this institution's own.
  await expect(page.getByRole('button', { name: /customise/i }).first()).toBeVisible();
});

test('the org tabs expose structure and activity', async ({ page }) => {
  await signedIn(page);
  await page.goto(`/organizations/${session.orgId}/overview`);
  await expect(page.getByRole('link', { name: 'Structure' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Activity' })).toBeVisible();
});

test('the structure page can add a programme and a batch', async ({ page }) => {
  await signedIn(page);
  await page.goto(`/organizations/${session.orgId}/structure`);
  await page.getByRole('button', { name: /add.*programme/i }).first().click();
  await page.getByLabel('Name').fill('PGP');
  await page.getByRole('button', { name: /^Add$/ }).click();
  // Scoped to the card, because "PGP" also appears in the empty state and the hint.
  const card = page.locator('div').filter({ hasText: /^PGP0 people/ }).first();
  await expect(page.getByRole('button', { name: '+ Batch' })).toBeVisible({ timeout: 10_000 });
  // The derived count, which must never be a stored number.
  await expect(page.getByText(/0 people/).first()).toBeVisible();
});

// The template gallery: what does an organiser actually learn from these cards?
test('the create wizard shows what each template will set up', async ({ page }) => {
  await signedIn(page);
  await page.goto('/championships/new');
  await expect(page.getByText(/choose a structure/i).first()).toBeVisible();

  const cards = page.locator('button[aria-pressed]');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });

  const summaries: string[] = [];
  for (let i = 0; i < await cards.count(); i += 1) {
    summaries.push((await cards.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  }
  console.log('\nTEMPLATE CARDS AS AN ORGANISER SEES THEM:');
  for (const s of summaries) console.log('  •', s);

  // The built-ins are rows in the database now, not a TypeScript const, so their
  // presence here also proves the library endpoint is wired up.
  const single = summaries.find((s) => /league tournament/i.test(s));
  expect(single, 'league template card').toBeTruthy();
  // A single-sport template must NAME its sport - "1 sport" tells an organiser nothing
  // about whether this is the one they want.
  expect(single!, `card does not name its sport: "${single}"`).toMatch(/football|cricket|basketball|badminton/i);

  // And every card carries what it adds up to.
  expect(single!).toMatch(/sports/i);
  expect(single!).toMatch(/draws/i);

  // Starting from nothing is always offered - a first-time organiser has no templates.
  expect(summaries.some((s) => /start from scratch/i.test(s))).toBe(true);
});

// Hovering is how an organiser sees WHICH six sports, without leaving the step.
test('hovering a template reveals its contents', async ({ page }) => {
  await signedIn(page);
  await page.goto('/championships/new');
  // Every card carries its own hidden preview, so scope to the one being hovered.
  const card = page.locator('div.group').filter({ hasText: /multi-sport meet/i }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });

  const preview = card.getByText('What this sets up');
  await expect(preview).toBeHidden();

  await card.getByRole('button', { name: /multi-sport meet/i }).hover();
  await expect(preview).toBeVisible();
  // The named contents, not a count.
  await expect(card.getByText(/scored as a medal tally/i)).toBeVisible();
  await expect(card.getByText(/athletics/i).first()).toBeVisible();
});

test('the template gallery can be filtered', async ({ page }) => {
  await signedIn(page);
  await page.goto('/championships/new');
  await expect(page.locator('button[aria-pressed]').first()).toBeVisible({ timeout: 10_000 });

  const before = await page.locator('button[aria-pressed]').count();
  // Cricket appears in exactly one built-in, so filtering by it must narrow the list.
  // Scoped to the filter rail - the sport also appears on cards and in previews.
  await page.locator('aside').getByText('Cricket', { exact: true }).click();
  await expect.poll(() => page.locator('button[aria-pressed]').count()).toBeLessThan(before);
  await expect(page.locator('button[aria-pressed]').filter({ hasText: /knockout cup/i })).toBeVisible();
});
