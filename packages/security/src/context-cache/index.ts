/**
 * @capital-q/security/context-cache: isolation for prepared Q context
 * (RECOVERY K, Part 11). Keys, a scoped single-flight cache, and the
 * Test 6 isolation check every caching layer runs.
 */
export {
  assertContextCacheScope,
  ContextCacheScopeError,
  contextCacheKey,
  type ContextCacheScope,
  type ContextCacheSubject,
} from "./key.js";
export { createContextCache, type ContextCache } from "./cache.js";
export {
  checkContextIsolation,
  type IsolationLayer,
  type IsolationScenario,
} from "./isolation.js";
