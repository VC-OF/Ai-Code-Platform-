import path from 'path';
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: IS_CI ? 2 : 0,
  workers: 1, // the app is stateful (shared SQLite/projects) — serialize

  reporter: [
    ['html', { outputFolder: 'results/html', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      // Locally: system Chrome, no browser download needed. CI installs
      // Playwright's bundled Chromium (`playwright install chromium`).
      use: IS_CI ? { ...devices['Desktop Chrome'] } : { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],

  // CI serves the production build downloaded from the Build job; locally
  // an already-running dev server is reused. BASE_URL pointing elsewhere
  // (a deployed instance) skips starting a server.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: IS_CI ? 'npm run start' : 'npm run dev',
        cwd: path.join(__dirname, '..'),
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !IS_CI,
        timeout: 120_000,
        stdout: 'pipe',
      },

  outputDir: 'results/artifacts',
});
