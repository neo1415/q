import { defineConfig, devices } from "@playwright/test";

/**
 * E5 acceptance re-runs (CQ-QX-007) against the E5 stack already running:
 * web :3804, api :3811, q-api :3802, local Supabase. No web server is
 * started here. Synthetic identities only (e5-ans-…@capitalq.local).
 */
export default defineConfig({
  testDir: ".",
  testMatch: /\.e5\.spec\.ts$/,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 600_000,
  expect: { timeout: 30_000 },
  outputDir: "../../.playwright/e5-results",
  use: {
    baseURL: "http://localhost:3804",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
});
