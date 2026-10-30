import { defineConfig } from 'vitest/config';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Tests get their own .platform/ and workspaces/ so they never write projects,
// settings or Private Mode state into the developer's real database
const dataRoot = process.env.OPEN_CODE_DATA_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'open-code-test-'));
// Also visible to tests/globalSetup.ts, which deletes it after the run
process.env.OPEN_CODE_DATA_ROOT = dataRoot;

export default defineConfig({
  test: {
    env: { OPEN_CODE_DATA_ROOT: dataRoot },
    globalSetup: ['./tests/globalSetup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.next/**',
      'workspaces/**', // generated user projects have their own test suites
      '.claude/**',    // agent worktrees carry their own copies of the tests
    ],
    // Tests that spawn processes (preview detection, CLI, git) can pass the 5s
    // default on loaded CI runners, and more so under coverage instrumentation
    testTimeout: process.argv.includes('--coverage') ? 30_000 : 15_000,
    // `npm run test:cover` (CI uploads coverage/lcov.info)
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}', 'bin/**/*.mjs'],
    },
  },
});
