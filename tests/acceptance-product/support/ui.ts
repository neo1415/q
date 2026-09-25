import { expect, type Browser, type Page } from "@playwright/test";

/**
 * Driving the real UI the way a person does: the sign-up form, the typed
 * composer, real clicks. Waits are for the product to go quiet, never for
 * a phrase. Nothing here asserts wording.
 */

export const PASSWORD = "acceptance-product-passphrase-1";

export function uniqueEmail(label: string): string {
  return `acc-prod-${label}-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}@capitalq.local`;
}

export async function signUp(
  page: Page,
  input: { name: string; organisation?: string; email: string },
): Promise<void> {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Your name").fill(input.name);
  if (input.organisation !== undefined) {
    await page.getByLabel("Company or fund").fill(input.organisation);
  }
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 300_000,
  });
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 300_000,
  });
}

/** A new browser context carrying only this page's cookies: a returning visit. */
export async function returningPage(
  browser: Browser,
  from: Page,
): Promise<Page> {
  const state = await from.context().storageState();
  const context = await browser.newContext({
    storageState: { cookies: state.cookies, origins: [] },
    viewport: { width: 1440, height: 900 },
  });
  return context.newPage();
}

/** The last composer on screen named "Ask Q" (onboarding, Home or sheet). */
export function composer(page: Page, scope?: string) {
  const root = scope === undefined ? page : page.locator(scope);
  return root.getByRole("textbox", { name: "Ask Q" }).last();
}

/**
 * Wait until Q is done with the turn: the composer is enabled again and
 * the visible text has not changed for `quietMs`. Bounded.
 */
export async function waitForQuiet(
  page: Page,
  options: { quietMs?: number; timeoutMs?: number; scope?: string } = {},
): Promise<void> {
  const quietMs = options.quietMs ?? 4_000;
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  let last = "";
  let stableSince = Date.now();
  await page.waitForTimeout(2_000);
  while (Date.now() < deadline) {
    const text = await page
      .locator(options.scope ?? "body")
      .first()
      .innerText()
      .catch(() => "");
    const enabled = await composer(page, options.scope)
      .isEnabled()
      .catch(() => true);
    if (!enabled || text !== last) {
      last = text;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Q did not go quiet in time");
}

/** Type one turn through the real composer and wait for Q to finish it. */
export async function say(
  page: Page,
  text: string,
  options: { scope?: string; timeoutMs?: number } = {},
): Promise<void> {
  const box = composer(page, options.scope);
  await expect(box).toBeEnabled({ timeout: 120_000 });
  await box.click();
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Enter");
  await waitForQuiet(page, {
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
}

/**
 * Q's visible lines in the conversation thread, in order. The thread is
 * the unnamed list; named lists ("Where to start", "Suggested questions",
 * "Attached", chats) are navigation, not conversation. Top-level items
 * only, so a list inside an answer is part of that answer.
 */
export async function qLines(page: Page, scope = "main"): Promise<string[]> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector) ?? document.body;
    const threads = [...root.querySelectorAll("ol, ul")].filter(
      (list) =>
        !list.hasAttribute("aria-label") &&
        list.parentElement?.closest("li") === null,
    );
    return threads
      .flatMap((list) => [...list.children])
      .filter((child) => child.tagName === "LI")
      .map((li) => (li as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 0 && !t.startsWith("You "));
  }, scope);
}

/** The newest Q answer's text in the main thread. */
export async function lastQAnswer(page: Page, scope = "main"): Promise<string> {
  const lines = await qLines(page, scope);
  return lines.at(-1) ?? "";
}

/** Walk the investor form to an active mandate: the quickest honest path. */
export async function completeInvestorMandateByForm(
  page: Page,
  input: { firm: string; country: string; stage: "Pre-seed" | "Seed" },
): Promise<void> {
  await page.goto("/onboarding/investor");
  const useForm = page.getByRole("button", {
    name: "Use the form",
    exact: true,
  });
  await useForm.first().waitFor({ state: "visible", timeout: 120_000 });
  await useForm.first().click();
  const h1 = (name: string | RegExp) =>
    expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
      timeout: 120_000,
    });
  const next = () =>
    page.getByRole("button", { name: /^(Continue|Looks right)$/ }).click();
  await h1("How do you invest?");
  await page.getByRole("radio", { name: "Angel investor" }).check();
  await page.getByRole("textbox", { name: "Your firm" }).fill(input.firm);
  await page.getByRole("textbox", { name: "Your role there" }).fill("Partner");
  await next();
  await h1("Are you deploying capital right now?");
  await page.getByRole("radio", { name: "Actively investing" }).check();
  await next();
  await h1("Stage and cheque");
  await page.getByRole("checkbox", { name: input.stage, exact: true }).check();
  await page.getByRole("textbox", { name: "Minimum cheque" }).fill("25000");
  await page.getByRole("textbox", { name: "Maximum cheque" }).fill("100000");
  await next();
  await h1("Where do you invest?");
  await page
    .getByRole("textbox", { name: "Search countries or regions" })
    .fill(input.country);
  await page.getByRole("button", { name: "Suggest" }).click();
  await page
    .getByRole("list", { name: "Suggestions" })
    .getByRole("button", { name: /add as a preference/ })
    .first()
    .click();
  await next();
  // Everything else optional: skip or continue until the review.
  for (let i = 0; i < 14; i += 1) {
    const heading = await page
      .getByRole("heading", { level: 1 })
      .first()
      .innerText();
    if (/mandate you've defined/i.test(heading)) break;
    if (/adventurous/i.test(heading)) {
      await page.getByRole("radio", { name: "Balanced" }).check();
      await next();
    } else if (/reach you/i.test(heading)) {
      await page.getByRole("radio", { name: "Qualified" }).check();
      await next();
    } else {
      const skip = page.getByRole("button", { name: "Skip for now" });
      if (await skip.count()) await skip.click();
      else await next();
    }
    await page.waitForTimeout(3_000);
  }
  await page.getByRole("button", { name: "Looks right" }).click();
  await h1("Your mandate is ready");
}
