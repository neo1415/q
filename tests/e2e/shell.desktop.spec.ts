import { expect, test } from "@playwright/test";

/** Desktop is the same information architecture, progressively enhanced. */
test.describe("desktop application shell", () => {
  test("shows the sidebar, hides the bottom navigation, and navigates", async ({
    page,
  }) => {
    await page.goto("/home");

    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeVisible();
    const nav = sidebar.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveCount(3);
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Ask Q" })).toBeVisible();

    // Exactly one Primary navigation is exposed: the mobile one is display:none.
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      1,
    );

    await expect(page.getByRole("textbox", { name: "Ask Q" })).toBeVisible();

    await nav.getByRole("link", { name: "Discover" }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(nav.getByRole("link", { name: "Discover" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "Capital" }).click();
    await expect(
      page.getByRole("heading", { name: "Capital", level: 1 }),
    ).toBeVisible();

    await sidebar.getByRole("link", { name: "Profile" }).click();
    await expect(
      page.getByRole("heading", { name: "Profile", level: 1 }),
    ).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test("shows the signed-in account and does not fabricate an organisation", async ({
    page,
  }) => {
    await page.goto("/profile");
    // The account row carries the verified provider email, nothing invented.
    await expect(page.getByText(/@example\.invalid/)).toBeVisible();
    await expect(page.getByText("No context set").first()).toBeVisible();
    await expect(page.getByText("Active organisation membership")).toHaveCount(
      0,
    );
  });

  test("the development UI preview is not available in production builds", async ({
    page,
  }) => {
    const response = await page.goto("/dev/ui");
    expect(response?.status()).toBe(404);
  });
});
