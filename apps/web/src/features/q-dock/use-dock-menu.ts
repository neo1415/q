"use client";

import { useSyncExternalStore } from "react";

import {
  applyMove,
  DEFAULT_PLACEMENT,
  readPlacement,
  storeHidden,
  storePlacement,
  subscribePlacement,
  type DockClass,
  type DockMove,
} from "./dock-placement";

function subscribeWide(onChange: () => void): () => void {
  const query = window.matchMedia("(min-width: 1024px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useDockClass(): DockClass {
  return useSyncExternalStore(
    subscribeWide,
    () =>
      window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile",
    () => "mobile",
  );
}

export type DockMenuItem = {
  readonly label: string;
  readonly run: () => void;
};

/**
 * Every move a drag can make, as menu items (WCAG 2.5.7): the dock's own
 * context menu and the panel's "Move Q" offer the same list.
 */
export function useDockMenu(): { readonly items: readonly DockMenuItem[] } {
  const dockClass = useDockClass();
  const placement = useSyncExternalStore(
    subscribePlacement,
    () => readPlacement(dockClass),
    () => DEFAULT_PLACEMENT,
  );
  const move = (action: DockMove) => {
    storePlacement(dockClass, applyMove(placement, action, dockClass));
  };
  const items: DockMenuItem[] = [
    { label: "Move to top", run: () => move({ kind: "slot", slot: "top" }) },
  ];
  if (dockClass === "desktop") {
    items.push({
      label: "Move to middle",
      run: () => move({ kind: "slot", slot: "middle" }),
    });
  }
  items.push(
    {
      label: "Move to bottom",
      run: () => move({ kind: "slot", slot: "bottom" }),
    },
    {
      label: "Move to the other side",
      run: () => move({ kind: "other-side" }),
    },
    { label: "Reset position", run: () => move({ kind: "reset" }) },
    { label: "Hide until next visit", run: () => storeHidden(true) },
  );
  return { items };
}
