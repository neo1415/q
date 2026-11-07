"use client";

import { createContext, useContext } from "react";

/**
 * The Q pane's own width in pixels while Q is in the Workspace pane; null
 * anywhere else (R7). Layout decisions made in code ("room for cards beside
 * Q?") read this instead of the viewport, which on a wide screen says
 * "wide" for a 380 px pane.
 */
export const QPaneWidthContext = createContext<number | null>(null);

export function useQPaneWidth(): number | null {
  return useContext(QPaneWidthContext);
}

/** At least `px` wide: the pane's width inside the pane, else the viewport's answer. */
export function wideEnough(
  paneWidth: number | null,
  viewportWide: boolean,
  px: number,
): boolean {
  return paneWidth === null ? viewportWide : paneWidth >= px;
}
