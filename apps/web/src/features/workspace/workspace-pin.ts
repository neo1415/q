"use client";

import { useSyncExternalStore } from "react";

/**
 * Pinned workspace (owner addendum, 13 Nov 2026): the person pins the page
 * pane so Q's automatic navigation never moves away from a page they are
 * reviewing. One flag for this tab, kept in sessionStorage so it survives
 * a reload of the tab and ends with it -- no database, no account setting
 * (the pane layout's own store is per browser; a pin is per sitting).
 *
 * What reads it:
 * - workspace-screen.ts tells Q (screen.workspace.pinned): the server's
 *   navigation decision then offers instead of moving (its PINNED hold),
 *   and an explicit "take me there" becomes "Unpin and open <place>".
 * - client-actions.ts (answerMove) and the fast path (fast-navigation.ts)
 *   hold Q's own moves in this browser too, so an older server, a voice
 *   board or a fast read never changes the visible page behind a pin.
 *
 * The person's own moves (a link, a nav item, "Open" on an offer, Back)
 * are never held and never unpin: a pin is about Q, not about them. Only
 * the pin control and an offer's "Unpin and open" unpin.
 */
export const PIN_STORAGE_KEY = "cq.ws.pinned";

let pinnedHere: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (pinnedHere !== null) return pinnedHere;
  try {
    pinnedHere = window.sessionStorage.getItem(PIN_STORAGE_KEY) === "1";
  } catch {
    pinnedHere = false;
  }
  return pinnedHere;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the person pinned the workspace in this tab. */
export function workspacePinned(): boolean {
  if (typeof window === "undefined") return false;
  return read();
}

export function setWorkspacePinned(pinned: boolean): void {
  pinnedHere = pinned;
  try {
    if (pinned) window.sessionStorage.setItem(PIN_STORAGE_KEY, "1");
    else window.sessionStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // Storage refused (private mode): the pin still holds for this page.
  }
  for (const listener of [...listeners]) listener();
}

/**
 * Whether Q's own moves are held right now: pinned, and the Q Workspace
 * shell is on screen (without it there is no adjacent pane to pin).
 */
export function pinHoldsMoves(): boolean {
  if (typeof document === "undefined") return false;
  return (
    workspacePinned() &&
    document.querySelector(".cq-shell[data-workspace]") !== null
  );
}

export function useWorkspacePinned(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Tests only: forget the in-memory value (storage is read again). */
export function resetWorkspacePinForTests(): void {
  pinnedHere = null;
  for (const listener of [...listeners]) listener();
}
