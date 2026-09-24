import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  deliveryFromCue,
  INTERVIEW_CONDUCTOR_V7,
  INTERVIEW_CONDUCTOR_V8,
  INTERVIEW_CONDUCTOR_V9,
  InterviewConductorV6ResultSchema,
  InterviewConductorV7ResultSchema,
} from "@capital-q/q-core";

/**
 * The active conductor is v10: v9 (v8 plus several-things turns, E1) with
 * no audio tags inside the reply and one delivery cue beside it
 * (CQ-VOICE-010). v7, v8 and v9 are retired unchanged (CQ-QX-005).
 *
 * v8 is built by rewriting v7's template, which is the repository's
 * convention and also the thing most likely to go wrong quietly: a missed
 * anchor leaves the old instruction in place and the new behaviour never
 * happens, with nothing failing. So this asserts the five replacements
 * landed, that what they replaced is gone, and that the result schema
 * takes the reading the runtime now depends on — and that an older
 * double without one still parses.
 */

describe("INTERVIEW_CONDUCTOR v10 is what the interview runs", () => {
  const registry = createDefaultPromptRegistry();
  const active = registry.getActive("INTERVIEW_CONDUCTOR");
  const template = active.definition.template;

  it("is the single active version, and v7, v8 and v9 are retired", () => {
    expect(active.definition.version).toBe(10);
    expect(INTERVIEW_CONDUCTOR_V7.status).toBe("DEPRECATED");
    expect(INTERVIEW_CONDUCTOR_V8.status).toBe("DEPRECATED");
    expect(INTERVIEW_CONDUCTOR_V9.status).toBe("DEPRECATED");
  });

  // CQ-VOICE-010: a tag in the reply reached the transcript, the thread
  // and memory, and a voice that cannot render it read it aloud.
  it("never asks for a stage direction inside the reply, and offers one cue beside it", () => {
    expect(template).not.toContain("[laughs]");
    expect(template).not.toContain("{{expressive}}");
    expect(template).toContain("reply is words only, never [tags]");
    expect(template).toContain("delivery is usually null");
    expect(INTERVIEW_CONDUCTOR_V9.template).toContain("[laughs]");
  });

  it("reads the cue into the closed delivery the speech layer renders, and nothing else", () => {
    const base = { reply: "Fair enough.", intent: "ANSWER" };
    const quiet = {
      ...base,
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
    expect(InterviewConductorV7ResultSchema.parse(quiet).delivery).toBeNull();
    const laughing = InterviewConductorV7ResultSchema.parse({
      ...quiet,
      delivery: "CHUCKLE",
    });
    expect(deliveryFromCue(laughing.delivery)).toMatchObject({
      reaction: "CHUCKLE",
      reactionAt: 0,
      pauseAfter: [],
    });
    expect(deliveryFromCue("PAUSE")).toMatchObject({
      reaction: null,
      pauseAfter: [0],
    });
    for (const bad of ["[laughs]", "SCREAM", "laugh"]) {
      expect(
        InterviewConductorV7ResultSchema.safeParse({ ...quiet, delivery: bad })
          .success,
      ).toBe(false);
    }
  });

  it("lets one turn confirm, correct and ask, and drops none of it (E1)", () => {
    expect(template).toContain("One turn can confirm, correct and ask at once");
    expect(template).toContain("Drop nothing");
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

  it("stays within the dialogue route's request budget", () => {
    // The 8,000-token Groq cap is gone (luna first, flash-lite behind);
    // the template is still bounded so the open steps keep their room and
    // a turn's latency does not creep (interviewer-prompt-budget.test.ts).
    expect(template.length).toBeLessThan(20_000);
  });

  it("lets the person point at Q's own words and at another step's value (v10)", () => {
    expect(template).toContain("select OFFERED");
    expect(template).toContain("select VALUE_OF");
    expect(template).toContain(
      "Read the whole sentence against every open step",
    );
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
