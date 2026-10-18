import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  acceptStructuredOutput,
  undoubleNewlines,
} from "../src/policy/structured.js";

/**
 * Run 7, 16 Oct: Q's answer on a company profile read
 * "Apapa.\n\nThe fit…" with the backslashes on screen. The model had
 * escaped its line breaks twice; JSON decoding left a backslash and an "n".
 */
const Schema = z
  .object({ answer: z.string(), findings: z.array(z.string()) })
  .strict();

// What the model wrote, as raw JSON text: `\\n` inside the string.
const doubled = String.raw`{"answer":"It addresses demurrage at Apapa.\\n\\nThe fit with your mandate is partial.","findings":["One.\\r\\nTwo."]}`;

describe("line breaks a model escaped twice", () => {
  it("reach the answer as real line breaks", () => {
    const outcome = acceptStructuredOutput(doubled, Schema);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.answer).toBe(
      "It addresses demurrage at Apapa.\n\nThe fit with your mandate is partial.",
    );
    expect(outcome.value.answer).not.toContain("\\n");
    expect(outcome.value.findings).toEqual(["One.\nTwo."]);
  });

  it("leave correctly escaped line breaks as they are", () => {
    const outcome = acceptStructuredOutput(
      '{"answer":"First.\\n\\nSecond.","findings":[]}',
      Schema,
    );
    expect(outcome.ok && outcome.value.answer).toBe("First.\n\nSecond.");
  });

  it("leave a backslash the model meant, beside real line breaks", () => {
    const meant = "Paths:\nC:\\new\\notes";
    expect(undoubleNewlines(meant)).toBe(meant);
  });
});
