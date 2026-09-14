import type {
  PublicWebExtractRequest,
  PublicWebExtractResult,
  PublicWebSearchRequest,
  PublicWebSearchResult,
} from "../contracts.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";

/**
 * A deterministic provider for tests and the local fixture (§43): no
 * network, no credential. It records every request it receives so a test
 * can assert what left Capital Q — the whole point of the egress tests —
 * and answers from a script of pages keyed by URL.
 */

export type FakePublicPage = {
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string;
  readonly text: string;
  readonly publishedAt?: string | null | undefined;
  readonly relevance?: number | undefined;
};

export type FakeResearchBehaviour =
  | {
      readonly kind: "FAIL_SEARCH";
      readonly failureClass: ResearchProviderFailure["failureClass"];
    }
  | {
      readonly kind: "FAIL_EXTRACT";
      readonly failureClass: ResearchProviderFailure["failureClass"];
    };

export type FakeResearchProvider = PublicWebResearchProvider & {
  readonly searches: PublicWebSearchRequest[];
  readonly extracts: PublicWebExtractRequest[];
  /** Every string this provider was ever handed, for leak assertions. */
  readonly egressed: () => string;
};

export function createFakeResearchProvider(options: {
  readonly pages: readonly FakePublicPage[];
  readonly behaviour?: FakeResearchBehaviour | undefined;
}): FakeResearchProvider {
  const searches: PublicWebSearchRequest[] = [];
  const extracts: PublicWebExtractRequest[] = [];
  const byUrl = new Map(options.pages.map((page) => [page.url, page] as const));
  return {
    code: "fake",
    searches,
    extracts,
    egressed: () => JSON.stringify({ searches, extracts }),
    search: (request) => {
      searches.push(request);
      if (options.behaviour?.kind === "FAIL_SEARCH") {
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: "fake",
            failureClass: options.behaviour.failureClass,
          }),
        );
      }
      const hits = options.pages
        .filter(
          (page) =>
            request.includeDomains.length === 0 ||
            request.includeDomains.some((domain) => page.url.includes(domain)),
        )
        .slice(0, request.maxResults)
        .map((page) => ({
          url: page.url,
          title: page.title,
          snippet: page.snippet.slice(0, 600),
          publishedAt: page.publishedAt ?? null,
          relevance: page.relevance ?? null,
        }));
      const result: PublicWebSearchResult = { hits, latencyMs: 1 };
      return Promise.resolve(result);
    },
    extract: (request) => {
      extracts.push(request);
      if (options.behaviour?.kind === "FAIL_EXTRACT") {
        return Promise.reject(
          new ResearchProviderFailure({
            providerCode: "fake",
            failureClass: options.behaviour.failureClass,
          }),
        );
      }
      const pages = request.urls
        .map((url) => byUrl.get(url))
        .filter((page): page is FakePublicPage => page !== undefined)
        .map((page) => ({ url: page.url, title: page.title, text: page.text }));
      const known = new Set(pages.map((page) => page.url));
      const result: PublicWebExtractResult = {
        pages,
        failedUrls: request.urls.filter((url) => !known.has(url)),
        latencyMs: 1,
      };
      return Promise.resolve(result);
    },
  };
}
