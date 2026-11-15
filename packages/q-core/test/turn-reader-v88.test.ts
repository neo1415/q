import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V87,
  TURN_READER_V88,
  TurnQuestionV88Schema,
  TurnReaderV88ResultSchema,
  V87_NAVIGATION_TAB,
  V88_FIT_EXCLUDE_RELATIONSHIPS,
} from "../src/index.js";

/**
 * TURN_READER v88 (owner live 14 Nov 2026, run bba40261, audit D1): "the
 * strongest fits, leaving out companies I'm already in contact with" came
 * back with three of them. The reading says, by meaning, that they want
 * companies other than those they are in contact with
 * (`question.excludeRelationships`); code decides which those are.
 */
describe("TURN_READER v88", () => {
  it("is v87 with one LEAVE OUT THEIR OWN paragraph after NAVIGATION TAB, on v88's schema (deprecated by v89)", () => {
    const registry = createDefaultPromptRegistry();
    const active = { ...TURN_READER_V88 };
    expect(active.version).toBe(88);
    expect(registry.get("TURN_READER", 88)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("TURN_READER", 87)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV88ResultSchema,
    );
    expect(TURN_READER_V88.variables).toEqual(TURN_READER_V87.variables);
    expect(
      TURN_READER_V88.template.replace(
        `\n${V88_FIT_EXCLUDE_RELATIONSHIPS}`,
        "",
      ),
    ).toBe(TURN_READER_V87.template);
    expect(TURN_READER_V88.template).toContain(
      `${V87_NAVIGATION_TAB}\n${V88_FIT_EXCLUDE_RELATIONSHIPS}`,
    );
  });

  it("reads the exclusion by meaning, in any language, and keeps it apart from excludeShown", () => {
    for (const said of [
      "FIT or DISCOVER_COMPANIES",
      "by meaning, in any words and any language",
      "leaving out companies I'm already in contact with",
      "aparte de las que ya contacté",
      "It is one of question's own fields, beside excludeShown",
      '"rank my pipeline"',
      "that is excludeShown",
    ]) {
      expect(V88_FIT_EXCLUDE_RELATIONSHIPS).toContain(said);
    }
  });

  it("parses leniently: absent or malformed is false, never a lost reading", () => {
    const question = {
      kind: "FIT",
      text: "strongest fits, not the ones I'm talking to",
    };
    expect(
      TurnQuestionV88Schema.parse({ ...question, excludeRelationships: true })
        .excludeRelationships,
    ).toBe(true);
    expect(TurnQuestionV88Schema.parse(question).excludeRelationships).toBe(
      false,
    );
    expect(
      TurnQuestionV88Schema.parse({ ...question, excludeRelationships: "yes" })
        .excludeRelationships,
    ).toBe(false);
    const reading = TurnReaderV88ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
      question: { ...question, excludeRelationships: true },
    });
    expect(reading.question?.excludeRelationships).toBe(true);
    expect(reading.question?.excludeShown).toBe(false);
  });
});
