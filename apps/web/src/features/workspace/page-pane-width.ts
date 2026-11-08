"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import { wideEnough } from "./q-pane-width";

/**
 * Batch 13: the workspace page pane's own width in pixels for pages
 * rendered in it; null anywhere else. A page's layout decision made in
 * code ("the dossier beside the pitch?") reads this instead of the
 * viewport, matching the CSS, which reads the pane as the `cq-page`
 * container (globals.css).
 */
export const PagePaneWidthContext = createContext<number | null>(null);

const subscribers = new Map<string, (onChange: () => void) => () => void>();
function subscribeTo(media: string): (onChange: () => void) => () => void {
  let subscribe = subscribers.get(media);
  if (subscribe === undefined) {
    subscribe = (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const query = window.matchMedia(media);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    };
    subscribers.set(media, subscribe);
  }
  return subscribe;
}

function useViewport(media: string, server: boolean): boolean {
  return useSyncExternalStore(
    subscribeTo(media),
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(media).matches
        : server,
    () => server,
  );
}

/**
 * Whether the page has at least `px`: the page pane's width inside the
 * workspace, else the viewport's (a media query). `server` is the answer
 * before hydration and where media queries are unavailable, as each page
 * chose it before.
 */
export function usePageAtLeast(px: number, server: boolean): boolean {
  const pane = useContext(PagePaneWidthContext);
  const viewport = useViewport(`(min-width: ${px}px)`, server);
  return wideEnough(pane, viewport, px);
}

/**
 * Whether the page is narrower than `px` (a phone's layout): the page
 * pane's width inside the workspace, else the viewport's own
 * `(max-width: px - 1)` query, as the page asked it before.
 */
export function usePageNarrowerThan(px: number, server: boolean): boolean {
  const pane = useContext(PagePaneWidthContext);
  const viewport = useViewport(`(max-width: ${px - 1}px)`, server);
  return pane === null ? viewport : pane < px;
}
