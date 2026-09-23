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
      // System Chrome — no separate browser download needed
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],

  webServer: IS_CI
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 90_000,
      },

  outputDir: 'results/artifacts',
});
