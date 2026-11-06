"use client";

import { useSyncExternalStore } from "react";

/**
 * Requests to the one Q pane from elsewhere in the workspace (W1.2): a page's
 * "Ask Q about…" draft, `/home?ask=` and `/home?board=1`. The pane is mounted
 * once in the layout, so these arrive as requests rather than props.
 * A draft is only typed into the composer, never sent (CQ-WEB-024).
 */
export type QPaneDraft = { readonly id: number; readonly text: string };

let draft: QPaneDraft | null = null;
let board = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestQPaneDraft(text: string): void {
  draft = { id: (draft?.id ?? 0) + 1, text };
  emit();
}

export function requestQPaneBoard(): void {
  board += 1;
  emit();
}

export function useQPaneDraft(): QPaneDraft | null {
  return useSyncExternalStore(
    subscribe,
    () => draft,
    () => null,
  );
}

export function useQPaneBoardRequest(): number {
  return useSyncExternalStore(
    subscribe,
    () => board,
    () => 0,
  );
}

/** Puts the caret in the Q pane's composer (the panel's composer id). */
export function focusQPaneComposer(): void {
  window.requestAnimationFrame(() => {
    document.getElementById("home-q")?.focus();
  });
}
