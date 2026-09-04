import { expect, test, type Page } from "@playwright/test";

import { signUpThroughUi, uniqueEmail } from "./support/local-auth.js";

/**
 * Investor onboarding on a phone (390 × 844, touch) against the real API.
 * The full I0 → I12 walk lives in the desktop spec; this file covers the
 * phone-specific behaviour on real sessions: layout, semantic progress,
 * touch targets, the two red-flag lists staying distinguishable on a narrow
 * screen, and resume after a refresh.
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

/**
 * A composite screen (stage and cheque, business attributes, red flags…)
 * becomes one runtime request per step, each verified against the local
 * Auth service. On a developer machine that is several seconds per screen,
 * so the next heading gets a longer wait than the suite's 10 s default. The
 * assertion is unchanged; only the wait bound is.
 */
const SCREEN_TIMEOUT = 45_000;
const screen = (page: Page, name: string | RegExp) =>
  expect(heading(page, name)).toBeVisible({ timeout: SCREEN_TIMEOUT });

test.describe("investor onboarding (mobile, real API)", () => {
  test("I0 → I2 on a phone: no overflow, progress announced, refresh resumes the same mandate", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await signUpThroughUi(page, uniqueEmail("investor-mobile"));
    await page.goto("/onboarding/investor");

    await screen(page, "How do you invest?");
    await expect(progressText(page)).toHaveText("Context, step 1 of 3");
    await expect(
      page.getByRole("link", { name: "Save & leave" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      0,
    );
    await page.getByRole("radio", { name: "Family office" }).check();
    const firm = `Mobile Office ${Date.now().toString(36)}`;
    await page.getByRole("textbox", { name: "Your firm" }).fill(firm);
    await expectNoHorizontalOverflow(page);
    await continueStep(page);

    await screen(page, "Are you deploying capital right now?");
    await expect(progressText(page)).toHaveText("Context, step 2 of 3");
    for (const name of ["Actively investing", "Selective", "Paused"]) {
      const box = await page
        .getByRole("radio", { name })
        .locator("..")
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("radio", { name: "Paused" }).check();
    await continueStep(page);

    await screen(page, "Which mandate are we defining?");
    await expect(progressText(page)).toHaveText("Context, step 3 of 3");
    await expect(
      page.getByRole("radio", { name: /Primary mandate/ }),
    ).toBeChecked();
    await continueStep(page);

    await screen(page, "Stage and cheque");
    await expect(progressText(page)).toHaveText("Mandate, step 1 of 4");
    await page.getByRole("checkbox", { name: "Pre-seed" }).check();
    await page.getByRole("textbox", { name: "Maximum cheque" }).fill("50000");
    await expectNoHorizontalOverflow(page);

    // Refresh, leave to Home and return: the same session and mandate.
    await page.reload();
    await screen(page, "Stage and cheque");
    await page.getByRole("link", { name: "Save & leave" }).tap();
    await expect(page).toHaveURL(/\/home$/);
    await page.getByRole("link", { name: "Set up as an investor" }).tap();
    await expect(page).toHaveURL(/\/onboarding\/investor$/);
    await screen(page, "Stage and cheque");
    await expect(progressText(page)).toHaveText("Mandate, step 1 of 4");
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(
      page.getByRole("radio", { name: /Primary mandate/ }),
    ).toBeChecked();
  });

  test("red flags keep 'rather not' and 'never show' apart on a narrow screen, and cheque order is checked exactly", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await signUpThroughUi(page, uniqueEmail("investor-flags"));
    await page.goto("/onboarding/investor");
    await page.getByRole("radio", { name: "Angel investor" }).check();
    await continueStep(page);
    await page.getByRole("radio", { name: "Exploring only" }).check();
    await continueStep(page);
    await screen(page, "Which mandate are we defining?");
    await continueStep(page);

    // Inverted cheques are refused before anything is sent.
    await screen(page, "Stage and cheque");
    await page.getByRole("checkbox", { name: "Seed", exact: true }).check();
    await page.getByRole("textbox", { name: "Minimum cheque" }).fill("900000");
    await page.getByRole("textbox", { name: "Maximum cheque" }).fill("100000");
    await continueStep(page);
    await expect(
      page.getByText(
        "Keep the cheques in order: minimum, then typical, then maximum.",
      ),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Minimum cheque" }).fill("50000");
    await continueStep(page);

    // Skip through the optional mandate screens to the red flags.
    await screen(page, "Where do you invest?");
    await page.getByRole("button", { name: "Skip for now" }).tap();
    await screen(page, "Which sectors and product areas?");
    await page.getByRole("button", { name: "Skip for now" }).tap();
    await screen(page, "Business attributes");
    await page.getByRole("button", { name: "Skip for now" }).tap();
    await screen(page, "Founding-team capabilities that matter to you");
    await page.getByRole("button", { name: "Skip for now" }).tap();
    await screen(page, "Green flags");
    await page.getByRole("button", { name: "Skip for now" }).tap();

    await screen(page, "Red flags");
    const avoid = page.locator('[data-red-flags="avoid"]');
    const hard = page.locator('[data-red-flags="hard"]');
    await expect(avoid.getByText("I'd rather not see")).toBeVisible();
    await expect(hard.getByText("Never show me")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // The same flag cannot be both a soft avoid and a hard exclusion.
    await avoid.getByRole("checkbox", { name: "Tobacco" }).check();
    await hard.getByRole("checkbox", { name: "Tobacco" }).check();
    await continueStep(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "not both" }),
    ).toBeVisible();
    await avoid.getByRole("checkbox", { name: "Tobacco" }).uncheck();
    await continueStep(page);
    await screen(page, "A few representative portfolio companies");
  });
});
