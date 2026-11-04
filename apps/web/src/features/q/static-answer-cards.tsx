"use client";

import { lazy, Suspense, useState } from "react";

import type { QAnswerCardsBlock } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { answerCardsOf } from "./answer-canvas-logic";
import {
  answerCardRef,
  closedHere,
  hideKey,
  isHiddenIn,
  restoreKeys,
  useCardsState,
} from "./cards/card-visibility";
import { useQSessionOptional } from "./q-session";
import { setKeyOf } from "./spotlight";
import { useSpotlight } from "./use-spotlight";
import { useT } from "@/features/i18n/language";

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
 *
 * D7 (N3): a card's X here is the same presentation controller and the
 * same key as on the Q stage (answerCardRef), so a card closed in one view
 * is closed in every view and stays closed across pages and a reload of
 * the tab; "Show again" brings this set's closed cards back everywhere.
 */
export function StaticAnswerCards({
  block,
  onAsk,
}: {
  readonly block: QAnswerCardsBlock;
  readonly onAsk?: ((question: string) => void) | undefined;
}) {
  const t = useT();
  const [focus, setFocus] = useState(-1);
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
  // The key AnswerCanvas hides by: the answer's id, else the set's title.
  const answerKey = answerId ?? block.title;
  const state = useCardsState();
  const hidden = block.cards
    .map((card) => answerCardRef(answerKey, card))
    .filter((ref) => isHiddenIn(state, ref))
    .map((ref) => ref.key);
  return (
    <div className="flex flex-col gap-2" data-q-static-cards>
      <Suspense fallback={null}>
        <AnswerCanvas
          answerKey={answerId ?? undefined}
          block={block}
          focus={focus}
          spotlight={spot.spotlight}
          onFocus={(index) => {
            setFocus((current) => (current === index ? -1 : index));
            spot.tap(index);
          }}
          onCloseCard={(cardKey) => {
            const card = block.cards.find((one) => one.key === cardKey);
            if (card !== undefined) hideKey(answerCardRef(answerKey, card).key);
          }}
          onAsk={onAsk}
          onFollowUp={onAsk}
        />
      </Suspense>
      {/* Only for cards the person closed in this conversation (owner
          2026-11-04: "Show again" on a page where nothing was closed). */}
      {hidden.length === 0 || !closedHere(state) ? null : (
        <div className="flex items-center gap-2" data-q-cards-closed>
          <span className="cq-caption text-(--cq-text-secondary)">
            {hidden.length === block.cards.length
              ? t(`${block.title} · closed`)
              : t(
                  `${String(hidden.length)} of ${String(block.cards.length)} cards closed`,
                )}
          </span>
          <button
            type="button"
            className={buttonClassName("quiet", "compact")}
            onClick={() => restoreKeys(hidden)}
            data-q-cards-show-again
          >
            {t("Show again")}
          </button>
        </div>
      )}
    </div>
  );
}
