import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  globalTeardown: './cleanup.ts',
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5198',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node --conditions=development --import tsx tests/browser/server.ts',
      cwd,
      url: 'http://127.0.0.1:3098/health/live',
      reuseExistingServer: false,
      timeout: 20000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    {
      command: 'node tests/browser/web.mjs',
      cwd,
      url: 'http://127.0.0.1:5198',
      reuseExistingServer: false,
      timeout: 30000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
  ],
});
