import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/(app)/gateq/logo/[gatewayId]/route";

/**
 * `/gateq/logo/:gatewayId` (live defect 2026-11-14): the settings preview
 * draws a saved logo while the gateway is paused. The person's own token
 * rides the read (the API decides who may), the bytes are re-checked as
 * the public route checks them, and nothing is shared-cached.
 */

const session = vi.hoisted(() => ({
  value: { baseUrl: "https://api.example", accessToken: "token-1" } as {
    baseUrl: string;
    accessToken: string;
  } | null,
}));
vi.mock("@/features/q/context", () => ({
  apiSession: () => Promise.resolve(session.value),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  session.value = { baseUrl: "https://api.example", accessToken: "token-1" };
});

const GATEWAY = "a0000000-0000-4000-8000-000000000001";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function answer(status: number, body: Uint8Array | string, type: string) {
  const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(typeof body === "string" ? body : body.slice(), {
      status,
      headers: { "content-type": type },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const get = (gatewayId: string) =>
  GET(new Request(`https://web.example/gateq/logo/${gatewayId}`), {
    params: Promise.resolve({ gatewayId }),
  });

describe("the gateway's own logo route", () => {
  it("serves the saved logo with the person's token, privately", async () => {
    const fetchMock = answer(200, PNG, "image/png");
    const response = await get(GATEWAY);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `https://api.example/v1/gateq/gateways/${GATEWAY}/appearance/logo`,
    );
    expect(
      (init?.headers as Record<string, string> | undefined)?.["authorization"],
    ).toBe("Bearer token-1");
  });

  it("is the one 404 when signed out, refused, malformed or not an image", async () => {
    answer(200, PNG, "image/png");
    session.value = null;
    expect((await get(GATEWAY)).status).toBe(404);
    session.value = { baseUrl: "https://api.example", accessToken: "t" };
    expect((await get("not-a-uuid")).status).toBe(404);
    answer(404, "Not found", "text/plain");
    expect((await get(GATEWAY)).status).toBe(404);
    answer(200, "<svg onload=alert(1)>", "image/svg+xml");
    expect((await get(GATEWAY)).status).toBe(404);
  });
});
