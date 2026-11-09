import { describe, expect, it } from "vitest";

import {
  checkTheirWords,
  cleanedFromTheirLine,
  createDefaultPromptRegistry,
  SPOKEN_MAX_WORDS,
  SPOKEN_MIN_KEPT,
  THEIR_WORDS_MIN_KEPT,
  wordTokens,
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

  it("keeps the rest of a short line after a short lead-in (an instruction, not the answer)", () => {
    const check = checkTheirWords(
      "Robotics for warehouse logistics.",
      "Change our description to robotics for warehouse logistics.",
    );
    expect(check.kept).toBeLessThan(THEIR_WORDS_MIN_KEPT);
    expect(check.afterLeadIn).toBe(true);
    expect(check.cleaned).toBe(true);
  });

  it("refuses a cut inside or after the answer, or a long lead-in, below the floor", () => {
    // A lead-in dropped but the end cut too ("not to banks" lost).
    expect(
      cleanedFromTheirLine(
        "we sell payroll software",
        "Put it as: we sell payroll software, but not to banks or insurers.",
      ),
    ).toBe(false);
    // A ramble's middle: a long lead-in and a long tail.
    expect(
      cleanedFromTheirLine(
        "we help grain co-ops track their silos",
        "So basically, um, what we do, right, is we help grain co-ops track their silos, and also the paperwork, the bank paperwork, and payments, sort of.",
      ),
    ).toBe(false);
  });

  it("refuses an empty value", () => {
    expect(cleanedFromTheirLine("", LINE)).toBe(false);
    expect(cleanedFromTheirLine("...", LINE)).toBe(false);
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v15 and ONBOARDING_TYPED_REPLY v8 (P1-1)", () => {
  const registry = createDefaultPromptRegistry();
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;
  const reply = registry.getActive("ONBOARDING_TYPED_REPLY").definition;

  it("carry into the active versions (reader v17, reply v9: DECISIONS 79)", () => {
    expect(reader.version).toBe(18);
    expect(reply.version).toBe(11);
  });

  it("the reader judges a LONG_TEXT answer clear (their words, filler removed) or rambling (a summary)", () => {
    expect(reader.template).toMatch(
      /judge how they told it, typed or spoken, whatever its length/iu,
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
    // Live run 1 (dev misses only): a two-step line is summarised first,
    // however clear; a short ramble and a long spoken answer are rambling.
    expect(reader.template).toMatch(
      /FIRST: when one line of theirs speaks to more than one LONG_TEXT step, never give their own words for any of them, however clear the line/u,
    );
    expect(reader.template).toMatch(/RAMBLING, even when short/u);
    expect(reader.template).toMatch(
      /a spoken answer that runs long is rambling/u,
    );
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

describe("a spoken answer's own words meet a stricter bar (P1-1 live run 1)", () => {
  const clear =
    "we run a small studio that, um, makes booking software for physiotherapy clinics in Portugal";
  const kept =
    "we run a small studio that makes booking software for physiotherapy clinics in Portugal";

  it("a short clear spoken answer with light filler is still theirs", () => {
    expect(cleanedFromTheirLine(kept, clear, { spoken: true })).toBe(true);
  });

  it("a long spoken answer is said back, however cleanly it was cut", () => {
    const long = `${clear} and ${clear} and ${clear}`;
    expect(wordTokens(long).length).toBeGreaterThan(SPOKEN_MAX_WORDS);
    expect(cleanedFromTheirLine(long, long)).toBe(true);
    expect(cleanedFromTheirLine(long, long, { spoken: true })).toBe(false);
  });

  it("a spoken cut the plain bar lets through, but not the spoken one, is said back", () => {
    const said =
      "so, um, basically, I mean, we sort of help, like, cafes and, you know, bakeries sell leftover bread at night";
    const cut = "we help cafes and bakeries sell leftover bread at night";
    const check = checkTheirWords(cut, said);
    expect(check.deletionsOnly).toBe(true);
    expect(check.kept).toBeLessThan(SPOKEN_MIN_KEPT);
    expect(cleanedFromTheirLine(cut, said, { spoken: true })).toBe(false);
  });
});

describe("DECISIONS 79: Q stops advertising optionality", () => {
  const registry = createDefaultPromptRegistry();
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;
  const reply = registry.getActive("ONBOARDING_TYPED_REPLY").definition;

  it("the typed reply never offers a skip, and still accepts one they offer", () => {
    expect(reply.template).not.toMatch(/saying they can skip/iu);
    expect(reply.template).toMatch(
      /Never say a question is optional or can be skipped/u,
    );
    // A skip or "I don't know" they offer is still accepted (v10 says how).
    expect(reply.template).toMatch(
      /If they say they don't know, that is an answer/u,
    );
    expect(reply.template).toMatch(
      /If they ask to skip an Other topic, move on/u,
    );
  });

  it("the reader holds a required step they do not have as not known", () => {
    expect(reader.template).toMatch(
      /a required step under notKnown with those words/u,
    );
    expect(reader.template).toMatch(
      /an optional step goes under declined with those words/u,
    );
  });
});

describe("batch 7: None answers a required list; drafts for the one line and the firm", () => {
  const reader = createDefaultPromptRegistry().getActive(
    "ONBOARDING_TRANSCRIPT_READER",
  ).definition;

  it('a required list marked "(none is an answer)" with nothing for them is declined', () => {
    expect(reader.version).toBe(18);
    expect(reader.template).toMatch(
      /a required step whose question ends "\(none is an answer\)"[^\n]*goes under declined/u,
    );
    // Every other required step is still never declined.
    expect(reader.template).toContain(
      "A required step is never declined: leave it out.",
    );
  });

  it("drafts the one line and the firm description as INFERRED, for their yes", () => {
    expect(reader.template).toMatch(
      /company in one line, or for a description of the firm[^\n]*source INFERRED/u,
    );
  });
});

describe("e2e run 3: a needed topic they decline is never just set aside", () => {
  const reply = createDefaultPromptRegistry().getActive(
    "ONBOARDING_TYPED_REPLY",
  ).definition;

  it("the template itself gives the reason for a Needed topic, and lets an Other one go", () => {
    expect(reply.version).toBe(11);
    expect(reply.template).toMatch(
      /would rather not answer a Needed topic[^\n]*never just set it aside: say in a few plain words why Capital Q needs it/u,
    );
    expect(reply.template).toMatch(
      /If they ask to skip an Other topic, move on and do not ask it again now/u,
    );
    expect(reply.template).not.toContain(
      "If they ask to skip something, or say they don't know, move on to the next thing",
    );
  });
});
