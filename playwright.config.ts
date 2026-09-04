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
 *
 * The founder onboarding journey runs against the real Capital Q API
 * (CQ-ONB-002): the suite starts the API from its production build on a
 * dedicated port with the local database, and the web app is configured
 * with the `api` adapter. No fixture is composed anywhere in this suite.
 */

// Dedicated test ports so the suite never collides with a developer's dev
// servers on 3000/3001. Tooling configuration, not application configuration.
const PORT = Number(process.env.CQ_E2E_PORT ?? 3100);
const API_PORT = Number(process.env.CQ_E2E_API_PORT ?? 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

// The local stack's API URL and its fixed, public publishable key. Overridable
// for a differently configured local stack; never a hosted project.
const SUPABASE_URL =
  process.env.CQ_E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.CQ_E2E_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
// The local stack's fixed development database credential (Supabase CLI
// default). Local loopback only; a hosted connection string is never
// defaulted here.
const DATABASE_URL =
  process.env.CQ_E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const STORAGE_STATE = ".playwright/auth/user.json";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Every worker shares one local Supabase Auth and one API process; beyond
  // two workers the auth round trips stall past the expect timeout on a
  // developer machine and journeys fail for load, not behaviour.
  workers: 2,

  // A stray `test.only` must not silently shrink the suite in CI.
  forbidOnly: Boolean(process.env.CI),

  // No retries. A flaky browser test is a defect to fix, not to paper over
  // (TEO-062; doc 24, 237).
  retries: 0,

  reporter: [["list"]],
  timeout: 60_000,
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

  // The suite starts the API and the web application itself from the
  // production builds produced by the `test:e2e` script, so E2E exercises
  // production-like behaviour, including the service worker.
  webServer: [
    {
      command: "node dist/main.js",
      cwd: "apps/api",
      env: {
        NODE_ENV: "production",
        CAPITAL_Q_ENV: "local",
        PORT: String(API_PORT),
        HOST: "127.0.0.1",
        DATABASE_URL,
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        LOG_LEVEL: "warn",
      },
      url: `${API_URL}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `node ./node_modules/next/dist/bin/next start --port ${String(PORT)}`,
      cwd: "apps/web",
      env: {
        // The founder onboarding journey runs on the real API under test.
        CQ_FOUNDER_ONBOARDING_ADAPTER: "api",
        CQ_API_URL: API_URL,
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY,
        // Email callback links must come back to the test server.
        CQ_WEB_ORIGIN: BASE_URL,
      },
      url: `${BASE_URL}/auth/sign-in`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
