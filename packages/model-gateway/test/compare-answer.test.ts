import { describe, expect, it } from "vitest";

import {
  COMPARE_ANSWER_FIELDS,
  COMPARE_ANSWER_SCHEMA,
  compareAnswerOutput,
  restatesVerdict,
} from "../src/q/compare-answer.js";
import { ledByVerdict, verdictSentence } from "../src/q/compare-table.js";

/**
 * Live 2026-10-26 (run 0adc1c1e): a compare code resolved still waited
 * 12.8 s for a writer asked for every field, and opened with code's
 * verdict said twice.
 */

const level = {
  leader: "Dawaledger",
  other: "Marketlight Grids",
  leaderScore: "7.6",
  otherScore: "7.6",
  level: true,
};
const leads = {
  leader: "Mizan",
  other: "Silo Credit",
  leaderScore: "7.8",
  otherScore: "6.1",
  level: false,
};

describe("the comparison's writer, asked for its own judgement only", () => {
  it("narrows the shape to the writer's own fields, all required", () => {
    const spec = compareAnswerOutput({
      kind: "STRUCTURED",
      schemaName: "company_analyst",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          [...COMPARE_ANSWER_FIELDS, "findings", "answerCards", "visual"].map(
            (field) => [field, { type: "string" }],
          ),
        ),
        required: [...COMPARE_ANSWER_FIELDS, "findings", "answerCards"],
      },
    });
    if (spec.kind !== "STRUCTURED") throw new Error("structured");
    expect(Object.keys(spec.jsonSchema["properties"] as object)).toEqual([
      ...COMPARE_ANSWER_FIELDS,
    ]);
    expect(spec.jsonSchema["required"]).toEqual([...COMPARE_ANSWER_FIELDS]);
    expect(spec.jsonSchema["additionalProperties"]).toBe(false);
  });

  it("fills what it was not asked for with the empty values", () => {
    const parsed = COMPARE_ANSWER_SCHEMA.parse({
      answer: "Traction separates them.",
      responseShape: "CONCISE",
      missingEvidence: ["Round terms are not known."],
      contradictions: [],
      insufficientEvidence: false,
      clarifyingQuestions: [],
      declined: false,
      actionTalk: [],
    });
    expect(parsed.recommendation).toBeNull();
    expect(parsed.findings).toEqual([]);
    expect(parsed.answerCards).toBeNull();
    expect(parsed.missingEvidence).toEqual(["Round terms are not known."]);
  });
});

describe("code's verdict is said once", () => {
  it("a sentence that only says the verdict again is a restatement", () => {
    expect(
      restatesVerdict(
        "Dawaledger and Marketlight Grids are level on mandate fit at 7.6 each.",
        level,
      ),
    ).toBe(true);
    expect(
      restatesVerdict("Mizan leads Silo Credit on fit, 7.8 to 6.1.", leads),
    ).toBe(true);
  });

  it("a sentence with anything of its own stays", () => {
    // Another number: the writer's own point.
    expect(
      restatesVerdict(
        "Mizan is at 7.8 and Silo Credit at 6.1, but Silo Credit grew 40% last quarter.",
        leads,
      ),
    ).toBe(false);
    // One company only, or no score.
    expect(restatesVerdict("Dawaledger is at 7.6.", level)).toBe(false);
    expect(
      restatesVerdict(
        "Dawaledger and Marketlight Grids sell to very different buyers.",
        level,
      ),
    ).toBe(false);
    // Longer than the verdict and a clause: it says more.
    expect(
      restatesVerdict(
        "Dawaledger and Marketlight Grids are level at 7.6, yet one sells to pharmacies on credit and the other runs solar grids for market clusters across northern Nigeria.",
        level,
      ),
    ).toBe(false);
  });

  it("the answer opens with the verdict, never followed by its restatement", () => {
    const text = ledByVerdict(
      `${verdictSentence(level)} Dawaledger and Marketlight Grids are level on mandate fit at 7.6 each. Dawaledger sells to pharmacies.`,
      level,
    );
    expect(text).toBe(
      `${verdictSentence(level)} Dawaledger sells to pharmacies.`,
    );
  });
});
