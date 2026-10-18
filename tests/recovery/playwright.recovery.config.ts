import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { STACK_MODE, WEB_URL } from "./support/stack.js";

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
/**
 * MOCK, or LIVE only when the founder runs scripts/recovery/voice/
 * LIVE-PROCEDURE.md on his own machine. Budget for live AI calls from this
 * build is $0: nothing here is ever run LIVE by an agent, and the live
 * project's results are LIVE-PENDING until he does.
 */
export const MODE = STACK_MODE === "live" ? "LIVE" : "MOCK";
// LIVE on the founder's own machine: a real microphone, headed, no fakes.
const REAL_MIC = MODE === "LIVE" && process.env["CQ_LIVE_REAL_MIC"] === "1";
const PROXY = MODE === "LIVE" ? process.env["HTTPS_PROXY"] : undefined;

const chromium = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  permissions: ["microphone"],
  ...(PROXY === undefined
    ? {}
    : { proxy: { server: PROXY }, ignoreHTTPSErrors: true }),
  launchOptions: {
    executablePath: CHROMIUM,
    headless: !REAL_MIC,
    args: REAL_MIC
      ? ["--autoplay-policy=no-user-gesture-required"]
      : [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          ...(MIC === undefined
            ? []
            : [`--use-file-for-fake-audio-capture=${MIC}`]),
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
  // Every report says which world it ran in; results-table.mjs prints it.
  metadata: { mode: MODE },
  reporter: [["list"], ["json", { outputFile: `${OUT}/report.json` }]],
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
    // Workstream K Tests 1-7 (TRACKING section K).
    { name: "knowledge", testDir: "./knowledge", use: chromium },
    // G2: the founder's five demo journeys (A-E), the release-candidate gate.
    { name: "journeys", testDir: "./journeys", use: chromium },
    // V2: the founder's Qatar demo (welcome follow-ups, the Qatar Five,
    // unknown and ambiguous people, voice navigation). Needs the stack
    // started with CQ_RECOVERY_GPT_LIVE=1 CQ_RECOVERY_SEARCH=1 and
    // `local-stack.sh seed-research`. Every measurement is LOCAL+MOCK.
    { name: "qatar", testDir: "./qatar", use: chromium },
    // Manual only, by the founder on his machine (LIVE-PROCEDURE.md):
    // `--project live` against a stack started with CQ_RECOVERY_MODE=live.
    // In MOCK these refuse to run and are reported LIVE-PENDING.
    { name: "live", testDir: "./live", use: chromium },
    {
      name: "phone",
      testDir: "./scenarios",
      testMatch: /a-navigate\.spec\.ts$/u,
      use: {
        ...chromium,
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
