import { AsyncLocalStorage } from "node:async_hooks";
import type { ObservabilityContext } from "./types.js";

/**
 * Scoped correlation context.
 *
 * The store is deliberately module-private: exposing the raw AsyncLocalStorage
 * would let any module mutate or replace request state, and would tie every
 * future caller to this implementation.
 *
 * A scope is immutable. Enriching derives a new nested scope rather than
 * mutating the active one, so concurrent requests and jobs cannot observe each
 * other's fields.
 */
const storage = new AsyncLocalStorage<ObservabilityContext>();

/** Run `callback` with `context` active for its entire async execution. */
export function runWithObservabilityContext<T>(
  context: ObservabilityContext,
  callback: () => T,
): T {
  return storage.run(Object.freeze({ ...context }), callback);
}

/**
 * Run `callback` with the active context plus `additions`.
 *
 * Fields already set are overridden only by explicit additions; the parent
 * scope is left untouched.
 */
export function withObservabilityContext<T>(
  additions: ObservabilityContext,
  callback: () => T,
): T {
  const current = storage.getStore() ?? {};
  return runWithObservabilityContext({ ...current, ...additions }, callback);
}

/** The active context, or an empty context outside any scope. */
export function getObservabilityContext(): ObservabilityContext {
  return storage.getStore() ?? {};
}
