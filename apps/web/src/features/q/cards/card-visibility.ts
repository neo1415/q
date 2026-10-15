"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  EMPTY,
  cardsState,
  isHiddenIn,
  mountCards,
  mounted,
  mountedListeners,
  mountedVersionNow,
  noteSeen,
  subscribeCards,
  type CardRef,
  type CardsState,
} from "./card-visibility-store";

// The plain controller lives in card-visibility-store (no React), so the
// server-reachable client-actions module can import it; the hooks are here.
export * from "./card-visibility-store";

function useCardsVersion(): CardsState {
  return useSyncExternalStore(subscribeCards, cardsState, () => EMPTY);
}

/** The whole presentation state, for a surface that decides with it. */
export function useCardsState(): CardsState {
  return useCardsVersion();
}

/**
 * The cards of one family that this tab should draw. Every card is
 * registered (so "Show again" knows they exist), the hidden ones are left
 * out, and they take no layout space.
 */
export function useVisibleCards<T>(
  items: readonly T[],
  refOf: (item: T) => CardRef,
): readonly T[] {
  const current = useCardsVersion();
  const refs = items.map(refOf);
  const signature = refs.map((ref) => `${ref.category}:${ref.key}`).join("|");
  // First sight is recorded before the filter reads it.
  noteSeen(refs.map((ref) => ref.key));
  useEffect(
    () => mountCards(refs),
    // The refs are rebuilt each render; their identity is the signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  return items.filter((_, index) => {
    const ref = refs[index];
    return ref === undefined ? true : !isHiddenIn(current, ref);
  });
}

/** One card (or group): true when it should not be drawn. */
export function useCardHidden(card: CardRef): boolean {
  const names = card.names.join("|");
  const ref = useMemo(
    () => card,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card.category, card.key, names],
  );
  return useVisibleCards([ref], (one) => one).length === 0;
}

export type CardsSummary = {
  /** Cards on the page that are drawn. */
  readonly visible: number;
  /** Cards on the page that are hidden. */
  readonly hidden: number;
};

export function useCardsSummary(): CardsSummary {
  const current = useCardsVersion();
  const subscribe = useCallback((listener: () => void) => {
    mountedListeners.add(listener);
    return () => {
      mountedListeners.delete(listener);
    };
  }, []);
  useSyncExternalStore(subscribe, mountedVersionNow, () => 0);
  let visible = 0;
  let hidden = 0;
  for (const card of mounted.values()) {
    if (isHiddenIn(current, card)) hidden += 1;
    else visible += 1;
  }
  return { visible, hidden };
}
