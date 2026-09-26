"use client";

import { useSyncExternalStore } from "react";

import {
  CONSTRAINED_PREFETCH_BUDGET,
  DEFAULT_PREFETCH_BUDGET,
  type FeedPrefetchBudget,
} from "./feed-state";

/**
 * Which preload window this connection may afford (doc 20 §50; spec §9.5).
 *
 * The warm tier -- the next pitch buffering a short start while the
 * current one plays -- is billed per delivered minute, so it runs only
 * where the link is fast and the person has not asked to save data: an
 * effective type of 4g and Save-Data off. Anywhere else, and wherever the
 * browser does not say, the constrained window: current ACTIVE, the next
 * one a poster, nothing else.
 */

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
  if (link === undefined) return CONSTRAINED_PREFETCH_BUDGET;
  return link.effectiveType === "4g" && link.saveData !== true
    ? DEFAULT_PREFETCH_BUDGET
    : CONSTRAINED_PREFETCH_BUDGET;
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
    () => CONSTRAINED_PREFETCH_BUDGET,
  );
}
