import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow } from "./support/local-auth.js";

/**
 * Desktop (1440 × 900) keeps the auth surface deliberately simple: a
 * controlled-width column, no sidebar, no dashboard navigation.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("authentication (desktop)", () => {
  test("sign-in is a single narrow column outside the application shell", async ({
    page,
  }) => {
    await page.goto("/auth/sign-in");
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Home" })).toHaveCount(0);

    const form = page.locator("form").first();
    const box = await form.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(400);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(300);

    // One primary action.
    await expect(page.locator('button[type="submit"]')).toHaveCount(1);
  });

  test("sign-up and recovery share the same frame", async ({ page }) => {
    for (const path of ["/auth/sign-up", "/auth/forgot-password"]) {
      await page.goto(path);
      await expect(page.getByRole("complementary")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toHaveCount(1);
    }
  });
});
