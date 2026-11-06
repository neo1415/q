// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnswerCanvas } from "../src/features/q/answer-canvas";
import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import {
  applyCardsIntent,
  resetCards,
  setCardsConversation,
} from "../src/features/q/cards/card-visibility";
import { useCardsMenu } from "../src/features/q/cards/cards-controls";
import { QMoreMenu } from "../src/features/q/q-more-menu";

/** The Q home's More menu, where clearing the cards lives (owner 2026-11-06). */
function More() {
  return (
    <QMoreMenu
      voice="FEMALE"
      onChooseVoice={() => undefined}
      readAloud={false}
      onReadAloud={() => undefined}
      cards={useCardsMenu()}
    />
  );
}

/** Founder P5: hidden cards are not rendered and take no space. */
describe("clearing the answer cards", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetCards();
  });
  afterEach(cleanup);

  it("renders no section at all when every card is cleared, and brings them back", async () => {
    const user = userEvent.setup();
    const block = demoTop(3);
    // Inside a conversation, as on the page: Show again is offered there.
    setCardsConversation("conversation-1");
    const { container } = render(
      <>
        <AnswerCanvas block={block} focus={-1} said="Here." />
        <More />
      </>,
    );
    expect(container.querySelectorAll("[data-ac-card]").length).toBe(3);
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      await screen.findByRole("menuitem", { name: "Clear the cards" }),
    ).not.toBeNull();
    await user.keyboard("{Escape}");

    act(() => {
      applyCardsIntent({ kind: "CARDS", action: "HIDE_ALL" });
    });
    expect(container.querySelector("[data-ac]")).toBeNull();
    expect(container.querySelectorAll("[data-ac-card]").length).toBe(0);
    await user.click(screen.getByRole("button", { name: "More" }));
    await screen.findByRole("menu");
    expect(
      screen.queryByRole("menuitem", { name: "Clear the cards" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("menuitem", { name: "Show the cards again" }),
    );
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
