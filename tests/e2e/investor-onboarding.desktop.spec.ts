import { expect, test, type Page } from "@playwright/test";

import { signUpThroughUi, uniqueEmail } from "./support/local-auth.js";

/**
 * Investor onboarding I0 → I12 on desktop against the real Capital Q API
 * and the local database. Each test signs up its own investor so journeys
 * never share a session, then walks the composite screens the web presents
 * over the runtime's I0–I12 steps. Nothing here is synthetic: the investor
 * organisation, representative, mandate, preferences and portfolio
 * references are created for real, and the mandate is activated for real.
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function continueStep(page: Page) {
  await page.getByRole("button", { name: /^(Continue|Looks right)$/ }).click();
}

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

const FORBIDDEN_COPY =
  /Q understood|Q analysed|Q analyzed|Q recommends|matches found|personalised feed|personalized feed|\d+ matches|\d+% match/i;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function suggestAndPickFirst(page: Page, query: string) {
  await page.getByRole("textbox", { name: "Search categories" }).fill(query);
  await page.getByRole("button", { name: "Suggest" }).click();
  const suggestions = page
    .getByRole("list", { name: "Suggested categories" })
    .getByRole("button", { name: /add as a preference/ });
  await expect(suggestions.first()).toBeVisible();
  const label = (await suggestions.first().textContent()) ?? "";
  await suggestions.first().click();
  return label.replace(", add as a preference", "").trim();
}

test.describe("investor onboarding (desktop, real API)", () => {
  test("I0 → I12: a new investor creates a real organisation and mandate, survives a refresh, recalibrates from the review and activates", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await signUpThroughUi(page, uniqueEmail("investor"));
    await page.getByRole("link", { name: "Set up as an investor" }).click();
    await expect(page).toHaveURL(/\/onboarding\/investor$/);

    // I0 — role: the investor type describes the organisation; the firm
    // name creates its workspace; the title grants nothing.
    await screen(page, "How do you invest?");
    await expect(page.getByText("Development preview")).toHaveCount(0);
    await page.getByRole("radio", { name: "Venture capital fund" }).check();
    const firm = `E2E Northbank ${Date.now().toString(36)}`;
    await page.getByRole("textbox", { name: "Your firm" }).fill(firm);
    await page
      .getByRole("textbox", { name: "Your role there" })
      .fill("Partner");
    await continueStep(page);

    // I1 — deployment state (operating state, not mandate status).
    await screen(page, "Are you deploying capital right now?");
    await page.getByRole("radio", { name: "Actively investing" }).check();
    await continueStep(page);

    // I1 — mandate context: exactly one draft exists and is preselected.
    await screen(page, "Which mandate are we defining?");
    const draft = page.getByRole("radio", { name: /Primary mandate/ });
    await expect(draft).toBeChecked();
    await expect(page.getByText("Draft — not active yet")).toBeVisible();
    await continueStep(page);

    // I2 — stage and cheque: exact amounts, one currency.
    await screen(page, "Stage and cheque");
    await page.getByRole("checkbox", { name: "Seed", exact: true }).check();
    await page.getByRole("checkbox", { name: "Series A" }).check();
    await page.getByRole("textbox", { name: "Minimum cheque" }).fill("250000");
    await page.getByRole("textbox", { name: "Typical cheque" }).fill("1000000");
    await page.getByRole("textbox", { name: "Maximum cheque" }).fill("3000000");
    await page.getByRole("checkbox", { name: "Lead rounds" }).check();
    await continueStep(page);

    // I3 — geography: suggested from the investor's words, confirmed
    // explicitly, with an explicit strength.
    await screen(page, "Where do you invest?");
    await expect(page.getByText(/Q understood/)).toHaveCount(0);
    const geography = await suggestAndPickFirst(page, "nigeria");
    expect(geography).toBe("Nigeria");
    await page.getByRole("radio", { name: "Must match" }).check();
    await continueStep(page);

    // I3 — sectors.
    await screen(page, "Which sectors and product areas?");
    const sector = await suggestAndPickFirst(page, "fintech");
    expect(sector.length).toBeGreaterThan(0);
    await expect(page.getByText("Rather not see")).toBeVisible();
    await continueStep(page);

    // I4 — business attributes: separate dimensions.
    await screen(page, "Business attributes");
    const models = page
      .getByRole("list", { name: "Business models you back" })
      .getByRole("button");
    await expect(models.first()).toBeVisible();
    await models.first().click();
    await expect(models.first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("radio", { name: "Prefer capital-light" }).check();
    await continueStep(page);

    // I5 — founder preferences (allowlisted business attributes only).
    await screen(page, "Founding-team capabilities that matter to you");
    await page.getByRole("checkbox", { name: "Repeat founders" }).check();
    await continueStep(page);

    // I6 — green flags with an explicit strength and free text.
    await screen(page, "Green flags");
    await page.getByRole("checkbox", { name: "Capital efficiency" }).check();
    await page.getByRole("radio", { name: "Must match" }).check();
    await page
      .getByRole("textbox", { name: "Anything else you look for?" })
      .fill("Founders who have sold into banks before.");
    await continueStep(page);

    // I7 — red flags: "rather not" and "never show" are different lists.
    await screen(page, "Red flags");
    const avoid = page.locator('[data-red-flags="avoid"]');
    const hard = page.locator('[data-red-flags="hard"]');
    await expect(avoid.getByText("I'd rather not see")).toBeVisible();
    await expect(hard.getByText("Never show me")).toBeVisible();
    await expect(hard.getByText(/hard exclusion/i)).toBeVisible();
    await avoid.getByRole("checkbox", { name: "Hardware-heavy" }).check();
    await hard.getByRole("checkbox", { name: "Gambling" }).check();
    await continueStep(page);

    // I8 — portfolio references: names only, investor-owned.
    await screen(page, "A few representative portfolio companies");
    await page.getByRole("textbox").fill("Paystack\nMoniepoint");
    await continueStep(page);

    // I9 / I10.
    await screen(page, "How adventurous should discovery be?");
    await page.getByRole("radio", { name: "Balanced" }).check();
    await continueStep(page);
    await screen(page, "How should founders reach you?");
    await page.getByRole("radio", { name: "Qualified" }).check();
    await continueStep(page);

    // I11 — additional context skipped; the review is what was declared.
    await screen(page, "Add something we missed");
    await page.getByRole("button", { name: "Skip for now" }).click();
    await screen(page, "Here's the mandate you've defined");
    await expect(page.locator('[data-review-item="investor"]')).toContainText(
      firm,
    );
    await expect(page.locator('[data-review-item="stages"]')).toContainText(
      "Seed, Series A",
    );
    await expect(page.locator('[data-review-item="cheque"]')).toContainText(
      "USD · min 250000 · typical 1000000 · max 3000000",
    );
    await expect(
      page.locator('[data-review-item="geographies"]'),
    ).toContainText("Nigeria");
    await expect(
      page.locator('[data-review-item="geographies"]'),
    ).toContainText("must have");
    await expect(page.locator('[data-review-item="avoid"]')).toContainText(
      "Hardware-heavy",
    );
    const exclusions = page.locator('[data-review-item="hard_exclusions"]');
    await expect(exclusions).toContainText("Gambling");
    await expect(exclusions).not.toContainText("Hardware-heavy");
    await expect(page.locator('[data-review-item="portfolio"]')).toContainText(
      "Paystack, Moniepoint",
    );
    await expect(page.locator('[data-review-item="inbound"]')).toContainText(
      "Qualified",
    );
    await expect(page.locator("[data-mandate-version]")).toContainText("draft");
    const versionBefore =
      (await page.locator("[data-mandate-version]").textContent()) ?? "";
    await expect(page.getByText(FORBIDDEN_COPY)).toHaveCount(0);
    await expect(page.getByText(/readiness|score|verified/i)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // A refresh mid-journey resumes exactly here, with the same mandate.
    await page.reload();
    await screen(page, "Here's the mandate you've defined");
    await expect(page.locator('[data-review-item="investor"]')).toContainText(
      firm,
    );

    // Change the cheque from the review: the same mandate recalibrates
    // (version moves on); nothing is duplicated.
    await page
      .locator('[data-review-item="cheque"]')
      .getByRole("button", { name: /Change/ })
      .click();
    await screen(page, "Stage and cheque");
    await expect(
      page.getByRole("textbox", { name: "Typical cheque" }),
    ).toHaveValue("1,000,000");
    await page.getByRole("textbox", { name: "Typical cheque" }).fill("1500000");
    await continueStep(page);
    await screen(page, "Here's the mandate you've defined");
    await expect(page.locator('[data-review-item="cheque"]')).toContainText(
      "typical 1500000",
    );
    const versionAfter =
      (await page.locator("[data-mandate-version]").textContent()) ?? "";
    expect(versionAfter).not.toBe(versionBefore);

    // Confirm: DRAFT → ACTIVE, then the truthful handoff.
    await page.getByRole("button", { name: "Looks right" }).click();
    await screen(page, "Your mandate is ready");
    await expect(page.locator("[data-handoff-mandate]")).toContainText(
      "Active",
    );
    await expect(page.locator("[data-handoff-recommendation]")).toContainText(
      "Not available yet",
    );
    await expect(page.getByText(FORBIDDEN_COPY)).toHaveCount(0);
    await expect(page.getByText(/GateQ/)).toHaveCount(0);

    // Back to the review from the handoff: now active.
    await page.getByRole("button", { name: "Review my mandate" }).click();
    await screen(page, "Here's the mandate you've defined");
    await expect(page.locator("[data-mandate-version]")).toContainText(
      "active",
    );
    await page.getByRole("button", { name: "Looks right" }).click();
    await screen(page, "Your mandate is ready");

    // Finish: journey completion only, then Discover's honest empty state.
    await page.getByRole("button", { name: "Go to Discover" }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await page.goto("/onboarding/investor");
    await expect(page.getByText("Investor setup is complete.")).toBeVisible();
  });

  test("Back preserves answers and a stale tab is told the session moved on", async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000);
    await signUpThroughUi(page, uniqueEmail("investor-back"));
    await page.goto("/onboarding/investor");
    await page.getByRole("radio", { name: "Angel investor" }).check();
    // A solo angel keeps the personal workspace; no firm is joined.
    await expect(page.getByRole("textbox", { name: "Your firm" })).toHaveValue(
      "Personal Investing",
    );
    await continueStep(page);
    await screen(page, "Are you deploying capital right now?");
    await page.getByRole("radio", { name: "Selective" }).check();
    await continueStep(page);
    await screen(page, "Which mandate are we defining?");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("radio", { name: "Selective" })).toBeChecked();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("radio", { name: "Angel investor" }),
    ).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Your firm" })).toHaveValue(
      "Personal Investing",
    );

    // A second tab answers first; the stale tab reloads the latest state
    // instead of overwriting it.
    const other = await context.newPage();
    await other.goto("/onboarding/investor");
    await expect(
      other.getByRole("radio", { name: "Angel investor" }),
    ).toBeChecked();
    await other.getByRole("textbox", { name: "Your role there" }).fill("Angel");
    await continueStep(other);
    // Deployment is already answered, so the runtime moves on to the next
    // incomplete step.
    await screen(other, "Which mandate are we defining?");

    await page.getByRole("textbox", { name: "Your role there" }).fill("Scout");
    await continueStep(page);
    await expect(page.getByText("Updated elsewhere")).toBeVisible();
    await screen(page, "Which mandate are we defining?");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("textbox", { name: "Your role there" }),
    ).toHaveValue("Angel");
  });
});
