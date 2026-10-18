"use client";

import { useSyncExternalStore } from "react";

import type { SpotlightTap } from "./spotlight";

/**
 * The person's taps on a card set, by set (spotlight.ts `setKeyOf`), so
 * the stage, the Board and the dock agree on which card is in focus.
 * Browser memory for this tab only.
 */

let taps: ReadonlyMap<string, SpotlightTap> = new Map();
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** A tap on card `index` (-1: back to level) when the thread had `at` turns. */
export function tapSpotlight(setKey: string, index: number, at: number): void {
  const next = new Map(taps);
  next.set(setKey, { index, at });
  taps = next;
  for (const notify of listeners) notify();
}

export function useSpotlightTap(setKey: string): SpotlightTap | null {
  return useSyncExternalStore(
    subscribe,
    () => taps.get(setKey) ?? null,
    () => null,
  );
}

/** For tests: forget every tap. */
export function clearSpotlightTaps(): void {
  taps = new Map();
  for (const notify of listeners) notify();
}
