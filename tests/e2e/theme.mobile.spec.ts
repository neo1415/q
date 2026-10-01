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

  // The More sheet carries Profile and the worded theme choice too.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "More" })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await sheet.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
