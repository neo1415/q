"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";
import { useT } from "@/features/i18n/language";
import {
  approveQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";

import type { DeckFigureCard } from "./upload-lines";

/**
 * Live founder run 2026-11-15 (D1): the page-cited figures Q read from the
 * deck were offered only after setup, in Work. They are offered here, in
 * the onboarding conversation, as the same cards: Keep approves exactly
 * that card (it becomes the founder's claim, supported by the document);
 * Not this records nothing. The server owns each card's payload.
 */
export function DeckFigureCards({
  cards,
}: {
  readonly cards: readonly DeckFigureCard[];
}) {
  const t = useT();
  const [decided, setDecided] = useState<
    Readonly<Record<string, "KEPT" | "DROPPED" | "FAILED" | "SENDING">>
  >({});
  if (cards.length === 0) return null;
  const decide = async (approvalId: string, keep: boolean) => {
    setDecided((now) => ({ ...now, [approvalId]: "SENDING" }));
    const done = keep
      ? await approveQApprovalAction(approvalId)
      : await rejectQApprovalAction(approvalId);
    setDecided((now) => ({
      ...now,
      [approvalId]: done.ok ? (keep ? "KEPT" : "DROPPED") : "FAILED",
    }));
  };
  return (
    <li
      data-turn="deck-figures"
      data-deck-figures
      className="flex flex-col gap-2"
      aria-label={t("Figures Q read from your deck")}
    >
      <span className="cq-label text-(--cq-text-secondary)">
        {t("Figures Q read from your deck")}
      </span>
      <ul className="flex flex-col gap-2">
        {cards.map((card) => {
          const state = decided[card.approvalId];
          return (
            <li
              key={card.approvalId}
              className="flex flex-wrap items-center justify-between gap-2"
              data-deck-figure={card.approvalId}
            >
              <span className="cq-body text-(--cq-text-primary)">
                {card.summary}
              </span>
              {state === "KEPT" || state === "DROPPED" ? (
                <span className="cq-caption text-(--cq-text-secondary)">
                  {state === "KEPT" ? t("Kept") : t("Not kept")}
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {state === "FAILED" ? (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {t("That didn't go through. Try again.")}
                    </span>
                  ) : null}
                  <Button
                    size="compact"
                    disabled={state === "SENDING"}
                    onClick={() => void decide(card.approvalId, true)}
                  >
                    {t("Keep")}
                  </Button>
                  <Button
                    size="compact"
                    variant="quiet"
                    disabled={state === "SENDING"}
                    onClick={() => void decide(card.approvalId, false)}
                  >
                    {t("Not this")}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
