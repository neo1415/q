import { describe, expect, it } from "vitest";

import {
  isResearchProviderFailure,
  ResearchProviderFailure,
} from "../src/ports.js";
import type { PublicWebResearchProvider } from "../src/ports.js";
import { createDirectPageReader } from "../src/providers/direct-read.js";
import { createFallbackResearchProvider } from "../src/providers/fallback.js";
import type { VettedHttp } from "../src/vetted-http.js";

/**
 * Reading a public page ourselves (23 Oct 2026: every paid reader in
 * production was spent): only through the vetted client, side by side,
 * never a sign-in wall, and passed by when searching.
 */

const encode = (text: string) => new TextEncoder().encode(text);

const ARTICLE = `<html><head><title>Zino Aviation takes off with pilot masterclass</title></head><body><script>x()</script><p>${"Zino Aviation, founded by Captain Zino Mario-Ghae, trains pilots in Lagos. ".repeat(6)}</p></body></html>`;

function http(pages: Readonly<Record<string, string | null>>) {
  const asked: string[] = [];
  const client: VettedHttp = {
    get: (url) => {
      asked.push(url);
      const body = pages[url];
      return Promise.resolve(
        body === undefined || body === null
          ? null
          : {
              url,
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: encode(body),
            },
      );
    },
  };
  return { client, asked };
}

describe("direct page reader", () => {
  it("reads the pages asked for through the vetted client, as visible text", async () => {
    const vetted = http({
      "https://www.thisdaylive.com/zino": ARTICLE,
      "https://ng.linkedin.com/in/zino":
        "<html><head><title>Sign Up | LinkedIn</title></head><body>Join</body></html>",
    });
    const reader = createDirectPageReader({ http: vetted.client });
    const result = await reader.extract(
      {
        urls: [
          "https://www.thisdaylive.com/zino",
          "https://ng.linkedin.com/in/zino",
          "https://unreachable.example/page",
        ],
      },
      {},
    );
    expect(result.pages.map((page) => page.url)).toEqual([
      "https://www.thisdaylive.com/zino",
    ]);
    expect(result.pages[0]?.title).toBe(
      "Zino Aviation takes off with pilot masterclass",
    );
    expect(result.pages[0]?.text).toContain("trains pilots in Lagos");
    expect(result.pages[0]?.text).not.toContain("x()");
    // A sign-in wall and an unreachable page are no source.
    expect(result.failedUrls).toEqual([
      "https://ng.linkedin.com/in/zino",
      "https://unreachable.example/page",
    ]);
  });

  it("fails when it read nothing, and never searches", async () => {
    const reader = createDirectPageReader({ http: http({}).client });
    await expect(
      reader.extract({ urls: ["https://example.com/a"] }, {}),
    ).rejects.toSatisfy(isResearchProviderFailure);
    expect(reader.canSearch).toBe(false);
  });
});

describe("a fan-out passes by what a provider cannot do", () => {
  const request = {
    query: "zino aviation",
    maxResults: 5,
    freshness: "ANY" as const,
    includeDomains: [],
  };

  it("searches without the reader and reads without the search-only index", async () => {
    const searched: string[] = [];
    const read: string[] = [];
    const searchOnly: PublicWebResearchProvider = {
      code: "brave",
      canReadPages: false,
      search: () => {
        searched.push("brave");
        return Promise.resolve({ hits: [], latencyMs: 1 });
      },
      extract: () => {
        read.push("brave");
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: "brave",
            failureClass: "VALIDATION",
          }),
        );
      },
    };
    const reader = createDirectPageReader({
      http: http({ "https://www.thisdaylive.com/zino": ARTICLE }).client,
    });
    const merged = createFallbackResearchProvider({
      providers: [searchOnly, reader],
      parallelSearch: true,
    });
    await merged.search(request, {});
    expect(searched).toEqual(["brave"]);
    const pages = await merged.extract(
      { urls: ["https://www.thisdaylive.com/zino"] },
      {},
    );
    expect(pages.pages).toHaveLength(1);
    expect(read).toEqual([]);
  });
});
