import { describe, expect, it } from "vitest";

import {
  TURN_SKIM_V6,
  TURN_SKIM_V7,
  TurnSkimV7ResultSchema,
  V6_SUBJECT,
  V7_WRITES,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA F-23 (live 2026-10-23): "draft a note to the founders" was silent for
 * 16 s. The skim says, by meaning, that Q is asked to write something, so
 * the first words come at skim time.
 */
describe("TURN_SKIM v7: whether Q is asked to write something", () => {
  it("is the active skim, v6 kept whole plus one field", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_SKIM");
    expect(active.definition.version).toBe(7);
    expect(TURN_SKIM_V6.status).toBe("DEPRECATED");
    expect(TURN_SKIM_V7.template).toContain(`${V6_SUBJECT}${V7_WRITES}`);
    expect(TURN_SKIM_V7.template.replace(V7_WRITES, "")).toBe(
      TURN_SKIM_V6.template,
    );
    expect(V7_WRITES).toMatch(/by what it means, in any language/u);
  });

  it("is lenient: absent or malformed reads as false", () => {
    const base = { kind: "OTHER", confidence: "HIGH" };
    expect(TurnSkimV7ResultSchema.parse(base).writes).toBe(false);
    expect(
      TurnSkimV7ResultSchema.parse({ ...base, writes: "yes" }).writes,
    ).toBe(false);
    expect(TurnSkimV7ResultSchema.parse({ ...base, writes: true }).writes).toBe(
      true,
    );
  });
});
