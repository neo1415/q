import { describe, expect, it } from "vitest";

import { composeOwnMandateDocument } from "@capital-q/q-specialists";
import type { GetInvestorMandateOutput } from "@capital-q/q-tools";

import { MANDATE_LABELS } from "../src/composition/mandate-labels.js";

/**
 * R30 #8: the live mandate PDF printed raw enums ("SYNDICATE"), mangled
 * labels ("West africa", "Co invest"), a false "Geography is not yet
 * stated" when geography was filed as a taxonomy preference, and the
 * importance label inside the person's own sentence.
 */

const RECORD: GetInvestorMandateOutput = {
  investorOrganisationId: "a0000000-0000-4000-8000-0000000000aa",
  displayName: "Lagoon Angels",
  investorType: "SYNDICATE",
  deploymentState: "ACTIVELY_INVESTING",
  truncated: false,
  mandates: [
    {
      mandateId: "a0000000-0000-4000-8000-0000000000bb",
      status: "ACTIVE",
      version: 1,
      discoveryMode: null,
      cheque: null,
      stage: { minStageCode: "pre_seed", maxStageCode: "seed" },
      constraints: [
        {
          dimension: "investment_role",
          operator: "IN",
          value: { kind: "codes", values: ["co_invest"] },
          importance: "STRONG",
          isHardExclusion: false,
          automatedUse: "ELIGIBLE",
        },
        {
          dimension: "custom.text",
          operator: "EQ",
          value: { kind: "text", text: "We back operators, not decks." },
          importance: "NICE",
          isHardExclusion: false,
          automatedUse: "MANUAL_ONLY",
        },
      ],
      taxonomyPreferences: [
        {
          vocabularyCode: "geography",
          canonicalCode: "west_africa",
          preferenceStrength: "STRONG",
          isExclusion: false,
        },
        {
          vocabularyCode: "geography",
          canonicalCode: "nigeria",
          preferenceStrength: "STRONG",
          isExclusion: false,
        },
        {
          vocabularyCode: "industry",
          canonicalCode: "digital_health",
          preferenceStrength: "STRONG",
          isExclusion: false,
        },
      ],
      truthClass: "USER_CLAIM",
    },
  ],
};

describe("the mandate document in the words the person knows", () => {
  const doc = composeOwnMandateDocument(RECORD, MANDATE_LABELS);
  const text =
    doc === null
      ? ""
      : doc.content.sections.map((s) => `${s.heading}: ${s.body}`).join("\n");

  it("uses the definition's and the taxonomy's display names", () => {
    expect(text).toContain("Invests as: Syndicate.");
    expect(text).toContain("Deploying capital: Actively investing.");
    expect(text).toContain("Pre-seed to Seed.");
    expect(text).toContain("Co-invest alongside a lead");
    expect(text).toContain("West Africa");
    expect(text).toContain("Nigeria");
    expect(text).not.toMatch(/SYNDICATE|ACTIVELY|West africa|Co invest/);
  });

  it("does not call a dimension missing when it was filed as a taxonomy preference", () => {
    expect(doc?.content.gaps).not.toContain("Geography is not yet stated.");
    expect(doc?.content.gaps).not.toContain("Sectors are not yet stated.");
  });

  it("keeps how a preference counts outside the person's own words", () => {
    expect(text).toContain("We back operators, not decks (nice to have).");
    expect(text).not.toContain("decks. (");
  });
});
