import { describe, expect, it } from "vitest";

import {
  TURN_READER_V66,
  TURN_READER_V67,
  TurnReaderV65ResultSchema,
  V65_CHOICE_IS_COMPARE,
  V67_TOP_N_COMPARE,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Guard I-top-five (coordinator 2026-10-26, run 97d4c273): after five
 * ranked cards, "How do the top two stack up?" was read with no compare.
 * The top N of a longer list Q showed is compare {count: N}, by meaning.
 */
describe("TURN_READER v67: the top N of a list Q showed is compare", () => {
  it("is the active reader: v66 kept whole plus the rule after the named choice", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(70);
    expect(TURN_READER_V66.status).toBe("DEPRECATED");
    expect(TURN_READER_V67.template).toContain(
      `${V65_CHOICE_IS_COMPARE}\n${V67_TOP_N_COMPARE}`,
    );
    expect(TURN_READER_V67.template.replace(`\n${V67_TOP_N_COMPARE}`, "")).toBe(
      TURN_READER_V66.template,
    );
  });

  it("names the turn it covers, over a longer list, whatever else the turn is", () => {
    expect(V67_TOP_N_COMPARE).toContain("how do the top two stack up?");
    expect(V67_TOP_N_COMPARE).toMatch(/list of more companies than that/u);
    expect(V67_TOP_N_COMPARE).toMatch(/whatever else the turn is/u);
    // Research is not this rule's to decide (coordinator correction).
    expect(V67_TOP_N_COMPARE).not.toMatch(/research|web/iu);
  });

  it("reads five cards then 'top two stack up?' as compare {count: 2}", () => {
    const read = TurnReaderV65ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      compare: { count: 2, names: [] },
    });
    expect(read.compare).toMatchObject({ count: 2 });
  });
});
