import { defineConfig, devices } from "@playwright/test";

/**
 * Capital Q browser end-to-end configuration (ERA-058, TEO-015).
 *
 * Playwright verifies user-visible behaviour in a real browser. It does not
 * test React internals, DOM structure or CSS classes.
 *
 * Two Chromium projects, mobile first: the phone project (390 × 844, touch,
 * mobile user agent) runs the `*.mobile.spec.ts` journeys; the desktop
 * project runs everything else. Firefox and WebKit belong to the scheduled
 * release matrix (doc 24, 42/233), not to every run.
 *
 * Authentication is real: the suite runs against the local Supabase stack
 * (`pnpm db:start`). A setup project creates one synthetic account through
 * the sign-up screen and the application journeys reuse its session; the
 * auth journeys start signed out. Nothing here talks to a hosted project.
 */

// Dedicated test port so the suite never collides with a developer's dev
// server on 3000. Tooling configuration, not application configuration.
const PORT = Number(process.env.CQ_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The local stack's API URL and its fixed, public publishable key. Overridable
// for a differently configured local stack; never a hosted project.
const SUPABASE_URL =
  process.env.CQ_E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.CQ_E2E_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const STORAGE_STATE = ".playwright/auth/user.json";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,

  // A stray `test.only` must not silently shrink the suite in CI.
  forbidOnly: Boolean(process.env.CI),

  // No retries. A flaky browser test is a defect to fix, not to paper over
  // (TEO-062; doc 24, 237).
  retries: 0,

  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // Doc 24 (43) requires trace artifacts on failure.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: /\.mobile\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        storageState: STORAGE_STATE,
      },
    },
    {
      name: "desktop",
      testIgnore: [/\.mobile\.spec\.ts$/, /\.setup\.ts$/],
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: STORAGE_STATE,
      },
    },
  ],

  // The suite starts the web application itself from the production build
  // produced by the `test:e2e` script, so E2E exercises production-like
  // behaviour, including the service worker.
  webServer: {
    command: `node ./node_modules/next/dist/bin/next start --port ${String(PORT)}`,
    cwd: "apps/web",
    env: {
      // The founder onboarding journey runs on the deterministic fixture
      // adapter under test; production builds default to "none".
      CQ_FOUNDER_ONBOARDING_ADAPTER: "fixture",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY,
      // Email callback links must come back to the test server.
      CQ_WEB_ORIGIN: BASE_URL,
    },
    url: `${BASE_URL}/auth/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
