import { expect, test, type Page } from "@playwright/test";

import { signUpThroughUi, uniqueEmail } from "./support/local-auth.js";

/**
 * Founder onboarding F0 → F8 on desktop against the real Capital Q API and
 * the local database. Each test signs up its own founder so journeys never
 * share a session, then walks the composite screens the web presents over
 * the runtime's F0–F8 steps. Nothing here is synthetic: the company,
 * membership, team facts and capital objective are created for real.
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function continueStep(page: Page) {
  await page.getByRole("button", { name: /^(Continue|Looks right)$/ }).click();
}

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("founder onboarding (desktop, real API)", () => {
  test("F0 → F8: a new founder creates a real company, survives a refresh, and lands on the snapshot", async ({
    page,
  }) => {
    test.slow();
    await signUpThroughUi(page, uniqueEmail("founder"));
    await page.getByRole("link", { name: "Set up as a founder" }).click();
    await expect(page).toHaveURL(/\/onboarding\/founder$/);

    // F0 — intent.
    await expect(heading(page, "What brings you to Capital Q?")).toBeVisible();
    await expect(page.getByText("Development preview")).toHaveCount(0);
    await page
      .getByRole("radio", { name: /I'm raising for a company/ })
      .check();
    await continueStep(page);

    // F1 — company basics: this creates the canonical company.
    await expect(heading(page, "Your company")).toBeVisible();
    const name = `E2E Rail ${Date.now().toString(36)}`;
    await page.getByRole("textbox", { name: "Company name" }).fill(name);
    await page
      .getByRole("textbox", { name: "Website" })
      .fill("e2e-rail.example");
    await page
      .getByRole("combobox", { name: "Where is the company based?" })
      .selectOption("ng");
    await continueStep(page);

    await expect(heading(page, "What stage is the company at?")).toBeVisible();
    await page.getByRole("radio", { name: "Seed", exact: true }).check();
    await continueStep(page);

    await expect(
      heading(page, /In a sentence or two, what does the company do\?/),
    ).toBeVisible();
    await page
      .getByRole("textbox")
      .fill("We automate claims handling for mid-sized insurers.");
    await continueStep(page);

    // Categories: suggested from the founder's words, confirmed explicitly.
    await expect(
      heading(page, "How would you categorise the company?"),
    ).toBeVisible();
    await expect(page.getByText("Suggested categories").first()).toBeVisible();
    await expect(page.getByText(/Q analysis/)).toHaveCount(0);
    const suggestions = page
      .getByRole("list", { name: "Suggested categories" })
      .getByRole("button");
    if ((await suggestions.count()) > 0) {
      await suggestions.first().click();
      await expect(suggestions.first()).toHaveAttribute("aria-pressed", "true");
      await continueStep(page);
    } else {
      await page.getByRole("button", { name: "Skip for now" }).click();
    }

    // F2 — materials: a declaration, no file picker anywhere.
    await expect(heading(page, "What do you already have?")).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Pitch deck" }).check();
    await continueStep(page);

    // F3 — review: exactly what was entered, from the canonical company.
    await expect(heading(page, "Here's what we have so far")).toBeVisible();
    await expect(page.locator('[data-review-item="name"]')).toContainText(name);
    await expect(page.locator('[data-review-item="website"]')).toContainText(
      "https://e2e-rail.example",
    );
    await expect(page.locator('[data-review-item="country"]')).toContainText(
      "Nigeria",
    );
    await expect(page.locator('[data-review-item="stage"]')).toContainText(
      "Seed",
    );
    await expect(page.locator('[data-review-item="materials"]')).toContainText(
      "Pitch deck",
    );
    await expect(page.getByText(/readiness|verified|score/i)).toHaveCount(0);

    // A refresh mid-journey resumes exactly here, with the same company.
    await page.reload();
    await expect(heading(page, "Here's what we have so far")).toBeVisible();
    await expect(page.locator('[data-review-item="name"]')).toContainText(name);
    await page.getByRole("button", { name: "Looks right" }).click();

    // F4 — team.
    await expect(heading(page, "Your founding team")).toBeVisible();
    await page.getByRole("radio", { name: "CEO" }).check();
    await page.getByRole("textbox", { name: "How many founders?" }).fill("2");
    await page
      .getByRole("radio", { name: "All founders are full-time" })
      .check();
    await page
      .getByRole("textbox", { name: /How many people work on the company/ })
      .fill("6");
    await page.getByRole("checkbox", { name: "Product" }).check();
    await continueStep(page);

    // F5 — seed stage takes the pre-revenue branch; a follow-up appears.
    await expect(heading(page, "Business and traction")).toBeVisible();
    await expect(page.locator("form[data-traction-variant]")).toHaveAttribute(
      "data-traction-variant",
      "pre_revenue",
    );
    await page.getByRole("radio", { name: "Pilots running" }).check();
    await continueStep(page);
    await expect(
      page.getByRole("textbox", {
        name: "How many pilots or design partners?",
      }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "How many pilots or design partners?" })
      .fill("4");
    await continueStep(page);

    // F6 — the raise becomes the company's capital objective.
    await expect(heading(page, "Are you raising now?")).toBeVisible();
    await page.getByRole("radio", { name: "Yes, actively" }).check();
    const amount = page.getByRole("textbox", { name: "Target amount" });
    await amount.fill("500000");
    await expect(amount).toHaveValue("500,000");
    await page.getByRole("radio", { name: "SAFE" }).check();
    await page
      .getByRole("checkbox", { name: "Product and engineering" })
      .check();
    await continueStep(page);

    // F7 — private follow-up, skipped.
    await expect(
      heading(page, "Anything else you want on record?"),
    ).toBeVisible();
    await expect(page.getByText(/Private to you/)).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    // F8 — the snapshot: what was entered, no score, no matches, no banner.
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Here's what we have so far.",
      }),
    ).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByText("Raising USD 500000")).toBeVisible();
    await expect(page.getByText("2 founders, 2 full-time")).toBeVisible();
    await expect(page.getByText(/onboarding complete/i)).toHaveCount(0);
    await expect(
      page.getByText(/\d+% (good|match)|investors for you|investment quality/i),
    ).toHaveCount(0);
    await expect(
      page.getByText("Investors don't see this.", { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Back from the snapshot reopens the review with the same facts.
    await page.getByRole("button", { name: "Keep improving" }).click();
    await expect(heading(page, "Here's what we have so far")).toBeVisible();
    await expect(page.locator('[data-review-item="name"]')).toContainText(name);
    await page.getByRole("button", { name: "Looks right" }).click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Here's what we have so far.",
      }),
    ).toBeVisible();

    // Finish: journey completion only, then Home. Returning shows completion.
    await page.getByRole("button", { name: "Go to Home" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto("/onboarding/founder");
    await expect(page.getByText("Founder setup is complete.")).toBeVisible();
  });

  test("Back preserves answers and a stale tab is told the session moved on", async ({
    page,
    context,
  }) => {
    await signUpThroughUi(page, uniqueEmail("founder-back"));
    await page.goto("/onboarding/founder");
    await page.getByRole("radio", { name: /I'm preparing to raise/ }).check();
    await continueStep(page);
    await expect(heading(page, "Your company")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Company name" })
      .fill(`Back Co ${Date.now().toString(36)}`);
    await continueStep(page);
    await expect(heading(page, "What stage is the company at?")).toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(heading(page, "Your company")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Company name" }),
    ).toHaveValue(/Back Co/);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("radio", { name: /I'm preparing to raise/ }),
    ).toBeChecked();

    // A second tab answers first; the stale tab reloads the latest state
    // instead of overwriting it.
    const other = await context.newPage();
    await other.goto("/onboarding/founder");
    await expect(
      other.getByRole("radio", { name: /I'm preparing to raise/ }),
    ).toBeChecked();
    await other.getByRole("radio", { name: /exploring/ }).check();
    await continueStep(other);
    // The company screen is already answered, so the runtime moves on to
    // the next incomplete step.
    await expect(heading(other, "What stage is the company at?")).toBeVisible();

    await page
      .getByRole("radio", { name: /I'm raising for a company/ })
      .check();
    await continueStep(page);
    await expect(page.getByText("Updated elsewhere")).toBeVisible();
    await expect(heading(page, "What stage is the company at?")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("radio", { name: /exploring/ })).toBeChecked();
  });
});
