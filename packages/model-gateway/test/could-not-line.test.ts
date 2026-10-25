import { describe, expect, it } from "vitest";

import { DRAFT_NOT_ON_CARD_LINE, explainsNothingDone } from "../src/q/index.js";

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
