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

/**
 * What the link actually did (doc 20 §53: "current rebuffer rate"). Two
 * stalls of the playing pitch within half a minute mean the link cannot
 * afford a warm next pitch whatever the browser claims, so the window
 * drops to the constrained one until the stalls age out. Nothing here
 * leaves the browser; it is a playback decision, not a signal.
 */
const STALL_WINDOW_MS = 30_000;
const STALLS_TO_CONSTRAIN = 2;
let stalls: number[] = [];
const stallListeners = new Set<() => void>();
let stallTimer: ReturnType<typeof setTimeout> | null = null;

function recentStalls(now: number): number {
  stalls = stalls.filter((at) => now - at < STALL_WINDOW_MS);
  return stalls.length;
}

/** The player reports a stall of the playing pitch (buffer ran dry). */
export function reportPlaybackStall(now = Date.now()): void {
  stalls.push(now);
  recentStalls(now);
  for (const listener of stallListeners) listener();
  // When the oldest stall ages out, the window may widen again.
  if (stallTimer !== null) clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    stallTimer = null;
    for (const listener of stallListeners) listener();
  }, STALL_WINDOW_MS);
}

export function linkIsStalling(now = Date.now()): boolean {
  return recentStalls(now) >= STALLS_TO_CONSTRAIN;
}

/** For tests. */
export function resetPlaybackStallsForTests(): void {
  stalls = [];
  if (stallTimer !== null) clearTimeout(stallTimer);
  stallTimer = null;
}

function subscribe(onChange: () => void): () => void {
  const link = connection();
  link?.addEventListener?.("change", onChange);
  stallListeners.add(onChange);
  return () => {
    link?.removeEventListener?.("change", onChange);
    stallListeners.delete(onChange);
  };
}

export function useFeedBudget(): FeedPrefetchBudget {
  return useSyncExternalStore(
    subscribe,
    () =>
      linkIsStalling() ? CONSTRAINED_PREFETCH_BUDGET : budgetFor(connection()),
    () => DEFAULT_PREFETCH_BUDGET,
  );
}
