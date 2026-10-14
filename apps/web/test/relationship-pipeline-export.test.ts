import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/(app)/relationships/export/route";
const context = vi.hoisted(() => ({ session: vi.fn(), own: vi.fn() }));
vi.mock("@/features/q/context", () => ({
  apiSession: context.session,
  resolveOwnContext: context.own,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
describe("authorized pipeline export proxy", () => {
  it("forwards only the server-resolved session organization", async () => {
    context.session.mockResolvedValue({
      baseUrl: "https://api.example",
      accessToken: "test-token",
      organisationId: "org-current",
    });
    context.own.mockResolvedValue({ kind: "INVESTOR" });
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("csv", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await GET(
          new Request(
            `https://web.example/relationships/export?scope=${"1".repeat(64)}`,
          ),
        )
      ).status,
    ).toBe(200);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Bearer test-token",
      "x-organisation-id": "org-current",
    });
  });
  it("rejects query organization overrides before contacting the API", async () => {
    context.session.mockResolvedValue({
      baseUrl: "https://api.example",
      accessToken: "test-token",
    });
    context.own.mockResolvedValue({ kind: "INVESTOR" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await GET(
          new Request(
            `https://web.example/relationships/export?scope=${"1".repeat(64)}&organisationId=other`,
          ),
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not reuse an export after signout", async () => {
    context.session.mockResolvedValue(null);
    context.own.mockResolvedValue({ kind: "NONE" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await GET(
          new Request(
            `https://web.example/relationships/export?scope=${"1".repeat(64)}`,
          ),
        )
      ).status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
