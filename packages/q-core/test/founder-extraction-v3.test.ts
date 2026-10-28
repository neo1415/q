import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  FOUNDER_ONBOARDING_EXTRACTION_V2,
  FOUNDER_ONBOARDING_EXTRACTION_V3,
} from "../src/index.js";

/**
 * Deck reading 2026-10-28: v3 reads real decks. A new version, never an
 * edit of v2: v2 keeps its published text and is deprecated, v3 is active
 * with the same variables and result schema.
 */
describe("FOUNDER_ONBOARDING_EXTRACTION v3", () => {
  const registry = createDefaultPromptRegistry();

  it("is the active version, v2 retained but deprecated with the same output schema", () => {
    expect(registry.getActive("FOUNDER_ONBOARDING_EXTRACTION").versionId).toBe(
      "founder-onboarding-extraction/v3",
    );
    expect(
      registry.get("FOUNDER_ONBOARDING_EXTRACTION", 2)?.definition.status,
    ).toBe("DEPRECATED");
    expect(FOUNDER_ONBOARDING_EXTRACTION_V3.output).toEqual(
      FOUNDER_ONBOARDING_EXTRACTION_V2.output,
    );
    expect(FOUNDER_ONBOARDING_EXTRACTION_V3.variables).toEqual(
      FOUNDER_ONBOARDING_EXTRACTION_V2.variables,
    );
  });

  it("treats pages of one deck as separate sources for contradictions", () => {
    const template = FOUNDER_ONBOARDING_EXTRACTION_V3.template;
    expect(template).toContain(
      "including different pages or slides of the same document",
    );
    expect(template).toContain(
      "do not prefer the larger, the newer, the later slide",
    );
    // v2's text is untouched.
    expect(FOUNDER_ONBOARDING_EXTRACTION_V2.template).toContain(
      "where two supplied sources disagree",
    );
  });

  it("keeps non-English wording with an English gloss and figures exactly as written", () => {
    const template = FOUNDER_ONBOARDING_EXTRACTION_V3.template;
    expect(template).toContain("keep the original words in value and in quote");
    expect(template).toContain("English gloss in square brackets");
    expect(template).toContain("Never convert currencies");
    expect(template).toContain("a figure with no currency is ambiguous");
  });
});
