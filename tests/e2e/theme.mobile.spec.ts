import { expect, test } from "@playwright/test";

/**
 * On a phone the theme is the worded Light · Device · Dark choice in the
 * mobile account menu (ADR 0017 F4), which is the You sheet in the header
 * since Work replaced More in the bar (option B, owner 2026-10-18).
 */
test("the You sheet carries Profile and the worded theme choice", async ({
  page,
}) => {
  await page.goto("/profile");
  const trigger = page.getByRole("banner").getByRole("button", { name: "You" });
  const box = await trigger.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await trigger.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await sheet.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await sheet.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
