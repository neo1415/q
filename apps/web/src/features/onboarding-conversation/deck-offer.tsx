"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";

/**
 * Q room W5 (R8): the onboarding offer. After a founder's first upload has
 * been read into intelligence, Q offers to draft their pitch deck from it.
 * Never blocking: the offer sits under what Q picked up, setup carries on
 * whatever they answer, and Skip is a full answer. A yes is remembered on
 * this device and asked of Q, as them, once setup is done (Q cannot make
 * a deck from a record that is not set up yet); a no is never asked again.
 */

export const DECK_OFFER_LINE = "Want me to draft your pitch deck from this?";
export const DECK_OFFER_QUESTION = "Draft my pitch deck from what I uploaded.";
const KEY = "cq.onboarding.deck-offer";

export type DeckOfferAnswer = "ACCEPTED" | "DECLINED" | "ASKED";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDeckOffer(): DeckOfferAnswer | null {
  try {
    const value = storage()?.getItem(KEY) ?? null;
    return value === "ACCEPTED" || value === "DECLINED" || value === "ASKED"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function answerDeckOffer(answer: DeckOfferAnswer): void {
  try {
    storage()?.setItem(KEY, answer);
  } catch {
    // A private window: the offer is simply made again next time.
  }
}

/** True once, after a yes: the caller asks Q for the deck now. */
export function takeAcceptedDeckOffer(): boolean {
  if (readDeckOffer() !== "ACCEPTED") return false;
  answerDeckOffer("ASKED");
  return readDeckOffer() === "ASKED";
}

/** Whether to offer: a founder, whose upload Q has just read, not yet asked. */
export function deckOfferShown(input: {
  readonly founder: boolean;
  readonly readingLanded: boolean;
  readonly answer: DeckOfferAnswer | null;
}): boolean {
  return input.founder && input.readingLanded && input.answer === null;
}

export function DeckOffer({
  founder,
  readingLanded,
}: {
  readonly founder: boolean;
  readonly readingLanded: boolean;
}) {
  const [answer, setAnswer] = useState<DeckOfferAnswer | null>(() =>
    readDeckOffer(),
  );
  const [said, setSaid] = useState<string | null>(null);
  if (said !== null) {
    return (
      <li data-turn="deck-offer" className="cq-body text-(--cq-text-secondary)">
        {said}
      </li>
    );
  }
  if (!deckOfferShown({ founder, readingLanded, answer })) return null;
  const choose = (next: "ACCEPTED" | "DECLINED") => {
    answerDeckOffer(next);
    setAnswer(next);
    setSaid(
      next === "ACCEPTED"
        ? "I'll draft it as soon as your setup is done; it opens in the Q room. Anything I can't source stays a marked space for you to fill."
        : "No problem. Ask me any time.",
    );
  };
  return (
    <li data-turn="deck-offer" className="flex flex-col gap-2" data-deck-offer>
      <p className="cq-body text-(--cq-text-primary)">{DECK_OFFER_LINE}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="compact" onClick={() => choose("ACCEPTED")}>
          Yes, draft it
        </Button>
        <Button
          size="compact"
          variant="quiet"
          onClick={() => choose("DECLINED")}
        >
          Not now
        </Button>
      </div>
    </li>
  );
}
