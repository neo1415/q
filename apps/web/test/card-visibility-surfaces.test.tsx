// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnswerCanvas } from "../src/features/q/answer-canvas";
import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import {
  applyCardsIntent,
  resetCards,
} from "../src/features/q/cards/card-visibility";
import { CardsControls } from "../src/features/q/cards/cards-controls";

/** Founder P5: hidden cards are not rendered and take no space. */
describe("clearing the answer cards", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetCards();
  });
  afterEach(cleanup);

  it("renders no section at all when every card is cleared, and brings them back", () => {
    const block = demoTop(3);
    const { container } = render(
      <>
        <AnswerCanvas block={block} focus={-1} said="Here." />
        <CardsControls />
      </>,
    );
    expect(container.querySelectorAll("[data-ac-card]").length).toBe(3);
    expect(container.querySelector("[data-q-cards-clear]")).not.toBeNull();

    act(() => {
      applyCardsIntent({ kind: "CARDS", action: "HIDE_ALL" });
    });
    expect(container.querySelector("[data-ac]")).toBeNull();
    expect(container.querySelectorAll("[data-ac-card]").length).toBe(0);
    expect(container.querySelector("[data-q-cards-clear]")).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>("[data-q-cards-show]")
        ?.click();
    });
    expect(container.querySelectorAll("[data-ac-card]").length).toBe(3);
  });

  it("hides one card by its name and leaves the rest", () => {
    const block = demoTop(3);
    const first = block.cards[0]?.name ?? "";
    const { container } = render(
      <AnswerCanvas block={block} focus={-1} said="Here." />,
    );
    act(() => {
      applyCardsIntent({ kind: "CARDS", action: "HIDE_ONE", name: first });
    });
    expect(container.querySelectorAll("[data-ac-card]").length).toBe(2);
    expect(container.textContent).not.toContain(first);
  });
});
