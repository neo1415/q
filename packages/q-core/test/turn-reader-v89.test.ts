import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V88,
  TURN_READER_V89,
  TurnQuestionV89Schema,
  TurnReaderV89ResultSchema,
  V88_FIT_EXCLUDE_RELATIONSHIPS,
  V89_LIST_CONDITIONS,
} from "../src/index.js";

/**
 * TURN_READER v89 (audit 2026-11-15, RC2): ranked lists answered by code
 * dropped the stated condition ("only ones with actual revenue", "outside
 * my preferred sectors", a founder's "poor fits" and "leave out ones I'm
 * talking to"). The reading carries the conditions as typed fields
 * (`question.listConditions`); code applies them from the records.
 */
describe("TURN_READER v89", () => {
  it("is v88 with one LIST CONDITIONS paragraph after LEAVE OUT THEIR OWN, on v89's schema (deprecated by v90)", () => {
    const registry = createDefaultPromptRegistry();
    const active = { ...TURN_READER_V89 };
    expect(active.version).toBe(89);
    expect(registry.get("TURN_READER", 89)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("TURN_READER", 88)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV89ResultSchema,
    );
    expect(TURN_READER_V89.variables).toEqual(TURN_READER_V88.variables);
    expect(
      TURN_READER_V89.template.replace(`\n${V89_LIST_CONDITIONS}`, ""),
    ).toBe(TURN_READER_V88.template);
    expect(TURN_READER_V89.template).toContain(
      `${V88_FIT_EXCLUDE_RELATIONSHIPS}\n${V89_LIST_CONDITIONS}`,
    );
  });

  it("reads conditions by meaning, on both sides, and never invents one", () => {
    for (const said of [
      "FIT, DISCOVER_COMPANIES or INVESTOR_PROSPECTS",
      "by meaning, in any words and any language",
      "only the ones with actual revenue",
      '"PRE_REVENUE"',
      "outside my preferred sectors",
      "which would be poor fits",
      "leaving out ones I'm already talking to",
      "Never write a condition they did not state",
    ]) {
      expect(V89_LIST_CONDITIONS).toContain(said);
    }
  });

  it("parses leniently: a malformed field is not stated, a malformed whole is none", () => {
    const question = { kind: "FIT", text: "only ones with actual revenue" };
    expect(
      TurnQuestionV89Schema.parse({
        ...question,
        listConditions: { revenue: "HAS_REVENUE" },
      }).listConditions,
    ).toEqual({
      relationship: null,
      revenue: "HAS_REVENUE",
      sector: null,
      stage: null,
      geography: null,
      order: "BEST_FIRST",
    });
    expect(TurnQuestionV89Schema.parse(question).listConditions).toBeNull();
    expect(
      TurnQuestionV89Schema.parse({
        ...question,
        listConditions: { revenue: "LOTS", sector: "OUTSIDE", order: 3 },
      }).listConditions,
    ).toMatchObject({ revenue: null, sector: "OUTSIDE", order: "BEST_FIRST" });
    expect(
      TurnQuestionV89Schema.parse({ ...question, listConditions: "yes" })
        .listConditions,
    ).toBeNull();
    const reading = TurnReaderV89ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
      question: {
        kind: "INVESTOR_PROSPECTS",
        text: "which would be poor fits",
        listConditions: { order: "WORST_FIRST" },
      },
    });
    expect(reading.question?.listConditions?.order).toBe("WORST_FIRST");
  });
});
