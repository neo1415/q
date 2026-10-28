"use client";

import type { ReactNode } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { AnswerCanvas } from "./answer-canvas";
import { hideKey, useCardsState } from "./cards/card-visibility";
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
  exchangeId,
  live,
  presence,
  onCloseAll,
  onAsk,
  onPin,
  turns = [],
  quiet = false,
}: {
  /** The full exchange is already on the stage (captions): no line over the cards. */
  readonly quiet?: boolean | undefined;
  /** The conversation, for the spotlight (what is said after the set). */
  readonly turns?: readonly QTurn[] | undefined;
  readonly answerId: string;
  readonly block: QAnswerCardsBlock;
  readonly asked: string | undefined;
  readonly closing: string;
  /** The exchange whose line is over the cards (a later one for a kept set). */
  readonly exchangeId?: string | undefined;
  readonly live: boolean;
  readonly presence: ReactNode;
  readonly onCloseAll: () => void;
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onPin?: (() => void) | undefined;
}) {
  const playback = useAnswerPlayback(
    block,
    answerId,
    closing,
    live,
    exchangeId ?? answerId,
  );
  // The spotlight: the card the conversation is about, large; on a live
  // line, also the card Q's own line names (not the timed walk-through).
  const spot = useSpotlight({
    block,
    turns,
    answerId,
    saidFocus: live ? playback.focus : -1,
  });
  // Lane A: a card's X is kept by the one presentation controller, so a
  // closed card stays closed on the way back from another page.
  const { keys } = useCardsState();
  const prefix = `card:${answerId}:`;
  const closed: ReadonlySet<string> = new Set(
    keys
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  );
  const closeCard = (key: string) => {
    const next = new Set([...closed, key]);
    // The last card closed closes the answer.
    if (block.cards.every((card) => next.has(card.key))) onCloseAll();
    else hideKey(`${prefix}${key}`);
  };
  return (
    <div className="w-full" data-q-canvas={answerId}>
      <AnswerCanvas
        answerKey={answerId}
        block={block}
        asked={asked}
        said={playback.said}
        quietLine={quiet}
        focus={playback.focus}
        walking={playback.walking}
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
