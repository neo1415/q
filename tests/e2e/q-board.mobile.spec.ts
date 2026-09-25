import { expect, test } from "@playwright/test";

/**
 * The Q page on a phone: the stage fits the screen with no sideways
 * scroll, and the Board is one press away as a sheet.
 */
test("fits the phone and opens the Board as a sheet", async ({ page }) => {
  await page.goto("/home");
  await expect(page.locator("[data-q-workspace]")).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Board" }).tap();
  const sheet = page.getByRole("dialog", { name: "Board" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-q-board]")).toBeVisible();
});
