import { expect, test } from "@playwright/test";

/**
 * Browser harness smoke verification.
 *
 * This is infrastructure verification, NOT product coverage. It proves the
 * Playwright harness can build, serve and drive the Capital Q web application
 * and assert on user-visible output. It does not cover any product journey.
 *
 * Real founder, investor, relationship and Q journeys arrive with the feature
 * packets that own them (TEO-017).
 */
test.describe("web application smoke", () => {
  test("serves the Capital Q application root", async ({ page }) => {
    await page.goto("/");

    // Semantic, user-facing locator with a web-first assertion: Playwright
    // retries until the heading appears rather than sleeping (TEO-016).
    await expect(
      page.getByRole("heading", { name: "Capital Q", level: 1 }),
    ).toBeVisible();

    await expect(page).toHaveTitle("Capital Q");
  });
});
