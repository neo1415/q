import { randomUUID } from "node:crypto";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Synthetic identities for browser tests against the local Supabase stack.
 * Addresses use the reserved `.invalid` TLD and a random local part, so no
 * real mailbox exists and every run creates fresh accounts.
 */
export const STORAGE_STATE = ".playwright/auth/user.json";

export const TEST_PASSWORD = "synthetic-e2e-passphrase-1";

/** The local stack's mail catcher. Nothing here reaches a real inbox. */
export const MAILPIT_URL =
  process.env["CQ_E2E_MAILPIT_URL"] ?? "http://127.0.0.1:54324";

export function uniqueEmail(label: string): string {
  return `e2e-${label}-${randomUUID().slice(0, 12)}@example.invalid`;
}

export async function signUpThroughUi(
  page: Page,
  email: string,
  password = TEST_PASSWORD,
): Promise<void> {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

export async function signInThroughUi(
  page: Page,
  email: string,
  password = TEST_PASSWORD,
): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Click Sign out on Profile and wait for the provider session to end. */
export async function signOutThroughUi(page: Page): Promise<void> {
  if (!page.url().endsWith("/profile")) {
    await page.goto("/profile");
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in\?notice=signed-out$/);
}

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string; HTML: string };

/**
 * Wait for the provider email sent to `email` and return the verification
 * link inside it. Polls the mail catcher; fails loudly if the stack is not
 * running rather than skipping.
 */
export async function waitForAuthLink(
  request: APIRequestContext,
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await request.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (search.ok()) {
      const body = (await search.json()) as MailpitSearch;
      const first = body.messages[0];
      if (first !== undefined) {
        const message = await request.get(
          `${MAILPIT_URL}/api/v1/message/${first.ID}`,
        );
        const content = (await message.json()) as MailpitMessage;
        const links = (content.Text || content.HTML).match(
          /https?:\/\/[^\s"'<>]+/g,
        );
        const verify = links?.find((link) => link.includes("/auth/v1/verify"));
        if (verify !== undefined) {
          return verify.replace(/&amp;/g, "&");
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `no provider email for ${email} within ${String(timeoutMs)}ms (is the local Supabase stack running?)`,
  );
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}
