import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Walkthrough H1, re-run (CQ-QX-007): ask Home Q, reload 2.5 s later, and
 * the same conversation reopens with the question and, in time, the answer.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
test.use({ storageState: `${STATE_DIR}/founder-state.json` });

test("H1: a reload mid-run reopens the conversation", async ({ page }) => {
  await page.goto("/home");
  const composer = page.getByPlaceholder("Or type to Q");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  const question = `what stage are we at, and where are we based? (${Date.now().toString(36)})`;
  await composer.fill(question);
  const asked = Date.now();
  await composer.press("Enter");
  const urls: string[] = [];
  while (Date.now() - asked < 2_500) {
    urls.push(`${String(Date.now() - asked)}ms ${page.url()}`);
    await page.waitForTimeout(250);
  }
  console.log("URLS >>>\n" + urls.join("\n"));
  await page.reload();
  console.log("AFTER RELOAD URL", page.url());
  // The question is back on screen at once, and the conversation is
  // named in the URL as soon as the run is (re)accepted.
  await expect(page.getByText(question)).toBeVisible({ timeout: 60_000 });
  await page.waitForURL(/[?&]c=/, { timeout: 120_000 });
  console.log("NAMED URL", page.url());
  await expect(page.getByText(question)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-q-answer="settled"]').last()).toBeVisible({
    timeout: 240_000,
  });
  await page.screenshot({ path: `${STATE_DIR}/h1-after-reload.png` });
});
