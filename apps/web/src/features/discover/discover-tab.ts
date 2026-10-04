import { useSyncExternalStore } from "react";

/**
 * Which of Discover's two tabs is showing (follow-55): "For you", the
 * recommended feed, or "Your companies", the investor's own companies.
 * Both feeds stay mounted once opened, so switching is instant and each
 * keeps its place; the one not showing holds its player (one active
 * player per page) and stops declaring Q's subject.
 */
export type DiscoverTab = "FOR_YOU" | "YOURS";

let current: DiscoverTab = "FOR_YOU";
const listeners = new Set<() => void>();

export function setDiscoverTab(next: DiscoverTab): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function discoverTab(): DiscoverTab {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The tab showing. `serverTab` is what the server rendered (the linked
 * tab), used while hydrating so the markup matches.
 */
export function useDiscoverTab(
  serverTab: DiscoverTab = "FOR_YOU",
): DiscoverTab {
  return useSyncExternalStore(subscribe, discoverTab, () => serverTab);
}

/** The query value each tab is linked by: `/discover?tab=yours`. */
export function tabFromQuery(raw: string | undefined): DiscoverTab {
  return raw === "yours" ? "YOURS" : "FOR_YOU";
}
