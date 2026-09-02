import { defineConfig, devices } from "@playwright/test";

/**
 * Capital Q browser end-to-end configuration (ERA-058, TEO-015).
 *
 * Playwright verifies user-visible behaviour in a real browser. It does not
 * test React internals, DOM structure or CSS classes.
 *
 * Browser matrix: Chromium only at this stage. Doc 24 (42) scopes the
 * Chromium/Firefox/WebKit matrix to scheduled and full-release runs, and (233)
 * places multi-browser E2E in the nightly matrix -- so Firefox and WebKit are
 * owed at release-matrix stage, not here. Adding them now would mean
 * downloading three browsers to run one smoke test.
 */

// Dedicated test port so the suite never collides with a developer's dev
// server on 3000. This is tooling configuration, not application configuration;
// typed runtime config for the applications themselves arrives in
// CQ-FOUND-006.
const PORT = Number(process.env.CQ_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,

  // A stray `test.only` must not silently shrink the suite in CI.
  forbidOnly: Boolean(process.env.CI),

  // No retries. A flaky browser test is a defect to fix, not to paper over
  // (TEO-062; doc 24, 237). CI retry policy, if any, belongs to CQ-FOUND-005.
  retries: 0,

  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // Doc 24 (43) requires trace artifacts on failure. `on-first-retry` would
    // never fire while retries are 0, so failures are captured directly.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // The suite starts the web application itself -- no second terminal, no
  // manual step. `next start` serves the production build rather than the dev
  // server, so E2E exercises production-like behaviour. The build is produced
  // by the `test:e2e` script before Playwright runs.
  webServer: {
    command: `node ./node_modules/next/dist/bin/next start --port ${String(PORT)}`,
    cwd: "apps/web",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
