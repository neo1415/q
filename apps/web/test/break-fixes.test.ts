import { describe, expect, it } from "vitest";

import { absentSentence } from "../src/features/relationships/relationship-words";

/** Break-it sweep 2026-10-03. */
describe("a relationship page with nothing on record", () => {
  it("says nothing is on record when the read worked, from either side", () => {
    expect(absentSentence(true, "company", "Zino Aviation")).toBe(
      "Nothing is on record yet between your company and Zino Aviation.",
    );
    expect(absentSentence(true, "organisation", "Nixo")).toBe(
      "Nothing is on record yet between your organisation and Nixo.",
    );
  });

  it("says it couldn't load only when the read failed", () => {
    expect(absentSentence(false, "company", "Zino Aviation")).toMatch(
      /couldn't load just now/,
    );
  });
});
