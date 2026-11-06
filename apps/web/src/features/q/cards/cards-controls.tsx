"use client";

import {
  applyCardsIntent,
  closedHere,
  useCardsState,
  useCardsSummary,
} from "./card-visibility";

/** What the Q home's More menu offers for the cards on this screen. */
export type CardsMenu = {
  /** Clear the cards on this screen, or null when there is nothing to clear. */
  readonly clear: (() => void) | null;
  /** Bring back the cards closed here, or null when none were. */
  readonly restore: (() => void) | null;
};

const clearAll = () => applyCardsIntent({ kind: "CARDS", action: "HIDE_ALL" });
const restoreAll = () =>
  applyCardsIntent({ kind: "CARDS", action: "RESTORE_ALL" });

/**
 * Founder P5: the click twin of "Q, clear all cards" and "show me the
 * cards again". Both call the same controller the voice does. Clearing
 * only hides cards on this screen; nothing is approved or removed, and
 * Needs You items stay in Work. Owner 2026-11-06 (Q home like ChatGPT):
 * these live in the header's More menu, not as a floating "Clear" in the
 * thread; each is offered only when it would do something.
 */
export function useCardsMenu(): CardsMenu {
  const summary = useCardsSummary();
  const state = useCardsState();
  // Owner 2026-11-04: "Show again" only after the person closed cards in
  // this conversation, never on a fresh one or for Q's own replacements.
  const hidden = closedHere(state) ? summary.hidden : 0;
  return {
    clear: summary.visible >= 2 ? clearAll : null,
    restore: hidden > 0 ? restoreAll : null,
  };
}
