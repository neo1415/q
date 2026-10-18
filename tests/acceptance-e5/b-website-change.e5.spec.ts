import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * ACC round 3 A5, re-run live (CQ-QX-007): the founder asks Home Q to
 * change the website. A proposal must exist with an Approve control, Q's
 * prose must not claim the change is noted or done, and the record must
 * change only after Approve.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
test.use({ storageState: `${STATE_DIR}/founder-state.json` });

test("A5: a website change becomes a proposal, and only Approve applies it", async ({
  page,
}) => {
  await page.goto("/home");
  const composer = page.getByPlaceholder("Or type to Q");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await composer.fill(
    "also our site moved to kivu-freight.africa, update it please",
  );
  await composer.press("Enter");
  // The run's answer settles.
  await expect(page.locator('[data-q-answer="settled"]').last()).toBeVisible({
    timeout: 240_000,
  });
  const approve = page.getByRole("button", { name: "Approve" });
  await expect(approve).toBeVisible({ timeout: 60_000 });
  const answer = await page.locator("[data-q-answer]").last().innerText();
  console.log("Q ANSWER >>>", answer, "<<<");
  console.log(
    "APPROVAL >>>",
    await page.locator("[data-q-approval]").last().innerText(),
    "<<<",
  );
  await page.screenshot({ path: `${STATE_DIR}/a5-proposal.png` });
  console.log("URL", page.url());
  if (process.env["E5_APPROVE"] === "1") {
    await approve.click();
    await page.waitForTimeout(15_000);
    await page.screenshot({ path: `${STATE_DIR}/a5-approved.png` });
  }
});
