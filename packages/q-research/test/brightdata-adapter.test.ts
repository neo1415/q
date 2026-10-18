import { describe, expect, it } from "vitest";

import {
  createBrightDataProfileLookup,
  createBrightDataResearchProvider,
  linkedInPageKind,
} from "../src/providers/brightdata.js";
import { isResearchProviderFailure } from "../src/ports.js";

/**
 * The Bright Data adapter with the vendor faked: a SERP page becomes
 * bounded hits (public URLs only), an unlocked page becomes text with its
 * title, a LinkedIn record becomes a bounded profile, a deferred snapshot
 * is PENDING, and a vendor status is classified, never relayed.
 */

type Call = {
  readonly url: string;
  readonly body: unknown;
  readonly auth: string | null;
};

function fakeFetch(
  respond: (call: Call) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(init?.headers);
    const call: Call = {
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.get("authorization"),
    };
    calls.push(call);
    const { status, body } = respond(call);
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetch: fetchFake, calls };
}

const KEY = "bd-secret-key-never-printed";

describe("Bright Data search and extract", () => {
  it("runs a Google search through the SERP zone and keeps only public hits", async () => {
    const vendor = fakeFetch(() => ({
      status: 200,
      body: {
        organic: [
          {
            link: "https://vaultlyne.com/",
            title: "Vaultlyne",
            description: "Secure vaults.",
          },
          {
            link: "http://localhost:3000/admin",
            title: "nope",
            description: "",
          },
          {
            link: "https://www.linkedin.com/company/vaultlyne",
            title: "Vaultlyne | LinkedIn",
            description: "About.",
          },
        ],
      },
    }));
    const provider = createBrightDataResearchProvider({
      apiKey: KEY,
      serpZone: "serp_zone",
      unlockerZone: "unlocker_zone",
      fetch: vendor.fetch,
    });
    const result = await provider.search(
      {
        query: "vaultlyne",
        maxResults: 5,
        freshness: "ANY",
        includeDomains: [],
      },
      {},
    );
    expect(result.hits.map((h) => h.url)).toEqual([
      "https://vaultlyne.com/",
      "https://www.linkedin.com/company/vaultlyne",
    ]);
    const call = vendor.calls[0];
    expect(call?.auth).toBe(`Bearer ${KEY}`);
    expect(call?.body).toMatchObject({ zone: "serp_zone", format: "raw" });
    expect(String((call?.body as { url: string }).url)).toContain("brd_json=1");
  });

  it("reads a page through the unlocker zone as markdown with its title", async () => {
    const vendor = fakeFetch(() => ({
      status: 200,
      body: "# Vaultlyne\n\nWe keep things safe.",
    }));
    const provider = createBrightDataResearchProvider({
      apiKey: KEY,
      serpZone: "serp_zone",
      unlockerZone: "unlocker_zone",
      fetch: vendor.fetch,
    });
    const result = await provider.extract(
      { urls: ["https://vaultlyne.com/"] },
      {},
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.title).toBe("Vaultlyne");
    expect(result.pages[0]?.text).toContain("We keep things safe.");
    expect(vendor.calls[0]?.body).toMatchObject({
      zone: "unlocker_zone",
      data_format: "markdown",
    });
  });

  it("classifies a vendor refusal without relaying it", async () => {
    const vendor = fakeFetch(() => ({
      status: 401,
      body: { error: "bad key xyz" },
    }));
    const provider = createBrightDataResearchProvider({
      apiKey: KEY,
      serpZone: "serp_zone",
      unlockerZone: "unlocker_zone",
      fetch: vendor.fetch,
    });
    await expect(
      provider.search(
        {
          query: "x",
          maxResults: 3,
          freshness: "ANY",
          includeDomains: [],
        },
        {},
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isResearchProviderFailure(error) &&
        error.failureClass === "AUTHENTICATION" &&
        !error.message.includes("xyz")
      );
    });
  });
});

describe("Bright Data LinkedIn lookup", () => {
  it("recognises person and company pages and nothing else", () => {
    expect(linkedInPageKind("https://www.linkedin.com/in/ada-obi/")).toEqual({
      kind: "PERSON",
      url: "https://www.linkedin.com/in/ada-obi",
    });
    expect(
      linkedInPageKind("https://ng.linkedin.com/company/paystack"),
    ).toEqual({
      kind: "COMPANY",
      url: "https://www.linkedin.com/company/paystack",
    });
    expect(linkedInPageKind("https://linkedin.com/feed/")).toBeNull();
    expect(linkedInPageKind("https://example.com/in/ada")).toBeNull();
  });

  it("maps a company record to bounded public fields", async () => {
    const vendor = fakeFetch(() => ({
      status: 200,
      body: [
        {
          id: "paystack",
          name: "Paystack",
          country_code: "US,NG",
          locations: ["Sunnyvale, CA", "Ikeja, Lagos"],
          followers: 154814,
          employees_in_linkedin: 322,
          about: "Payments for Africa.",
          industries: "Financial Services",
          company_size: "201-500 employees",
          headquarters: "Lagos, Nigeria",
          website: "https://paystack.com",
          founded: 2015,
          secret_internal_field: "should be dropped",
        },
      ],
    }));
    const lookup = createBrightDataProfileLookup({
      apiKey: KEY,
      fetch: vendor.fetch,
    });
    const result = await lookup.lookup(
      { url: "https://www.linkedin.com/company/paystack" },
      {},
    );
    expect(result.status).toBe("FOUND");
    expect(result.profile).toEqual({
      kind: "COMPANY",
      url: "https://www.linkedin.com/company/paystack",
      name: "Paystack",
      about: "Payments for Africa.",
      website: "https://paystack.com",
      industries: ["Financial Services"],
      companySize: "201-500 employees",
      headquarters: "Lagos, Nigeria",
      countryCodes: ["US", "NG"],
      followers: 154814,
      employeesOnLinkedIn: 322,
      founded: "2015",
      retrievedAt: expect.any(String) as string,
    });
    expect(vendor.calls[0]?.url).toContain("dataset_id=gd_l1vikfnt1wgvvqz95w");
    expect(vendor.calls[0]?.body).toEqual([
      { url: "https://www.linkedin.com/company/paystack" },
    ]);
  });

  it("maps a person record, and reports a deferred snapshot as PENDING", async () => {
    const person = fakeFetch(() => ({
      status: 200,
      body: [
        {
          name: "Ada Obi",
          position: "Founder at Vaultlyne",
          city: "Lagos",
          country_code: "NG",
          current_company: { name: "Vaultlyne", title: "Founder" },
          experience: [
            { title: "Founder", company: "Vaultlyne", start_date: "2024" },
          ],
          followers: 1200,
          connections: 500,
        },
      ],
    }));
    const lookup = createBrightDataProfileLookup({
      apiKey: KEY,
      fetch: person.fetch,
    });
    const found = await lookup.lookup(
      { url: "https://www.linkedin.com/in/ada-obi" },
      {},
    );
    expect(found.status).toBe("FOUND");
    expect(found.profile).toMatchObject({
      kind: "PERSON",
      name: "Ada Obi",
      headline: "Founder at Vaultlyne",
      location: "Lagos, NG",
      currentCompany: { name: "Vaultlyne", title: "Founder" },
      experience: [{ title: "Founder", company: "Vaultlyne", period: "2024" }],
    });

    const slow = fakeFetch(() => ({
      status: 202,
      body: { snapshot_id: "sd_x" },
    }));
    const later = createBrightDataProfileLookup({
      apiKey: KEY,
      fetch: slow.fetch,
    });
    const pending = await later.lookup(
      { url: "https://www.linkedin.com/in/ada-obi" },
      {},
    );
    expect(pending).toEqual({ status: "PENDING", profile: null });

    const other = await later.lookup({ url: "https://example.com/in/ada" }, {});
    expect(other).toEqual({ status: "NOT_LINKEDIN", profile: null });
    expect(slow.calls).toHaveLength(1);
  });
});
