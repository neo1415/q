import { describe, expect, it } from "vitest";
import { z } from "zod";

import { acceptStructuredOutput } from "../src/policy/structured.js";
import { ANALYST_LENIENT_FIELDS } from "../src/q/index.js";

/**
 * Live 2026-10-01: a reminder was prepared, then the answer's
 * `recommendation` came back as a string, the whole reading was refused,
 * and the person was told Q's reasoning service was unreachable.
 */
const Schema = z
  .object({
    answer: z.string(),
    recommendation: z
      .object({ statement: z.string(), confidence: z.string() })
      .strict()
      .nullable(),
    actionTalk: z.array(z.string()).default([]),
  })
  .strict();

describe("auxiliary fields of an answer", () => {
  it("a malformed required-but-nullable field stands as null, and the answer is kept", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({ answer: "Prepared.", recommendation: "Do it." }),
      Schema,
      { lenientFields: ANALYST_LENIENT_FIELDS },
    );
    expect(accepted.ok).toBe(true);
    expect(accepted.ok ? accepted.value.recommendation : "x").toBeNull();
    expect(accepted.ok ? accepted.value.answer : "").toBe("Prepared.");
  });

  it("a malformed field that is not auxiliary still refuses the answer", () => {
    expect(
      acceptStructuredOutput(
        JSON.stringify({ answer: 3, recommendation: null }),
        Schema,
        { lenientFields: ANALYST_LENIENT_FIELDS },
      ).ok,
    ).toBe(false);
  });
});

describe("the analyst answer schema (live 2026-10-09)", () => {
  it("is the schema of the prompt in use, so a v22 answer is never refused", async () => {
    const { COMPANY_ANALYST_V22 } = await import("@capital-q/q-core");
    const { ANALYST_RESULT_SCHEMA } = await import("../src/q/index.js");
    // v17 refused every answer that carried v22's `visual` (unknown key)
    // and re-ran it: 10-15 s on every turn.
    const output = COMPANY_ANALYST_V22.output;
    expect(output.kind === "STRUCTURED" ? output.schema : null).toBe(
      ANALYST_RESULT_SCHEMA,
    );
    expect(Object.keys(ANALYST_RESULT_SCHEMA.shape)).toContain("visual");
  });
});
