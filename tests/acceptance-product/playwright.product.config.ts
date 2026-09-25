import { defineConfig, devices } from "@playwright/test";

/**
 * Product acceptance (CQ-ACCEPT-001, user directive 2026-09-24) as a
 * PROPERTY suite, against a stack that is ALREADY RUNNING. Nothing is
 * started here. Projects:
 *
 *   static  wording-keyed rules in active prompts / conversation code (no stack)
 *   api     the eight properties over many unseen paraphrases + the
 *           directive cases, through the public HTTP surfaces (cheap)
 *   ui      continuity only: reload, refresh, returning people (browser)
 *
 *   pnpm exec playwright test -c tests/acceptance-product/playwright.product.config.ts --project=api
 *
 *   CQ_ACCEPT_BASE_URL      web origin (default http://localhost:3500)
 *   CQ_ACCEPT_API_URL / CQ_ACCEPT_Q_API_URL / CQ_ACCEPT_SUPABASE_URL
 *   CQ_ACCEPT_DATABASE_URL  loopback Postgres for authoritative-state reads
 *
 * Assertions are about semantic outcome, persisted state, tool effects and
 * continuity -- never about exact prose. Fresh synthetic identities per
 * run (acc-prod-...@capitalq.local). No screenshots or traces are kept:
 * the evidence is the assertion and the database row.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /\.product\.spec\.ts$/,
  projects: [
    { name: "static", testMatch: /\.static\.product\.spec\.ts$/ },
    { name: "api", testMatch: /\.api\.product\.spec\.ts$/ },
    { name: "ui", testMatch: /\.ui\.product\.spec\.ts$/ },
  ],
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../.playwright/acceptance-product/results.json" },
    ],
  ],
  timeout: 900_000,
  expect: { timeout: 60_000 },
  outputDir: "../../.playwright/acceptance-product/output",
  use: {
    baseURL: process.env["CQ_ACCEPT_BASE_URL"] ?? "http://localhost:3500",
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // Voice surfaces ask for the microphone; a fake device keeps the page
    // honest without audio. Live audio is exercised on the deployed stack.
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
    permissions: ["microphone"],
  },
});
