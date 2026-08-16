import { defineConfig, devices } from '@playwright/test';

// Frontend regression + theming pass.
//
// Points at a LOCAL api (4001) rather than the deployed Lambda that .env.local
// targets, because these tests exercise endpoints that only exist locally.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_API_URL: process.env.E2E_API_URL ?? 'http://localhost:4001' },
  },
});
