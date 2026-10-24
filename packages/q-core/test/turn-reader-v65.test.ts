import { describe, expect, it } from "vitest";

import {
  TURN_READER_V64,
  TURN_READER_V65,
  TurnReaderV64ResultSchema,
  V62_COMPARE,
  V65_CHOICE_IS_COMPARE,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Coordinator 2026-10-24 (run beb74547): "Which is better, Anchor or
 * Afyascan?" was read with no compare, and no side-by-side was drawn. A
 * choice between named companies is compare with their names, by meaning.
 */
describe("TURN_READER v65: a choice between named companies is compare", () => {
  it("is the active reader: v64 plus the choice rule, after COMPARE", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(65);
    expect(TURN_READER_V64.status).toBe("DEPRECATED");
    const at = TURN_READER_V65.template.indexOf(V65_CHOICE_IS_COMPARE);
    expect(at).toBeGreaterThan(TURN_READER_V65.template.indexOf(V62_COMPARE));
    expect(TURN_READER_V65.template.split(V65_CHOICE_IS_COMPARE)).toHaveLength(
      2,
    );
  });

  it("names the choices it covers, in more than one language, and keeps compare beside fit", () => {
    for (const phrasing of [
      "which is better, A or B?",
      "which fits me more, A or B?",
      "would you pick A or B?",
      "lequel est le meilleur, A ou B ?",
      "أيهما أفضل، A أم B؟",
    ]) {
      expect(V65_CHOICE_IS_COMPARE).toContain(phrasing);
    }
    expect(V65_CHOICE_IS_COMPARE).toMatch(
      /sets compare as well, never instead/u,
    );
  });

  it("reads into the same schema as v64: compare with names in order", () => {
    const read = TurnReaderV64ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      compare: { count: null, names: ["Anchor", "Afyascan"] },
    });
    expect(read.compare?.names).toEqual(["Anchor", "Afyascan"]);
  });
});
