import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  PASSWORD,
  RUN_PATH,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./stack";

/**
 * Seeded synthetic accounts only (`*@fictional.capitalq.local`). A signed-in
 * browser state is cached per account for the run, so each test starts
 * signed in without repeating the sign-in journey.
 */
const STATE_DIR = resolve(RUN_PATH, "auth");

export async function signInThroughUi(page: Page, email: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("cq.splash.seen", "1");
    } catch {
      // Storage can be unavailable; the splash then simply shows.
    }
  });
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/auth\/sign-in/u, { timeout: 90_000 });
}

/** A browser context signed in as `email`, from the cached state when present. */
export async function contextAs(
  browser: Browser,
  email: string,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<BrowserContext> {
  mkdirSync(STATE_DIR, { recursive: true });
  const state = resolve(STATE_DIR, `${email}.json`);
  if (existsSync(state)) {
    return browser.newContext({ ...options, storageState: state });
  }
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await signInThroughUi(page, email);
  await context.storageState({ path: state });
  await page.close();
  return context;
}

/**
 * An access token for API-level tests, from the local Supabase Auth with the
 * public publishable key. Never a service credential: these tests prove what
 * a signed-in person can and cannot reach.
 */
export async function accessTokenFor(email: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`sign-in for ${email} refused: ${String(response.status)}`);
  }
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") {
    throw new Error(`sign-in for ${email} returned no access token`);
  }
  return body.access_token;
}
