import { describe, expect, it } from "vitest";

import {
  CriterionConfigSchema,
  GatewayPolicySchema,
  QualificationResultSchema,
  QualificationSubjectProjectionSchema,
  type CompanyQualificationProjection,
  type CriterionConfig,
  type CriterionRequiredness,
  type GatewayPolicy,
} from "../src/contracts/index.js";
import { generateGatewayPublicId } from "../src/domain/public-id.js";
import {
  QUALIFICATION_POLICY_VERSION,
  qualify,
} from "../src/domain/qualification.js";

/**
 * Owner decision 91 (2026-11-14), qualification result v2: a fact the
 * subject gave genuinely disagreeing values for is judged UNRESOLVED. It
 * never disqualifies, never blocks the door and never outranks what is
 * established; old projections and stored results still parse.
 */

const NOW = "2026-11-14T12:00:00.000Z";
const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-00000000000a";
const GATEWAY = "c0000000-0000-4000-8000-0000000000a1";
const VERSION = "c0000000-0000-4000-8000-0000000000a2";
const criterionId = (n: number) =>
  `c0000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function policyOf(
  specs: readonly {
    readonly config: CriterionConfig;
    readonly requiredness?: CriterionRequiredness;
  }[],
): GatewayPolicy {
  return GatewayPolicySchema.parse({
    gateway: {
      id: GATEWAY,
      tenantId: TENANT,
      investorOrganisationId: "c0000000-0000-4000-8000-0000000000a3",
      organisationId: "c0000000-0000-4000-8000-0000000000a4",
      publicId: generateGatewayPublicId(),
      name: "Seed programme",
      status: "ACTIVE",
      createdByUserId: USER,
      createdAt: NOW,
      updatedAt: NOW,
    },
    version: {
      id: VERSION,
      gatewayId: GATEWAY,
      tenantId: TENANT,
      versionNumber: 1,
      status: "PUBLISHED",
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      publicDescription: "We read every application.",
      qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
      createdByUserId: USER,
      publishedByUserId: USER,
      publishedAt: NOW,
      supersededAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    criteria: specs.map((spec, index) => ({
      id: criterionId(index + 1),
      versionId: VERSION,
      position: index + 1,
      requiredness: spec.requiredness ?? "REQUIRED",
      label: `criterion ${index + 1}`,
      config: CriterionConfigSchema.parse(spec.config),
    })),
  });
}

function company(
  overrides: Partial<CompanyQualificationProjection> = {},
): CompanyQualificationProjection {
  return {
    subject: {
      kind: "COMPANY",
      companyId: "44444444-0000-4000-8000-000000000001",
      tenantId: TENANT,
    },
    classifications: [],
    headquartersCountry: "NG",
    currentStageCode: "seed",
    raise: { amount: "500000", currency: "USD" },
    ...overrides,
  };
}

const GEO: CriterionConfig = {
  type: "GEOGRAPHY",
  allowedCountries: ["NG", "KE"],
};
const STAGE: CriterionConfig = {
  type: "STAGE",
  allowedStageCodes: ["pre_seed", "seed"],
};
const BAND: CriterionConfig = {
  type: "RAISE_SIZE",
  currency: "USD",
  minAmount: "250000",
  maxAmount: "1000000",
};
const CHEQUE: CriterionConfig = {
  type: "CHEQUE_COMPATIBILITY",
  currency: "USD",
  minCheque: "250000",
  maxCheque: "1000000",
};

const run = (
  policy: GatewayPolicy,
  projection: CompanyQualificationProjection,
) => qualify({ policy, projection, evaluatedAt: NOW });

describe("disputed facts (owner decision 91)", () => {
  it("a required rule on a disputed fact is UNRESOLVED and still admits the applicant", () => {
    const result = run(
      policyOf([{ config: GEO }, { config: STAGE }, { config: BAND }]),
      company({ disputed: ["RAISE"] }),
    );
    expect(result.criteria.map((c) => [c.status, c.reasonCode])).toEqual([
      ["MATCH", "GEOGRAPHY_COUNTRY_ALLOWED"],
      ["MATCH", "STAGE_ALLOWED"],
      ["UNRESOLVED", "RAISE_DISPUTED"],
    ]);
    expect(result.outcome).toBe("UNRESOLVED");
    expect(result.access).toBe("MAY_APPLY");
    expect(result.accessReasonCode).toBe("REQUIRED_CRITERIA_UNRESOLVED");
    expect(result.principalMismatches).toEqual([]);
    expect(result.unknowns).toEqual([]);
    expect(result.unresolved).toEqual([criterionId(3)]);
    // The disputed value is never read, even though one is present.
    expect(result.criteria[2]?.observed).toBeNull();
  });

  it("each disputed fact reads UNRESOLVED on every rule that uses it", () => {
    const result = run(
      policyOf([{ config: GEO }, { config: STAGE }, { config: CHEQUE }]),
      company({ disputed: ["HEADQUARTERS_COUNTRY", "CURRENT_STAGE", "RAISE"] }),
    );
    expect(result.criteria.map((c) => c.reasonCode)).toEqual([
      "GEOGRAPHY_DISPUTED",
      "STAGE_DISPUTED",
      "RAISE_DISPUTED",
    ]);
    expect(result.outcome).toBe("UNRESOLVED");
  });

  it("never outranks an established mismatch or a missing answer", () => {
    const policy = policyOf([{ config: GEO }, { config: BAND }]);
    expect(
      run(policy, company({ headquartersCountry: "GH", disputed: ["RAISE"] }))
        .outcome,
    ).toBe("NOT_QUALIFIED");
    expect(
      run(policy, company({ headquartersCountry: null, disputed: ["RAISE"] })),
    ).toMatchObject({
      outcome: "INSUFFICIENT_INFORMATION",
      access: "NEEDS_INFORMATION",
    });
  });

  it("a disputed preferred rule is reported and never gates", () => {
    const result = run(
      policyOf([{ config: GEO }, { config: BAND, requiredness: "PREFERRED" }]),
      company({ disputed: ["RAISE"] }),
    );
    expect(result.criteria[1]?.status).toBe("UNRESOLVED");
    expect(result.outcome).toBe("QUALIFIED");
    expect(result.unresolved).toEqual([]);
  });

  it("without disputes nothing changes, and v1 projections and results still parse", () => {
    const result = run(policyOf([{ config: GEO }]), company());
    expect(result.outcome).toBe("QUALIFIED");
    expect(result.unresolved).toEqual([]);
    const { unresolved: _v2Only, ...v1 } = result;
    expect(QualificationResultSchema.safeParse(v1).success).toBe(true);
    expect(QualificationResultSchema.safeParse(result).success).toBe(true);
    expect(
      QualificationSubjectProjectionSchema.safeParse(company()).success,
    ).toBe(true);
    expect(
      QualificationSubjectProjectionSchema.safeParse(
        company({ disputed: ["RAISE"] }),
      ).success,
    ).toBe(true);
  });
});
