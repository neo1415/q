import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V21,
  COMPANY_ANALYST_V22,
  CompanyAnalystV22ResultSchema,
  createDefaultPromptRegistry,
  V21_NO_DISCLAIMER_LINE,
  V22_VISUAL_LINE,
} from "../src/index.js";

/**
 * RECOVERY-2026-10 (workstream E's request): COMPANY_ANALYST v22 lets the
 * model ask for a standalone visual. It names only the kind; what is drawn
 * comes from the run's reads (model-gateway result-blocks).
 */

const answer = {
  answer: "Three investors fit, two in Lagos.",
  responseShape: "CONCISE",
  insufficientEvidence: false,
};

describe("COMPANY_ANALYST v22", () => {
  it("is active and adds only the visual line after v21's disclaimer rule", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(22);
    expect(COMPANY_ANALYST_V22.template).toBe(
      COMPANY_ANALYST_V21.template.replace(
        V21_NO_DISCLAIMER_LINE,
        `${V21_NO_DISCLAIMER_LINE}\n${V22_VISUAL_LINE}`,
      ),
    );
    // v21 is kept, so runs made under it stay explained.
    expect(registry.get("COMPANY_ANALYST", 21)?.definition.status).toBe(
      "DEPRECATED",
    );
  });

  it("takes MAP, TABLE, CHART or TIMELINE, and nothing otherwise", () => {
    const visual = CompanyAnalystV22ResultSchema.shape.visual;
    for (const kind of ["MAP", "TABLE", "CHART", "TIMELINE"] as const) {
      expect(visual.parse(kind)).toBe(kind);
    }
    expect(visual.parse(undefined)).toBeNull();
    expect(visual.safeParse("PIE").success).toBe(false);
    // The rest of the answer is v19's, unchanged.
    expect(Object.keys(CompanyAnalystV22ResultSchema.shape)).toContain(
      "answer",
    );
    expect(answer.answer.length).toBeGreaterThan(0);
  });
});
