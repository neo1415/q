import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V29,
  COMPANY_ANALYST_V30,
  CompanyAnalystV26ResultSchema,
  CompanyAnalystV30ResultSchema,
  createDefaultPromptRegistry,
  OFFER_GUIDANCE,
  V30_CHANGES,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v30 (C3, 13 Nov 2026): the offer an answer closes with
 * is also returned as a record -- the sentence, the one tool of the turn
 * that does it, and what exactly -- so a yes binds to it. Every v29 rule
 * stays; the output schema adds `offer`, null by default.
 */
describe("COMPANY_ANALYST v30: the offer is a record", () => {
  const answer = {
    answer: "Savanna replied last week. Want me to draft a follow-up?",
    responseShape: "CONCISE",
    insufficientEvidence: false,
    recommendation: null,
  };

  it("was active on schema v30 (now v31), keeps v29 published, and differs only by its listed changes", () => {
    const registry = createDefaultPromptRegistry();
    // v31 (A8) succeeds it on the same schema; v30 stays published, deprecated.
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(32);
    expect(registry.get("COMPANY_ANALYST", 30)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(registry.get("COMPANY_ANALYST", 29)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V30.output.kind).toBe("STRUCTURED");
    const undone = [...V30_CHANGES]
      .reverse()
      .reduce(
        (text, [from, to]) => text.replace(to, from),
        COMPANY_ANALYST_V30.template,
      );
    expect(undone).toBe(COMPANY_ANALYST_V29.template);
    expect(COMPANY_ANALYST_V30.template).toContain(", offer.");
    expect(COMPANY_ANALYST_V30.template).toContain("(an offer also in offer)");
  });

  it("offer is optional (null), strict in shape, and described to the model in the schema", () => {
    expect(CompanyAnalystV30ResultSchema.parse(answer).offer).toBeNull();
    const offer = {
      said: "Want me to draft a follow-up?",
      action: "draft_follow_up",
      request: "Draft a follow-up to Savanna Seed about the call.",
    };
    expect(
      CompanyAnalystV30ResultSchema.parse({ ...answer, offer }).offer,
    ).toEqual(offer);
    expect(
      CompanyAnalystV30ResultSchema.safeParse({
        ...answer,
        offer: { ...offer, approved: true },
      }).success,
    ).toBe(false);
    // v26's schema stays as it was for the runs made under it.
    expect(
      CompanyAnalystV26ResultSchema.safeParse({ ...answer, offer }).success,
    ).toBe(false);
    expect(OFFER_GUIDANCE).toContain("exact name of the one tool");
  });
});
