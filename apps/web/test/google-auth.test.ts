import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSafeReturnPath } from "../src/auth/redirect-safety";

/**
 * Continue with Google (CQ-C5-R2A §7, §11, §31, §35).
 *
 * Two things are worth holding here, and neither needs a browser.
 *
 * The button must appear only when the Auth server actually offers the
 * provider, because a control that always fails is worse than none — and
 * because the alternative design, a second switch in Capital Q's own
 * configuration, can disagree with the truth in both directions.
 *
 * And the destination after sign-in must survive a round trip through
 * Google without becoming somebody else's site. The `next` a person carries
 * into the flow is attacker-influenced input; it is resolved before it is
 * ever put in a redirect URL, and it is resolved again on the way back.
 */

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_value",
  CAPITAL_Q_ENV: "local",
  NODE_ENV: "development",
} as const;

async function loadProviders() {
  vi.resetModules();
  for (const [name, value] of Object.entries(ENV)) {
    vi.stubEnv(name, value);
  }
  return import("../src/auth/providers");
}

function settingsResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("R2A-A01 · the Google control follows the Auth server, not our own flag", () => {
  const original = globalThis.fetch;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is offered when the provider reports google enabled", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(settingsResponse({ external: { google: true } })),
    );
    const { googleSignInEnabled } = await loadProviders();
    await expect(googleSignInEnabled()).resolves.toBe(true);
  });

  it("is withheld when the provider reports google disabled", async () => {
    // The state of the hosted project at the time this was written, and the
    // reason the button must not simply always render.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        settingsResponse({ external: { google: false, email: true } }),
      ),
    );
    const { googleSignInEnabled } = await loadProviders();
    await expect(googleSignInEnabled()).resolves.toBe(false);
  });

  it.each([
    ["a refused request", () => Promise.resolve(settingsResponse({}, false))],
    ["an unreachable Auth server", () => Promise.reject(new Error("offline"))],
    [
      "a response without the field",
      () => Promise.resolve(settingsResponse({ external: {} })),
    ],
  ])("withholds it on %s, leaving email and password", async (_case, impl) => {
    globalThis.fetch = vi.fn(impl);
    const { googleSignInEnabled } = await loadProviders();
    await expect(googleSignInEnabled()).resolves.toBe(false);
  });

  it("sends the publishable key and nothing else", async () => {
    const spy = vi.fn(() =>
      Promise.resolve(settingsResponse({ external: { google: true } })),
    );
    globalThis.fetch = spy;
    const { googleSignInEnabled } = await loadProviders();
    await googleSignInEnabled();

    const [url, init] = spy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://project.supabase.co/auth/v1/settings");
    // A publishable key is public by definition; nothing else may travel.
    expect(Object.keys(init.headers)).toEqual(["apikey"]);
    expect(JSON.stringify(init)).not.toMatch(/service_role|secret|Bearer/i);
  });
});

describe("R2A-A02 · the return path cannot become somebody else's site", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "http://evil.example/steal",
    "/\\evil.example",
    "/%2f%2fevil.example",
    "/home@evil.example",
  ])("refuses %s and falls back to Home", (candidate) => {
    // The value handed to signInWithOAuth's redirectTo is built from this
    // result, so a destination that cannot survive here cannot be reached
    // through Google either.
    expect(resolveSafeReturnPath(candidate)).toBe("/home");
  });

  it("keeps a genuine in-app destination across the flow", () => {
    expect(resolveSafeReturnPath("/onboarding/founder")).toBe(
      "/onboarding/founder",
    );
  });

  it("never returns someone to the authentication surface itself", () => {
    expect(resolveSafeReturnPath("/auth/sign-in")).toBe("/home");
  });
});
