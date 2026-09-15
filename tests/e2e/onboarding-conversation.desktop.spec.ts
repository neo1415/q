import { expect, test, type Page } from "@playwright/test";

import { signUpThroughUi, uniqueEmail } from "./support/local-auth.js";

/**
 * The Q-led interview itself, on desktop against the real Capital Q API
 * (CQ-Q-VOICE-001 B §16-§27). The form specs take the "Use the form" tap;
 * this one never does. It checks the interaction rules the packet sets:
 * one live question at a time, a tap on an option submits it, several taps
 * and "Done" submit a set, typing is the answer, Q's closest-fit categories
 * are kept in one tap, gaps sit behind a small entry, the interview's own
 * moves ("Where were we?", "Let's stop here.") are heard, the form shows
 * the same persisted state, and "Welcome back" does not greet a person who
 * was here a moment ago.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const workspace = (page: Page) => page.locator("[data-q-onboarding-workspace]");
const composer = (page: Page) => page.getByRole("textbox", { name: "Ask Q" });
const chip = (page: Page, name: string) =>
  workspace(page).getByRole("button", { name, exact: true });

async function sayToQ(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

/** The live question Q is asking now: the last Q line before the controls. */
const asking = (page: Page, text: string) =>
  workspace(page).locator(`[data-turn^="prompt:"]`).getByText(text, {
    exact: true,
  });

test.describe("Q-led onboarding interview (desktop, real API)", () => {
  test("a founder answers by tapping and typing, keeps Q's categories in one tap, and the form shows the same state", async ({
    page,
  }) => {
    test.slow();
    await signUpThroughUi(page, uniqueEmail("founder-q"));
    await page.getByRole("link", { name: "Set up as a founder" }).click();
    await expect(page).toHaveURL(/\/onboarding\/founder$/);

    // One live question, its options as the input; no "Answer" gate, no
    // greeting for a brand-new session.
    await expect(asking(page, "What brings you to Capital Q?")).toBeVisible();
    await expect(workspace(page).getByText(/^Welcome back/)).toHaveCount(0);
    await expect(
      workspace(page).getByRole("button", { name: "Answer", exact: true }),
    ).toHaveCount(0);
    await expect(composer(page)).toBeEnabled();

    // F0 — a single tap submits the option and Q moves on.
    await chip(page, "I'm raising for a company").click();
    await expect(
      workspace(page).getByText(
        "Why you're here: I'm raising for a company. Noted.",
      ),
    ).toBeVisible();

    // F1 — typing is the answer: the composer is the input.
    await expect(asking(page, "Your company")).toBeVisible();
    const name = `E2E Freight ${Date.now().toString(36)}`;
    await sayToQ(page, name);
    await expect(
      workspace(page).getByText(`Company: ${name}. Noted.`),
    ).toBeVisible();

    await expect(asking(page, "Website")).toBeVisible();
    await sayToQ(page, "e2e-freight.example");
    await expect(
      workspace(page).getByText(/^Website: .*e2e-freight\.example\. Noted\.$/),
    ).toBeVisible();

    await expect(asking(page, "Where is the company based?")).toBeVisible();
    await chip(page, "Nigeria").click();
    await expect(
      workspace(page).getByText("Based in: Nigeria. Noted."),
    ).toBeVisible();

    await expect(asking(page, "What stage is the company at?")).toBeVisible();
    await chip(page, "Seed").click();
    await expect(
      workspace(page).getByText("Stage: Seed. Noted."),
    ).toBeVisible();

    // The interview's own moves: a pause persists and completes nothing; a
    // resume phrase brings the live question back. Neither touches the runtime.
    await expect(
      asking(page, "In a sentence or two, what does the company do?"),
    ).toBeVisible();
    await sayToQ(page, "Let's stop here.");
    await expect(
      workspace(page).getByText(/Everything so far is saved/),
    ).toBeVisible();
    await sayToQ(page, "Where were we?");
    await expect(
      workspace(page).getByText(/^Right, back to it\./),
    ).toBeVisible();

    // A description in plain words: committed as the answer, and read for
    // the category step (CQ-Q-VOICE-001 A) — Q's closest fits appear as
    // chips to keep or adjust, never as a detour to the form (§19).
    await sayToQ(
      page,
      "We make AI software for freight forwarders and logistics companies.",
    );
    await expect(
      workspace(page).getByText(/^What it does: We make AI software/),
    ).toBeVisible();
    await expect(
      asking(page, "How would you categorise the company?"),
    ).toBeVisible();
    const categories = workspace(page).getByRole("group", {
      name: "Categories to keep",
    });
    await expect(
      categories.getByRole("button", { name: /Logistics & Mobility/ }),
    ).toHaveAttribute("aria-pressed", "true");
    // Searching the real taxonomy adds a category by its own words.
    await workspace(page)
      .getByRole("textbox", { name: "Search categories" })
      .fill("supply chain");
    await workspace(page)
      .getByRole("group", { name: "Matching categories" })
      .getByRole("button", { name: /Supply Chain/ })
      .first()
      .click();
    await expect(
      categories.getByRole("button", { name: /Supply Chain/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await chip(page, "Continue").click();
    await expect(
      workspace(page).getByText(
        /^Categories: .*Logistics & Mobility.*Supply Chain.*\. Noted\.$/,
      ),
    ).toBeVisible();

    // F2 — documents: the uploader is one tap away and the step is
    // optional, so "Skip" is one click too.
    await expect(asking(page, "What do you already have?")).toBeVisible();
    await expect(chip(page, "Add a document")).toBeVisible();
    await chip(page, "Skip").click();
    await expect(
      workspace(page).getByText("Skip this one", { exact: true }),
    ).toBeVisible();

    // F3 — the confirmation step's own label is the control.
    await expect(asking(page, "Here's what I understood")).toBeVisible();
    await chip(page, "That's right").click();
    await expect(
      workspace(page).getByText("Company review: Confirmed. Noted."),
    ).toBeVisible();
    await expect(asking(page, "Your role")).toBeVisible();

    // The form shows the same persisted state: the company created above,
    // and the interview's position (§22). Back in the thread, no greeting
    // for someone who was here seconds ago (§26).
    await page
      .getByRole("button", { name: "Use the form", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Your founding team" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to Q", exact: true }).click();
    await expect(asking(page, "Your role")).toBeVisible();
    await expect(workspace(page).getByText(/^Welcome back/)).toHaveCount(0);

    await page.reload();
    await expect(asking(page, "Your role")).toBeVisible();
    await expect(workspace(page).getByText(/^Welcome back/)).toHaveCount(0);
    await workspace(page)
      .getByRole("button", { name: "Review what Q knows" })
      .click();
    await expect(
      workspace(page).getByRole("region", { name: "What Q knows" }),
    ).toContainText(name);
  });

  test("an investor's tap on an option is the answer, and the next question follows at once", async ({
    page,
  }) => {
    test.slow();
    await signUpThroughUi(page, uniqueEmail("investor-q"));
    await page.getByRole("link", { name: "Set up as an investor" }).click();
    await expect(page).toHaveURL(/\/onboarding\/investor$/);

    await expect(asking(page, "How do you invest?")).toBeVisible();
    await chip(page, "Venture capital fund").click();
    await expect(
      workspace(page).getByText("Investor type: Venture capital fund. Noted."),
    ).toBeVisible();

    await expect(asking(page, "Your firm")).toBeVisible();
    const firm = `E2E Northbank ${Date.now().toString(36)}`;
    await sayToQ(page, firm);
    await expect(
      workspace(page).getByText(`Organisation: ${firm}. Noted.`),
    ).toBeVisible();
    await expect(asking(page, "Your role there")).toBeVisible();
    await expect(
      workspace(page).getByRole("button", { name: "Answer", exact: true }),
    ).toHaveCount(0);
  });
});
