import { describe, expect, it } from "vitest";

import { correctionIntent } from "../src/domain/resolution/correction.js";

/**
 * Corrections (CQ-Q-VOICE-001 A §14): the words after the objection carry
 * the corrected answer; a bare objection carries none; an ordinary answer
 * is not a correction.
 */
describe("correctionIntent", () => {
  it("recognises the packet's phrasings and keeps the corrected words", () => {
    expect(correctionIntent("No, that's wrong.")).toEqual({ remainder: "" });
    expect(correctionIntent("What I meant was Series A")).toEqual({
      remainder: "Series A",
    });
    expect(
      correctionIntent(
        "Actually, we're enterprise software, not logistics infrastructure.",
      ),
    ).toEqual({
      remainder: "enterprise software, not logistics infrastructure.",
    });
    expect(correctionIntent("Sorry, I meant Ghana")).toEqual({
      remainder: "Ghana",
    });
  });

  it("leaves an ordinary answer alone", () => {
    expect(correctionIntent("We're at seed")).toBeNull();
    expect(correctionIntent("Nigeria and Ghana")).toBeNull();
    expect(correctionIntent("Not sure yet")).toBeNull();
  });
});
