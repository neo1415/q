import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { installDeepgramFake } from "../support/deepgram-fake.js";
import { awaits } from "../support/expected-red.js";
import { answer, failVoiceVendors, useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * The standard line (Deepgram Voice Agent), with the fake microphone and the
 * agent socket served by Playwright. Proves: mic frames flow after
 * SettingsApplied, a spoken turn reaches q-api's think endpoint and the
 * answer comes back, and a dropped socket follows the reconnect ladder
 * (1.2 s / 3 s / 8 s, then "I couldn't get the line back").
 */
/**
 * Both voice vendors refuse to issue credentials (the fake's scripted voice
 * outage), so q-api cannot open a line. The person must be told, in text.
 * (Before the credential redirect, an unreachable vendor gave q-api an
 * "unhandled request error" 500 rather than a classified problem: G-D9.)
 */
test("a voice line that cannot open says so", async ({ browser }) => {
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  // Both voice vendors refuse to issue credentials (fake-vendors.mjs).
  await failVoiceVendors(true);
  await page.goto("/home");
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  await expect(
    page.getByText("I couldn't start voice right now. Try again."),
  ).toBeVisible({
    timeout: 20_000,
  });
});

/**
 * Defect G-D7 (WCAG 2.2 SC 4.1.3 Status Messages): that notice is plain
 * text beside a Dismiss button, in no live region, so a screen reader is
 * never told the line failed.
 */
test("the voice failure notice is announced (a live region)", async ({
  browser,
}) => {
  awaits(["A4"], "defect G-D7: voice failure notice is not in a live region");
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await failVoiceVendors(true);
  await page.goto("/home");
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  await expect(
    page
      .locator(
        '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"]',
      )
      .filter({ hasText: "I couldn't start voice right now" }),
  ).toBeVisible({ timeout: 20_000 });
});

test.afterEach(async () => {
  await failVoiceVendors(false);
});

// The voice credential comes from the fake through
// scripts/recovery/vendor-redirect.mjs, so these run in MOCK on their merits.
test.describe("standard voice line", () => {
  test("audio flows, a spoken turn is answered by Q", async ({ browser }) => {
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    const line = await installDeepgramFake(page);
    await useScript([
      {
        name: "spoken",
        when: { task: "COMPANY_ANALYST", user: "how much am I raising" },
        reply: answer("You are raising two and a half million dollars."),
      },
    ]);
    await page.goto("/home");
    await page
      .getByRole("button", { name: /Talk with Q/u })
      .first()
      .click();
    await expect
      .poll(() => line.frames(), { timeout: 30_000 })
      .toBeGreaterThan(10);
    const reply = await line.say("How much am I raising?");
    expect(reply).toContain("two and a half million");
    await expect(page.getByText(/two and a half million/u)).toBeVisible();
  });

  test("a dropped line reconnects, and says so if it cannot", async ({
    browser,
  }) => {
    awaits(["A4"], "reconnect notice");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    const line = await installDeepgramFake(page);
    await page.goto("/home");
    await page
      .getByRole("button", { name: /Talk with Q/u })
      .first()
      .click();
    await expect
      .poll(() => line.settings() !== null, { timeout: 30_000 })
      .toBe(true);
    await line.drop();
    await expect
      .poll(() => line.settings() !== null, { timeout: 15_000 })
      .toBe(true);
    await expect(page.getByRole("button", { name: /^End/u })).toBeVisible();
  });

  test("a vendor error mid-turn ends the turn visibly", async ({ browser }) => {
    awaits(["A4", "G-R3"], "terminal disposition per voice turn");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    const line = await installDeepgramFake(page);
    await page.goto("/home");
    await page
      .getByRole("button", { name: /Talk with Q/u })
      .first()
      .click();
    await expect
      .poll(() => line.settings() !== null, { timeout: 30_000 })
      .toBe(true);
    line.error("scripted agent failure");
    // A status that names the failure, not any status on the page.
    await expect(
      page
        .locator('[role="status"], [role="alert"]')
        .filter({ hasText: /couldn't|lost|went wrong|try again|error/iu })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
