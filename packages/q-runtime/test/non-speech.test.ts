import { describe, expect, it } from "vitest";

import { withoutNonSpeechTags } from "../src/domain/non-speech.js";

/**
 * A recogniser's non-speech tags never reach the turn (production
 * 2026-10-23: "Laughter Tell me about Halyard" was stored as said).
 */
describe("non-speech tags out of a spoken turn", () => {
  it.each([
    ["Laughter Tell me about Halyard", "Tell me about Halyard"],
    ["(laughter) Tell me about Halyard", "Tell me about Halyard"],
    ["[Applause] Who is Captain Zino Mario?", "Who is Captain Zino Mario?"],
    ["Tell me about Halyard *coughs* please", "Tell me about Halyard please"],
    ["Tell me about Halyard. Laughter.", "Tell me about Halyard."],
    ["{music} <noise> What's new?", "What's new?"],
  ])("%s", (said, kept) => {
    expect(withoutNonSpeechTags(said)).toBe(kept);
  });

  it("keeps a word that is part of what they said", () => {
    expect(withoutNonSpeechTags("Music streaming startups in Lagos?")).toBe(
      "Music streaming startups in Lagos?",
    );
    expect(withoutNonSpeechTags("What does Static Labs do?")).toBe(
      "What does Static Labs do?",
    );
  });

  it("leaves a turn that was only a sound as it was, for the voice channel", () => {
    expect(withoutNonSpeechTags("[laughter]")).toBe("[laughter]");
    expect(withoutNonSpeechTags("Laughter.")).toBe("Laughter.");
  });
});
