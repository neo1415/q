import { expect, test } from "@playwright/test";

/**
 * On a phone the theme is the first row of the header's account menu
 * (ADR 0017 F4), with thumb-sized segments.
 */
test("the account menu opens on the theme", async ({ page }) => {
  await page.goto("/profile");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Account and appearance" })
    .click();
  const menu = page.getByRole("dialog");
  const theme = menu.getByRole("group", { name: "Theme" });
  await expect(theme).toBeVisible();
  const box = await theme.getByRole("button", { name: "Dark" }).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(menu.getByRole("link", { name: "Profile" })).toBeVisible();
});
