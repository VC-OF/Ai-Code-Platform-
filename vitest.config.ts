import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
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
