/**
 * Discover's two tabs, read from the URL. Kept apart from the tab store
 * (discover-tab.ts, which uses client-only React) so the server page can
 * read `?tab=` without importing a client module (deploy 80f63ff7 failed:
 * useSyncExternalStore pulled into a Server Component).
 */
export type DiscoverTab = "FOR_YOU" | "YOURS";

export function tabFromQuery(raw: string | undefined): DiscoverTab {
  return raw === "yours" ? "YOURS" : "FOR_YOU";
}
