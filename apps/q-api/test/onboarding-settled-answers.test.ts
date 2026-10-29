import { describe, expect, it } from "vitest";

import { quotedFrom } from "../src/voice/onboarding-conversation.js";

/**
 * Live 2026-10-29 (re-test 4): "6 deals a year, mostly follow" was saved
 * as follow; the finishing reading re-read the same words and wrote
 * "follow, lead". A settled answer changes only on words said after it
 * was saved: the reading's quote must come from one of those turns.
 */
describe("a reading's quote, matched to what they said", () => {
  it("verbatim, any case and punctuation", () => {
    expect(
      quotedFrom("mostly follow", ["6 deals a year, Mostly FOLLOW."]),
    ).toBe(true);
  });

  it("most of its words in one turn (the reader trims)", () => {
    expect(
      quotedFrom("make that 50 to 100k", ["sorry make that 50 to 100k not 25"]),
    ).toBe(true);
  });

  it("not from turns that never said it", () => {
    expect(
      quotedFrom("mostly follow", ["hold on, my dog is barking", "that's all"]),
    ).toBe(false);
    expect(quotedFrom("mostly follow", [])).toBe(false);
  });

  it("in any language", () => {
    expect(
      quotedFrom("surtout suivre", ["six deals par an, surtout suivre"]),
    ).toBe(true);
    expect(quotedFrom("نتابع غالبا", ["ست صفقات في السنة، نتابع غالبا"])).toBe(
      true,
    );
  });
});
