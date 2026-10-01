"use client";

import { useSyncExternalStore } from "react";

import {
  CONSTRAINED_PREFETCH_BUDGET,
  DEFAULT_PREFETCH_BUDGET,
  type FeedPrefetchBudget,
} from "./feed-state";

/**
 * Which preload window this connection may afford (doc 20 §50/§52/§130).
 *
 * The warm tier -- the next pitch buffering a short start while the
 * current one plays -- is billed per delivered minute, so it is withheld
 * where the browser says the link is slow (an effective type below 4g) or
 * the person asked to save data. Absence of the Network Information API is
 * not a constraint: Safari, every iPhone browser and Firefox never say, and
 * treating silence as "slow" left the next pitch cold on the phones most
 * people swipe on, so every swipe paid manifest + first segment + decode
 * (founder report 2026-10-01: "each takes seconds to start").
 */

const SLOW_LINKS: ReadonlySet<string> = new Set(["slow-2g", "2g", "3g"]);

type Connection = {
  readonly effectiveType?: string;
  readonly saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

function connection(): Connection | undefined {
  if (typeof navigator === "undefined") return undefined;
  const value: unknown = Reflect.get(navigator, "connection");
  // Every member is optional and read defensively, so any object will do.
  return typeof value === "object" && value !== null ? value : undefined;
}

export function budgetFor(link: Connection | undefined): FeedPrefetchBudget {
  if (link?.saveData === true) return CONSTRAINED_PREFETCH_BUDGET;
  const type = link?.effectiveType;
  return type !== undefined && SLOW_LINKS.has(type)
    ? CONSTRAINED_PREFETCH_BUDGET
    : DEFAULT_PREFETCH_BUDGET;
}

function subscribe(onChange: () => void): () => void {
  const link = connection();
  link?.addEventListener?.("change", onChange);
  return () => link?.removeEventListener?.("change", onChange);
}

export function useFeedBudget(): FeedPrefetchBudget {
  return useSyncExternalStore(
    subscribe,
    () => budgetFor(connection()),
    // The server cannot know the link; the client's first render decides.
    () => DEFAULT_PREFETCH_BUDGET,
  );
}
