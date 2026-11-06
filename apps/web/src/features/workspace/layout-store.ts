"use client";

import { useSyncExternalStore } from "react";

import {
  applyLayoutSet,
  clampWidth,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  parseLayout,
  settle,
  type PaneState,
  type WorkspaceLayout,
} from "./layout-rules";

/**
 * The one store of the workspace's pane layout, per browser (W1.3/W1.4).
 * The person's drag and buttons and Q's `LAYOUT_SET` all write here; the
 * panes read it through `<html>` attributes, so CSS lays them out.
 */
let current: WorkspaceLayout | null = null;
const listeners = new Set<() => void>();

function read(): WorkspaceLayout {
  if (current !== null) return current;
  try {
    current = parseLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    current = DEFAULT_LAYOUT;
  }
  return current;
}

function paint(layout: WorkspaceLayout): void {
  const root = document.documentElement;
  root.style.setProperty("--cq-ws-q-width", `${layout.qWidth}px`);
  if (layout.qPane === "collapsed")
    root.setAttribute("data-cq-ws-q", "collapsed");
  else root.removeAttribute("data-cq-ws-q");
  if (layout.pagePane === "collapsed")
    root.setAttribute("data-cq-ws-page", "collapsed");
  else root.removeAttribute("data-cq-ws-page");
}

function write(next: WorkspaceLayout): void {
  current = next;
  paint(next);
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage refused (private mode): the layout still holds for this tab.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceLayout(): WorkspaceLayout {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_LAYOUT);
}

export function getWorkspaceLayout(): WorkspaceLayout {
  return read();
}

export function setQWidth(width: number): void {
  const layout = read();
  const qWidth = clampWidth(width);
  if (qWidth === layout.qWidth) return;
  write({ ...layout, qWidth });
}

export function setPane(pane: "qPane" | "pagePane", state: PaneState): void {
  write(settle({ ...read(), [pane]: state }, pane));
}

/** Q's `LAYOUT_SET` (W1.5). */
export function setLayout(set: {
  readonly qPane?: PaneState | undefined;
  readonly pagePane?: PaneState | undefined;
}): WorkspaceLayout {
  const next = applyLayoutSet(read(), {
    ...(set.qPane === undefined ? {} : { qPane: set.qPane }),
    ...(set.pagePane === undefined ? {} : { pagePane: set.pagePane }),
  });
  write(next);
  return next;
}

/** Tests only. */
export function resetWorkspaceLayoutForTests(): void {
  current = null;
}
