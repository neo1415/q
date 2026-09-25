import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V8,
  COMPANY_ANALYST_V9,
  COMPANY_ANALYST_V10,
  createPromptRegistry,
  PROMPT_DEFINITIONS,
} from "../src/index.js";

/**
 * Fit is not interest (acceptance directive E). The active analyst may
 * name likely candidates by fit; it may still produce no fit SCORE, and
 * interest stays something only a source can show.
 */
describe("COMPANY_ANALYST v9", () => {
  it("no longer bans saying who fits, only a fit score, and keeps interest to sources", () => {
    const template = COMPANY_ANALYST_V9.template;
    expect(COMPANY_ANALYST_V8.template).toContain(
      "investor fit or peer benchmark",
    );
    expect(template).not.toContain("investor fit or peer benchmark");
    expect(template).toContain("fit score or peer benchmark");
    expect(template).toContain("LIKELY INVESTORS");
    // Nothing else of v8 was lost.
    expect(template).toContain("ACTING, CORRECTIONS, MANDATES");
  });
});

/**
 * v10 states the same rule as a concept. v9 keyed it to one question's
 * wording, which is a phrase list written in prose; the concept has to hold
 * for any wording and for any kind of counterpart, not only investors.
 */
describe("COMPANY_ANALYST v10", () => {
  it("is the one active analyst version, v9 retired and still resolvable", () => {
    const registry = createPromptRegistry(PROMPT_DEFINITIONS);
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(10);
    expect(COMPANY_ANALYST_V9.status).toBe("DEPRECATED");
    expect(registry.get("COMPANY_ANALYST", 9)?.definition.version).toBe(9);
  });

  it("separates already-involved (evidence) from would-suit (labelled inference) without keying on a question's wording", () => {
    const template = COMPANY_ANALYST_V10.template;
    expect(template).toContain("INVOLVED VERSUS SUITED");
    expect(template).toContain("Already involved is evidence");
    expect(template).toContain("labelled a likely fit to be checked");
    expect(template).not.toContain("LIKELY INVESTORS");
    expect(template).not.toContain("which investors would likely invest");
    expect(template).toContain("fit score or peer benchmark");
    expect(template).toContain("ACTING, CORRECTIONS, MANDATES");
  });
});
