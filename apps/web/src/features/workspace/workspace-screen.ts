"use client";

import { useEffect, useId } from "react";

import { getWorkspaceLayout } from "./layout-store";

/**
 * What Q is told about the Q Workspace on every turn (screen.workspace,
 * W1/W3/W4): the panes, the page side's place, the page before Q's last
 * move, unsaved work on the page and whether the person is busy there.
 * Present only when the workspace shell is on screen. Hints for Q's
 * navigation policy, never authority (the server re-authorises everything).
 */
export type WorkspaceScreen = {
  readonly qPane: "open" | "collapsed";
  readonly pagePane: "open" | "collapsed";
  /** The page pane's current path (with its query). */
  readonly at?: string | undefined;
  /** The page before Q's last move (what Back returns to). */
  readonly previous?: string | undefined;
  /** The page has registered unsaved work (a leave guard applies). */
  readonly dirty?: true | undefined;
  /** The person typed, scrolled or pressed in the page pane in the last ~2 s. */
  readonly busy?: true | undefined;
};

/** How recent page-pane activity counts as "busy". */
export const BUSY_WINDOW_MS = 2000;

// --- The person's own moves (link presses, Back/Forward) -----------------

let lastOwnMove = Number.NEGATIVE_INFINITY;

export function noteOwnMove(at: number = Date.now()): void {
  lastOwnMove = at;
}

export function ownMoveJustNow(now: number = Date.now()): boolean {
  return now - lastOwnMove < BUSY_WINDOW_MS;
}

// --- The page before Q's last move ----------------------------------------

let previousBeforeQ: string | undefined;

/** A page change: when Q made it, the page it left is what Back means. */
export function notePageMove(from: string, own: boolean): void {
  if (!own) previousBeforeQ = from;
}

// --- Unsaved work: pages register it (W5 extends the registry) ------------

const dirtyPages = new Set<string>();

/**
 * A page (or a form on it) says it holds unsaved work. While any does, Q
 * is told so, and its navigation policy offers instead of moving.
 */
export function useDirty(dirty: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    dirtyPages.add(id);
    return () => {
      dirtyPages.delete(id);
    };
  }, [dirty, id]);
}

export function hasDirtyWork(): boolean {
  return dirtyPages.size > 0;
}

// --- Busy: the person's own input in the page pane ------------------------

let lastPageActivity = Number.NEGATIVE_INFINITY;

export function notePageActivity(at: number = Date.now()): void {
  lastPageActivity = at;
}

/**
 * Listens for the person's own input inside the page pane: typing,
 * pressing, wheel and touch scrolling. A programmatic scroll (Q's arrival)
 * is not input and does not count.
 */
export function watchPageActivity(pane: HTMLElement): () => void {
  const mark = () => notePageActivity();
  const events = ["keydown", "input", "pointerdown", "wheel", "touchmove"];
  for (const name of events) {
    pane.addEventListener(name, mark, { capture: true, passive: true });
  }
  return () => {
    for (const name of events) {
      pane.removeEventListener(name, mark, { capture: true });
    }
  };
}

/** The workspace's part of the screen, or undefined when it is not on. */
export function workspaceScreen(
  now: number = Date.now(),
): WorkspaceScreen | undefined {
  if (typeof document === "undefined") return undefined;
  if (document.querySelector(".cq-shell[data-workspace]") === null) {
    return undefined;
  }
  const layout = getWorkspaceLayout();
  const at = `${window.location.pathname}${window.location.search}`;
  return {
    qPane: layout.qPane,
    pagePane: layout.pagePane,
    at,
    ...(previousBeforeQ === undefined || previousBeforeQ === at
      ? {}
      : { previous: previousBeforeQ }),
    ...(hasDirtyWork() ? { dirty: true } : {}),
    ...(now - lastPageActivity < BUSY_WINDOW_MS ? { busy: true } : {}),
  };
}

/** Tests only. */
export function resetWorkspaceScreenForTests(): void {
  lastOwnMove = Number.NEGATIVE_INFINITY;
  previousBeforeQ = undefined;
  lastPageActivity = Number.NEGATIVE_INFINITY;
  dirtyPages.clear();
}
