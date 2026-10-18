"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import {
  canonicalDiscoverFilters,
  QSetDiscoverFiltersIntentSchema,
  type QSetDiscoverFiltersIntent,
} from "@capital-q/contracts";

import {
  DISCOVER_FILTERS_EVENT,
  filtersFromIntent,
  NO_DISCOVER_FILTERS,
  readStoredFilters,
  storeFilters,
  takePendingIntent,
  type DiscoverFilters,
  type SectorOption,
} from "./discover-filters";

/**
 * The reader's filters as an external store: held in memory for this tab,
 * mirrored to localStorage as a convenience, and re-read from it when
 * Discover mounts. The server render and hydration see no filters (the
 * server snapshot), so the HTML always matches; the stored choice applies
 * right after. Memory is the truth while mounted, so blocked storage still
 * lets the reader filter.
 */
let current: DiscoverFilters = NO_DISCOVER_FILTERS;
const listeners = new Set<() => void>();

function publish(next: DiscoverFilters): void {
  current = canonicalDiscoverFilters(next);
  storeFilters(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) current = readStoredFilters();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;
const serverSnapshot = () => NO_DISCOVER_FILTERS;

export type DiscoverFiltersState = {
  readonly filters: DiscoverFilters;
  readonly setFilters: (next: DiscoverFilters) => void;
  readonly clear: () => void;
  /** Said once after Q set filters it could not fully resolve. */
  readonly notice: string | null;
};

function unresolvedNotice(unresolved: readonly string[]): string | null {
  if (unresolved.length === 0) return null;
  return `Q couldn't match ${unresolved.map((c) => c.replace(/_/g, " ")).join(", ")} to a sector, so ${unresolved.length === 1 ? "it isn't" : "they aren't"} applied.`;
}

/**
 * The reader's filters, and Q's SET_DISCOVER_FILTERS: an intent queued
 * on another page is taken when Discover subscribes, and one sent while
 * Discover is open arrives as an event. Either is validated again here.
 */
export function useDiscoverFilters(
  sectors: readonly SectorOption[],
): DiscoverFiltersState {
  const [notice, setNotice] = useState<string | null>(null);

  const applyIntent = useCallback(
    (intent: QSetDiscoverFiltersIntent) => {
      const { filters, unresolved } = filtersFromIntent(intent, sectors);
      publish(filters);
      setNotice(unresolvedNotice(unresolved));
    },
    [sectors],
  );

  const subscribeWithIntents = useCallback(
    (listener: () => void) => {
      const unsubscribe = subscribe(listener);
      const pending = takePendingIntent();
      if (pending !== null) applyIntent(pending);
      const onIntent = (event: Event) => {
        const detail: unknown =
          event instanceof CustomEvent ? (event.detail as unknown) : null;
        takePendingIntent();
        const parsed = QSetDiscoverFiltersIntentSchema.safeParse(detail);
        if (parsed.success) applyIntent(parsed.data);
      };
      window.addEventListener(DISCOVER_FILTERS_EVENT, onIntent);
      return () => {
        window.removeEventListener(DISCOVER_FILTERS_EVENT, onIntent);
        unsubscribe();
      };
    },
    [applyIntent],
  );

  const filters = useSyncExternalStore(
    subscribeWithIntents,
    snapshot,
    serverSnapshot,
  );

  const setFilters = useCallback((next: DiscoverFilters) => {
    publish(next);
    setNotice(null);
  }, []);
  const clear = useCallback(
    () => setFilters(NO_DISCOVER_FILTERS),
    [setFilters],
  );

  return { filters, setFilters, clear, notice };
}
