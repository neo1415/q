"use client";

import { useMemo, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import type { QTurn } from "./conversation";
import { setKeyOf, spotlightOf } from "./spotlight";
import { tapSpotlight, useSpotlightTap } from "./spotlight-store";

/**
 * The spotlight for one card set on any surface (stage, Board, dock):
 * what the conversation after it points at, the person's taps, and, with
 * a live voice line, the card Q's own line names (`saidFocus`). The latest
 * of these wins. Returns the card in focus (null: level) and a tap.
 */
export function useSpotlight(input: {
  readonly block: QAnswerCardsBlock;
  readonly turns: readonly QTurn[];
  /** The answer that showed the set; null: not in this thread. */
  readonly answerId: string | null;
  /** Live voice: the card Q's latest line named, -1 for none. */
  readonly saidFocus?: number | undefined;
}): {
  readonly spotlight: number | null;
  readonly tap: (index: number) => void;
} {
  const setKey = setKeyOf(input.block);
  const tapped = useSpotlightTap(setKey);
  const derived = useMemo(
    () =>
      spotlightOf({
        turns: input.turns,
        answerId: input.answerId ?? "",
        cards: input.block.cards,
        tap: tapped,
      }),
    [input.turns, input.answerId, input.block.cards, tapped],
  );
  // Whichever moved last: what was said after the set (and taps), or the
  // card Q's live line named (state adjusted during render, as React asks).
  const saidFocus = input.saidFocus ?? -1;
  const [seen, setSeen] = useState({
    derived,
    saidFocus,
    value: derived,
  });
  if (seen.derived !== derived || seen.saidFocus !== saidFocus) {
    const value =
      seen.derived !== derived
        ? derived
        : saidFocus >= 0
          ? saidFocus
          : seen.value;
    setSeen({ derived, saidFocus, value });
  }
  const turnCount = input.turns.length;
  const current = seen.derived === derived ? seen.value : derived;
  return {
    spotlight: current,
    tap: (index) => {
      // The card in the spotlight tapped again: back to level.
      tapSpotlight(setKey, current === index ? -1 : index, turnCount);
    },
  };
}
