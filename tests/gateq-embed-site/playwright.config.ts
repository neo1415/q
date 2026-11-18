import { defineConfig, devices } from "@playwright/test";

/**
 * The GateQ embed on another website (B7), in a real browser. Its own
 * config: it starts no Capital Q, no API and no database. By default it
 * frames a local stand-in that serves Capital Q's real embed scripts; with
 * CQ_GATEQ_EMBED_ORIGIN and CQ_GATEQ_EMBED_GATEWAY it frames a real Capital
 * Q (a local stack, or a fictional gateway in production) from a fictional
 * investor site on http://localhost:4417.
 *
 *   npx playwright test -c tests/gateq-embed-site/playwright.config.ts --trace off
 *
 * CQ_E2E_CHROMIUM points at a Chromium outside Playwright's default place.
 */
const executablePath = process.env.CQ_E2E_CHROMIUM;

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/u,
  // The host site and the stand-in listen on fixed ports: one worker.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { trace: "off", screenshot: "off" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath === undefined
          ? {}
          : { launchOptions: { executablePath } }),
      },
    },
    {
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        ...(executablePath === undefined
          ? {}
          : { launchOptions: { executablePath } }),
      },
    },
  ],
});
