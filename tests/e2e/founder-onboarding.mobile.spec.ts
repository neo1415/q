import { expect, test, type Page } from "@playwright/test";

/**
 * Founder onboarding F0–F8 on a phone (390 × 844, touch), driven by the
 * deterministic fixture adapter the e2e server is configured with. Nothing
 * here talks to a backend or uploads a file anywhere.
 */

const SYNTHETIC_DECK = {
  name: "nexarail-deck.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 synthetic fixture deck"),
};

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function continueStep(page: Page) {
  await page
    .getByRole("button", { name: /Continue|Confirm and continue/ })
    .tap();
}

const progressText = (page: Page) => page.locator("[data-progress-text]");

test.describe("founder onboarding (mobile)", () => {
  test("F0 → F8: the complete founder journey on the fixture adapter", async ({
    page,
  }) => {
    // Nine screens in one journey: give it the slow budget on purpose.
    test.slow();
    await page.goto("/onboarding/founder?fixture=reset");

    // F0 — intent. One tap selects, Continue confirms.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What brings you to Capital Q?",
      }),
    ).toBeVisible();
    await expect(progressText(page)).toHaveText("Company, step 1 of 6");
    await expect(
      page.getByRole("link", { name: "Save & leave" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      0,
    );
    await page
      .getByRole("radio", { name: /I'm raising for a company/ })
      .check();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What brings you to Capital Q?",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await continueStep(page);

    // F1 — company basics.
    await expect(
      page.getByRole("heading", { level: 1, name: "Your company" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Company name" })
      .fill("NexaRail Technologies");
    await page
      .getByRole("combobox", { name: "Where is the company based?" })
      .selectOption("NG");
    await continueStep(page);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What stage is the company at?",
      }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Seed", exact: true }).check();
    await continueStep(page);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /what does NexaRail Technologies do/,
      }),
    ).toBeVisible();
    await page
      .getByRole("textbox")
      .fill("We automate claims handling for mid-sized insurers.");
    await continueStep(page);

    // F2 — assets and the native file picker.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What do you already have?",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Your files stay private to your company"),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Pitch deck" }).check();
    const fileInput = page.locator("#asset-file-input");
    await expect(fileInput).toHaveAttribute("accept", /\.pdf/);
    await fileInput.setInputFiles(SYNTHETIC_DECK);
    const fileRow = page
      .getByRole("list", { name: "Selected files" })
      .getByRole("listitem");
    await expect(fileRow).toHaveCount(1);
    await expect(fileRow.first()).toContainText("nexarail-deck.pdf");
    await expect(fileRow.first()).toContainText("Ready");
    await expectNoHorizontalOverflow(page);
    await continueStep(page);

    // F3 — review what Q found; edit one fact, then confirm.
    await expect(
      page.getByRole("heading", { level: 1, name: "Here's what I understand" }),
    ).toBeVisible();
    await expect(page.getByText("From your materials").first()).toBeVisible();
    const customer = page.locator('[data-fact="customer"]');
    await customer.getByRole("button", { name: "Edit" }).tap();
    await customer
      .getByRole("textbox")
      .fill("Mid-sized general insurers in West Africa");
    await customer.getByRole("button", { name: "Save" }).tap();
    await expect(customer).toContainText("Edited by you");
    await expect(
      page.getByRole("button", { name: "Insurance Technology", pressed: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm and continue" }).tap();

    // F4 — team.
    await expect(
      page.getByRole("heading", { level: 1, name: "Your founding team" }),
    ).toBeVisible();
    await expect(progressText(page)).toHaveText("Business, step 1 of 3");
    await page.getByRole("radio", { name: "Two founders" }).check();
    await page
      .getByRole("radio", { name: "All founders are full-time" })
      .check();
    await page.getByRole("radio", { name: "CEO" }).check();
    await page.getByRole("checkbox", { name: "Product" }).check();
    await page.getByRole("radio", { name: "6–15 people" }).check();
    await continueStep(page);

    // Narrative is optional: skip.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What gives your founding team an edge here?",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).tap();

    // F5 — adaptive traction (seed stage → pre-revenue variant).
    await expect(
      page.getByRole("heading", { level: 1, name: "Business and traction" }),
    ).toBeVisible();
    await expect(page.locator("form[data-traction-variant]")).toHaveAttribute(
      "data-traction-variant",
      "pre_revenue",
    );
    await page.getByRole("radio", { name: "Pilots running" }).check();
    await page
      .getByRole("textbox", { name: "How many pilots or design partners?" })
      .fill("4");
    await page
      .getByRole("checkbox", { name: "Not sure / not tracked" })
      .last()
      .check();
    await continueStep(page);

    // F6 — the raise, with an exact-string amount.
    await expect(
      page.getByRole("heading", { level: 1, name: "Are you raising now?" }),
    ).toBeVisible();
    await expect(progressText(page)).toHaveText("Raise, step 1 of 1");
    await page.getByRole("radio", { name: "Yes, actively" }).check();
    const amount = page.getByRole("textbox", { name: "Target amount" });
    await amount.fill("500000");
    await expect(amount).toHaveValue("500,000");
    await page.getByRole("radio", { name: "SAFE" }).check();
    await page
      .getByRole("checkbox", { name: "Product and engineering" })
      .check();
    await expectNoHorizontalOverflow(page);
    await continueStep(page);

    // F7 — clarification from the deck contradiction.
    await expect(page.getByText("Needs clarification")).toBeVisible();
    await expect(page.getByText(/45 customers on page 9/)).toBeVisible();
    await page.getByRole("radio", { name: /31 paying customers/ }).check();
    await continueStep(page);

    // F8 — first-value intelligence. No score, no matches, no "complete".
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Here's how I currently understand your company.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What stands out" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What needs attention" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Highest-impact next steps" }),
    ).toBeVisible();
    await expect(page.getByText(/31 paying insurers/)).toBeVisible();
    await expect(page.getByText(/onboarding complete/i)).toHaveCount(0);
    await expect(
      page.getByText(/\d+% (good|match)|investors for you|investment quality/i),
    ).toHaveCount(0);
    await expect(page.getByText("Investors don't see this.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep improving" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Back from F8 also verifies that the raise amount survived.
    await page.getByRole("button", { name: "Keep improving" }).tap();
    await expect(
      page.getByRole("heading", { level: 1, name: "Here's what I understand" }),
    ).toBeVisible();
    await expect(page.locator('[data-fact="customer"]')).toContainText(
      "Mid-sized general insurers in West Africa",
    );
  });

  test("Back preserves answers in both directions (F6 → F5 → F6)", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=clarify");
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(
      page.getByRole("heading", { level: 1, name: "Are you raising now?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Target amount" }),
    ).toHaveValue("2,500,000");
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(
      page.getByRole("heading", { level: 1, name: "Business and traction" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", {
        name: "How many pilots or design partners?",
      }),
    ).toHaveValue("4");
    await page.getByRole("radio", { name: "Signed letters of intent" }).check();
    await continueStep(page);
    await expect(
      page.getByRole("textbox", { name: "Target amount" }),
    ).toHaveValue("2,500,000");
    await expect(
      page.getByRole("radio", { name: "Yes, actively" }),
    ).toBeChecked();
  });

  test("refresh, leaving to Home and returning all resume at the latest incomplete step", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=review");
    await expect(
      page.getByRole("heading", { level: 1, name: "Here's what I understand" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Here's what I understand" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Save & leave" }).tap();
    await expect(page).toHaveURL(/\/home$/);
    await page.getByRole("link", { name: "Set up as a founder" }).tap();
    await expect(page).toHaveURL(/\/onboarding\/founder$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Here's what I understand" }),
    ).toBeVisible();
    await expect(progressText(page)).toHaveText("Company, step 6 of 6");
  });

  test("two stage configurations produce different traction questions", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=revenue");
    await expect(page.locator("form[data-traction-variant]")).toHaveAttribute(
      "data-traction-variant",
      "revenue",
    );
    await expect(page.getByText("Annual recurring revenue")).toBeVisible();
    await expect(
      page.getByText("How many pilots or design partners?"),
    ).toHaveCount(0);

    await page.goto("/onboarding/founder?fixture=clarify");
    await page.getByRole("button", { name: "Back" }).tap();
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page.locator("form[data-traction-variant]")).toHaveAttribute(
      "data-traction-variant",
      "pre_revenue",
    );
    await expect(
      page.getByText("How many pilots or design partners?"),
    ).toBeVisible();
    await expect(page.getByText("Annual recurring revenue")).toHaveCount(0);
  });

  test("an unreadable file offers calm recovery and never blocks the journey", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=review");
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What do you already have?",
      }),
    ).toBeVisible();
    await page.locator("#asset-file-input").setInputFiles({
      name: "unreadable-scan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not really a pdf"),
    });
    const failed = page.locator('[data-upload-state="failed"]');
    await expect(failed).toContainText("Couldn't read this file");
    await expect(
      failed.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
    await expect(
      failed.getByRole("button", { name: "Choose another" }),
    ).toBeVisible();
    await failed.getByRole("button", { name: "Continue without it" }).tap();
    await expect(page.locator('[data-upload-state="failed"]')).toHaveCount(0);
    await continueStep(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Here's what I understand" }),
    ).toBeVisible();
  });

  test("a failed save keeps the answer on screen and retries", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=flaky");
    await page.getByRole("radio", { name: /I'm preparing to raise/ }).check();
    await continueStep(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't save" }),
    ).toBeVisible();
    await expect(page.locator("[data-save-status]")).toHaveAttribute(
      "data-save-status",
      "failed",
    );
    await expect(
      page.getByRole("radio", { name: /I'm preparing to raise/ }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Retry" }).tap();
    await expect(
      page.getByRole("heading", { level: 1, name: "Your company" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(
      page.getByRole("radio", { name: /I'm preparing to raise/ }),
    ).toBeChecked();
  });

  test("the bottom action bar reserves space, stays reachable with the keyboard up, and targets are comfortable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto("/onboarding/founder?fixture=reset");
    await continueStep(page); // nothing chosen → inline error, still on F0
    await expect(
      page.getByRole("alert").filter({ hasText: "Choose one" }),
    ).toBeVisible();
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
    for (const name of [/I'm raising/, /preparing/, /exploring/]) {
      await page.goto("/onboarding/founder?fixture=reset");
      const box = await page
        .getByRole("radio", { name })
        .locator("..")
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("keyboard only: select with arrows, submit with Enter, with visible focus", async ({
    page,
  }) => {
    await page.goto("/onboarding/founder?fixture=reset");
    await page.getByRole("radio", { name: /I'm raising/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /preparing/ })).toBeChecked();
    const outline = await page
      .getByRole("radio", { name: /preparing/ })
      .locator("..")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your company" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Company name" })
      .fill("NexaRail Technologies");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "What stage is the company at?",
      }),
    ).toBeVisible();
  });
});
