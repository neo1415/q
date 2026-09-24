import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Walkthrough D3, re-run (CQ-QX-007 fit): an investor with a declared
 * mandate asks Q, from a company's page, "is this one worth my time given
 * what I invest in? what's missing?".
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
const PASSWORD = "synthetic-e5-passphrase-1";
const COMPANY = "9ea0a8ef-ef51-4076-ba73-5710d7ead5cd";

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { level: 1, name });
const screen = (page: Page, name: string | RegExp) =>
  expect(heading(page, name)).toBeVisible({ timeout: 90_000 });
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
async function suggestAndPickFirst(page: Page, query: string) {
  await page
    .getByRole("textbox", {
      name: /^Search (?:countries or regions|sectors or product areas)$/,
    })
    .fill(query);
  await page.getByRole("button", { name: "Suggest" }).click();
  const suggestions = page
    .getByRole("list", { name: "Suggestions" })
    .getByRole("button", { name: /add as a preference/ });
  await expect(suggestions.first()).toBeVisible({ timeout: 60_000 });
  await suggestions.first().click();
}

test("investor declares a mandate", async ({ page }) => {
  test.skip(process.env["E5_SKIP_SETUP"] === "1");
  test.setTimeout(900_000);
  const email = `e5-ans-investor-${Date.now().toString(36)}@capitalq.local`;
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill("Ama Mensah");
  await page.getByLabel("Company or fund").fill("Savannah Logistics Capital");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 300_000,
  });
  await page.goto("/onboarding/investor");
  await useTheForm(page);
  await screen(page, "How do you invest?");
  await page.getByRole("radio", { name: "Venture capital fund" }).check();
  await page
    .getByRole("textbox", { name: "Your firm" })
    .fill("Savannah Logistics Capital");
  await page.getByRole("textbox", { name: "Your role there" }).fill("Partner");
  await continueStep(page);
  await screen(page, "Are you deploying capital right now?");
  await page.getByRole("radio", { name: "Actively investing" }).check();
  await continueStep(page);
  await screen(page, "Stage and cheque");
  await page.getByRole("checkbox", { name: "Seed", exact: true }).check();
  await page.getByRole("textbox", { name: "Minimum cheque" }).fill("250000");
  await page.getByRole("textbox", { name: "Typical cheque" }).fill("500000");
  await page.getByRole("textbox", { name: "Maximum cheque" }).fill("1000000");
  await continueStep(page);
  await screen(page, "Where do you invest?");
  await suggestAndPickFirst(page, "kenya");
  await page.getByRole("radio", { name: "Must match" }).check();
  await continueStep(page);
  await screen(page, "Which sectors and product areas?");
  await suggestAndPickFirst(page, "logistics");
  await continueStep(page);
  for (const name of [
    "Business attributes",
    "Founding-team capabilities that matter to you",
    "Green flags",
    "Red flags",
  ]) {
    await screen(page, name);
    await continueStep(page);
  }
  await screen(page, "A few representative portfolio companies");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await screen(page, "How adventurous should discovery be?");
  await page.getByRole("radio", { name: "Balanced" }).check();
  await continueStep(page);
  await screen(page, "How should founders reach you?");
  await page.getByRole("radio", { name: "Qualified" }).check();
  await continueStep(page);
  await screen(page, "Add something we missed");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await screen(page, "Here's the mandate you've defined");
  await page.getByRole("button", { name: "Looks right" }).click();
  await screen(page, "Your mandate is ready");
  writeFileSync(`${STATE_DIR}/investor.json`, JSON.stringify({ email }));
  await page
    .context()
    .storageState({ path: `${STATE_DIR}/investor-state.json` });
});

test("D3: fit, asked from the company's page", async ({ browser }) => {
  test.setTimeout(900_000);
  const context = await browser.newContext({
    storageState: `${STATE_DIR}/investor-state.json`,
  });
  const page = await context.newPage();
  JSON.parse(readFileSync(`${STATE_DIR}/investor.json`, "utf8"));
  await page.goto(`/company/${COMPANY}`);
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${STATE_DIR}/d3-company.png` });
  await page.getByRole("button", { name: "Ask Q" }).first().click();
  const composer = page.getByPlaceholder("Ask Q").last();
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await composer.fill(
    "is this one worth my time given what I invest in? what's missing?",
  );
  await composer.press("Enter");
  const answer = page.locator('[data-q-answer="settled"]').last();
  await expect(answer).toBeVisible({ timeout: 300_000 });
  await page.waitForTimeout(2_000);
  const text = await answer.innerText();
  console.log(`\n=== D3\n${text}\n===`);
  await page.screenshot({ path: `${STATE_DIR}/d3-fit.png`, fullPage: true });
  expect(text).not.toMatch(
    /no authorised facts|no .*context on your investment thesis/i,
  );
});
