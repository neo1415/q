import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { WEB_URL } from "./support/stack";

/**
 * Recovery G: independent verification of the release candidate.
 *
 *   scripts/recovery/local-stack.sh start && scripts/recovery/local-stack.sh seed
 *   npx playwright test -c tests/recovery/playwright.recovery.config.ts [project]
 *
 * Runs against the local stack that is already up (no web server started
 * here: the stack is brought up one service at a time on 4 shared CPUs).
 * Nothing reaches a provider: the services run behind the egress guard and
 * the model is scripts/recovery/fake-vendors.mjs.
 *
 * Chromium only, the pre-installed one, with a fake microphone. The default
 * mic is a tone; `CQ_FAKE_MIC_WAV` plays a recording instead.
 *
 * Expected-red tests are annotated (support/expected-red.ts) and still fail;
 * scripts/recovery/results-table.mjs separates them from real defects.
 */
const CHROMIUM = process.env["CQ_E2E_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const MIC = process.env["CQ_FAKE_MIC_WAV"];
const OUT = resolve(import.meta.dirname, "../../.playwright/recovery");

const chromium = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  permissions: ["microphone"],
  launchOptions: {
    executablePath: CHROMIUM,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(MIC === undefined ? [] : [`--use-file-for-fake-audio-capture=${MIC}`]),
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
};

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/u,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  outputDir: `${OUT}/results`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${OUT}/report.json` }],
  ],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
  },
  projects: [
    { name: "scenarios", testDir: "./scenarios", use: chromium },
    { name: "voice", testDir: "./voice", use: chromium },
    { name: "permissions", testDir: "./permissions", use: chromium },
    { name: "promises", testDir: "./promises", use: chromium },
    { name: "a11y", testDir: "./a11y", use: chromium },
    {
      name: "phone",
      testDir: "./scenarios",
      testMatch: /a-navigate\.spec\.ts$/u,
      use: { ...chromium, ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});
