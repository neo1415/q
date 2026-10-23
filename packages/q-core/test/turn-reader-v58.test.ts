import { describe, expect, it } from "vitest";

import {
  QuestionKindSchema,
  TurnReaderV58ResultSchema,
  TURN_READER_V57,
  TURN_READER_V58,
  V46_DISCOVER,
  V58_INVESTOR_PROSPECTS,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Founder investor matching (owner 2026-10-23): "Which investors should I
 * talk to first, and why?" from a founder is its own question kind, read
 * by meaning, so code answers it from investors' network-visible profiles
 * rather than the company record alone.
 */
describe("TURN_READER v58: which investors a company should approach", () => {
  it("is the active reader, v57 kept whole plus the INVESTOR_PROSPECTS kind", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(58);
    expect(TURN_READER_V57.status).toBe("DEPRECATED");
    expect(TURN_READER_V58.template).toContain(
      `${V46_DISCOVER}${V58_INVESTOR_PROSPECTS}`,
    );
    expect(TURN_READER_V58.template.replace(V58_INVESTOR_PROSPECTS, "")).toBe(
      TURN_READER_V57.template,
    );
    expect(TURN_READER_V58.output.kind).toBe("STRUCTURED");
  });

  it("is a question kind of v58's reading only; published kinds are unchanged", () => {
    const question = {
      kind: "INVESTOR_PROSPECTS",
      text: "Which investors should I talk to first, and why?",
      count: null,
    };
    expect(TurnReaderV58ResultSchema.shape.question.parse(question)?.kind).toBe(
      "INVESTOR_PROSPECTS",
    );
    expect(QuestionKindSchema.safeParse("INVESTOR_PROSPECTS").success).toBe(
      false,
    );
  });

  it("reads by meaning, over ADVICE, FIT and DISCOVER_COMPANIES, and leaves region asks alone", () => {
    expect(V58_INVESTOR_PROSPECTS).toMatch(
      /by what it means, in any words and any language/u,
    );
    expect(V58_INVESTOR_PROSPECTS).toMatch(
      /Over ADVICE, FIT and DISCOVER_COMPANIES/u,
    );
    expect(V58_INVESTOR_PROSPECTS).toContain(
      "which investors should I talk to first, and why?",
    );
    expect(V58_INVESTOR_PROSPECTS).toMatch(
      /not this kind when they ask about one named investor/u,
    );
  });
});
