import { toJSONSchema } from "zod";
import { describe, expect, it } from "vitest";

import {
  TURN_READER_V68,
  TURN_READER_V69,
  TurnReaderV65ResultSchema,
  V68_ONLY_WHAT_APPLIES,
  V69_FIELDS_WHERE_THEY_BELONG,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (run 7b51d28d): "How investor-ready is my company
 * right now?" was read with nextSteps inside question, refused twice by
 * the schema and asked a third time. v69 says where every field goes; the
 * schema stays strict.
 */
const REFUSED = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: {
    kind: "ADVICE",
    text: "How investor-ready is my company right now?",
    nextSteps: true,
  },
};

describe("TURN_READER v69: each field where it belongs", () => {
  it("is the active reader: v68 kept whole plus the rule after its own line", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(69);
    expect(TURN_READER_V68.status).toBe("DEPRECATED");
    expect(TURN_READER_V69.output).toMatchObject({ onlyWhatApplies: true });
    expect(TURN_READER_V69.template).toContain(
      `${V68_ONLY_WHAT_APPLIES} ${V69_FIELDS_WHERE_THEY_BELONG}`,
    );
    expect(
      TURN_READER_V69.template.replace(` ${V69_FIELDS_WHERE_THEY_BELONG}`, ""),
    ).toBe(TURN_READER_V68.template);
  });

  it("names question's own fields exactly as the schema has them", () => {
    const schema = JSON.parse(
      JSON.stringify(toJSONSchema(TurnReaderV65ResultSchema, { io: "input" })),
    ) as {
      properties: {
        question: {
          anyOf: { properties?: Record<string, unknown> }[];
        };
      };
    };
    const own = Object.keys(
      schema.properties.question.anyOf.find((s) => s.properties)?.properties ??
        {},
    );
    expect(V69_FIELDS_WHERE_THEY_BELONG).toContain(
      `question holds only its own fields (${own.join(", ")})`,
    );
    expect(V69_FIELDS_WHERE_THEY_BELONG).toMatch(
      /nextSteps.*top level of the object, beside question, never inside question/u,
    );
  });

  it("still refuses nextSteps inside question (strict), and reads it at the top level", () => {
    expect(TurnReaderV65ResultSchema.safeParse(REFUSED).success).toBe(false);
    const read = TurnReaderV65ResultSchema.parse({
      ...REFUSED,
      question: {
        kind: "ADVICE",
        text: "How investor-ready is my company right now?",
      },
      nextSteps: true,
    });
    expect(read.nextSteps).toBe(true);
    expect(read.question?.kind).toBe("ADVICE");
  });
});
