import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V89,
  TURN_READER_V90,
  TurnQuestionV90Schema,
  TurnReaderV90ResultSchema,
  V89_LIST_CONDITIONS,
  V90_FIT_REASONS,
} from "../src/index.js";

/**
 * TURN_READER v90 (owner live 17 Nov 2026, conversation 9995dcca, run
 * 333d9645): "So, why are they the strongest fits? Don't just repeat the
 * descriptions" was read as FIT about the companies shown, and code ranked
 * them again. The reading says why was asked (`question.fitReasons`); code
 * answers from the fit profiles.
 */
describe("TURN_READER v90", () => {
  it("was active (v91 now): v89 with one WHY THEY FIT paragraph after LIST CONDITIONS, on v90's schema", () => {
    const registry = createDefaultPromptRegistry();
    const v90 = registry.get("TURN_READER", 90)?.definition;
    expect(v90?.status).toBe("DEPRECATED");
    expect(registry.get("TURN_READER", 89)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(v90?.output.kind === "STRUCTURED" && v90.output.schema).toBe(
      TurnReaderV90ResultSchema,
    );
    expect(TURN_READER_V90.variables).toEqual(TURN_READER_V89.variables);
    expect(TURN_READER_V90.template.replace(`\n${V90_FIT_REASONS}`, "")).toBe(
      TURN_READER_V89.template,
    );
    expect(TURN_READER_V90.template).toContain(
      `${V89_LIST_CONDITIONS}\n${V90_FIT_REASONS}`,
    );
  });

  it("reads why by meaning, the live words among its cases, and keeps a ranking a ranking", () => {
    for (const said of [
      "on a FIT question",
      "by meaning, in any words and any language",
      "why are they the strongest fits?",
      "don't just repeat the descriptions",
      "not the list again",
      '"rank them"',
      "for every other question kind",
    ]) {
      expect(V90_FIT_REASONS).toContain(said);
    }
  });

  it("parses leniently: absent or malformed is false", () => {
    const question = { kind: "FIT", text: "why are they the strongest fits?" };
    expect(TurnQuestionV90Schema.parse(question).fitReasons).toBe(false);
    expect(
      TurnQuestionV90Schema.parse({ ...question, fitReasons: "yes" })
        .fitReasons,
    ).toBe(false);
    const reading = TurnReaderV90ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
      question: { ...question, fitReasons: true },
    });
    expect(reading.question?.fitReasons).toBe(true);
  });
});
