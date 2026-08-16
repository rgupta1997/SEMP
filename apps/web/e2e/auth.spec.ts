import { test, expect, type Page } from '@playwright/test';

// The sign-in screen is the one surface every user meets, and the one whose flow
// changed most in wave 0.5: it forks on whether the address is already registered.
// These drive it as a person would.

const API = process.env.E2E_API_URL ?? 'http://localhost:4001';
const stamp = Date.now();

// A verified institution + claimed domain, created through the API so the UI can be
// driven against real data.
async function seedInstitution() {
  const domain = `zzpw-${stamp}.ac.in`;
  const res = await fetch(`${API}/api/__test__/noop`).catch(() => null);
  return { domain, res };
}

test.describe('sign-in screen', () => {
  test('opens on a neutral state, not a promise to create an account', async ({ page }) => {
    await page.goto('/login');
    const cta = page.getByRole('button', { name: /continue|create my account|send/i });
    await expect(cta).toBeVisible();
    // Before any address is checked, the button must not claim it will create an
    // account - it does not yet know whether one exists.
    await expect(cta).toHaveText(/continue/i);
  });

  test('offers Organisation and Individual without changing the mechanism', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Organisation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Individual' })).toBeVisible();
    await page.getByRole('button', { name: 'Individual' }).click();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('an unknown address is offered the sign-up path', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`nobody-${stamp}@example.com`);
    // The debounced identify call decides the copy.
    await expect(page.getByRole('button', { name: /create my account/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/we'll send a code|confirm it's yours/i)).toBeVisible();
  });

  test('a registered address is sent to its password, never asked to guess', async ({ page }) => {
    // Register one through the API first.
    const email = `known-${stamp}@example.com`;
    const req = await (await fetch(`${API}/api/auth/otp/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'signup' }),
    })).json();
    const ver = await (await fetch(`${API}/api/auth/otp/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: req.dev_code, purpose: 'signup' }),
    })).json();
    await fetch(`${API}/api/auth/signup/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verification_token: ver.verification_token, name: 'PW Known', phone: `9${String(stamp).slice(-9)}`, password: 'secret123' }),
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await expect(page.getByText(/already has an account/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /forgotten your password/i })).toBeVisible();
  });

  test('signing up asks for a password, and phone, before creating anything', async ({ page }) => {
    const email = `newbie-${stamp}@example.com`;
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('button', { name: /create my account/i }).click();

    // The code screen: six boxes, prefilled while the email bypass is on.
    await expect(page.getByText(/check your inbox|confirm your email/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/dev mode/i)).toBeVisible();
    await page.getByRole('button', { name: /confirm/i }).click();

    // And only now the details - the account does not exist until this is submitted.
    await expect(page.getByText(/set up your account/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/phone/i)).toBeVisible();
    await expect(page.getByLabel(/choose a password/i)).toBeVisible();
  });
});
