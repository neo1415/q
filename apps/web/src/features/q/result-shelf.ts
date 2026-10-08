"use client";

import { useSyncExternalStore } from "react";

import type { ShownItem } from "./shown";

/**
 * Every result set Q showed in this tab, kept for the tab's life
 * (INC-1, live 2026-10-08: a top-three answer vanished when the voice
 * line reconnected and the page moved to another conversation, taking
 * the old turns, and their cards, with it).
 *
 * A set is kept by its run, as it was first shown, and is never merged
 * with another run's set, overwritten by a later copy of the same run, or
 * cleared by a reconnect, a replayed arrival or a change of conversation.
 * The stage reads it for "Shown recently", so an older set is always one
 * tap away. Browser memory only: nothing here is stored or sent.
 */

export const RESULT_SHELF_MAX = 12;

let shelf: readonly ShownItem[] = [];
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** Keeps the sets not yet on the shelf; a run already there is left as it was. */
export function rememberResults(items: readonly ShownItem[]): void {
  const known = new Set(shelf.map((item) => item.run));
  const fresh = items.filter((item) => !known.has(item.run));
  if (fresh.length === 0) return;
  shelf = [...shelf, ...fresh].slice(-RESULT_SHELF_MAX);
  for (const notify of listeners) notify();
}

const EMPTY: readonly ShownItem[] = [];

export function useResultShelf(): readonly ShownItem[] {
  return useSyncExternalStore(
    subscribe,
    () => shelf,
    () => EMPTY,
  );
}

/** For tests: start over. */
export function clearResultShelf(): void {
  shelf = [];
  for (const notify of listeners) notify();
}
