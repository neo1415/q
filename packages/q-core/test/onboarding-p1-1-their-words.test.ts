import { describe, expect, it } from "vitest";

import {
  checkTheirWords,
  cleanedFromTheirLine,
  createDefaultPromptRegistry,
  THEIR_WORDS_MIN_KEPT,
} from "../src/index.js";

/**
 * Onboarding P1-1 (DECISIONS 77): the structural check of the reader's
 * "their own words, filler removed" claim. Deletions only, in order, and
 * most of their line kept; everything else goes to the read-back.
 */
const LINE =
  "Um, so we, uh, we sell a scheduling tool to independent physio clinics in Portugal, you know, and Spain, and they pay 40 euros a month per therapist.";

describe("cleanedFromTheirLine", () => {
  it("keeps their words with filler and a false start removed", () => {
    expect(
      cleanedFromTheirLine(
        "We sell a scheduling tool to independent physio clinics in Portugal and Spain, and they pay 40 euros a month per therapist.",
        LINE,
      ),
    ).toBe(true);
  });

  it("is case- and punctuation-blind", () => {
    expect(
      cleanedFromTheirLine(
        "we sell a scheduling tool to independent physio clinics in portugal and spain and they pay 40 euros a month per therapist",
        LINE,
      ),
    ).toBe(true);
  });

  it("refuses an added word", () => {
    expect(
      cleanedFromTheirLine(
        "We sell a scheduling tool to independent physio clinics in Portugal and Spain, and they pay only 40 euros a month per therapist.",
        LINE,
      ),
    ).toBe(false);
  });

  it("refuses a reworded word", () => {
    expect(
      cleanedFromTheirLine(
        "We sell a booking tool to independent physio clinics in Portugal and Spain, and they pay 40 euros a month per therapist.",
        LINE,
      ),
    ).toBe(false);
  });

  it("refuses reordered words", () => {
    expect(
      cleanedFromTheirLine(
        "We sell a scheduling tool to independent physio clinics in Spain and Portugal, and they pay 40 euros a month per therapist.",
        LINE,
      ),
    ).toBe(false);
  });

  it("refuses a selection that keeps too little of the line", () => {
    const check = checkTheirWords(
      "We sell a scheduling tool to physio clinics.",
      LINE,
    );
    expect(check.deletionsOnly).toBe(true);
    expect(check.kept).toBeLessThan(THEIR_WORDS_MIN_KEPT);
    expect(check.cleaned).toBe(false);
  });

  it("refuses an empty value", () => {
    expect(cleanedFromTheirLine("", LINE)).toBe(false);
    expect(cleanedFromTheirLine("...", LINE)).toBe(false);
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v14 and ONBOARDING_TYPED_REPLY v8 (P1-1)", () => {
  const registry = createDefaultPromptRegistry();
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;
  const reply = registry.getActive("ONBOARDING_TYPED_REPLY").definition;

  it("are active", () => {
    expect(reader.version).toBe(14);
    expect(reply.version).toBe(8);
  });

  it("the reader judges a LONG_TEXT answer clear (their words, filler removed) or rambling (a summary)", () => {
    expect(reader.template).toMatch(
      /Judge how they told it, typed or spoken, whatever its length/u,
    );
    expect(reader.template).toMatch(
      /give THEIR OWN WORDS for that step with only filler removed/u,
    );
    expect(reader.template).toMatch(
      /nothing reordered, reworded, corrected or added, and ownWords true/u,
    );
    expect(reader.template).toMatch(/give a short professional summary/u);
    expect(reader.template).toMatch(
      /keeping every figure, name and place they gave for it, and ownWords false/u,
    );
    expect(reader.template).toMatch(/When unsure, summarise\./u);
    // The v13 "saved only as Q's summary" rule is gone; agreement stays.
    expect(reader.template).not.toMatch(
      /is saved only as Q's summary that they agreed to/u,
    );
    expect(reader.template).toMatch(
      /they agreed in their next line without changing or adding to it/u,
    );
  });

  it("the reply says back only a ramble or a summary not confirmed yet", () => {
    expect(reply.template).toMatch(
      /A clear answer, typed or spoken, whatever its length, is kept in their own words with only filler removed: never say it back/u,
    );
    expect(reply.template).toMatch(
      /says back what you understood for EVERY such topic/u,
    );
    expect(reply.template).toMatch(
      /A summary not confirmed yet always waits for their yes; an answer already saved needs no say-back/u,
    );
  });
});
