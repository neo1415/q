import { geographyNodeId } from "@capital-q/taxonomy/countries";
import { describe, expect, it } from "vitest";

import { ELIGIBILITY_POLICY_VERSION } from "../src/eligibility/contracts.js";
import {
  evaluateHardEligibility,
  mustMatchCountries,
  unverifiedExclusions,
  type EligibilityEvaluationInput,
} from "../src/eligibility/policy.js";
import type {
  MandateSnapshotForEligibility,
  MandateTaxonomyRule,
} from "../src/eligibility/ports.js";

/**
 * Live investor onboarding, 15 Nov 2026 (D5): East Africa declared
 * "must match" (taxonomy.mandate_preferences east_africa MUST), and 25 of
 * 37 slate items were outside it (Nigeria, Mexico, UK, US, France, …).
 * eligibility.v6: a declared must-match geography is hard eligibility; a
 * company whose country is not stated stays eligible and labelled.
 */
const INVESTOR = "aaaaaaaa-0000-4000-8000-00000000aa01";
const EAST_AFRICA = geographyNodeId("east_africa");

const rule = (
  over: Partial<MandateTaxonomyRule> = {},
): MandateTaxonomyRule => ({
  nodeId: EAST_AFRICA,
  vocabularyCode: "geography",
  preferenceStrength: "MUST",
  isExclusion: false,
  source: "user_selected",
  ...over,
});

const mandateWith = (
  taxonomyPreferences: readonly MandateTaxonomyRule[],
): MandateSnapshotForEligibility => ({
  mandateId: "dddddddd-0000-4000-8000-00000000dd01",
  investorOrganisationId: INVESTOR,
  version: 16,
  status: "ACTIVE",
  constraints: [],
  taxonomyPreferences,
});

const evaluate = (
  country: string | null,
  taxonomyPreferences: readonly MandateTaxonomyRule[] = [rule()],
) => {
  const input: EligibilityEvaluationInput = {
    mode: "INVESTOR_DISCOVER",
    investorOrganisationId: INVESTOR,
    mandate: { kind: "FOUND", mandate: mandateWith(taxonomyPreferences) },
    company: {
      companyId: "bbbbbbbb-0000-4000-8000-00000000bb01",
      tenantId: "ffffffff-0000-4000-8000-00000000ff01",
      organisationId: "cccccccc-0000-4000-8000-00000000cc01",
      companyStatus: "active",
      marketplaceVisibility: "network_visible",
      marketplaceParticipation: "ELIGIBLE",
      currentStageCode: "seed",
      headquartersCountry: country,
    },
    classifications: [],
    permittedToView: true,
    relationship: { kind: "NONE" },
    taxonomyVersion: { geography: 1 },
    evaluatedAt: "2026-11-15T16:00:00.000Z",
  };
  return evaluateHardEligibility(input);
};

describe("eligibility.v6: a declared must-match geography is hard eligibility", () => {
  it("is a new policy version", () => {
    expect(ELIGIBILITY_POLICY_VERSION).toBe("eligibility.v6");
  });

  it("East Africa must-match admits Kenya and Uganda, and excludes Nigeria, Mexico and the UK", () => {
    expect(evaluate("KE").decision).toBe("ELIGIBLE");
    expect(evaluate("UG").decision).toBe("ELIGIBLE");
    for (const outside of ["NG", "MX", "GB", "US", "FR", "IN"]) {
      const r = evaluate(outside);
      expect(r.decision).toBe("INELIGIBLE");
      expect(r.reasonCodes).toContain("GEOGRAPHY_OUTSIDE_HARD_MANDATE");
    }
  });

  it("an unknown country stays eligible, labelled: unknown is not negative evidence", () => {
    const r = evaluate(null);
    expect(r.decision).toBe("ELIGIBLE");
    expect(unverifiedExclusions(r)).toContain("geography.country");
  });

  it("a strong or nice-to-have geography stays a ranking signal", () => {
    for (const strength of ["STRONG", "NICE"] as const) {
      expect(
        evaluate("NG", [rule({ preferenceStrength: strength })]).decision,
      ).toBe("ELIGIBLE");
    }
  });

  it("only the person's own selection is a rule: a Q inference is not", () => {
    expect(evaluate("NG", [rule({ source: "q_inferred" })]).decision).toBe(
      "ELIGIBLE",
    );
  });

  it("reads the region from the reference hierarchy, reproducibly", () => {
    const countries = mustMatchCountries(mandateWith([rule()]));
    expect(countries?.has("KE")).toBe(true);
    expect(countries?.has("TZ")).toBe(true);
    expect(countries?.has("NG")).toBe(false);
    expect(mustMatchCountries(mandateWith([]))).toBeNull();
  });
});
