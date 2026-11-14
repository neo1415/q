import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V31,
  COMPANY_ANALYST_V32,
  createDefaultPromptRegistry,
  V32_CHANGES,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v32 (A8, live 14 Nov 2026, founder.maji-loop): after an
 * approved "$120k MRR in October", "Actually October MRR was $110k." made
 * no card, yet Q answered that the MRR was corrected and both were kept.
 * A correction is prepared like any stated figure and is never said
 * recorded, corrected or kept before approval. Same output schema.
 */
describe("COMPANY_ANALYST v32: a corrected figure is proposed, never said corrected", () => {
  it("is active on v31's schema, keeps v31 published, and differs only by its listed changes", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(32);
    expect(registry.get("COMPANY_ANALYST", 31)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V32.output).toBe(COMPANY_ANALYST_V31.output);
    const undone = [...V32_CHANGES]
      .reverse()
      .reduce(
        (text, [from, to]) => text.replace(to, from),
        COMPANY_ANALYST_V32.template,
      );
    expect(undone).toBe(COMPANY_ANALYST_V31.template);
  });

  it("prepares a correction with the figure tool and forbids saying it is corrected or kept", () => {
    const template = COMPANY_ANALYST_V32.template;
    expect(template).toContain(
      "A figure it reached, or a correction: also call propose_company_figure if held; never recorded, corrected or kept until they approve.",
    );
    expect(template).toContain(
      "Never say you did, will or are about to do what they asked",
    );
    // No keyword routing: no metric word is added to the template.
    expect(template.split("MRR").length).toBe(
      COMPANY_ANALYST_V31.template.split("MRR").length,
    );
  });
});
