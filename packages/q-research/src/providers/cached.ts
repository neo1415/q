import type {
  PublicWebResearchProvider,
  ResearchExecutionContext,
} from "../ports.js";

/**
 * A short memory for public reads. The same search or the same page asked
 * for again within the window comes back without a second vendor call,
 * so a person who asks two questions about one company waits once. A
 * read the person wants fresh ("refresh", "latest", "again") passes
 * `freshRead` and goes to the vendor; what it brings back replaces the
 * entry. Process-local and bounded; nothing here is evidence, the service
 * still records what it retains.
 */

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 400;

type Entry<T> = { readonly value: T; readonly expiresAt: number };

export function createCachedResearchProvider(input: {
  readonly provider: PublicWebResearchProvider;
  readonly ttlMs?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly clock?: (() => number) | undefined;
}): PublicWebResearchProvider {
  const { provider } = input;
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const max = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const clock = input.clock ?? Date.now;
  const searches = new Map<
    string,
    Entry<Awaited<ReturnType<PublicWebResearchProvider["search"]>>>
  >();
  const pages = new Map<
    string,
    Entry<Awaited<ReturnType<PublicWebResearchProvider["extract"]>>>
  >();

  const read = <T>(
    store: Map<string, Entry<T>>,
    key: string,
    context: ResearchExecutionContext,
  ): T | null => {
    if (context.freshRead === true) return null;
    const entry = store.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= clock()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };
  const write = <T>(store: Map<string, Entry<T>>, key: string, value: T) => {
    if (store.size >= max) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expiresAt: clock() + ttl });
  };

  return {
    get code() {
      return provider.code;
    },
    search: async (request, context) => {
      const key = JSON.stringify([
        request.query.trim().toLowerCase(),
        request.freshness,
        [...request.includeDomains].sort(),
        request.maxResults,
      ]);
      const hit = read(searches, key, context);
      if (hit !== null) return { ...hit, latencyMs: 0 };
      const result = await provider.search(request, context);
      write(searches, key, result);
      return result;
    },
    extract: async (request, context) => {
      const key = JSON.stringify([...request.urls].sort());
      const hit = read(pages, key, context);
      if (hit !== null) return { ...hit, latencyMs: 0 };
      const result = await provider.extract(request, context);
      write(pages, key, result);
      return result;
    },
  };
}
