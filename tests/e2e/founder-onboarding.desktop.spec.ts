import { expect, test } from "@playwright/test";

/** Desktop keeps the same journey in a readable centred column. */
test.describe("founder onboarding (desktop)", () => {
  test("renders first-value intelligence at reading width without overflow", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=intelligence");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Here's how I currently understand your company.",
      }),
    ).toBeVisible();
    const width = await page
      .locator("main")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(800);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
  });

  test("the review step edits a fact and confirms with the keyboard", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=review");
    const model = page.locator('[data-fact="model"]');
    await model.getByRole("button", { name: "Confirm" }).click();
    await expect(model).toContainText("Confirmed");
    await page.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Your founding team" }),
    ).toBeVisible();
  });
});
