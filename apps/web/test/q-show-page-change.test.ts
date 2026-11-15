import { describe, expect, it } from "vitest";

import { shownFromEarlierTurn } from "../src/features/q/control/q-show-modal";

/**
 * D21 (live 15 Nov 2026, conversation 2c0740db): step 3's fit cards ("By
 * Q") stayed open over /work after step 4 ("What's waiting for me?")
 * moved the page. A page change closes what an earlier answer showed.
 */
describe("a result dialog when the page changes (D21)", () => {
  const conversation = [
    { id: "user-3" },
    { id: "q-3-fit-cards" },
    { id: "user-4" },
    { id: "q-4-whats-waiting" },
  ];

  it("closes the fit cards of an earlier answer once a later turn moved the page", () => {
    expect(shownFromEarlierTurn({ key: "q-3-fit-cards" }, conversation)).toBe(
      true,
    );
  });

  it("keeps what the answer that moved the page shows", () => {
    expect(
      shownFromEarlierTurn({ key: "q-4-whats-waiting" }, conversation),
    ).toBe(false);
  });

  it("closes a dialog no answer in this conversation holds", () => {
    expect(shownFromEarlierTurn({ key: "choices:deck" }, conversation)).toBe(
      true,
    );
  });
});
