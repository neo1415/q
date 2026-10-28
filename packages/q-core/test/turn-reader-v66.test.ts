import { describe, expect, it } from "vitest";

import {
  TURN_READER_V65,
  TURN_READER_V66,
  TurnReaderV65ResultSchema,
  V58_RAISING,
  V66_DISCOVER_QUALIFIERS,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA F-114 (coordinator 2026-10-25): Discover's verified, pitch-video and
 * raise-shared filters are kept only when the person asked for them, so
 * the reader is asked for them by meaning.
 */
describe("TURN_READER v66: Discover's own narrowing choices, only when stated", () => {
  it("is the active reader: v65 kept whole plus the qualifiers after raising", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(70);
    expect(TURN_READER_V65.status).toBe("DEPRECATED");
    expect(TURN_READER_V66.template).toContain(
      `${V58_RAISING} ${V66_DISCOVER_QUALIFIERS}`,
    );
    expect(
      TURN_READER_V66.template.replace(` ${V66_DISCOVER_QUALIFIERS}`, ""),
    ).toBe(TURN_READER_V65.template);
    expect(V66_DISCOVER_QUALIFIERS).toMatch(
      /Raising now is raising, never raiseShared/u,
    );
  });

  it("reads 'only verified fintechs in Kenya' with verifiedOnly, and absent as false", () => {
    const read = TurnReaderV65ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: {
        kind: "DISCOVER_COMPANIES",
        text: "only verified fintechs in Kenya",
        discover: {
          sectors: ["fintech"],
          countries: ["KE"],
          verifiedOnly: true,
        },
      },
    });
    expect(read.question?.discover).toMatchObject({
      verifiedOnly: true,
      hasPitch: false,
      raiseShared: false,
    });
  });

  // Reader lane review (2026-10-25): raising now is raising alone.
  it("reads 'Show me fintechs in Kenya raising now' as raising, with no qualifier", () => {
    const read = TurnReaderV65ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: {
        kind: "DISCOVER_COMPANIES",
        text: "Show me fintechs in Kenya raising now",
        discover: { sectors: ["fintech"], countries: ["KE"], raising: true },
      },
    });
    expect(read.question?.discover).toMatchObject({
      raising: true,
      verifiedOnly: false,
      hasPitch: false,
      raiseShared: false,
    });
  });
});
