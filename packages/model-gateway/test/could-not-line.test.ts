import { describe, expect, it } from "vitest";

import {
  DRAFT_NOT_ON_CARD_LINE,
  explainsNothingDone,
  shownFindingsLine,
} from "../src/q/index.js";

/**
 * Guard run 1 (2026-10-25): "I didn't prepare that…" followed answers that
 * had already said why (savanna-seed, "Book a call with Mizan") or had
 * written the draft (maji-loop, run b6f9236c).
 */
describe("the could-not line never contradicts the answer", () => {
  it("takes 'not connected yet, the next step is…' as the answer's own account", () => {
    expect(
      explainsNothingDone(
        "Mizan isn't connected with you yet, so the next step is to express interest.",
      ),
    ).toBe(true);
    expect(explainsNothingDone("You'd first need to connect with them.")).toBe(
      true,
    );
    expect(explainsNothingDone("Ajopot builds payments rails for SMEs.")).toBe(
      false,
    );
  });

  it("says a written draft is not on a card yet, never 'I didn't prepare that'", () => {
    expect(DRAFT_NOT_ON_CARD_LINE).toMatch(/isn't on a card yet/u);
    expect(DRAFT_NOT_ON_CARD_LINE).not.toMatch(/didn't prepare/u);
  });
});

describe("a reply with no words of its own says what is on screen", () => {
  it("is the first findings shown, never a bare 'Understood.'", () => {
    const finding = (statement: string) =>
      ({ kind: "FINDING", finding: { statement } }) as never;
    expect(
      shownFindingsLine([
        finding("No Q Card currently exists for Maji Loop"),
        finding("Your company card is Maji Loop."),
        finding("A third."),
      ]),
    ).toBe(
      "No Q Card currently exists for Maji Loop. Your company card is Maji Loop.",
    );
    expect(shownFindingsLine([])).toBeNull();
    expect(shownFindingsLine(undefined)).toBeNull();
  });
});
