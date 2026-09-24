import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * A synthetic founder who uploads a one-pager during onboarding (the F1/H3
 * walkthrough rows). Saves the session for the later E5 journeys.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
const PASSWORD = "synthetic-e5-passphrase-1";

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });
async function continueStep(page: Page) {
  await page.getByRole("button", { name: /^(Continue|Looks right)$/ }).click();
}
async function useTheForm(page: Page) {
  const button = page
    .getByRole("button", { name: "Use the form", exact: true })
    .first();
  try {
    await button.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    return;
  }
  await button.click();
}

test("founder signs up, creates Kivu Freight and uploads the one-pager", async ({
  page,
}) => {
  mkdirSync(STATE_DIR, { recursive: true });
  const email = `e5-ans-founder-${Date.now().toString(36)}@capitalq.local`;
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill("Wanjiru Kamau");
  await page.getByLabel("Company or fund").fill("Kivu Freight");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 300_000,
  });
  await page.waitForTimeout(4_000);
  await page.screenshot({ path: `${STATE_DIR}/after-signup.png` });
  writeFileSync(`${STATE_DIR}/founder.json`, JSON.stringify({ email }));
  await page
    .context()
    .storageState({ path: `${STATE_DIR}/founder-state.json` });
  console.log("after sign-up:", page.url());
  if (process.env["E5_STOP_AFTER_SIGNUP"] === "1") return;

  await page.goto("/onboarding/founder");
  await useTheForm(page);
  await expect(heading(page, "What brings you to Capital Q?")).toBeVisible();
  await page.getByRole("radio", { name: /I'm raising for a company/ }).check();
  await continueStep(page);

  await expect(heading(page, "Your company")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Company name" })
    .fill("Kivu Freight");
  await page
    .getByRole("textbox", { name: "Website" })
    .fill("kivufreight.example");
  await page
    .getByRole("combobox", { name: "Where is the company based?" })
    .selectOption("ke");
  await continueStep(page);
  await expect(heading(page, "What stage is the company at?")).toBeVisible();
  await page.getByRole("radio", { name: "Seed", exact: true }).check();
  await continueStep(page);
  await expect(
    heading(page, /In a sentence or two, what does the company do\?/),
  ).toBeVisible();
  await page
    .getByRole("textbox")
    .fill(
      "Kivu Freight matches shippers with vetted truckers for cross-border freight in Kenya, Uganda and Rwanda, and handles escrow and customs documents.",
    );
  await continueStep(page);
  await expect(
    heading(page, "How would you categorise the company?"),
  ).toBeVisible();
  const suggestions = page
    .getByRole("list", { name: "Suggested categories" })
    .getByRole("button");
  if ((await suggestions.count()) > 0) {
    await suggestions.first().click();
    await continueStep(page);
  } else {
    await page.getByRole("button", { name: "Skip for now" }).click();
  }

  await expect(heading(page, "What do you already have?")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (
    await chooser
  ).setFiles(resolve(import.meta.dirname, "kivu-one-pager.pdf"));
  await page.screenshot({ path: `${STATE_DIR}/founder-upload.png` });
  await expect(page.getByText(/kivu-one-pager/i).first()).toBeVisible({
    timeout: 60_000,
  });
  await continueStep(page);
  await page.screenshot({ path: `${STATE_DIR}/founder-after-upload.png` });

  writeFileSync(`${STATE_DIR}/founder.json`, JSON.stringify({ email }));
  await page
    .context()
    .storageState({ path: `${STATE_DIR}/founder-state.json` });
});
