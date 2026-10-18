import { expect, test } from "@playwright/test";

/**
 * Browser harness smoke verification: the application builds, serves and
 * routes. Product journeys live in the shell and feature specs.
 */
test.describe("web application smoke", () => {
  test("the root redirects into the product at Discover", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/discover$/);
    await expect(
      page.getByRole("heading", { name: "Discover", level: 1 }),
    ).toBeAttached();
    await expect(page).toHaveTitle(/Discover · Capital Q/);
  });

  test("/q is Q's page, and keeps the conversation it names", async ({
    page,
  }) => {
    await page.goto("/q?c=00000000-0000-4000-8000-000000000000");
    await expect(page).toHaveURL(
      /\/home\?c=00000000-0000-4000-8000-000000000000$/,
    );
  });
});
