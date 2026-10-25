import { describe, expect, it } from "vitest";

import {
  TURN_READER_V64,
  TURN_READER_V65,
  TurnReaderV64ResultSchema,
  TurnReaderV65ResultSchema,
  V62_COMPARE,
  V65_CHOICE_IS_COMPARE,
  V65_DISCOVER_WHOM,
  V65_REPLY_TO,
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
    expect(active.definition.version).toBe(66);
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

  // Coordinator 2026-10-24: these decisions are the reading's, by meaning;
  // code's word lists only decide when to wait for it.
  it("reads what a reply answers and whom a discovery is about", () => {
    expect(TURN_READER_V65.template).toContain(V65_REPLY_TO);
    expect(TURN_READER_V65.template).toContain(V65_DISCOVER_WHOM);
    expect(V65_REPLY_TO).toContain("Yes. No, not Halyard. Capital Q");
    expect(V65_REPLY_TO).toMatch(/never WAITING_CARD/u);
    expect(V65_DISCOVER_WHOM).toMatch(/never a company search/u);
    const read = TurnReaderV65ResultSchema.parse({
      kind: "ANSWER",
      confidence: "HIGH",
      transcript: "CLEAR",
      replyTo: { kind: "Q_QUESTION" },
      discoverWhom: "INVESTORS",
    });
    expect(read.replyTo).toEqual({ kind: "Q_QUESTION", card: null });
    expect(read.discoverWhom).toBe("INVESTORS");
    // Absent on older readings: null, never a guess.
    expect(
      TurnReaderV65ResultSchema.parse({
        kind: "ANSWER",
        confidence: "HIGH",
        transcript: "CLEAR",
      }).replyTo,
    ).toBeNull();
  });
});
