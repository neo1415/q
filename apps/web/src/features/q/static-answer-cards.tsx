"use client";

import { lazy, Suspense, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

// W7: the cards (and their animation library) load with the first answer
// that carries them, not with the page.
const AnswerCanvas = lazy(() =>
  import("./answer-canvas").then((module) => ({
    default: module.AnswerCanvas,
  })),
);

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
    <Suspense fallback={null}>
      <AnswerCanvas
        block={block}
        focus={focus}
        dismissed={closed}
        onFocus={(index) =>
          setFocus((current) => (current === index ? -1 : index))
        }
        onCloseCard={(key) =>
          setClosed((current) => new Set([...current, key]))
        }
        onAsk={onAsk}
        onFollowUp={onAsk}
      />
    </Suspense>
  );
}
