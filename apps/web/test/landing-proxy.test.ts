import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request proxy at `/`: the landing is served only to a signed-out
 * browser visit. Signed-in people and installed launches are redirected
 * before any HTML is sent, so the landing never flashes for them.
 */

let signedIn = false;
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({
    auth: {
      supabase: {
        url: "http://127.0.0.1:54321",
        publishableKey: "disabled-locally-000000000000",
      },
    },
  }),
}));
vi.mock("../src/auth/cookie-options", () => ({
  sessionCookieOptions: () => ({}),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: () =>
        Promise.resolve({
          data: signedIn ? { claims: { sub: "user-1" } } : null,
        }),
    },
  }),
}));

const { handleSessionProxy } = await import("../src/auth/session-proxy");

const at = (path: string) =>
  handleSessionProxy(new NextRequest(new URL(path, "https://capitalq.test")));

describe("the proxy at /", () => {
  beforeEach(() => {
    signedIn = false;
  });

  it("serves the landing to a signed-out browser visit", async () => {
    const response = await at("/");
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("sends a signed-in person into the app", async () => {
    signedIn = true;
    const response = await at("/");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/welcome",
    );
  });

  it("sends a signed-out installed launch to sign-in, never the landing", async () => {
    const response = await at("/?source=pwa");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/auth/sign-in",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sends a signed-in installed launch into the app", async () => {
    signedIn = true;
    const response = await at("/?source=pwa");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/welcome",
    );
  });
});
