import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CompanyAnalystResultSchema } from "@capital-q/q-core";

import { schemaForGemini } from "../src/providers/google.js";

/**
 * Transport-level schema adaptation in the Google adapter (CQ-Q-006 §28).
 * Deterministic: no SDK call. The adapter removes only the keywords the
 * Gemini API rejects; Capital Q's Zod schema still enforces every bound.
 */
describe("schemaForGemini", () => {
  it("removes bounds, patterns and the $schema key, and nothing else", () => {
    const input = z.toJSONSchema(CompanyAnalystResultSchema);
    const text = JSON.stringify(schemaForGemini(input));
    for (const keyword of [
      "$schema",
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "pattern",
    ]) {
      expect(text, keyword).not.toContain(`"${keyword}"`);
    }
    // Structure the model needs survives.
    for (const keyword of [
      "properties",
      "required",
      "enum",
      "anyOf",
      "items",
      "additionalProperties",
    ]) {
      expect(text, keyword).toContain(`"${keyword}"`);
    }
    const out = schemaForGemini(input) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(out.properties).sort()).toEqual(
      Object.keys(
        (input as { properties: Record<string, unknown> }).properties,
      ).sort(),
    );
    expect(out.required).toEqual((input as { required: string[] }).required);
  });

  it("leaves scalars and arrays intact and does not mutate its input", () => {
    const input = {
      type: "array",
      items: { type: "string", maxLength: 3 },
      maxItems: 2,
    };
    const before = JSON.stringify(input);
    expect(schemaForGemini(input)).toEqual({
      type: "array",
      items: { type: "string" },
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(schemaForGemini("x")).toBe("x");
    expect(schemaForGemini(null)).toBeNull();
  });
});
