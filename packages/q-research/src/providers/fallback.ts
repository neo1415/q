import {
  RESEARCH_BOUNDS,
  type PublicWebSearchHit,
  type PublicWebSearchResult,
} from "../contracts.js";
import { canonicalUrlKey } from "../domain/url-safety.js";
import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";

/**
 * One provider over several.
 *
 * Search, by default, tries each index in turn until one answers. With
 * `parallelSearch` (web search 2026-10-06: Tavily and SerpApi index the
 * web differently, and one of them alone missed what the other found)
 * every index is asked at once, each under its own deadline, and the hits
 * are merged by canonical URL; the search fails only when every index
 * failed. A page is read by the first provider that can read pages. The
 * code reported on evidence is the provider that answered first.
 */
export function createFallbackResearchProvider(input: {
  readonly providers: readonly PublicWebResearchProvider[];
  readonly parallelSearch?: boolean | undefined;
  /** Each index's deadline in a parallel search. */
  readonly searchTimeoutMs?: number | undefined;
}): PublicWebResearchProvider {
  const providers = input.providers;
  const first = providers[0];
  if (first === undefined) {
    throw new Error("a fallback research provider needs at least one provider");
  }
  const timeoutMs = input.searchTimeoutMs ?? RESEARCH_BOUNDS.searchTimeoutMs;
  let lastSearch: PublicWebResearchProvider = first;

  const sequentialSearch: PublicWebResearchProvider["search"] = async (
    request,
    context,
  ) => {
    let failure: unknown = null;
    for (const provider of providers) {
      try {
        const result = await provider.search(request, context);
        lastSearch = provider;
        return result;
      } catch (error: unknown) {
        if (!isResearchProviderFailure(error)) throw error;
        failure = error;
        if (context.signal?.aborted === true) throw error;
      }
    }
    throw failure;
  };

  const parallelSearch: PublicWebResearchProvider["search"] = async (
    request,
    context,
  ) => {
    const started = Date.now();
    const settled = await Promise.allSettled(
      providers.map((provider) => {
        const own: ResearchExecutionContext = {
          ...context,
          signal:
            context.signal === undefined
              ? AbortSignal.timeout(timeoutMs)
              : AbortSignal.any([
                  context.signal,
                  AbortSignal.timeout(timeoutMs),
                ]),
        };
        return provider.search(request, own);
      }),
    );
    const answered: {
      provider: PublicWebResearchProvider;
      result: PublicWebSearchResult;
    }[] = [];
    let failure: unknown = null;
    for (const [index, outcome] of settled.entries()) {
      const provider = providers[index];
      if (provider === undefined) continue;
      if (outcome.status === "fulfilled") {
        answered.push({ provider, result: outcome.value });
      } else {
        if (!isResearchProviderFailure(outcome.reason)) throw outcome.reason;
        failure = outcome.reason;
      }
    }
    const lead = answered[0];
    if (lead === undefined) throw failure;
    lastSearch = lead.provider;
    return {
      hits: mergeHits(answered.map((entry) => entry.result.hits)),
      latencyMs: Math.max(0, Date.now() - started),
    };
  };

  return {
    get code() {
      return lastSearch.code;
    },
    search:
      input.parallelSearch === true && providers.length > 1
        ? parallelSearch
        : sequentialSearch,
    extract: async (request, context) => {
      let failure: unknown = null;
      for (const provider of providers) {
        try {
          return await provider.extract(request, context);
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) throw error;
          failure = error;
          if (context.signal?.aborted === true) throw error;
        }
      }
      throw failure;
    },
  };
}

/**
 * Hits from several indexes as one list: interleaved by rank so no index
 * crowds out the others, one entry per canonical URL. A page more than
 * one index found keeps its best relevance plus a small agreement bonus
 * (two independent indexes ranking it is a signal), and the first
 * non-empty title, snippet and date.
 */
export function mergeHits(
  lists: readonly (readonly PublicWebSearchHit[])[],
): PublicWebSearchHit[] {
  const byKey = new Map<string, { hit: PublicWebSearchHit; seen: number }>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank += 1) {
    for (const list of lists) {
      const hit = list[rank];
      if (hit === undefined) continue;
      const key = canonicalUrlKey(hit.url);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, { hit, seen: 1 });
        continue;
      }
      existing.seen += 1;
      existing.hit = {
        ...existing.hit,
        title: existing.hit.title ?? hit.title,
        snippet:
          existing.hit.snippet.length > 0 ? existing.hit.snippet : hit.snippet,
        publishedAt: existing.hit.publishedAt ?? hit.publishedAt,
        relevance: Math.max(existing.hit.relevance ?? 0, hit.relevance ?? 0),
      };
    }
  }
  return [...byKey.values()]
    .map(({ hit, seen }) =>
      seen > 1
        ? { ...hit, relevance: Math.min(1, (hit.relevance ?? 0) + 0.1) }
        : hit,
    )
    .slice(0, RESEARCH_BOUNDS.maxMergedResults);
}
