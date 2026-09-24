import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V8,
  COMPANY_ANALYST_V9,
  createPromptRegistry,
  PROMPT_DEFINITIONS,
} from "../src/index.js";

/**
 * Fit is not interest (acceptance directive E). The active analyst may
 * name likely prospects by fit; it may still produce no fit SCORE, and
 * interest stays something only a source can show.
 */
describe("COMPANY_ANALYST v9", () => {
  it("is the one active analyst version, v8 retired and still resolvable", () => {
    const registry = createPromptRegistry(PROMPT_DEFINITIONS);
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(9);
    expect(COMPANY_ANALYST_V8.status).toBe("DEPRECATED");
  });

  it("no longer bans saying who fits, only a fit score, and keeps interest to sources", () => {
    const template = COMPANY_ANALYST_V9.template;
    expect(COMPANY_ANALYST_V8.template).toContain(
      "investor fit or peer benchmark",
    );
    expect(template).not.toContain("investor fit or peer benchmark");
    expect(template).toContain("fit score or peer benchmark");
    expect(template).toContain("LIKELY INVESTORS");
    expect(template).toContain("labelled likely fit");
    expect(template).toContain("Interest is separate and needs a source");
    // Nothing else of v8 was lost.
    expect(template).toContain("ACTING, CORRECTIONS, MANDATES");
  });
});
