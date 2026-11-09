import { describe, expect, it } from "vitest";

import {
  figuresOf,
  isPlainYes,
  restatedHeld,
} from "../src/voice/held-accept.js";
import { readBackIn } from "../src/voice/onboarding-conversation.js";

const figures = (text: string) => [...figuresOf(text)].sort((a, b) => a - b);

/**
 * Owner, live duplex voice 9 Nov (session 73253301): cheques heard as
 * 500000 / 3000000 / 7000000 and held for a yes; Q read them back in words
 * and the owner said yes nine times, but none was taken: the words were
 * read one by one (5, 100, 3), so no read-back matched the held figure.
 */
describe("spoken figures are read whole", () => {
  it("composes number words into one figure", () => {
    expect(figures("five hundred thousand")).toEqual([500_000]);
    expect(figures("a maximum of seven million")).toEqual([7_000_000]);
    expect(figures("two and a half million")).toEqual([2_500_000]);
    expect(figures("half a million")).toEqual([500_000]);
    expect(figures("one point five million")).toEqual([1_500_000]);
    expect(figures("a hundred and fifty thousand")).toEqual([150_000]);
    expect(figures("twenty five thousand")).toEqual([25_000]);
    expect(figures("one million five hundred thousand")).toEqual([1_500_000]);
    expect(figures("seventy five")).toEqual([75]);
  });

  it("keeps separate figures separate", () => {
    expect(figures("five hundred thousand and three million")).toEqual([
      500_000, 3_000_000,
    ]);
    expect(figures("between 50k and 3m")).toEqual([50_000, 3_000_000]);
  });

  it("still reads digits as before", () => {
    expect(figures("500 thousand")).toEqual([500_000]);
    expect(figures("3.5 million")).toEqual([3_500_000]);
    expect(figures("$500k")).toEqual([500_000]);
    expect(figures("USD 500,000")).toEqual([500_000]);
    expect(figures("twelve months")).toEqual([12]);
  });

  it("matches the owner's live read-back, so their yes is taken", () => {
    const qLine =
      "Okay, US dollar. And from what I have your smallest cheque is around five hundred thousand, and the typical one is about three million. Is that still right?";
    expect(readBackIn("500000", qLine)).toBe(true);
    expect(readBackIn("3000000", qLine)).toBe(true);
    expect(readBackIn("7000000", qLine)).toBe(false);
    expect(isPlainYes("Yup")).toBe(true);
    const later =
      "Just to be sure - you mentioned a minimum cheque of five hundred thousand, a typical one around three million, and a maximum of seven million. Is that right?";
    expect(readBackIn("7000000", later)).toBe(true);
  });

  it("a restated figure in words agrees; a different one does not", () => {
    const held = [{ stepKey: "I2.cheque_max", value: "7000000" }];
    expect(restatedHeld(held, "seven million")).toEqual(["I2.cheque_max"]);
    expect(restatedHeld(held, "no, eight million")).toEqual([]);
  });
});

/** The same fault for values in words: Q never says them character for character. */
describe("held words are matched as said, in any order", () => {
  it("a list said with 'and', a website said with 'dot', a plural", () => {
    expect(
      readBackIn(
        "Nigeria, Kenya, France",
        "So that's Nigeria, Kenya and France - right?",
      ),
    ).toBe(true);
    expect(readBackIn("acme.com", "Your site is acme dot com, yes?")).toBe(
      true,
    );
    expect(
      readBackIn("US dollar", "And you write cheques in US dollars?"),
    ).toBe(true);
    expect(
      readBackIn(
        "Fintech, Agritech",
        "I have fintech and agritech as your sectors.",
      ),
    ).toBe(true);
  });

  it("a line missing one of the words is not a read-back of it", () => {
    expect(
      readBackIn("Nigeria, Kenya, France", "So that's Nigeria and Kenya?"),
    ).toBe(false);
    expect(
      readBackIn("Fintech, Agritech", "I have fintech as your sector."),
    ).toBe(false);
  });

  it("a restatement agrees; a 'no' that names it does not", () => {
    const held = [{ stepKey: "I3.geography", value: "Nigeria, Kenya" }];
    expect(restatedHeld(held, "Kenya and Nigeria, yes")).toEqual([
      "I3.geography",
    ]);
    expect(restatedHeld(held, "No, not Kenya and Nigeria")).toEqual([]);
  });
});
