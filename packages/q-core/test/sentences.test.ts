import { describe, expect, it } from "vitest";

import { createSentenceCutter } from "../src/index.js";

/**
 * A sentence is the unit an answer can safely leave in: below it the
 * deterministic guards cannot do their work, above it a person waits for
 * no reason.
 */

function cutInto(text: string, size: number): readonly string[] {
  const cutter = createSentenceCutter();
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) {
    out.push(...cutter.push(text.slice(at, at + size)));
  }
  const last = cutter.rest();
  if (last !== null) {
    out.push(last);
  }
  return out;
}

describe("cutting an answer into sentences as it arrives", () => {
  it("gives the same sentences however the text is cut up", () => {
    const text =
      "Paystack is a Nigerian payments company. Stripe acquired it in 2020. It serves about 60,000 merchants.";
    const expected = [
      "Paystack is a Nigerian payments company.",
      "Stripe acquired it in 2020.",
      "It serves about 60,000 merchants.",
    ];
    for (const size of [1, 2, 5, 13, 40, 1000]) {
      expect(cutInto(text, size), `chunk ${String(size)}`).toEqual(expected);
    }
  });

  it("does not cut a number, an initial or an abbreviation in half", () => {
    for (const text of [
      "They raised $1.5m last year.",
      "The round closed at 4.2 times revenue.",
      "Shola A. Akinlade founded it.",
    ]) {
      expect(cutInto(text, 1), text).toEqual([text]);
    }
  });

  it("treats a paragraph break as an ending", () => {
    expect(cutInto("First thing\n\nSecond thing", 3)).toEqual([
      "First thing",
      "Second thing",
    ]);
  });

  it("holds an unfinished sentence back rather than sending half of one", () => {
    const cutter = createSentenceCutter();
    expect(cutter.push("Paystack is a Nigerian ")).toEqual([]);
    expect(cutter.push("payments company")).toEqual([]);
    expect(cutter.push(". Stripe ")).toEqual([
      "Paystack is a Nigerian payments company.",
    ]);
    expect(cutter.rest()).toBe("Stripe");
    expect(cutter.rest()).toBeNull();
  });

  it("emits nothing twice and loses nothing", () => {
    const text = "One. Two! Three? And a last one with no terminator at all";
    const pieces = cutInto(text, 4);
    expect(pieces.join(" ")).toBe(text);
  });

  it("says nothing when there is nothing", () => {
    const cutter = createSentenceCutter();
    expect(cutter.push("")).toEqual([]);
    expect(cutter.push("   \n  ")).toEqual([]);
    expect(cutter.rest()).toBeNull();
  });
});
