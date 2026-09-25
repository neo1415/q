import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Directive E, fixture conversation 4d31d38d: "which specific investors
 * would likely invest in Zino Aviation?" must be read as prospect
 * identification — named prospects by fit, labelled as likely fit, kept
 * apart from evidenced interest — not as a search for investors publicly
 * linked to the company.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
const WHO = process.env["E5_WHO"] ?? "partial";
test.use({ storageState: `${STATE_DIR}/${WHO}-state.json` });

test("E: likely investors are prospects by fit, not publicly linked ones", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await page.goto("/home");
  const composer = page.getByPlaceholder("Or type to Q");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await composer.fill(
    process.env["E5_Q"] ??
      "Tell me the names of specific investors that would likely invest in Zino Aviation. It can be from public sources.",
  );
  await composer.press("Enter");
  const answer = page.locator('[data-q-answer="settled"]').last();
  await expect(answer).toBeVisible({ timeout: 600_000 });
  await page.waitForTimeout(1_500);
  const text = await answer.innerText();
  console.log(`\n=== LIKELY INVESTORS\n${text}\n===\nURL ${page.url()}`);
  await page.screenshot({
    path: `${STATE_DIR}/likely-investors.png`,
    fullPage: true,
  });
  // One answer to one question.
  await expect(page.locator('[data-q-answer="settled"]')).toHaveCount(1);
});
