import { contextCacheKey, type ContextCacheScope } from "./key.js";

/**
 * A process-local cache for prepared Q context (Tier A snapshots, Live
 * context packages), with the isolation rules of K Part 11 built in
 * rather than left to each caller:
 *
 * - Every read and write goes through the full scope key (key.ts). There
 *   is no `get(id)`: an entry cannot be fetched without proving who is
 *   asking, under which permissions, about what.
 * - Single-flight: concurrent misses for one key share one load. A load
 *   that was in flight when its actor, tenant, organisation or subject was
 *   invalidated is returned to its own caller but never stored, so a
 *   revocation racing a warm-up cannot leave the old view cached.
 * - Invalidation by actor (logout, role or membership change), tenant,
 *   organisation (org switch, team change) and subject (visibility or
 *   disclosure change, projection rebuilt) removes entries at once. The
 *   epochs in the key already make stale entries unreachable; explicit
 *   invalidation also frees them and stops in-flight loads landing.
 * - TTL and a size bound, so nothing outlives its use by long.
 *
 * A cache entry is a convenience, never authority: a consequential action
 * re-authorizes at execution whatever the cache holds.
 */

export type ContextCache<T> = {
  readonly get: (scope: ContextCacheScope) => T | undefined;
  readonly getOrLoad: (
    scope: ContextCacheScope,
    load: () => Promise<T>,
  ) => Promise<T>;
  readonly invalidateActor: (userId: string) => number;
  readonly invalidateTenant: (tenantId: string) => number;
  readonly invalidateOrganisation: (organisationId: string) => number;
  readonly invalidateSubject: (type: string, id: string) => number;
  readonly clear: () => void;
  readonly size: () => number;
};

type Entry<T> = {
  readonly value: T;
  readonly expiresAt: number;
  readonly tags: readonly string[];
};

function tagsOf(scope: ContextCacheScope): string[] {
  const tags = [`user:${scope.actor.userId}`, `tenant:${scope.actor.tenantId}`];
  if (scope.actor.organisationId !== undefined) {
    tags.push(`org:${scope.actor.organisationId}`);
  }
  if (scope.subject !== undefined) {
    tags.push(`subject:${scope.subject.type}:${scope.subject.id}`);
  }
  return tags;
}

export function createContextCache<T>(
  options: {
    readonly ttlMs?: number | undefined;
    readonly maxEntries?: number | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): ContextCache<T> {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const maxEntries = options.maxEntries ?? 2_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();
  /** Bumped by every invalidation touching a tag; loads compare it. */
  const generation = new Map<string, number>();
  const inFlightTags = new Map<string, readonly string[]>();
  /** Bumped by clear(), which resets every tag's generation. */
  let cleared = 0;

  const genOf = (tags: readonly string[]) =>
    `${String(cleared)}/${tags.map((tag) => generation.get(tag) ?? 0).join(",")}`;

  function invalidate(tag: string): number {
    generation.set(tag, (generation.get(tag) ?? 0) + 1);
    let removed = 0;
    for (const [key, entry] of entries) {
      if (entry.tags.includes(tag)) {
        entries.delete(key);
        removed += 1;
      }
    }
    for (const [key] of inFlight) {
      // The load still resolves for its caller; it just will not be stored
      // (the generation check below) and is not shared with new callers.
      if (inFlightTags.get(key)?.includes(tag) === true) {
        inFlight.delete(key);
        inFlightTags.delete(key);
      }
    }
    return removed;
  }

  function read(key: string): T | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function store(key: string, value: T, tags: readonly string[]): void {
    if (entries.size >= maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done !== true) entries.delete(oldest.value);
    }
    entries.set(key, { value, expiresAt: now() + ttlMs, tags });
  }

  return {
    get: (scope) => read(contextCacheKey(scope)),
    getOrLoad: (scope, load) => {
      const key = contextCacheKey(scope);
      const hit = read(key);
      if (hit !== undefined) return Promise.resolve(hit);
      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;
      const tags = tagsOf(scope);
      const startedAt = genOf(tags);
      const loading = load().then(
        (value) => {
          if (inFlight.get(key) === loading) {
            inFlight.delete(key);
            inFlightTags.delete(key);
          }
          if (genOf(tags) === startedAt) store(key, value, tags);
          return value;
        },
        (error: unknown) => {
          if (inFlight.get(key) === loading) {
            inFlight.delete(key);
            inFlightTags.delete(key);
          }
          throw error;
        },
      );
      inFlight.set(key, loading);
      inFlightTags.set(key, tags);
      return loading;
    },
    invalidateActor: (userId) => invalidate(`user:${userId}`),
    invalidateTenant: (tenantId) => invalidate(`tenant:${tenantId}`),
    invalidateOrganisation: (organisationId) =>
      invalidate(`org:${organisationId}`),
    invalidateSubject: (type, id) => invalidate(`subject:${type}:${id}`),
    clear: () => {
      entries.clear();
      inFlight.clear();
      inFlightTags.clear();
      generation.clear();
      cleared += 1;
    },
    size: () => entries.size,
  };
}
