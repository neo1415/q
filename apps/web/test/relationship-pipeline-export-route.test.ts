import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  session: {
    baseUrl: "https://api.test",
    accessToken: "synthetic-test-token",
    organisationId: "00000000-0000-4000-8000-000000000002",
  } as { baseUrl: string; accessToken: string; organisationId?: string } | null,
  context: {
    kind: "INVESTOR",
    investorOrganisationId: "00000000-0000-4000-8000-000000000003",
  } as { kind: string; investorOrganisationId?: string; companyId?: string },
}));
vi.mock("@/features/q/context", () => ({
  apiSession: () => Promise.resolve(mock.session),
  resolveOwnContext: () => Promise.resolve(mock.context),
}));
const { GET } = await import("../app/(app)/relationships/export/route");
beforeEach(() => {
  mock.session = {
    baseUrl: "https://api.test",
    accessToken: "synthetic-test-token",
    organisationId: "00000000-0000-4000-8000-000000000002",
  };
  mock.context = {
    kind: "INVESTOR",
    investorOrganisationId: "00000000-0000-4000-8000-000000000003",
  };
});
afterEach(() => vi.unstubAllGlobals());
describe("relationship export scope proxy", () => {
  it("forwards the verified active organisation with exact filter and selection", async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () =>
        Promise.resolve(
          new Response('"Kivu"\r\n', {
            headers: { "content-type": "text/csv" },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const selected = "a0000000-0000-4000-8000-000000000001";
    const response = await GET(
      new Request(
        `https://web.test/relationships/export?q=Kivu&selected=${selected}`,
      ),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.test/v1/network/relationships/pipeline/export?q=Kivu&selected=${selected}`,
    );
    expect(new Headers(init.headers).get("x-organisation-id")).toBe(
      mock.session?.organisationId,
    );
    expect(init.cache).toBe("no-store");
    expect(await response.text()).toContain("Kivu");
  });
  it("derives founder company from own context rather than caller input", async () => {
    mock.context = {
      kind: "FOUNDER",
      companyId: "00000000-0000-4000-8000-000000000004",
    };
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response("CSV")),
    );
    vi.stubGlobal("fetch", fetch);
    await GET(
      new Request("https://web.test/relationships/export?state=CONNECTED"),
    );
    expect(fetch.mock.calls[0]?.[0]).toContain(
      "/companies/00000000-0000-4000-8000-000000000004/relationships/pipeline/export",
    );
  });
  it("does not call upstream when no authenticated session exists", async () => {
    mock.session = null;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (await GET(new Request("https://web.test/relationships/export"))).status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not silently broaden invalid filters", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await GET(
          new Request("https://web.test/relationships/export?state=HOT_LEAD"),
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409])(
    "preserves upstream denial/conflict status %s without CSV attachment",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
          Promise.resolve(new Response("private-detail", { status })),
        ),
      );
      const response = await GET(
        new Request("https://web.test/relationships/export"),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(await response.text()).not.toContain("private-detail");
    },
  );
});
