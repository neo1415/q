import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod";

import {
  COMPANY_ANALYST_V13,
  COMPANY_ANALYST_V14,
  CompanyAnalystV14ResultSchema,
  gesturesForReply,
  ModelSentenceGesturesSchema,
  sentenceCount,
} from "../src/index.js";

describe("PRESENCE gestures beside a reply", () => {
  it("counts a reply's sentences", () => {
    expect(sentenceCount("One.")).toBe(1);
    expect(sentenceCount("One. Two! Three?")).toBe(3);
    expect(sentenceCount("One. And a tail")).toBe(2);
    expect(sentenceCount("")).toBe(1);
  });

  it("keeps closed-set gestures, clamps positions, one per sentence, in order", () => {
    const reply = "Revenue is up. They have offices in Lagos. Well done.";
    expect(
      gesturesForReply(reply, [
        { sentence: 2, gesture: "CLAP" },
        { sentence: 0, gesture: "MONEY" },
        { sentence: 0, gesture: "CHART_UP" },
        { sentence: 9, gesture: "BUILDINGS" },
        { sentence: 1, gesture: "FIREWORKS" },
        { sentence: -3, gesture: "NOD" },
      ]),
    ).toEqual([
      { sentence: 0, gesture: "MONEY" },
      { sentence: 2, gesture: "CLAP" },
    ]);
  });

  it("never holds more than four, and nothing when the model gave none", () => {
    const reply = "A. B. C. D. E. F.";
    const many = [0, 1, 2, 3, 4, 5].map((sentence) => ({
      sentence,
      gesture: "NOD",
    }));
    expect(gesturesForReply(reply, many)).toHaveLength(4);
    expect(gesturesForReply(reply, undefined)).toEqual([]);
    expect(gesturesForReply(reply, [])).toEqual([]);
  });

  it("is lenient on the way in: an odd gesture never fails the reply", () => {
    expect(ModelSentenceGesturesSchema.parse(undefined)).toEqual([]);
    expect(
      ModelSentenceGesturesSchema.safeParse([{ sentence: 1, gesture: "WAVE" }])
        .success,
    ).toBe(true);
  });

  it("COMPANY_ANALYST v14 is v13 plus the presence section, and parses gestures", () => {
    // Superseded by v15 (proposal status), which keeps the field.
    expect(COMPANY_ANALYST_V14.status).toBe("DEPRECATED");
    expect(COMPANY_ANALYST_V14.template).toBe(COMPANY_ANALYST_V13.template);
    // The guidance and the closed set reach the model through the schema.
    const schema = JSON.stringify(
      toJSONSchema(CompanyAnalystV14ResultSchema, { io: "input" }),
    );
    expect(schema).toContain("HANDS_EXPLAIN");
    expect(schema).toContain("0-based index of a sentence");
    const parsed = CompanyAnalystV14ResultSchema.parse({
      answer: "x",
      responseShape: "CONCISE",
      insufficientEvidence: false,
      recommendation: null,
    });
    expect(parsed.gestures).toEqual([]);
  });
});

describe("INTERVIEW_AGENT v16 (PRESENCE)", () => {
  it("is v15's text with gestures in its output schema, lenient on the way in", async () => {
    const {
      INTERVIEW_AGENT_V15,
      INTERVIEW_AGENT_V16,
      InterviewAgentV16ResultSchema,
    } = await import("../src/index.js");
    expect(INTERVIEW_AGENT_V16.status).toBe("ACTIVE");
    expect(INTERVIEW_AGENT_V16.template).toBe(INTERVIEW_AGENT_V15.template);
    const parsed = InterviewAgentV16ResultSchema.parse({
      reply: "What do you charge?",
      gestures: [{ sentence: 0, gesture: "NOT_A_GESTURE" }],
    });
    // The reply survives; the unknown gesture is dropped by code.
    expect(gesturesForReply(parsed.reply, parsed.gestures)).toEqual([]);
  });
});
