import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * The fixture's person (conversation 64aab371): an angel investor, firm
 * "Zino Aviation", role Founder, actively investing, pre-seed, EUR — part
 * way through onboarding. Saved as `partial-state.json` for f-who-am-i.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
const PASSWORD = "synthetic-e5-passphrase-1";

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

test("an angel investor stops part way through onboarding", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const email = `e5-ans-angel-${Date.now().toString(36)}@capitalq.local`;
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill("Zino Mario");
  await page.getByLabel("Company or fund").fill("Zino Aviation");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 300_000,
  });
  await page.goto("/onboarding/investor");
  await useTheForm(page);
  await screen(page, "How do you invest?");
  await page.getByRole("radio", { name: /Angel/ }).check();
  await page.getByRole("textbox", { name: "Your firm" }).fill("Zino Aviation");
  await page.getByRole("textbox", { name: "Your role there" }).fill("Founder");
  await continueStep(page);
  await screen(page, "Are you deploying capital right now?");
  await page.getByRole("radio", { name: "Actively investing" }).check();
  await continueStep(page);
  await screen(page, "Stage and cheque");
  await page.getByRole("checkbox", { name: "Pre-seed", exact: true }).check();
  const currency = page.getByRole("combobox", { name: /currency/i });
  if ((await currency.count()) > 0) {
    await currency
      .first()
      .selectOption({ label: "Euro" })
      .catch(() => undefined);
  }
  await page.getByRole("textbox", { name: "Minimum cheque" }).fill("10000");
  await page.getByRole("textbox", { name: "Typical cheque" }).fill("25000");
  await page.getByRole("textbox", { name: "Maximum cheque" }).fill("50000");
  await continueStep(page);
  await screen(page, "Where do you invest?");
  await page
    .context()
    .storageState({ path: `${STATE_DIR}/partial-state.json` });
});
