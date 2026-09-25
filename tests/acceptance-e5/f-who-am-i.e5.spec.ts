import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Directive item "Home Q doesn't know the person" (fixture conversation
 * 64aab371): an onboarded investor asks Home Q who they are according to
 * their profile. Q must answer from their own authorised profile.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
const WHO = process.env["E5_WHO"] ?? "investor";
test.use({ storageState: `${STATE_DIR}/${WHO}-state.json` });

test("who am I, according to my profile", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/home");
  const composer = page.getByPlaceholder("Or type to Q");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await composer.fill(
    "Okay. According to my profile, who am I? Is there anything in my profile that still needs to be filled in?",
  );
  await composer.press("Enter");
  const answer = page.locator('[data-q-answer="settled"]').last();
  await expect(answer).toBeVisible({ timeout: 300_000 });
  await page.waitForTimeout(1_500);
  const text = await answer.innerText();
  console.log(`\n=== WHO AM I (${WHO})\n${text}\n===\nURL ${page.url()}`);
  await page.screenshot({
    path: `${STATE_DIR}/who-am-i-${WHO}.png`,
    fullPage: true,
  });
});
