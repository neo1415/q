import { describe, expect, it } from "vitest";

import {
  createSupabaseAccessTokenAuthenticator,
  extractBearerToken,
  looksLikeAccessToken,
} from "../src/supabase/index.js";

/**
 * The authenticator is exercised against a fake Auth server: every request it
 * makes is captured, so the test proves both what it sends (the token, to the
 * user endpoint, with the publishable key) and what it trusts (only a 200
 * with a well-formed user id).
 */

const URL_BASE = "http://auth.local.test";
const PUBLISHABLE_KEY = "sb_publishable_synthetic";
const AUTH_USER_ID = "a0000000-0000-4000-8000-000000000001";

// Three base64url segments; not a real credential and never verified locally.
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";

type Captured = { url: string; headers: Record<string, string> };

function fakeFetch(respond: (captured: Captured) => Response): {
  fetch: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const impl: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const captured = { url, headers };
    calls.push(captured);
    return Promise.resolve(respond(captured));
  };
  return { fetch: impl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createSupabaseAccessTokenAuthenticator", () => {
  it("verifies the token with the Auth server and returns the principal", async () => {
    const server = fakeFetch(() =>
      json(200, {
        id: AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "person@example.invalid",
      }),
    );
    const authenticator = createSupabaseAccessTokenAuthenticator({
      url: URL_BASE,
      publishableKey: PUBLISHABLE_KEY,
      fetch: server.fetch,
    });

    const principal = await authenticator.authenticate(TOKEN);

    expect(principal).toEqual({ authUserId: AUTH_USER_ID });
    expect(server.calls).toHaveLength(1);
    const call = server.calls[0];
    expect(call?.url).toBe(`${URL_BASE}/auth/v1/user`);
    expect(call?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(call?.headers["apikey"]).toBe(PUBLISHABLE_KEY);
  });

  it("returns null when the Auth server rejects the token, without detail", async () => {
    const server = fakeFetch(() =>
      json(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" }),
    );
    const authenticator = createSupabaseAccessTokenAuthenticator({
      url: URL_BASE,
      publishableKey: PUBLISHABLE_KEY,
      fetch: server.fetch,
    });

    await expect(authenticator.authenticate(TOKEN)).resolves.toBeNull();
  });

  it("returns null when the Auth server is unreachable", async () => {
    const failing: typeof fetch = () =>
      Promise.reject(new TypeError("fetch failed"));
    const authenticator = createSupabaseAccessTokenAuthenticator({
      url: URL_BASE,
      publishableKey: PUBLISHABLE_KEY,
      fetch: failing,
    });

    await expect(authenticator.authenticate(TOKEN)).resolves.toBeNull();
  });

  it("does not trust a user object without a valid uuid id", async () => {
    const server = fakeFetch(() => json(200, { id: "not-a-uuid" }));
    const authenticator = createSupabaseAccessTokenAuthenticator({
      url: URL_BASE,
      publishableKey: PUBLISHABLE_KEY,
      fetch: server.fetch,
    });

    await expect(authenticator.authenticate(TOKEN)).resolves.toBeNull();
  });

  it("never contacts the server for something that is not a token", async () => {
    const server = fakeFetch(() => json(200, { id: AUTH_USER_ID }));
    const authenticator = createSupabaseAccessTokenAuthenticator({
      url: URL_BASE,
      publishableKey: PUBLISHABLE_KEY,
      fetch: server.fetch,
    });

    for (const bad of ["", "abc", "a.b", "a b.c.d", "x".repeat(5000)]) {
      await expect(authenticator.authenticate(bad)).resolves.toBeNull();
    }
    expect(server.calls).toHaveLength(0);
  });
});

describe("extractBearerToken", () => {
  it("accepts only the Bearer scheme with a token-shaped value", () => {
    expect(extractBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`  Bearer   ${TOKEN}  `)).toBe(TOKEN);
  });

  it.each([
    undefined,
    "",
    "Bearer",
    "Bearer ",
    `Basic ${TOKEN}`,
    `Token ${TOKEN}`,
    TOKEN,
    `Bearer ${TOKEN} extra`,
    "Bearer not.a.jwt.at.all",
    "Bearer <script>",
  ])("rejects %s", (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});

describe("looksLikeAccessToken", () => {
  it("bounds length and shape", () => {
    expect(looksLikeAccessToken(TOKEN)).toBe(true);
    expect(looksLikeAccessToken("a.b.c")).toBe(true);
    expect(looksLikeAccessToken("a.b")).toBe(false);
    expect(looksLikeAccessToken(`${"a".repeat(4000)}.b.c`)).toBe(true);
    expect(looksLikeAccessToken(`${"a".repeat(5000)}.b.c`)).toBe(false);
  });
});
