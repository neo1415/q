// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CARDS_STORAGE_KEY,
  applyCardsIntent,
  cardsState,
  isCardHidden,
  resetCards,
  useVisibleCards,
  type CardRef,
} from "../src/features/q/cards/card-visibility";
import {
  cardsRequestOf,
  cardsIntentOf,
} from "@capital-q/q-specialists/cards-request";

const approval: CardRef = {
  category: "NEEDS_YOU",
  key: "needs:1",
  names: ["Halyard Security", "Reply to Halyard"],
};
const connection: CardRef = {
  category: "CONNECTION",
  key: "attention:2",
  names: ["Connection request from Orla"],
};
const source: CardRef = {
  category: "SOURCE",
  key: "source:3",
  names: ["sources"],
};
const tensor: CardRef = {
  category: "RECOMMENDATION",
  key: "match:4",
  names: ["TensorGate"],
};

function Cards({ items }: { readonly items: readonly CardRef[] }) {
  const shown = useVisibleCards(items, (card) => card);
  return (
    <ul>
      {shown.map((card) => (
        <li key={card.key} data-testid="card">
          {card.names[0]}
        </li>
      ))}
    </ul>
  );
}

const run = (intent: Parameters<typeof applyCardsIntent>[0]): void => {
  act(() => {
    applyCardsIntent(intent);
  });
};
const names = () => screen.queryAllByTestId("card").map((n) => n.textContent);

describe("card visibility controller", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.sessionStorage.clear();
    resetCards();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides all, then restores all; hidden cards are not rendered", () => {
    render(<Cards items={[approval, connection, source, tensor]} />);
    expect(names()).toHaveLength(4);
    run({ kind: "CARDS", action: "HIDE_ALL" });
    expect(names()).toEqual([]);
    expect(screen.queryByText("TensorGate")).toBeNull();
    run({ kind: "CARDS", action: "RESTORE_ALL" });
    expect(names()).toHaveLength(4);
  });

  it("a card that arrives after a clear is new and shows", () => {
    const { rerender } = render(<Cards items={[approval]} />);
    run({ kind: "CARDS", action: "HIDE_ALL" });
    rerender(<Cards items={[approval, tensor]} />);
    expect(names()).toEqual(["TensorGate"]);
  });

  it("hides and restores a category", () => {
    render(<Cards items={[approval, connection, tensor]} />);
    run({ kind: "CARDS", action: "HIDE_CATEGORY", category: "CONNECTION" });
    expect(names()).toEqual(["Halyard Security", "TensorGate"]);
    run({ kind: "CARDS", action: "RESTORE_ALL", category: "CONNECTION" });
    expect(names()).toHaveLength(3);
  });

  it("hides and restores one by name, including after a clear all", () => {
    render(<Cards items={[approval, tensor]} />);
    run({ kind: "CARDS", action: "HIDE_ONE", name: "tensorgate" });
    expect(names()).toEqual(["Halyard Security"]);
    run({ kind: "CARDS", action: "RESTORE_ONE", name: "TensorGate" });
    expect(names()).toHaveLength(2);
    run({ kind: "CARDS", action: "HIDE_ALL" });
    run({ kind: "CARDS", action: "RESTORE_ONE", name: "TensorGate" });
    expect(names()).toEqual(["TensorGate"]);
  });

  it("holds across navigation (remount) through sessionStorage", () => {
    const first = render(<Cards items={[approval, tensor]} />);
    run({ kind: "CARDS", action: "HIDE_ALL" });
    first.unmount();
    expect(window.sessionStorage.getItem(CARDS_STORAGE_KEY)).not.toBeNull();
    render(<Cards items={[approval, tensor]} />);
    expect(names()).toEqual([]);
    expect(isCardHidden(approval)).toBe(true);
  });

  it("works with storage unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Cards items={[approval]} />);
    run({ kind: "CARDS", action: "HIDE_ALL" });
    expect(names()).toEqual([]);
    vi.restoreAllMocks();
  });

  it("calls no business API: no fetch for any action, spoken or clicked", () => {
    render(<Cards items={[approval, connection, tensor]} />);
    for (const said of [
      "clear all cards",
      "hide the connection cards",
      "hide the TensorGate card",
      "show me the cards again",
    ]) {
      const request = cardsRequestOf(said);
      expect(request).not.toBeNull();
      if (request !== null) run(cardsIntentOf(request));
    }
    run({ kind: "CARDS", action: "HIDE_ALL" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cardsState().clearedAt).not.toBeNull();
  });

  it("the same words heard twice act once", () => {
    render(<Cards items={[approval]} />);
    run({ kind: "CARDS", action: "HIDE_ALL" });
    const at = cardsState().clearedAt;
    run({ kind: "CARDS", action: "HIDE_ALL" });
    expect(cardsState().clearedAt).toBe(at);
  });
});
