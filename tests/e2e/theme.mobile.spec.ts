import { expect, test } from "@playwright/test";

/**
 * On a phone the theme is one icon in the header (R24; ADR 0017 F4): a
 * thumb-sized target opening Light, Dark and System.
 */
test("the header's theme icon opens the three choices", async ({ page }) => {
  await page.goto("/profile");
  const trigger = page
    .getByRole("banner")
    .getByRole("button", { name: /^Theme: / });
  const box = await trigger.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page
    .getByRole("banner")
    .getByRole("button", { name: "Account" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Profile" }),
  ).toBeVisible();
});
