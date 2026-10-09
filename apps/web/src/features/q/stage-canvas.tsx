"use client";

import { useState, type ReactNode } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { AnswerCanvas } from "./answer-canvas";
import type { QTurn } from "./conversation";
import { useAnswerPlayback } from "./use-answer-playback";
import { useSpotlight } from "./use-spotlight";

/**
 * Q room W7: its own module, loaded when an answer's cards first come on
 * the stage, so the stage's first paint carries neither the cards nor
 * their animation library.
 */

/** The answer on the stage, walked through card by card (C1-C3). */
export function StageCanvas({
  answerId,
  block,
  asked,
  closing,
  live,
  presence,
  onCloseAll,
  onAsk,
  onPin,
  turns = [],
}: {
  /** The conversation, for the spotlight (what is said after the set). */
  readonly turns?: readonly QTurn[] | undefined;
  readonly answerId: string;
  readonly block: QAnswerCardsBlock;
  readonly asked: string | undefined;
  readonly closing: string;
  readonly live: boolean;
  readonly presence: ReactNode;
  readonly onCloseAll: () => void;
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onPin?: (() => void) | undefined;
}) {
  const playback = useAnswerPlayback(block, answerId, closing, live);
  // The spotlight: the card the conversation is about, large; on a live
  // line, also the card Q's own line names (not the timed walk-through).
  const spot = useSpotlight({
    block,
    turns,
    answerId,
    saidFocus: live ? playback.focus : -1,
  });
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const closeCard = (key: string) => {
    const next = new Set([...closed, key]);
    // The last card closed closes the answer.
    if (block.cards.every((card) => next.has(card.key))) onCloseAll();
    else setClosed(next);
  };
  return (
    <div className="w-full" data-q-canvas={answerId}>
      <AnswerCanvas
        block={block}
        asked={asked}
        said={playback.said}
        focus={playback.focus}
        presence={presence}
        dismissed={closed}
        spotlight={spot.spotlight}
        onFocus={(index) => {
          playback.choose(index);
          spot.tap(index);
        }}
        onCloseCard={closeCard}
        onCloseAll={onCloseAll}
        onFollowUp={onAsk}
        onAsk={onAsk}
        onPin={onPin === undefined ? undefined : () => onPin()}
      />
    </div>
  );
}
