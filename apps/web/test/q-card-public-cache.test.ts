import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getPublicHandle = vi.fn();
const getSessionAccessToken = vi.fn();
const connection = vi.fn(() => Promise.resolve());

vi.mock("next/server", () => ({ connection }));
vi.mock("@/auth/session", () => ({ getSessionAccessToken }));
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({
    apiBaseUrl: "https://api.test",
    auth: { appOrigin: "https://capitalq.test" },
  }),
}));
vi.mock("@capital-q/api-client", () => ({
  ApiProblemError: class extends Error {},
  getPublicHandle,
}));

const { loadPublicCard, publicCardTag, PUBLIC_CARD_TAG } =
  await import("../src/features/q-card/public-card-data");

/**
 * The public card read (Q Story S6): an anonymous visitor's projection is
 * the same for every anonymous visitor, so it is briefly cached and tagged
 * for the owner's edits to expire; a signed-in participant's wider
 * projection is never cached or shared.
 */

beforeEach(() => {
  getPublicHandle.mockReset();
  getSessionAccessToken.mockReset();
  getPublicHandle.mockResolvedValue(null);
});

describe("the public card read", () => {
  it("caches an anonymous read briefly, tagged by handle, never no-store", async () => {
    getSessionAccessToken.mockRejectedValue(new Error("no session"));
    await loadPublicCard("Kivu");
    const [session] = getPublicHandle.mock.calls[0] as [
      { accessToken?: string; fetch?: typeof fetch },
    ];
    expect(session.accessToken).toBeUndefined();
    expect(session.fetch).toBeTypeOf("function");

    const real = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", real);
    await session.fetch?.("https://api.test/v1/public/handles/kivu", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    vi.unstubAllGlobals();
    const init = (real.mock.calls[0] as unknown[])[1] as RequestInit & {
      next?: { revalidate?: number; tags?: string[] };
    };
    expect(init.cache).toBeUndefined();
    expect(init.next?.revalidate).toBe(30);
    expect(init.next?.tags).toEqual([PUBLIC_CARD_TAG, publicCardTag("kivu")]);
    expect(init.headers).toEqual({ accept: "application/json" });
  });

  it("never caches a signed-in participant's read", async () => {
    getSessionAccessToken.mockResolvedValue("token");
    await loadPublicCard("kivu");
    const [session] = getPublicHandle.mock.calls[0] as [
      { accessToken?: string; fetch?: typeof fetch },
    ];
    expect(session.accessToken).toBe("token");
    expect(session.fetch).toBeUndefined();
  });

  it("is always rendered per request, so the session decides the projection", async () => {
    getSessionAccessToken.mockResolvedValue(null);
    connection.mockClear();
    await loadPublicCard("other");
    expect(connection).toHaveBeenCalled();
  });
});
