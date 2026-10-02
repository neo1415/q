import { describe, expect, it } from "vitest";

import { appActionLineOf } from "../src/q/index.js";

/**
 * ADR 0040 (parity eval 2026-10-02): an app action that ran says so in its
 * own words; the model's removed talk about acting no longer leaves
 * "Understood." as the whole answer.
 */
describe("the line an app action tool returns", () => {
  it("is said when it ran or could not; a prepared card is the engine's to narrate", () => {
    expect(appActionLineOf({ status: "DONE", says: "Passed on Ajopot." })).toBe(
      "Passed on Ajopot.",
    );
    expect(
      appActionLineOf({
        status: "NOT_DONE",
        says: "That company isn't one you can act on.",
      }),
    ).toBe("That company isn't one you can act on.");
    expect(
      appActionLineOf({ status: "PREPARED", says: "On the card." }),
    ).toBeNull();
    expect(appActionLineOf({ saved: true })).toBeNull();
    expect(appActionLineOf(null)).toBeNull();
  });
});
