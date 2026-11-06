import { describe, expect, it } from "vitest";

import {
  TURN_SKIM_V9,
  TURN_SKIM_V10,
  TurnSkimV10ResultSchema,
  V7_WRITES,
  V10_DOCUMENT,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Acceptance 2026-11-04 (J3): "Write me a one-page memo on Ledgerline" was
 * held with "Drafting that note to Ledgerline now." A document about
 * someone is not a message to them.
 */
describe("TURN_SKIM v10: a document about someone is not a note to them", () => {
  it("is active, v9 kept whole plus the document rule, by meaning", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_SKIM");
    // v11 (2026-11-06) keeps v10 whole and adds onWeb.
    expect(active.definition.version).toBeGreaterThanOrEqual(10);
    expect(
      TURN_SKIM_V10.template.replace(`${V7_WRITES}${V10_DOCUMENT}`, V7_WRITES),
    ).toBe(TURN_SKIM_V9.template);
    expect(V10_DOCUMENT).toMatch(/by what it means, in any language/u);
    expect(V10_DOCUMENT).toMatch(/writes is false/u);
  });

  it("reads document leniently: absent or malformed is false", () => {
    const base = { kind: "OTHER", confidence: "HIGH" };
    expect(TurnSkimV10ResultSchema.parse(base).document).toBe(false);
    expect(
      TurnSkimV10ResultSchema.parse({ ...base, document: "yes" }).document,
    ).toBe(false);
    expect(
      TurnSkimV10ResultSchema.parse({ ...base, document: true }).document,
    ).toBe(true);
  });
});
