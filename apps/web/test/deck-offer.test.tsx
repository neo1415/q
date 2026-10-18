// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DECK_OFFER_LINE,
  DeckOffer,
  deckOfferShown,
  readDeckOffer,
  takeAcceptedDeckOffer,
} from "../src/features/onboarding-conversation/deck-offer";

/**
 * Q room W5 (R8): after a founder's first upload is read, Q offers to
 * draft the deck; skip is a full answer, nothing blocks, and a yes is
 * asked of Q once, after setup.
 */

afterEach(() => {
  window.localStorage.clear();
});

describe("the onboarding deck offer", () => {
  it("is offered only to a founder whose upload Q has read, and only until answered", () => {
    expect(
      deckOfferShown({ founder: true, readingLanded: true, answer: null }),
    ).toBe(true);
    expect(
      deckOfferShown({ founder: false, readingLanded: true, answer: null }),
    ).toBe(false);
    expect(
      deckOfferShown({ founder: true, readingLanded: false, answer: null }),
    ).toBe(false);
    expect(
      deckOfferShown({
        founder: true,
        readingLanded: true,
        answer: "DECLINED",
      }),
    ).toBe(false);
  });

  it("yes is remembered and asked of Q exactly once", () => {
    render(<DeckOffer founder readingLanded />);
    expect(screen.getByText(DECK_OFFER_LINE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, draft it" }));
    expect(screen.getByText(/as soon as your setup is done/u)).toBeTruthy();
    expect(readDeckOffer()).toBe("ACCEPTED");
    expect(takeAcceptedDeckOffer()).toBe(true);
    expect(takeAcceptedDeckOffer()).toBe(false);
  });

  it("not now is a full answer: never offered again, never asked", () => {
    const { unmount } = render(<DeckOffer founder readingLanded />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    unmount();
    render(<DeckOffer founder readingLanded />);
    expect(screen.queryByText(DECK_OFFER_LINE)).toBeNull();
    expect(takeAcceptedDeckOffer()).toBe(false);
  });
});
