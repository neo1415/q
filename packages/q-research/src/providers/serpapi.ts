import { judgePublicUrl } from "../domain/url-safety.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";
import {
  RESEARCH_BOUNDS,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
} from "../contracts.js";

/**
 * SerpApi (serpapi.com) behind the PublicWebResearchProvider port: Google
 * results as JSON, search only. It reads no pages, so `extract` reports
 * UNAVAILABLE and the service keeps the snippets. Composed as a second
 * search index behind Tavily (`./fallback`), so a search still happens
 * when the first index is rate-limited or down. Plain HTTPS; the key
 * travels only in the request to the vendor.
 */

export type SerpApiResearchProviderOptions = {
  readonly apiKey: string;
  readonly timeoutMs?: number | undefined;
  /** Test seam: a scripted fetch instead of the platform's. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly baseUrl?: string | undefined;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = "https://serpapi.com/search.json";

type OrganicResult = {
  readonly link?: unknown;
  readonly title?: unknown;
  readonly snippet?: unknown;
  readonly date?: unknown;
  readonly position?: unknown;
};

function classify(status: number): ResearchProviderFailure["failureClass"] {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNAVAILABLE";
}

function tbsFor(freshness: PublicWebSearchRequest["freshness"]): string | null {
  switch (freshness) {
    case "PAST_MONTH":
      return "qdr:m";
    case "PAST_YEAR":
      return "qdr:y";
    case "ANY":
      return null;
  }
}

export function createSerpApiResearchProvider(
  options: SerpApiResearchProviderOptions,
): PublicWebResearchProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const failure = (
    failureClass: ResearchProviderFailure["failureClass"],
    status: number | null,
    cause?: unknown,
  ) =>
    new ResearchProviderFailure({
      providerCode: "serpapi",
      failureClass,
      status,
      cause,
    });

  return {
    code: "serpapi",
    search: async (request, context: ResearchExecutionContext) => {
      const startedAt = Date.now();
      const url = new URL(baseUrl);
      url.searchParams.set("engine", "google");
      // Site restriction is part of the query: SerpApi has no domain filter.
      const sites = request.includeDomains
        .map((domain) => `site:${domain}`)
        .join(" OR ");
      url.searchParams.set(
        "q",
        sites.length > 0 ? `${request.query} (${sites})` : request.query,
      );
      url.searchParams.set(
        "num",
        String(Math.min(request.maxResults, RESEARCH_BOUNDS.maxSearchResults)),
      );
      const tbs = tbsFor(request.freshness);
      if (tbs !== null) url.searchParams.set("tbs", tbs);
      url.searchParams.set("api_key", options.apiKey);

      const signals = [AbortSignal.timeout(timeoutMs)];
      if (context.signal !== undefined) signals.push(context.signal);
      let response: Response;
      try {
        response = await doFetch(url, { signal: AbortSignal.any(signals) });
      } catch (error: unknown) {
        throw failure(
          error instanceof Error && error.name === "TimeoutError"
            ? "TIMEOUT"
            : "UNAVAILABLE",
          null,
          error,
        );
      }
      if (!response.ok) {
        throw failure(classify(response.status), response.status);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error: unknown) {
        throw failure("UNAVAILABLE", response.status, error);
      }
      const organic =
        body !== null &&
        typeof body === "object" &&
        Array.isArray((body as { organic_results?: unknown }).organic_results)
          ? ((body as { organic_results: OrganicResult[] }).organic_results ??
            [])
          : [];
      const hits: PublicWebSearchResult["hits"] = [];
      for (const [index, result] of organic.entries()) {
        if (typeof result.link !== "string") continue;
        const verdict = judgePublicUrl(result.link);
        if (!verdict.ok) continue;
        hits.push({
          url: verdict.url,
          title:
            typeof result.title === "string" && result.title.length > 0
              ? result.title.slice(0, 300)
              : null,
          snippet: (typeof result.snippet === "string"
            ? result.snippet
            : ""
          ).slice(0, RESEARCH_BOUNDS.maxSnippetChars),
          publishedAt:
            typeof result.date === "string" && result.date.length > 0
              ? result.date.slice(0, 40)
              : null,
          // Google's order is the only relevance signal the vendor gives.
          relevance: Math.max(0, 1 - index * 0.05),
        });
        if (hits.length >= RESEARCH_BOUNDS.maxSearchResults) break;
      }
      return { hits, latencyMs: Math.max(0, Date.now() - startedAt) };
    },
    extract: () => Promise.reject(failure("UNAVAILABLE", null)),
  };
}
