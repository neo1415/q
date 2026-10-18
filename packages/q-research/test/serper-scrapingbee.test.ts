import { describe, expect, it } from "vitest";

import {
  createScrapingBeeResearchProvider,
  htmlToText,
} from "../src/providers/scrapingbee.js";
import { createDetectingSerpProvider } from "../src/providers/serp-detect.js";
import { createSerperResearchProvider } from "../src/providers/serper.js";
import { isResearchProviderFailure } from "../src/ports.js";

/** Scripted fetch only: no vendor is ever called. */

const REQUEST = {
  query: "shadi qishta doha qatar",
  maxResults: 6,
  freshness: "ANY" as const,
  includeDomains: ["linkedin.com"],
};
const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
const bodyOf = (init: RequestInit | undefined): string =>
  typeof init?.body === "string" ? init.body : "{}";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("serper adapter", () => {
  it("posts the key as a header, restricts sites in the query, and maps organic results", async () => {
    let seen: { url: string; headers: Headers; body: unknown } | null = null;
    const provider = createSerperResearchProvider({
      apiKey: "k".repeat(40),
      fetch: (input, init) => {
        seen = {
          url: urlOf(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(bodyOf(init)),
        };
        return Promise.resolve(
          json({
            organic: [
              {
                link: "https://qa.linkedin.com/in/shadi-qishta-282453a",
                title: "Shadi Qishta - Finance | LinkedIn",
                snippet: "Doha, Qatar",
                position: 1,
              },
              { link: "http://localhost/secret", title: "internal" },
            ],
          }),
        );
      },
    });
    const result = await provider.search(REQUEST, {});
    expect(seen).not.toBeNull();
    expect(
      (seen as unknown as { headers: Headers }).headers.get("x-api-key"),
    ).toBe("k".repeat(40));
    expect(
      JSON.stringify((seen as unknown as { body: unknown }).body),
    ).toContain("site:linkedin.com");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.url).toContain("linkedin.com/in/");
  });

  it("classifies vendor failures without leaking the key", async () => {
    const provider = createSerperResearchProvider({
      apiKey: "secret-key-0000000000000000",
      fetch: () => Promise.resolve(json({ message: "Unauthorized" }, 403)),
    });
    const error = await provider.search(REQUEST, {}).catch((e: unknown) => e);
    expect(isResearchProviderFailure(error)).toBe(true);
    expect(isResearchProviderFailure(error) && error.failureClass).toBe(
      "AUTHENTICATION",
    );
    expect(String((error as Error).message)).not.toContain("secret-key");
  });
});

describe("scrapingbee adapter", () => {
  it("maps Google organic results and fetches an official page as text", async () => {
    const provider = createScrapingBeeResearchProvider({
      apiKey: "b".repeat(80),
      fetch: (input) => {
        const url = new URL(urlOf(input));
        if (url.pathname.endsWith("/store/google")) {
          return Promise.resolve(
            json({
              organic_results: [
                {
                  url: "https://www.qinvest.com/about",
                  title: "QInvest",
                  description: "Investment bank in Doha",
                },
              ],
            }),
          );
        }
        return Promise.resolve(
          new Response(
            "<html><head><title>QInvest | Mission</title><style>x{}</style></head><body><script>bad()</script><h1>Our mission</h1><p>Six values &amp; core divisions.</p></body></html>",
          ),
        );
      },
    });
    const search = await provider.search(
      { ...REQUEST, includeDomains: [] },
      {},
    );
    expect(search.hits[0]?.snippet).toBe("Investment bank in Doha");
    const page = await provider.extract(
      { urls: ["https://www.qinvest.com/about"] },
      {},
    );
    expect(page.pages[0]?.title).toBe("QInvest | Mission");
    expect(page.pages[0]?.text).toContain("Six values & core divisions.");
    expect(page.pages[0]?.text).not.toContain("bad()");
  });

  it("reduces html to visible text", () => {
    expect(htmlToText("<p>a</p><script>x</script><p>b</p>").text).toBe("a\nb");
  });
});

describe("detecting serp provider", () => {
  it("falls back to SerpApi when the key is refused by Serper.dev, then keeps it", async () => {
    const calls: string[] = [];
    const provider = createDetectingSerpProvider({
      apiKey: "x".repeat(40),
      fetch: (input) => {
        const host = new URL(urlOf(input)).host;
        calls.push(host);
        return Promise.resolve(
          host === "google.serper.dev"
            ? json({}, 403)
            : json({
                organic_results: [
                  { link: "https://example.com/a", title: "A", snippet: "s" },
                ],
              }),
        );
      },
    });
    const first = await provider.search(REQUEST, {});
    expect(first.hits).toHaveLength(1);
    expect(provider.code).toBe("serpapi");
    await provider.search(REQUEST, {});
    expect(calls).toEqual(["google.serper.dev", "serpapi.com", "serpapi.com"]);
  });

  it("uses Serper.dev when that is the key's vendor", async () => {
    const provider = createDetectingSerpProvider({
      apiKey: "x".repeat(40),
      fetch: () =>
        Promise.resolve(
          json({
            organic: [
              { link: "https://example.com/a", title: "A", snippet: "s" },
            ],
          }),
        ),
    });
    await provider.search(REQUEST, {});
    expect(provider.code).toBe("serper");
  });
});
