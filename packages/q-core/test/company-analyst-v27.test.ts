import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V26,
  COMPANY_ANALYST_V27,
  createCandidatePromptRegistry,
  createDefaultPromptRegistry,
  V27_BASIS_FROM,
  V27_BASIS_TO,
  V27_CARDS_FROM,
  V27_CARDS_TO,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v27 is a candidate: it differs from v26 only in what
 * code now fills, and production keeps v26 until q-evals parity.
 */
describe("COMPANY_ANALYST v27 (candidate)", () => {
  it("changes only the basis and fit-card lines of v26", () => {
    expect(
      COMPANY_ANALYST_V27.template
        .replace(V27_BASIS_TO, V27_BASIS_FROM)
        .replace(V27_CARDS_TO, V27_CARDS_FROM),
    ).toBe(COMPANY_ANALYST_V26.template);
    expect(COMPANY_ANALYST_V27.output).toBe(COMPANY_ANALYST_V26.output);
  });

  it("is not in the production registry", () => {
    expect(
      createDefaultPromptRegistry().getActive("COMPANY_ANALYST").definition
        .version,
    ).toBe(26);
  });

  it("is active only in the candidate registry, with v26 kept to compare", () => {
    const candidate = createCandidatePromptRegistry();
    expect(candidate.getActive("COMPANY_ANALYST").definition.version).toBe(27);
    expect(candidate.get("COMPANY_ANALYST", 26)?.definition.status).toBe(
      "DEPRECATED",
    );
  });
});
