"use client";

import { Button } from "@capital-q/ui/button";

import { applyCardsIntent, useCardsSummary } from "./card-visibility";

/**
 * Founder P5: the click twin of "Q, clear all cards" and "show me the
 * cards again". Both call the same controller the voice does. Clearing
 * only hides cards on this screen; nothing is approved or removed, and
 * Needs You items stay in Work. Nothing renders when there is nothing to
 * clear or restore, so it takes no space on a quiet page.
 */
export function CardsControls() {
  const { visible, hidden } = useCardsSummary();
  if (visible < 2 && hidden === 0) return null;
  return (
    <div
      className="flex min-h-11 w-full items-center justify-end gap-2"
      role="group"
      aria-label="Cards on this screen"
      data-q-cards-controls
    >
      {visible >= 2 ? (
        <Button
          variant="quiet"
          onClick={() =>
            applyCardsIntent({ kind: "CARDS", action: "HIDE_ALL" })
          }
          data-q-cards-clear
        >
          Clear
        </Button>
      ) : null}
      {hidden > 0 ? (
        <Button
          variant="quiet"
          onClick={() =>
            applyCardsIntent({ kind: "CARDS", action: "RESTORE_ALL" })
          }
          data-q-cards-show
        >
          Show again
        </Button>
      ) : null}
    </div>
  );
}
