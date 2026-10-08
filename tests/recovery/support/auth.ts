import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  PASSWORD,
  RUN_PATH,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./stack.js";

/**
 * Seeded synthetic accounts only (`*@fictional.capitalq.local`). A signed-in
 * browser state is cached per account for the run, so each test starts
 * signed in without repeating the sign-in journey.
 */
const STATE_DIR = resolve(RUN_PATH, "auth");

export async function signInThroughUi(
  page: Page,
  email: string,
): Promise<void> {
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
  // A context made here does not inherit the config's `use` options, so the
  // microphone grant is given explicitly (without it every voice line fell
  // back with CONNECT before a peer was ever made).
  const withMic = { permissions: ["microphone"], ...options };
  const context = existsSync(state)
    ? await browser.newContext({ ...withMic, storageState: state })
    : await browser.newContext(withMic);
  await keepBrowserLocal(context);
  if (existsSync(state)) return context;
  const page = await context.newPage();
  await signInThroughUi(page, email);
  await context.storageState({ path: state });
  await page.close();
  return context;
}

/**
 * The browser half of "no live provider calls": anything not on loopback is
 * refused at the context (a test's own page.route / routeWebSocket fakes,
 * registered on the page, take precedence). Found: a duplex fallback opened
 * wss://agent.deepgram.com from the test browser with a fake token.
 */
export async function keepBrowserLocal(context: BrowserContext): Promise<void> {
  const remote = /^(?!https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:)/u;
  await context.route(remote, (route) => route.abort("blockedbyclient"));
  await context.routeWebSocket(
    /^wss?:\/\/(?!127\.0\.0\.1|localhost)/u,
    (ws) => {
      void ws.close({ code: 1008, reason: "recovery: no remote sockets" });
    },
  );
}

/**
 * An access token for API-level tests, from the local Supabase Auth with the
 * public publishable key. Never a service credential: these tests prove what
 * a signed-in person can and cannot reach.
 */
export async function accessTokenFor(email: string): Promise<string> {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  if (!response.ok) {
    throw new Error(`sign-in for ${email} refused: ${String(response.status)}`);
  }
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") {
    throw new Error(`sign-in for ${email} returned no access token`);
  }
  return body.access_token;
}
