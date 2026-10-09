import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V41,
  TURN_READER_V42,
  TURN_READER_V42_MESSY_WORDS,
} from "../src/index.js";

/**
 * TURN_READER v42 (voiceq-63): badly phrased requests are read for their
 * most plausible meaning. Deterministic checks only: what the reader does
 * with real messy phrasings is the voice eval's (scripts/evals/q-voice,
 * the messy-* cases), never a model judged in a unit test.
 */
describe("TURN_READER v42", () => {
  it("is the active reader and v41 is deprecated", () => {
    expect(
      createDefaultPromptRegistry().getActive("TURN_READER").definition.version,
    ).toBe(47);
    expect(TURN_READER_V41.status).toBe("DEPRECATED");
  });

  it("adds only MESSY WORDS, once, in the static prefix", () => {
    expect(
      TURN_READER_V42.template.replace(TURN_READER_V42_MESSY_WORDS, ""),
    ).toBe(TURN_READER_V41.template);
    expect(TURN_READER_V42.template.split("MESSY WORDS").length).toBe(2);
    expect(TURN_READER_V42.template.indexOf("MESSY WORDS")).toBeLessThan(
      TURN_READER_V42.template.indexOf("{{"),
    );
  });

  it("covers typos, speech slips, fragments, pidgin and the one-question rule", () => {
    for (const covered of [
      "Typos",
      "Speech-recognition slips",
      "Fragments",
      "Pidgin",
      "one short question",
      "A misheard name is never a new person",
    ]) {
      expect(TURN_READER_V42_MESSY_WORDS).toContain(covered);
    }
  });
});
