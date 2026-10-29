import { describe, expect, it } from "vitest";

import { ONBOARDING_TYPED_REPLY_V3 } from "@capital-q/q-core";

import { withoutStepIds } from "../src/voice/typed-onboarding.js";

/**
 * Live 2026-10-29: every typed reply said asking=null (the checklist had no
 * ids; the template's example answer showed "asking": null), so a reopened
 * setup asked team size instead of the full-time question it had asked.
 */
describe("a typed reply can say which topic it asks", () => {
  it("v3 asks for the id whenever the reply asks something; no null example", () => {
    expect(ONBOARDING_TYPED_REPLY_V3.status).toBe("ACTIVE");
    expect(ONBOARDING_TYPED_REPLY_V3.template).not.toContain('"asking": null,');
    expect(ONBOARDING_TYPED_REPLY_V3.template).toContain(
      "the id shown beside that topic",
    );
  });

  it("an id the model writes into its message never reaches the person", () => {
    expect(
      withoutStepIds(
        "How do you invest: as an angel or through a fund? (id: I0.investor_type)",
        "investor",
      ),
    ).toBe("How do you invest: as an angel or through a fund?");
  });
});
