/**
 * Q room W7: the wire's contracts (wire-contracts.ts) off the critical
 * path. Zod and the schemas were a quarter of the room's first-load
 * script; nothing on the first paint checks anything, so they load once
 * the page is up (idle, or at once when something asks for them).
 *
 * Code that checks Q's data either awaits `loadWire()` where it is
 * already asynchronous (a read, a call starting), or reads `wireNow()`
 * where it is not and fails closed while it is null -- a card not shown
 * yet, an action not taken yet -- with `useWire()` re-rendering once the
 * contracts are in, so nothing is lost, only checked a moment later.
 * (The hook is in use-wire.ts: this module is also read on the server.)
 */

export type WireContracts = typeof import("./wire-contracts");

let loaded: WireContracts | null = null;
let loading: Promise<WireContracts> | null = null;
const listeners = new Set<() => void>();

export function loadWire(): Promise<WireContracts> {
  loading ??= import("./wire-contracts").then(
    (module) => {
      loaded = module;
      for (const listener of listeners) listener();
      return module;
    },
    (error: unknown) => {
      // A failed chunk load is tried again by the next caller.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The contracts if they are in; null until then (fail closed). */
export function wireNow(): WireContracts | null {
  return loaded;
}

/** For useWire (use-wire.ts): told once the contracts are in. */
export function subscribeWire(listener: () => void): () => void {
  // A component that checks Q's data is on screen: load them when idle.
  warmWire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The page's start comes first: the contracts are warmed a moment after
 * it (WARM_AFTER_MS), in an idle period, unless something asks for them
 * sooner (loadWire).
 */
const WARM_AFTER_MS = 2_000;
let warming: Promise<WireContracts> | null = null;

/** Starts the load once the page has settled (in a browser only). */
export function warmWire(): void {
  void wireWarmed().catch(() => undefined);
}

/** The contracts, warmed as above: resolves once they are in. */
export function wireWarmed(): Promise<WireContracts> {
  if (loading !== null) return loading;
  if (warming !== null) return warming;
  if (typeof window === "undefined") return loadWire();
  const warm = new Promise<void>((resolve) => {
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 1_500 });
      } else {
        resolve();
      }
    }, WARM_AFTER_MS);
  }).then(() => loadWire());
  warming = warm;
  // A failed warm is tried again by the next caller.
  warm.catch(() => {
    if (warming === warm) warming = null;
  });
  return warm;
}
