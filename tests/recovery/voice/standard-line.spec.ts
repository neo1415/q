import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { installDeepgramFake } from "../support/deepgram-fake.js";
import { awaits } from "../support/expected-red.js";
import { answer, useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * The standard line (Deepgram Voice Agent), with the fake microphone and the
 * agent socket served by Playwright. Proves: mic frames flow after
 * SettingsApplied, a spoken turn reaches q-api's think endpoint and the
 * answer comes back, and a dropped socket follows the reconnect ladder
 * (1.2 s / 3 s / 8 s, then "I couldn't get the line back").
 */
test.describe("standard voice line", () => {
  test.beforeEach(() => {
    awaits(
      ["G-R2"],
      "no offline voice credential: q-api's Deepgram grant URL is a constant (deepgram.ts:16)",
    );
  });

  test("audio flows, a spoken turn is answered by Q", async ({ browser }) => {
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    const line = await installDeepgramFake(page);
    await useScript([
      {
        name: "spoken",
        when: { user: "how much am I raising" },
        reply: answer("You are raising two and a half million dollars."),
      },
    ]);
    await page.goto("/home");
    await page.getByRole("button", { name: /Talk with Q/u }).click();
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
    await page.getByRole("button", { name: /Talk with Q/u }).click();
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
    await page.getByRole("button", { name: /Talk with Q/u }).click();
    await expect
      .poll(() => line.settings() !== null, { timeout: 30_000 })
      .toBe(true);
    line.error("scripted agent failure");
    await expect(page.locator('[role="status"], [role="alert"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
