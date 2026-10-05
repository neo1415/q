"use client";

import { useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { AnswerCanvas } from "./answer-canvas";

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
  return (
    <AnswerCanvas
      block={block}
      focus={focus}
      dismissed={closed}
      onFocus={(index) => setFocus((current) => (current === index ? -1 : index))}
      onCloseCard={(key) => setClosed((current) => new Set([...current, key]))}
      onAsk={onAsk}
      onFollowUp={onAsk}
    />
  );
}
