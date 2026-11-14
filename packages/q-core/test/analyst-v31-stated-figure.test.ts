import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V30,
  COMPANY_ANALYST_V31,
  createDefaultPromptRegistry,
  V31_CHANGES,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v31 (A8, live 13 Nov 2026, founder.maji-loop): "Good
 * news: we hit $120k MRR in October." went into userStatements only and no
 * approval card was made. The one rule about a fact they state now joins
 * it to the figure tool, and forbids implying a figure is recorded before
 * they approve it. Same output schema; every v30 rule stays.
 */
describe("COMPANY_ANALYST v31: a stated figure is proposed, never implied recorded", () => {
  it("was active on v30's schema (now v32), keeps v30 published, and differs only by its listed changes", () => {
    const registry = createDefaultPromptRegistry();
    // v32 (A8 corrections) succeeds it on the same schema.
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(32);
    expect(registry.get("COMPANY_ANALYST", 31)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("COMPANY_ANALYST", 30)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V31.output).toBe(COMPANY_ANALYST_V30.output);
    const undone = [...V31_CHANGES]
      .reverse()
      .reduce(
        (text, [from, to]) => text.replace(to, from),
        COMPANY_ANALYST_V31.template,
      );
    expect(undone).toBe(COMPANY_ANALYST_V30.template);
  });

  it("joins a stated figure to the figure tool by meaning, and to the approval it waits for", () => {
    const template = COMPANY_ANALYST_V31.template;
    expect(template).toContain(
      "A figure it reached: also call propose_company_figure if held; unrecorded until they approve.",
    );
    // The ACTING rule (never say it is done or awaiting approval) stays.
    expect(template).toContain(
      "Never say you did, will or are about to do what they asked",
    );
    // No keyword routing: no metric word is added to the template.
    expect(template.split("MRR").length).toBe(
      COMPANY_ANALYST_V30.template.split("MRR").length,
    );
  });
});
