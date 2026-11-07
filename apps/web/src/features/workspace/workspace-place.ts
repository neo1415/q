"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { useWorkspaceMode } from "./workspace-context";
import { useWorkspaceLayout } from "./layout-store";

/**
 * Whether the page pane already shows the place a link names (W1 batch 6,
 * live: after Q moved the page, its reply still offered "Open <page>").
 *
 * - "SHOWN": the page pane is open on that place; the link is redundant.
 * - "COLLAPSED": that place is in the page pane, but the pane is folded;
 *   the useful action is to show it, not to navigate.
 * - "ELSEWHERE": a different place, or not the workspace (today's card).
 *
 * The same place: the same path, and every query value the link names is
 * the one on screen (the link may name a tab the page is not on).
 */
export type WorkspacePlace = "SHOWN" | "COLLAPSED" | "ELSEWHERE";

export function samePlace(
  href: string,
  pathname: string,
  search: URLSearchParams,
): boolean {
  let target: URL;
  try {
    target = new URL(href, "https://capital-q.invalid");
  } catch {
    return false;
  }
  if (target.origin !== "https://capital-q.invalid") return false;
  const trim = (path: string) =>
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (trim(target.pathname) !== trim(pathname)) return false;
  for (const [key, value] of target.searchParams) {
    if (search.get(key) !== value) return false;
  }
  return true;
}

// The query on screen, read as each render happens (a navigation changes
// the pathname, which re-renders the reader); "" on the server and while
// hydrating, so nothing here can mismatch.
const subscribeLocation = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

export function useWorkspacePlace(href: string | null): WorkspacePlace {
  const mode = useWorkspaceMode();
  const pathname = usePathname();
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const layout = useWorkspaceLayout();
  if (!mode.enabled || href === null) return "ELSEWHERE";
  if (!samePlace(href, pathname ?? "", new URLSearchParams(search))) {
    return "ELSEWHERE";
  }
  return layout.pagePane === "collapsed" ? "COLLAPSED" : "SHOWN";
}
