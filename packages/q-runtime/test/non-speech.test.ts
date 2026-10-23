import { describe, expect, it } from "vitest";

import { withoutNonSpeechTags } from "../src/domain/non-speech.js";

/**
 * A recogniser's marked non-speech never reaches the turn (production
 * 2026-10-23); an unmarked word is the person's, and stays.
 */
describe("non-speech markup out of a spoken turn", () => {
  it.each([
    ["(laughter) Tell me about Halyard", "Tell me about Halyard"],
    ["[Applause] Who is Captain Zino Mario?", "Who is Captain Zino Mario?"],
    ["Tell me about Halyard *coughs* please", "Tell me about Halyard please"],
    ["{music} <noise> What's new?", "What's new?"],
  ])("%s", (said, kept) => {
    expect(withoutNonSpeechTags(said)).toBe(kept);
  });

  it("keeps every unmarked word: what they meant is the reader's to understand", () => {
    for (const said of [
      "Music streaming startups in Lagos?",
      "Laughter Tell me about Halyard",
      "What does Static Labs do?",
    ]) {
      expect(withoutNonSpeechTags(said)).toBe(said);
    }
  });

  it("leaves a turn that was only marked sound as it was, for the voice channel", () => {
    expect(withoutNonSpeechTags("[laughter]")).toBe("[laughter]");
  });
});
