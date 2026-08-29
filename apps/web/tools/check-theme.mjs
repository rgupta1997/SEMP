/**
 * Does the per-tenant colour actually reach the pixels?
 *
 * Sets a colour through the real Appearance panel, then reads the computed style of
 * the sidebar and a primary button on a different page - because the thing worth
 * proving is not that the setting saved, it is that the whole ramp moved with it.
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  ! page error:', e.message.split('\n')[0]));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('#si-subject').waitFor({ timeout: 25000 });
await page.locator('#si-subject').fill('owner.nit@bench.test');
await page.locator('button[type="submit"]').first().click();
await page.locator('#si-password').waitFor({ timeout: 25000 });
await page.locator('#si-password').fill('Bench@2026');
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 });
await sleep(1500);

const org = await page.evaluate(async (api) => {
  const t = localStorage.getItem('semp_token') ?? '';
  const me = await (await fetch(`${api}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json();
  return (me.organizations ?? []).find((m) => m.status === 'active')?.organization_id;
}, API);

const read = () => page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const btn = document.querySelector('button.bg-brand-500, button.bg-brand-600');
  return {
    seed: [root.getPropertyValue('--brand-h'), root.getPropertyValue('--brand-s'), root.getPropertyValue('--brand-l')].map((v) => v.trim()).join(' / ') || '(unset)',
    brand600: root.getPropertyValue('--color-brand-600').trim(),
    sidebar: root.getPropertyValue('--sidebar-bg').trim(),
    button: btn ? getComputedStyle(btn).backgroundColor : '(no primary button on screen)',
  };
});

mkdirSync('.shots/theme', { recursive: true });

await page.goto(`${BASE}/organizations/${org}/admin?tab=appearance`, { waitUntil: 'networkidle' });
await sleep(1200);
console.log('before :', JSON.stringify(await read()));
await page.screenshot({ path: '.shots/theme/1-panel.png', fullPage: true });

// Maroon, through the actual swatch a person would tap.
await page.locator('button[aria-label="Maroon"]').click();
await sleep(400);
console.log('preview:', JSON.stringify(await read()));
await page.screenshot({ path: '.shots/theme/2-preview.png', fullPage: true });

await page.locator('button:has-text("Save colour")').click();
await sleep(1800);
console.log('saved  :', JSON.stringify(await read()));

// The real test: a different page, after a full reload.
await page.goto(`${BASE}/organizations/${org}/students`, { waitUntil: 'networkidle' });
await sleep(1500);
console.log('reload :', JSON.stringify(await read()));
await page.screenshot({ path: '.shots/theme/3-players-themed.png', fullPage: false });

// And that leaving the tenant clears it.
await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
await sleep(1500);
console.log('personal:', JSON.stringify(await read()));
await page.screenshot({ path: '.shots/theme/4-personal-cleared.png', fullPage: false });

// Put it back so the bench is not left maroon.
await page.goto(`${BASE}/organizations/${org}/admin?tab=appearance`, { waitUntil: 'networkidle' });
await sleep(1200);
const reset = page.locator('button:has-text("Reset to Sportagon blue")');
if (await reset.isVisible().catch(() => false)) { await reset.click(); await sleep(1500); }
console.log('reset  :', JSON.stringify(await read()));

await browser.close();
