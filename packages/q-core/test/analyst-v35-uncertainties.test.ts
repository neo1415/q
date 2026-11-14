import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  COMPANY_ANALYST_V34,
  COMPANY_ANALYST_V35,
  CompanyAnalystV34ResultSchema,
  CompanyAnalystV35ResultSchema,
  createDefaultPromptRegistry,
  UNCERTAINTY_GUIDANCE,
} from "../src/index.js";

/**
 * Owner addendum "resolving investor uncertainty" (14 Nov 2026, slice 3):
 * the analyst names each uncertainty as structure -- statement, standing,
 * material, mattersFor, resolveBy -- and the offer names the uncertainty it
 * would resolve. v34's template word for word (the meaning is in the field
 * descriptions), so the research-acceptance recordings, which never call
 * the analyst, and every v34 answer stay valid.
 */
describe("COMPANY_ANALYST v35: uncertainties as structure", () => {
  const base = {
    answer: "Public reports put Maji Loop's October MRR at USD 42,000.",
    responseShape: "CONCISE",
    insufficientEvidence: false,
    recommendation: null,
  };

  it("is active on schema v35, on v34's template, with v34 deprecated", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(35);
    expect(registry.get("COMPANY_ANALYST", 34)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V35.template).toBe(COMPANY_ANALYST_V34.template);
    expect(COMPANY_ANALYST_V35.output).toMatchObject({
      kind: "STRUCTURED",
      schemaVersion: 35,
      schema: CompanyAnalystV35ResultSchema,
    });
  });

  it("is additive: a v34 answer is a v35 answer with no uncertainties", () => {
    const v34 = CompanyAnalystV34ResultSchema.parse(base);
    const v35 = CompanyAnalystV35ResultSchema.parse(v34);
    expect(v35.uncertainties).toEqual([]);
    expect(v35.offer).toBeNull();
  });

  it("keeps each standing distinct and refuses one KYB would set", () => {
    const one = (standing: string) => ({
      ...base,
      uncertainties: [
        {
          statement: "October MRR is reported by one outlet only.",
          standing,
          material: true,
          mattersFor: ["VALUATION"],
          resolveBy: ["CORROBORATION", "REQUEST_DOCUMENT"],
        },
      ],
    });
    for (const standing of [
      "REPORTED",
      "CORROBORATED",
      "CONTRADICTED",
      "FOUNDER_CONFIRMED",
      "DOCUMENT_SUPPORTED",
      "INDEPENDENTLY_VERIFIED",
    ]) {
      expect(
        CompanyAnalystV35ResultSchema.safeParse(one(standing)).success,
      ).toBe(true);
    }
    expect(
      CompanyAnalystV35ResultSchema.safeParse(one("KYB_VERIFIED")).success,
    ).toBe(false);
    expect(
      CompanyAnalystV35ResultSchema.safeParse(one("VERIFIED")).success,
    ).toBe(false);
  });

  it("an offer names the uncertainty it resolves, or none", () => {
    const parsed = CompanyAnalystV35ResultSchema.parse({
      ...base,
      offer: {
        said: "Want me to ask Maji Loop for October's bank statements?",
        action: "diligence_documents",
        request: "Ask Maji Loop for October 2026 bank statements.",
        about: "October MRR is reported by one outlet only.",
      },
    });
    expect(parsed.offer?.about).toBe(
      "October MRR is reported by one outlet only.",
    );
    const without = CompanyAnalystV35ResultSchema.parse({
      ...base,
      offer: {
        said: "Want me to draft a follow-up?",
        action: "WRITE_DOCUMENT",
        request: "Draft a follow-up.",
      },
    });
    expect(without.offer?.about).toBeNull();
  });

  it("says its meaning in the schema the model is given: answer first, offer only for a material one, never from KYB", () => {
    const json = JSON.stringify(
      z.toJSONSchema(CompanyAnalystV35ResultSchema, { io: "input" }),
    );
    expect(json).toContain(UNCERTAINTY_GUIDANCE.slice(0, 60));
    expect(UNCERTAINTY_GUIDANCE).toContain("never instead of it");
    expect(UNCERTAINTY_GUIDANCE).toContain(
      "Offer a next step only for a material one",
    );
    expect(UNCERTAINTY_GUIDANCE).toContain(
      "identity or company checks never verify",
    );
    expect(UNCERTAINTY_GUIDANCE).toContain("never as repeated disclaimers");
  });
});
