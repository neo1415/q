import { useSyncExternalStore } from "react";

import type { QShowInQRoomIntent } from "@capital-q/contracts";

import type { QTurnObjectBlock } from "../conversation";

/**
 * Lane 7 (owner 2026-10-21): what Q shows the person on whatever page they
 * are on -- a card, a comparison, a summary -- in one closable modal, so
 * they never have to go to the Q page to see it. One item at a time; the
 * newest replaces the last. Presentation only: what it holds is the
 * answer's own blocks, which every card authorises again as it reads.
 */
export type Shown = {
  /** The answer it came from: the same answer is never shown twice. */
  readonly key: string;
  readonly title: string;
  /** The answer's own words, shown above its cards. */
  readonly text: string;
  readonly blocks: readonly QTurnObjectBlock[];
  /** A card Q brought up (the Q room's own card surface, read as them). */
  readonly room?: QShowInQRoomIntent | undefined;
};

let shown: Shown | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showInModal(next: Shown): void {
  shown = next;
  emit();
}

/** Closes what is shown; false when nothing was. */
export function closeShown(): boolean {
  if (shown === null) return false;
  shown = null;
  emit();
  return true;
}

export function shownNow(): Shown | null {
  return shown;
}

export function useShown(): Shown | null {
  return useSyncExternalStore(
    subscribe,
    () => shown,
    () => null,
  );
}
