import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V79,
  TURN_READER_V80,
  TurnReaderV79ResultSchema,
  TurnReaderV86ResultSchema,
  V78_WHAT_WAS_ASKED,
  V79_REFERENCE_NAMES,
  V80_NAME_AS_SAID,
} from "../src/index.js";

/**
 * TURN_READER v80 (live Q-IQ AMB-136 on 61b7a85): a partial or possibly
 * ambiguous company name they wrote ("Silo") is namedOther as written,
 * so code can check it against their record and ask when two fit.
 */
describe("TURN_READER v80", () => {
  it("v79 kept whole plus one line after REFERENCES BY NAME, on v79's schema (v81 is active)", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(86);
    expect(registry.get("TURN_READER", 80)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("TURN_READER", 79)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV86ResultSchema,
    );
    expect(TURN_READER_V80.variables).toEqual(TURN_READER_V79.variables);
    expect(TURN_READER_V80.template.replace(V80_NAME_AS_SAID, "")).toBe(
      TURN_READER_V79.template,
    );
    // The cached prefix up to v79's rule is unchanged.
    const before = `${V78_WHAT_WAS_ASKED}${V79_REFERENCE_NAMES}`;
    expect(TURN_READER_V80.template.indexOf(V80_NAME_AS_SAID)).toBe(
      TURN_READER_V80.template.indexOf(before) + before.length,
    );
  });

  it("says a partial name is namedOther as written, never completed or left null", () => {
    for (const said of [
      '("Silo", "the Ledger one")',
      "is still namedOther, written exactly as they wrote it",
      "never completed into a fuller name you guess",
      "never null because you cannot tell which one",
    ]) {
      expect(V80_NAME_AS_SAID).toContain(said);
    }
  });

  it("parses a reading with the partial name as namedOther", () => {
    const parsed = TurnReaderV79ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
      aboutNamedOther: true,
      namedOther: { name: "Silo", kind: "COMPANY" },
    });
    expect(parsed.namedOther).toEqual({ name: "Silo", kind: "COMPANY" });
  });
});
