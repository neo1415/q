import { expect, test } from "@playwright/test";

/**
 * Browser harness smoke verification: the application builds, serves and
 * routes. Product journeys live in the shell and feature specs.
 */
test.describe("web application smoke", () => {
  test("the root redirects into the product at /home", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/home$/);
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Home · Capital Q/);
  });
});
