import { describe, expect, it } from "vitest";

import { isResearchProviderFailure } from "../src/ports.js";
import {
  createBraveImageSearch,
  createBraveResearchProvider,
} from "../src/providers/brave.js";
import { createMergedImageSearch } from "../src/providers/images.js";

/**
 * Brave Search behind the research ports (owner 2026-10-23): its own
 * index for web, news and images, the key only in Brave's header.
 */

const KEY = "b".repeat(32);

function scripted(body: unknown, status = 200) {
  const requests: { url: URL; headers: Headers }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const href =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    requests.push({ url: new URL(href), headers: new Headers(init?.headers) });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetch, requests };
}

const request = {
  query: "zino aviation",
  maxResults: 6,
  freshness: "ANY" as const,
  includeDomains: [],
};

describe("Brave web and news search", () => {
  it("maps web results to plain-text hits with their dates and extra passages", async () => {
    const vendor = scripted({
      web: {
        results: [
          {
            title: "<strong>Zino Aviation</strong>: Pilot Training",
            url: "https://www.zinoaviation.com/",
            description: "Charter &amp; <strong>training</strong>.",
            extra_snippets: ["Founded by Captain Zino Mario."],
            page_age: "2025-04-02T00:00:00",
          },
          { title: "no address" },
          { title: "private", url: "http://127.0.0.1/x" },
        ],
      },
    });
    const brave = createBraveResearchProvider({
      apiKey: KEY,
      fetch: vendor.fetch,
    });
    const result = await brave.search(request, {});
    expect(result.hits).toEqual([
      {
        url: "https://www.zinoaviation.com/",
        title: "Zino Aviation: Pilot Training",
        snippet: "Charter & training. Founded by Captain Zino Mario.",
        publishedAt: "2025-04-02T00:00:00",
        relevance: 1,
      },
    ]);
    const sent = vendor.requests[0];
    expect(sent?.url.pathname).toBe("/res/v1/web/search");
    expect(sent?.url.searchParams.get("q")).toBe("zino aviation");
    // The key travels in Brave's header only, never in the address.
    expect(sent?.headers.get("X-Subscription-Token")).toBe(KEY);
    expect(sent?.url.href).not.toContain(KEY);
  });

  it("asks the news vertical for a news turn, with its freshness", async () => {
    const vendor = scripted({
      results: [
        {
          title: "Flutterwave raises",
          url: "https://techcabal.com/2026/10/20/flutterwave/",
          description: "News.",
          page_age: "2026-10-20T08:00:00",
        },
      ],
    });
    const brave = createBraveResearchProvider({
      apiKey: KEY,
      fetch: vendor.fetch,
    });
    const result = await brave.search(
      { ...request, topic: "NEWS", freshness: "PAST_WEEK" },
      {},
    );
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://techcabal.com/2026/10/20/flutterwave/",
    ]);
    expect(vendor.requests[0]?.url.pathname).toBe("/res/v1/news/search");
    expect(vendor.requests[0]?.url.searchParams.get("freshness")).toBe("pw");
  });

  it("reports a refused key as AUTHENTICATION and reads no pages", async () => {
    const brave = createBraveResearchProvider({
      apiKey: KEY,
      fetch: scripted({}, 401).fetch,
    });
    const refused = await brave.search(request, {}).catch((e: unknown) => e);
    expect(isResearchProviderFailure(refused)).toBe(true);
    if (isResearchProviderFailure(refused)) {
      expect(refused.failureClass).toBe("AUTHENTICATION");
      expect(refused.providerCode).toBe("brave");
    }
    await expect(
      brave.extract({ urls: ["https://www.zinoaviation.com/"] }, {}),
    ).rejects.toSatisfy(isResearchProviderFailure);
  });
});

describe("Brave image search, merged with another index", () => {
  it("maps image results and interleaves them with the other index's, one per image", async () => {
    const brave = createBraveImageSearch({
      apiKey: KEY,
      fetch: scripted({
        results: [
          {
            title: "Zino Aviation hangar",
            url: "https://www.zinoaviation.com/about",
            properties: { url: "https://www.zinoaviation.com/hangar.jpg" },
            thumbnail: { src: "https://imgs.search.brave.com/t.jpg" },
          },
        ],
      }).fetch,
    });
    const other = {
      code: "serper",
      searchImages: () =>
        Promise.resolve([
          {
            imageUrl: "https://www.zinoaviation.com/hangar.jpg",
            thumbnailUrl: null,
            pageUrl: "https://www.zinoaviation.com/",
            title: "Zino Aviation",
          },
          {
            imageUrl: "https://cdn.nairametrics.com/zino.jpg",
            thumbnailUrl: null,
            pageUrl: "https://nairametrics.com/zino",
            title: "Zino Aviation interview",
          },
        ]),
    };
    const merged = createMergedImageSearch([other, brave]);
    const hits = await merged.searchImages("zino aviation", {});
    expect(hits.map((hit) => hit.imageUrl)).toEqual([
      "https://www.zinoaviation.com/hangar.jpg",
      "https://cdn.nairametrics.com/zino.jpg",
    ]);
  });
});
