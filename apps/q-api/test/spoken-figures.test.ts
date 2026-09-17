import { describe, expect, it } from "vitest";

import { spokenFigures, speakable } from "../src/voice/speech.js";

/**
 * Money and big numbers, said the way a person says them. "200 000 000
 * NGN" was read aloud as a string of zeros followed by three letters.
 */
describe("figures, spoken", () => {
  it("says a raise target as words, not digits and letters", () => {
    expect(spokenFigures("a raise target of 200 000 000 NGN")).toBe(
      "a raise target of 200 million naira",
    );
    expect(spokenFigures("200,000,000 NGN via a convertible note")).toBe(
      "200 million naira via a convertible note",
    );
    expect(spokenFigures("NGN 200,000,000")).toBe("200 million naira");
  });

  it("keeps a written scale word with its figure", () => {
    // Live: "₦200 million" was read out as "200 nairamillion".
    expect(spokenFigures("a ₦200 million convertible-note raise")).toBe(
      "a 200 million naira convertible-note raise",
    );
    expect(spokenFigures("NGN 200 million")).toBe("200 million naira");
    expect(spokenFigures("200 million NGN")).toBe("200 million naira");
    expect(spokenFigures("$2 billion")).toBe("2 billion dollars");
  });

  it("handles the ways models write money", () => {
    expect(spokenFigures("$1.5m")).toBe("1.5 million dollars");
    expect(spokenFigures("USD 250k")).toBe("250 thousand dollars");
    expect(spokenFigures("£2,000,000")).toBe("2 million pounds");
    expect(spokenFigures("raised 3 000 000 USD last year")).toBe(
      "raised 3 million dollars last year",
    );
    expect(spokenFigures("1 USD")).toBe("1 dollar");
  });

  it("compacts a grouped count and leaves a plain number alone", () => {
    expect(spokenFigures("serves 60,000 merchants")).toBe(
      "serves 60 thousand merchants",
    );
    expect(spokenFigures("acquired in 2020")).toBe("acquired in 2020");
    expect(spokenFigures("about 12 people")).toBe("about 12 people");
  });

  it("is applied to everything Q says aloud", () => {
    expect(speakable("Target: **200 000 000 NGN**.")).toBe(
      "Target: 200 million naira.",
    );
  });
});
