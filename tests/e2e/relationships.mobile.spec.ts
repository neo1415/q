import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow } from "./support/local-auth.js";

/**
 * R27 at phone width, for the shared signed-in account (no company or
 * investor organisation yet): Relationships is a bottom tab whose label
 * fits, and its empty state points to setup. The investor journey spec
 * covers the populated profile (R25) and the investor empty state.
 */
test("Relationships is a tab, and its empty state points to setup", async ({
  page,
}) => {
  await page.goto("/discover");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const tab = nav.getByRole("link", { name: "Relationships" });
  const box = await tab.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  // The whole label is visible: nothing is clipped by the five-tab grid.
  expect(
    await tab
      .locator("span")
      .last()
      .evaluate((label) => label.scrollWidth <= label.clientWidth),
  ).toBe(true);

  await tab.tap();
  await expect(page).toHaveURL(/\/relationships$/);
  await expect(
    page.getByRole("heading", { name: "Relationships", level: 1 }),
  ).toBeVisible();
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Set up" })).toHaveAttribute(
    "href",
    "/welcome",
  );
  await expectNoHorizontalOverflow(page);
});
