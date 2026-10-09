"use client";

import { lazy, Suspense, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { answerCardsOf } from "./answer-canvas-logic";
import { useQSessionOptional } from "./q-session";
import { setKeyOf } from "./spotlight";
import { useSpotlight } from "./use-spotlight";

// W7: the cards (and their animation library) load with the first answer
// that carries them, not with the page.
const AnswerCanvas = lazy(() =>
  import("./answer-canvas").then((module) => ({
    default: module.AnswerCanvas,
  })),
);

const NO_TURNS: readonly never[] = [];

/**
 * Answer cards outside the stage (Chat view, the dock's panel): no
 * walk-through, the person opens the card they want.
 */
export function StaticAnswerCards({
  block,
  onAsk,
}: {
  readonly block: QAnswerCardsBlock;
  readonly onAsk?: ((question: string) => void) | undefined;
}) {
  const [focus, setFocus] = useState(-1);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  // The same spotlight as the stage (Board, dock): this set's answer in
  // the session's thread, what was said after it, and the person's taps.
  const turns = useQSessionOptional()?.turns ?? NO_TURNS;
  const key = setKeyOf(block);
  const answerId =
    turns.find((turn) => {
      const cards = answerCardsOf(turn);
      return cards !== null && setKeyOf(cards) === key;
    })?.id ?? null;
  const spot = useSpotlight({ block, turns, answerId });
  return (
    <Suspense fallback={null}>
      <AnswerCanvas
        block={block}
        focus={focus}
        spotlight={spot.spotlight}
        dismissed={closed}
        onFocus={(index) => {
          setFocus((current) => (current === index ? -1 : index));
          spot.tap(index);
        }}
        onCloseCard={(key) =>
          setClosed((current) => new Set([...current, key]))
        }
        onAsk={onAsk}
        onFollowUp={onAsk}
      />
    </Suspense>
  );
}
