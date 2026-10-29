import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Perf lane 2026-10-16: the photo routes' "no photo" answers. Hosted, every
 * Pipeline view asked again for ten companies that have no photo (each a
 * web request and an API read). The API's own "no photo for you" is kept
 * briefly in this browser; a failed read or a missing session never is.
 */

const photo = vi.fn<() => Promise<{ photoUrl: string | null } | null>>();

vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({ apiBaseUrl: "http://api.test" }),
}));
vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve("session-token"),
}));
vi.mock("@capital-q/api-client", () => ({
  getCompanyProfilePhoto: () => photo(),
  getInvestorOrganisationPhoto: () => photo(),
  getDiscoveryInvestorPhoto: () => photo(),
}));

const company = await import("../app/api/company-photo/[companyId]/route");

const ID = "a0000000-0000-4000-8000-000000000001";

function ask() {
  return company.GET(
    new NextRequest(`http://web.test/api/company-photo/${ID}`),
    {
      params: Promise.resolve({ companyId: ID }),
    },
  );
}

describe("the company photo route", () => {
  beforeEach(() => photo.mockReset());

  it("keeps the API's 'no photo' briefly, privately", async () => {
    photo.mockResolvedValue({ photoUrl: null });
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-capital-q-picture")).toBe("none");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("never keeps a read that failed", async () => {
    // What the route's own catch makes of a failed read: no answer at all.
    photo.mockResolvedValue(null);
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-capital-q-picture")).toBe("none");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("redirects to the minted URL, privately and briefly", async () => {
    photo.mockResolvedValue({ photoUrl: "https://storage.test/p.png?sig=1" });
    const response = await ask();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://storage.test/p.png?sig=1",
    );
  });
});
