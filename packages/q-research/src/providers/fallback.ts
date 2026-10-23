import {
  RESEARCH_BOUNDS,
  type ResearchProviderFailureClass,
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
  readonly now?: (() => number) | undefined;
}): PublicWebResearchProvider {
  const all = input.providers;
  const first = all[0];
  if (first === undefined) {
    throw new Error("a fallback research provider needs at least one provider");
  }
  const timeoutMs = input.searchTimeoutMs ?? RESEARCH_BOUNDS.searchTimeoutMs;
  const now = input.now ?? Date.now;
  let lastSearch: PublicWebResearchProvider = first;
  /**
   * Production 2026-10-23: a provider whose key was refused (ScrapingBee,
   * 401 on every search) was asked again on every search and every page
   * read. A refused key rests for a while and a rate limit for a minute;
   * the others carry on. When every provider is resting, all are asked.
   */
  const restingUntil = new Map<PublicWebResearchProvider, number>();
  const note = (provider: PublicWebResearchProvider, error: unknown) => {
    if (!isResearchProviderFailure(error)) return;
    // 402: the account's credit is spent, which passes no sooner.
    const rest =
      error.status === 402
        ? COOL_DOWN_MS.AUTHENTICATION
        : COOL_DOWN_MS[error.failureClass];
    if (rest !== undefined) restingUntil.set(provider, now() + rest);
  };
  const awake = (): readonly PublicWebResearchProvider[] => {
    const at = now();
    const ready = all.filter(
      (provider) => (restingUntil.get(provider) ?? 0) <= at,
    );
    return ready.length > 0 ? ready : all;
  };

  const sequentialSearch: PublicWebResearchProvider["search"] = async (
    request,
    context,
  ) => {
    let failure: unknown = null;
    for (const provider of awake()) {
      try {
        const result = await provider.search(request, context);
        lastSearch = provider;
        return result;
      } catch (error: unknown) {
        if (!isResearchProviderFailure(error)) throw error;
        note(provider, error);
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
    const providers = awake();
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
        note(provider, outcome.reason);
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
      input.parallelSearch === true && all.length > 1
        ? parallelSearch
        : sequentialSearch,
    extract: async (request, context) => {
      let failure: unknown = null;
      for (const provider of awake()) {
        try {
          return await provider.extract(request, context);
        } catch (error: unknown) {
          if (!isResearchProviderFailure(error)) throw error;
          note(provider, error);
          failure = error;
          if (context.signal?.aborted === true) throw error;
        }
      }
      throw failure;
    },
  };
}

/** How long a provider rests after a failure that will not pass by itself. */
const COOL_DOWN_MS: Partial<Record<ResearchProviderFailureClass, number>> = {
  AUTHENTICATION: 10 * 60_000,
  RATE_LIMIT: 60_000,
};

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
