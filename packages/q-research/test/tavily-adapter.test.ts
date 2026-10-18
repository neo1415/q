import { describe, expect, it } from "vitest";

import { isResearchProviderFailure } from "../src/index.js";
import {
  classifyTavilyError,
  createTavilyResearchProvider,
  type TavilyClientLike,
} from "../src/providers/tavily.js";

/**
 * The adapter translates the vendor's shapes and failures into the port's,
 * keeps vendor detail as `cause` only, and never asks for crawl, map,
 * research, answers or raw content (CQ-Q-RESEARCH-001 §5-§6, §33).
 */
describe("tavily adapter", () => {
  it.each([
    [new Error('401 Error: {"detail":"bad key"}'), "AUTHENTICATION", 401],
    [new Error("403 Error: {}"), "AUTHENTICATION", 403],
    [new Error('429 Error: {"detail":{"error":"rate"}}'), "RATE_LIMIT", 429],
    [new Error("432 Error: plan limit"), "RATE_LIMIT", 432],
    [new Error("400 Error: bad request"), "VALIDATION", 400],
    [new Error("502 Error: upstream"), "UNAVAILABLE", 502],
    [new Error("Request timed out after 20 seconds."), "TIMEOUT", null],
    [new TypeError("fetch failed"), "UNAVAILABLE", null],
    ["not even an error", "UNAVAILABLE", null],
  ])("classifies %s as %s", (error, failureClass, status) => {
    expect(classifyTavilyError(error)).toEqual({ failureClass, status });
  });

  it("sends a bounded search with no answer, raw content or images, and maps results", async () => {
    const calls: { query: string; options: Record<string, unknown> }[] = [];
    const client: TavilyClientLike = {
      search: (query, options) => {
        calls.push({ query, options });
        return Promise.resolve({
          results: [
            {
              url: "https://kibohealth.example/about",
              title: "About",
              content: "Kibo builds clinic software.",
              score: 0.91,
              publishedDate: "2026-05-01",
            },
            {
              url: "http://localhost/secret",
              title: "nope",
              content: "x",
              score: 0.5,
            },
            {
              url: "https://press.example/kibo",
              title: "",
              content: null,
              score: 2,
            },
          ],
        });
      },
      extract: () => Promise.reject(new Error("unused")),
    };
    const provider = createTavilyResearchProvider({
      apiKey: "tvly-test-key-not-real-0000",
      client,
    });
    const result = await provider.search(
      {
        query: "Kibo Health Systems",
        maxResults: 5,
        freshness: "PAST_YEAR",
        includeDomains: [],
      },
      {},
    );
    expect(calls[0]?.query).toBe("Kibo Health Systems");
    expect(calls[0]?.options).toMatchObject({
      searchDepth: "basic",
      topic: "general",
      maxResults: 5,
      includeAnswer: false,
      includeRawContent: false,
      includeImages: false,
      timeRange: "year",
    });
    expect(result.hits).toEqual([
      {
        url: "https://kibohealth.example/about",
        title: "About",
        snippet: "Kibo builds clinic software.",
        publishedAt: "2026-05-01",
        relevance: 0.91,
      },
      {
        url: "https://press.example/kibo",
        title: null,
        snippet: "",
        publishedAt: null,
        relevance: null,
      },
    ]);
  });

  it("extracts as text, drops unsafe or duplicate URLs, and reports failures as URLs only", async () => {
    const client: TavilyClientLike = {
      search: () => Promise.reject(new Error("unused")),
      extract: (urls, options) => {
        expect(urls).toEqual(["https://a.example/", "https://b.example/"]);
        expect(options).toMatchObject({
          extractDepth: "basic",
          format: "text",
          includeImages: false,
        });
        return Promise.resolve({
          results: [
            { url: "https://a.example/", title: "A", rawContent: "text a" },
            { url: "https://a.example/", title: "A again", rawContent: "dup" },
            { url: "http://10.0.0.1/", title: "private", rawContent: "no" },
          ],
          failedResults: [
            { url: "https://b.example/" },
            { url: "http://localhost/" },
          ],
        });
      },
    };
    const provider = createTavilyResearchProvider({
      apiKey: "tvly-test-key-not-real-0000",
      client,
    });
    const result = await provider.extract(
      { urls: ["https://a.example/", "https://b.example/"] },
      {},
    );
    expect(result.pages).toEqual([
      { url: "https://a.example/", title: "A", text: "text a" },
    ]);
    expect(result.failedUrls).toEqual(["https://b.example/"]);
  });

  it("wraps vendor errors as ResearchProviderFailure with the vendor text only as cause", async () => {
    const vendor = new Error(
      '429 Error: {"detail":"Too many requests to https://api.tavily.com/search"}',
    );
    const client: TavilyClientLike = {
      search: () => Promise.reject(vendor),
      extract: () => Promise.reject(vendor),
    };
    const provider = createTavilyResearchProvider({
      apiKey: "tvly-test-key-not-real-0000",
      client,
    });
    const failure = await provider
      .search(
        { query: "x", maxResults: 1, freshness: "ANY", includeDomains: [] },
        {},
      )
      .catch((error: unknown) => error);
    expect(isResearchProviderFailure(failure)).toBe(true);
    if (isResearchProviderFailure(failure)) {
      expect(failure.failureClass).toBe("RATE_LIMIT");
      expect(failure.status).toBe(429);
      expect(failure.message).not.toContain("tavily.com");
      expect(failure.cause).toBe(vendor);
    }
  });

  it("honours cancellation before the vendor answers", async () => {
    const client: TavilyClientLike = {
      search: () => new Promise(() => undefined),
      extract: () => new Promise(() => undefined),
    };
    const provider = createTavilyResearchProvider({
      apiKey: "tvly-test-key-not-real-0000",
      client,
    });
    const controller = new AbortController();
    const pending = provider.search(
      { query: "x", maxResults: 1, freshness: "ANY", includeDomains: [] },
      { signal: controller.signal },
    );
    controller.abort();
    const failure = await pending.catch((error: unknown) => error);
    expect(isResearchProviderFailure(failure) && failure.failureClass).toBe(
      "TIMEOUT",
    );
  });
});
