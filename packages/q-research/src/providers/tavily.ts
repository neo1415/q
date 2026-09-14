import { tavily } from "@tavily/core";

import {
  RESEARCH_BOUNDS,
  type PublicWebExtractResult,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
} from "../contracts.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import {
  ResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";

/**
 * Tavily behind the PublicWebResearchProvider port (CQ-Q-RESEARCH-001 §5-§6).
 *
 * The only file in Capital Q that imports the vendor SDK. Search and extract
 * are the only operations reached: the SDK's crawl, map and research
 * functions are not referenced here, so nothing built on the port can call
 * them. The API key is captured in the closure at composition and appears
 * in no field, log, error or result. Vendor request ids, scores and raw
 * payloads stay inside this adapter; what leaves is the port's shape.
 *
 * The SDK throws plain Errors of the form "<status> Error: …" or a timeout
 * sentence; they are classified into the port's stable failure classes and
 * kept only as `cause`.
 */

/** The surface this adapter uses, so tests can inject a scripted client. */
export type TavilyClientLike = {
  readonly search: (
    query: string,
    options: Record<string, unknown>,
  ) => Promise<{
    readonly results: readonly {
      readonly url: string;
      readonly title?: string | null | undefined;
      readonly content?: string | null | undefined;
      readonly score?: number | null | undefined;
      readonly publishedDate?: string | null | undefined;
    }[];
  }>;
  readonly extract: (
    urls: string[],
    options: Record<string, unknown>,
  ) => Promise<{
    readonly results: readonly {
      readonly url: string;
      readonly title?: string | null | undefined;
      readonly rawContent?: string | null | undefined;
    }[];
    readonly failedResults?: readonly { readonly url: string }[] | undefined;
  }>;
};

export type TavilyResearchProviderOptions = {
  readonly apiKey: string;
  /** Per-call timeout the vendor honours, in seconds. */
  readonly timeoutSeconds?: number | undefined;
  /** Test seam: a scripted client instead of the SDK. */
  readonly client?: TavilyClientLike | undefined;
};

const DEFAULT_TIMEOUT_SECONDS = 20;

function statusOf(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = /^(\d{3}) Error:/.exec(error.message);
  return match === null ? null : Number.parseInt(match[1] ?? "", 10);
}

export function classifyTavilyError(error: unknown): {
  readonly failureClass: ResearchProviderFailure["failureClass"];
  readonly status: number | null;
} {
  const status = statusOf(error);
  if (error instanceof Error && /timed out/i.test(error.message)) {
    return { failureClass: "TIMEOUT", status };
  }
  if (status === 401 || status === 403) {
    return { failureClass: "AUTHENTICATION", status };
  }
  if (status === 429 || status === 432 || status === 433) {
    return { failureClass: "RATE_LIMIT", status };
  }
  if (status === 400 || status === 422) {
    return { failureClass: "VALIDATION", status };
  }
  return { failureClass: "UNAVAILABLE", status };
}

function failure(error: unknown): ResearchProviderFailure {
  const classified = classifyTavilyError(error);
  return new ResearchProviderFailure({
    providerCode: "tavily",
    failureClass: classified.failureClass,
    status: classified.status,
    cause: error,
  });
}

function timeRangeFor(
  freshness: PublicWebSearchRequest["freshness"],
): Record<string, unknown> {
  switch (freshness) {
    case "PAST_MONTH":
      return { timeRange: "month" };
    case "PAST_YEAR":
      return { timeRange: "year" };
    case "ANY":
      return {};
  }
}

function raceSignal<T>(
  work: Promise<T>,
  context: ResearchExecutionContext,
): Promise<T> {
  const signal = context.signal;
  if (signal === undefined) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(
      new ResearchProviderFailure({
        providerCode: "tavily",
        failureClass: "TIMEOUT",
      }),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        new ResearchProviderFailure({
          providerCode: "tavily",
          failureClass: "TIMEOUT",
        }),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createTavilyResearchProvider(
  options: TavilyResearchProviderOptions,
): PublicWebResearchProvider {
  const timeout = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const client: TavilyClientLike =
    options.client ?? tavily({ apiKey: options.apiKey });
  return {
    code: "tavily",
    search: async (request, context) => {
      const startedAt = Date.now();
      let response;
      try {
        response = await raceSignal(
          client.search(request.query, {
            searchDepth: "basic",
            topic: "general",
            maxResults: Math.min(
              request.maxResults,
              RESEARCH_BOUNDS.maxSearchResults,
            ),
            includeAnswer: false,
            includeRawContent: false,
            includeImages: false,
            includeDomains: request.includeDomains,
            timeout,
            ...timeRangeFor(request.freshness),
          }),
          context,
        );
      } catch (error: unknown) {
        throw error instanceof ResearchProviderFailure ? error : failure(error);
      }
      const hits: PublicWebSearchResult["hits"] = [];
      for (const result of response.results ?? []) {
        const verdict = judgePublicUrl(result.url);
        if (!verdict.ok) {
          continue;
        }
        hits.push({
          url: verdict.url,
          title:
            typeof result.title === "string" && result.title.length > 0
              ? result.title.slice(0, 300)
              : null,
          snippet: (result.content ?? "").slice(
            0,
            RESEARCH_BOUNDS.maxSnippetChars,
          ),
          publishedAt:
            typeof result.publishedDate === "string" &&
            result.publishedDate.length > 0
              ? result.publishedDate.slice(0, 40)
              : null,
          relevance:
            typeof result.score === "number" &&
            result.score >= 0 &&
            result.score <= 1
              ? result.score
              : null,
        });
        if (hits.length >= RESEARCH_BOUNDS.maxSearchResults) {
          break;
        }
      }
      return { hits, latencyMs: Math.max(0, Date.now() - startedAt) };
    },
    extract: async (request, context) => {
      const startedAt = Date.now();
      const urls = request.urls.slice(0, RESEARCH_BOUNDS.maxExtractCount);
      let response;
      try {
        response = await raceSignal(
          client.extract([...urls], {
            extractDepth: "basic",
            format: "text",
            includeImages: false,
            timeout,
          }),
          context,
        );
      } catch (error: unknown) {
        throw error instanceof ResearchProviderFailure ? error : failure(error);
      }
      const pages: PublicWebExtractResult["pages"] = [];
      const seen = new Set<string>();
      for (const result of response.results ?? []) {
        const verdict = judgePublicUrl(result.url);
        if (!verdict.ok || seen.has(verdict.url)) {
          continue;
        }
        seen.add(verdict.url);
        pages.push({
          url: verdict.url,
          title:
            typeof result.title === "string" && result.title.length > 0
              ? result.title.slice(0, 300)
              : null,
          text: (result.rawContent ?? "").slice(0, 200_000),
        });
      }
      const failedUrls = (response.failedResults ?? [])
        .map((entry) => judgePublicUrl(entry.url))
        .flatMap((verdict) => (verdict.ok ? [verdict.url] : []))
        .slice(0, RESEARCH_BOUNDS.maxExtractCount);
      return {
        pages,
        failedUrls,
        latencyMs: Math.max(0, Date.now() - startedAt),
      };
    },
  };
}
