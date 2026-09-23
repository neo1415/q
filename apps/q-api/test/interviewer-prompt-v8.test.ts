import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  INTERVIEW_CONDUCTOR_V7,
  InterviewConductorV6ResultSchema,
} from "@capital-q/q-core";

/**
 * The active conductor is v8, and v7 is retired unchanged (CQ-QX-005).
 *
 * v8 is built by rewriting v7's template, which is the repository's
 * convention and also the thing most likely to go wrong quietly: a missed
 * anchor leaves the old instruction in place and the new behaviour never
 * happens, with nothing failing. So this asserts the five replacements
 * landed, that what they replaced is gone, and that the result schema
 * takes the reading the runtime now depends on — and that an older
 * double without one still parses.
 */

describe("INTERVIEW_CONDUCTOR v8 is what the interview runs", () => {
  const registry = createDefaultPromptRegistry();
  const active = registry.getActive("INTERVIEW_CONDUCTOR");
  const template = active.definition.template;

  it("is the single active version, and v7 is retired", () => {
    expect(active.definition.version).toBe(8);
    expect(INTERVIEW_CONDUCTOR_V7.status).toBe("DEPRECATED");
  });

  it("answers a question to Q in the turn instead of sending it away", () => {
    expect(template).toContain("A question is never a failed answer");
    expect(template).toContain("THEIR_OWN_RECORDS");
    expect(template).toContain("REAL_WORLD_EXAMPLE or PUBLIC_FACTS");
    expect(template).not.toContain("Do not answer that kind yourself here.");
  });

  it("keeps meaning beside the field and resolves pointing against the shown options", () => {
    expect(template).toContain("is NOT no preference");
    expect(template).toContain("reading.qualitative");
    expect(template).toContain("reading.references against SHOWN OPTIONS");
    expect(template).toContain("{{asked}}");
    expect(template).toContain("{{conversation}}");
  });

  it("stops acknowledging every field, keeps transcript apart from reasoning, and raises tensions", () => {
    expect(template).toContain("Do not acknowledge every field");
    expect(template).toContain(
      "never blame their speech for a sentence you understood",
    );
    expect(template).toContain("reading.tensions");
    expect(template).not.toContain('("Lagos, got it." / "Two pilots, nice.")');
  });

  it("offers inferences as suggestions and never as answers", () => {
    expect(template).toContain("reading.suggestions");
    expect(template).toContain("never put it in answers");
    expect(template).toContain(
      "Only an ANSWER or a CORRECTION lets the platform write anything",
    );
  });

  it("stays within a small model's request budget", () => {
    // Groq's free tier refused a turn above ~8,000 tokens once the open
    // steps were rendered. The template's own share is bounded here so
    // that the steps keep the room they need (interviewer.ts caps them).
    expect(template.length).toBeLessThan(17_000);
  });

  it("parses a reading, and defaults to none for an older double", () => {
    const quiet = {
      reply: "Which stages?",
      intent: "ANSWER",
      answers: [],
      categoryPhrases: [],
      confirmations: [],
      skips: [],
      askNext: null,
      showOptions: false,
      questionForQ: null,
      navigate: null,
      pronounce: null,
      lookup: null,
    };
    expect(InterviewConductorV6ResultSchema.parse(quiet).reading).toBeNull();
    const read = InterviewConductorV6ResultSchema.parse({
      ...quiet,
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "ADVICE", text: "What should I look for?" },
      },
    });
    expect(read.reading?.question?.kind).toBe("ADVICE");
    expect(read.reading?.references).toEqual([]);
  });
});
