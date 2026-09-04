import { expect, test, type Page } from "@playwright/test";

import { signUpThroughUi, uniqueEmail } from "./support/local-auth.js";

/**
 * Founder onboarding on a phone (390 × 844, touch) against the real API.
 * Each test signs up its own founder. The full F0 → F8 walk lives in the
 * desktop spec; this file covers the phone-specific behaviour: layout,
 * reachability with the keyboard up, touch targets, keyboard-only use and
 * resume after a refresh, all on real sessions.
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function continueStep(page: Page) {
  await page.getByRole("button", { name: /^(Continue|Looks right)$/ }).tap();
}

const progressText = (page: Page) => page.locator("[data-progress-text]");
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });

test.describe("founder onboarding (mobile, real API)", () => {
  test("F0 → F3 on a phone: no overflow, progress announced, refresh resumes the same company", async ({
    page,
  }) => {
    test.slow();
    await signUpThroughUi(page, uniqueEmail("founder-mobile"));
    await page.goto("/onboarding/founder");

    await expect(heading(page, "What brings you to Capital Q?")).toBeVisible();
    await expect(progressText(page)).toHaveText("Company, step 1 of 7");
    await expect(
      page.getByRole("link", { name: "Save & leave" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      0,
    );
    await page
      .getByRole("radio", { name: /I'm raising for a company/ })
      .check();
    await expectNoHorizontalOverflow(page);
    await continueStep(page);

    await expect(heading(page, "Your company")).toBeVisible();
    await expect(progressText(page)).toHaveText("Company, step 2 of 7");
    const name = `Mobile Rail ${Date.now().toString(36)}`;
    await page.getByRole("textbox", { name: "Company name" }).fill(name);
    await page
      .getByRole("combobox", { name: "Where is the company based?" })
      .selectOption("ke");
    await continueStep(page);

    await expect(heading(page, "What stage is the company at?")).toBeVisible();
    await page.getByRole("radio", { name: "Series A" }).check();
    await continueStep(page);
    await page.getByRole("button", { name: "Skip for now" }).tap();
    await expect(
      heading(page, "How would you categorise the company?"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).tap();
    await expect(heading(page, "What do you already have?")).toBeVisible();
    await page.getByRole("checkbox", { name: "Nothing yet" }).check();
    await expectNoHorizontalOverflow(page);
    await continueStep(page);

    await expect(heading(page, "Here's what we have so far")).toBeVisible();
    await expect(page.locator('[data-review-item="name"]')).toContainText(name);
    await expect(page.locator('[data-review-item="country"]')).toContainText(
      "Kenya",
    );
    await expect(page.locator('[data-review-item="materials"]')).toContainText(
      "Nothing yet",
    );

    // Refresh, leave to Home and return: the same session and company.
    await page.reload();
    await expect(heading(page, "Here's what we have so far")).toBeVisible();
    await page.getByRole("link", { name: "Save & leave" }).tap();
    await expect(page).toHaveURL(/\/home$/);
    await page.getByRole("link", { name: "Set up as a founder" }).tap();
    await expect(page).toHaveURL(/\/onboarding\/founder$/);
    await expect(heading(page, "Here's what we have so far")).toBeVisible();
    await expect(page.locator('[data-review-item="name"]')).toContainText(name);
    await expect(progressText(page)).toHaveText("Company, step 7 of 7");

    // Series A takes the revenue branch.
    await page.getByRole("button", { name: "Looks right" }).tap();
    await expect(heading(page, "Your founding team")).toBeVisible();
    await expect(progressText(page)).toHaveText("Business, step 1 of 2");
    await page.getByRole("radio", { name: "CTO" }).check();
    await page.getByRole("textbox", { name: "How many founders?" }).fill("3");
    await page
      .getByRole("radio", { name: "Some founders are full-time" })
      .check();
    await page
      .getByRole("textbox", { name: /How many people work on the company/ })
      .fill("40");
    await continueStep(page);
    await expect(page.locator("form[data-traction-variant]")).toHaveAttribute(
      "data-traction-variant",
      "revenue",
    );
    await expect(page.getByText("Paying customers")).toBeVisible();
    await expect(
      page.getByText("How many pilots or design partners?"),
    ).toHaveCount(0);
  });

  test("the bottom action bar reserves space, stays reachable with the keyboard up, and targets are comfortable", async ({
    page,
  }) => {
    await signUpThroughUi(page, uniqueEmail("founder-targets"));
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto("/onboarding/founder");
    await expect(heading(page, "What brings you to Capital Q?")).toBeVisible();
    await continueStep(page); // nothing chosen → inline error, still on F0
    await expect(
      page.getByRole("alert").filter({ hasText: "Choose one" }),
    ).toBeVisible();
    for (const name of [/I'm raising/, /preparing/, /exploring/]) {
      const box = await page
        .getByRole("radio", { name })
        .locator("..")
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("radio", { name: /exploring/ }).check();
    await continueStep(page);
    await page.getByRole("textbox", { name: "Company name" }).focus();
    const send = await page
      .getByRole("button", { name: "Continue" })
      .boundingBox();
    expect(send?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((send?.y ?? 0) + (send?.height ?? 0)).toBeLessThanOrEqual(500);
    const geometry = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main === null
        ? 0
        : Number.parseFloat(getComputedStyle(main).paddingBottom);
    });
    expect(geometry).toBeGreaterThanOrEqual(90);
  });

  test("keyboard only: select with arrows, submit with Enter, with visible focus", async ({
    page,
  }) => {
    await signUpThroughUi(page, uniqueEmail("founder-keys"));
    await page.goto("/onboarding/founder");
    await page.getByRole("radio", { name: /I'm raising/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /preparing/ })).toBeChecked();
    const outline = await page
      .getByRole("radio", { name: /preparing/ })
      .locator("..")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(heading(page, "Your company")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Company name" })
      .fill(`Keys Co ${Date.now().toString(36)}`);
    await page.keyboard.press("Enter");
    await expect(heading(page, "What stage is the company at?")).toBeVisible();
  });
});
