import { describe, expect, it } from "vitest";

import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../src/ports.js";
import { createCachedResearchProvider } from "../src/providers/cached.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";
import { createSerpApiResearchProvider } from "../src/providers/serpapi.js";

function scripted(
  code: PublicWebResearchProvider["code"],
  search: PublicWebResearchProvider["search"],
): PublicWebResearchProvider {
  return {
    code,
    search,
    extract: () =>
      Promise.reject(
        new ResearchProviderFailure({
          providerCode: code,
          failureClass: "UNAVAILABLE",
        }),
      ),
  };
}

const request = {
  query: "vaultlyne",
  maxResults: 5,
  freshness: "ANY" as const,
  includeDomains: [],
};

describe("indexes in a row", () => {
  it("answers from the next index when the first is rate-limited, and reports who answered", async () => {
    const first = scripted("tavily", () =>
      Promise.reject(
        new ResearchProviderFailure({
          providerCode: "tavily",
          failureClass: "RATE_LIMIT",
          status: 429,
        }),
      ),
    );
    const second = scripted("serpapi", () =>
      Promise.resolve({
        hits: [
          {
            url: "https://example.com/a",
            title: "A",
            snippet: "a",
            publishedAt: null,
            relevance: 1,
          },
        ],
        latencyMs: 3,
      }),
    );
    const provider = createFallbackResearchProvider({
      providers: [first, second],
    });
    const result = await provider.search(request, {});
    expect(result.hits).toHaveLength(1);
    expect(provider.code).toBe("serpapi");
  });

  it("throws the last failure when every index fails", async () => {
    const failing = scripted("tavily", () =>
      Promise.reject(
        new ResearchProviderFailure({
          providerCode: "tavily",
          failureClass: "UNAVAILABLE",
        }),
      ),
    );
    const provider = createFallbackResearchProvider({ providers: [failing] });
    await expect(provider.search(request, {})).rejects.toBeInstanceOf(
      ResearchProviderFailure,
    );
  });
});

describe("a short memory for public reads", () => {
  it("reads the vendor once for the same query, and again when asked for a fresh read", async () => {
    let calls = 0;
    const inner = scripted("tavily", () => {
      calls += 1;
      return Promise.resolve({ hits: [], latencyMs: 9 });
    });
    let now = 0;
    const provider = createCachedResearchProvider({
      provider: inner,
      ttlMs: 1_000,
      clock: () => now,
    });
    await provider.search(request, {});
    await provider.search(request, {});
    expect(calls).toBe(1);
    await provider.search(request, { freshRead: true });
    expect(calls).toBe(2);
    now = 5_000;
    await provider.search(request, {});
    expect(calls).toBe(3);
  });
});

describe("SerpApi behind the port", () => {
  it("maps organic results to public hits and never leaks the key into a hit", async () => {
    const seen: string[] = [];
    const fetch: typeof globalThis.fetch = (input) => {
      seen.push(
        input instanceof URL
          ? input.toString()
          : typeof input === "string"
            ? input
            : input.url,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            organic_results: [
              {
                link: "https://thevaultlyne.com/",
                title: "Vaultlyne",
                snippet: "Secure vaults.",
              },
              { link: "http://localhost/private", title: "no" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    const provider = createSerpApiResearchProvider({
      apiKey: "serp-test-key-0000000000000000",
      fetch,
    });
    const result = await provider.search(request, {});
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://thevaultlyne.com/",
    ]);
    expect(seen[0]).toContain("engine=google");
    expect(JSON.stringify(result)).not.toContain("serp-test-key");
  });

  it("classifies a 429 as a rate limit", async () => {
    const provider = createSerpApiResearchProvider({
      apiKey: "serp-test-key-0000000000000000",
      fetch: () => Promise.resolve(new Response("", { status: 429 })),
    });
    await expect(provider.search(request, {})).rejects.toMatchObject({
      failureClass: "RATE_LIMIT",
      status: 429,
    });
  });
});
