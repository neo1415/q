import { describe, expect, it } from "vitest";

import {
  copiesWords,
  memoryCallbackFor,
  memoryCallbackNote,
  quotesCallback,
  withoutQuotedCallback,
} from "../src/q/memory-callback.js";

/** HQ-7: memory callbacks, deterministic. */
describe("HQ-7: one callback, relevant, never verbatim", () => {
  const candidates = [
    {
      memoryType: "preference" as const,
      content: "Prefers seed rounds in West African logistics",
      quote: "I only want seed rounds in West African logistics companies",
    },
    {
      memoryType: "fact" as const,
      content: "Their typical cheque is $250,000",
      quote: null,
    },
  ];

  it("picks the one this turn bears on, and none when nothing is shared", () => {
    expect(
      memoryCallbackFor(candidates, "Any new logistics companies this week?")
        ?.content,
    ).toBe("Prefers seed rounds in West African logistics");
    expect(
      memoryCallbackFor(candidates, "How do I export my data?"),
    ).toBeNull();
  });

  it("asks for a paraphrase, said as something they told Q", () => {
    const pick = candidates[0];
    if (pick === undefined) throw new Error("candidate missing");
    const note = memoryCallbackNote(pick);
    expect(note).toContain("at most once");
    expect(note).toContain("never quote their words");
    expect(note).toContain("not as verified");
  });

  it("drops a sentence that copies eight words in a row, keeps a paraphrase", () => {
    const pick = candidates[0] ?? null;
    expect(
      quotesCallback(
        "You said you only want seed rounds in West African logistics companies.",
        pick,
      ),
    ).toBe(true);
    expect(
      quotesCallback(
        "Since you focus on early logistics deals in West Africa, Baridi fits.",
        pick,
      ),
    ).toBe(false);
    expect(
      withoutQuotedCallback(
        "Baridi fits. You said you only want seed rounds in West African logistics companies. It raised last month.",
        pick,
      ),
    ).toBe("Baridi fits. It raised last month.");
    expect(
      copiesWords(
        "one two three four five six seven",
        "one two three four five six seven",
      ),
    ).toBe(false);
  });
});
