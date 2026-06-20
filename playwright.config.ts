import { defineConfig, devices } from '@playwright/test';

// Tests run on a dedicated port so they don't conflict with `npm run dev` (port 3000).
const TEST_PORT = 3100;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 3,
  timeout: 120_000,
  expect: { timeout: 60_000 },

  webServer: {
    command: `PORT=${TEST_PORT} node build.mjs --dev`,
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'unit',
      testDir: './tests/unit',
      // No browser — pure Node execution for unit tests.
    },
    {
      name: 'chromium',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'], acceptDownloads: true },
    },
    {
      name: 'firefox',
      testDir: './tests',
      use: { ...devices['Desktop Firefox'], acceptDownloads: true },
    },
  ],
});
