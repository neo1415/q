import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks that need no database, API or provider: they drive the
 * web app's own dev harnesses (`/dev/*`, served by a production build only
 * with CQ_DEV_PREVIEW=1) and answer every data request with fixtures.
 * The full journeys against the local stack live in `tests/e2e`.
 *
 *   pnpm --filter @capital-q/web build
 *   npx playwright test -c apps/web/e2e/playwright.config.ts
 *
 * Chromium only, phone and desktop. A machine with Playwright's browsers
 * in a non-default place sets CQ_E2E_CHROMIUM to the executable.
 */
const PORT = Number(process.env.CQ_E2E_HARNESS_PORT ?? 3110);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const executablePath = process.env.CQ_E2E_CHROMIUM;
const launchOptions =
  executablePath === undefined ? {} : { launchOptions: { executablePath } };

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  // One server, two small projects: no need to parallelise.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        ...launchOptions,
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...launchOptions,
      },
    },
  ],
  webServer: {
    command: `node ./node_modules/next/dist/bin/next start --port ${String(PORT)}`,
    cwd: "..",
    env: {
      CQ_DEV_PREVIEW: "1",
      // Nothing here may reach a provider (CLAUDE.md): non-empty, disabled.
      OPENAI_API_KEY: "disabled-locally-000000000000",
      ELEVENLABS_API_KEY: "disabled-locally-000000000000",
      DEEPGRAM_API_KEY: "disabled-locally-000000000000",
    },
    url: `${BASE_URL}/dev/q-cards`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
