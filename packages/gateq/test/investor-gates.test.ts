import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CriterionConfigSchema,
  GatewayPolicySchema,
  type CompanyQualificationProjection,
  type CriterionConfig,
  type GatewayCriterion,
  type GatewayPolicy,
} from "../src/contracts/index.js";
import { createInvestorGateFits } from "../src/index.js";
import { generateGatewayPublicId } from "../src/domain/public-id.js";
import { QUALIFICATION_POLICY_VERSION } from "../src/domain/qualification.js";

/**
 * Q.05: a founder sees, per published gate, how their own company stands
 * on each criterion; never a threshold, never another company's facts.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-00000000000b";
const USER = "b0000000-0000-4000-8000-00000000000a";
const OWN_TENANT = "22222222-0000-4000-8000-000000000001";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const OTHER_COMPANY = "44444444-0000-4000-8000-000000000002";
const NOW = "2026-10-07T12:00:00.000Z";
const INVESTOR_A = "11111111-0000-4000-8000-000000000001";
const INVESTOR_B = "11111111-0000-4000-8000-000000000002";

function policyOf(
  investorOrganisationId: string,
  specs: readonly { label: string; config: CriterionConfig }[],
  status: "PUBLISHED" | "DRAFT" = "PUBLISHED",
): GatewayPolicy {
  const gatewayId = randomUUID();
  const versionId = randomUUID();
  const published = status === "PUBLISHED";
  const criteria: GatewayCriterion[] = specs.map((spec, index) => ({
    id: randomUUID() as GatewayCriterion["id"],
    versionId: versionId as GatewayCriterion["versionId"],
    position: index + 1,
    requiredness: "REQUIRED",
    label: spec.label,
    config: CriterionConfigSchema.parse(spec.config),
  }));
  return GatewayPolicySchema.parse({
    gateway: {
      id: gatewayId,
      tenantId: TENANT,
      investorOrganisationId,
      organisationId: ORG,
      publicId: generateGatewayPublicId(),
      name: "Seed programme",
      status: "ACTIVE",
      createdByUserId: USER,
      createdAt: NOW,
      updatedAt: NOW,
    },
    version: {
      id: versionId,
      gatewayId,
      tenantId: TENANT,
      versionNumber: 1,
      status,
      inboundMode: "QUALIFIED",
      publicTitle: "Seed-stage fintech",
      publicDescription: null,
      qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
      createdByUserId: USER,
      publishedByUserId: published ? USER : null,
      publishedAt: published ? NOW : null,
      supersededAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    criteria,
  });
}

const ownCompany: CompanyQualificationProjection = {
  subject: { kind: "COMPANY", companyId: COMPANY, tenantId: OWN_TENANT },
  classifications: [],
  headquartersCountry: "NG",
  currentStageCode: "seed",
  raise: null,
};

function world(policies: readonly GatewayPolicy[]) {
  const projected: { tenantId: string; companyId: string }[] = [];
  const fits = createInvestorGateFits({
    policies: {
      publishedPolicy: () => Promise.resolve(null),
      publishedPolicyByPublicId: () => Promise.resolve(null),
      publishedPoliciesForInvestorOrganisations: (ids) =>
        Promise.resolve(
          policies.filter((p) =>
            ids.includes(p.gateway.investorOrganisationId),
          ),
        ),
    },
    companies: {
      projectionFor: (query) => {
        projected.push(query);
        return Promise.resolve(
          query.tenantId === OWN_TENANT && query.companyId === COMPANY
            ? ownCompany
            : null,
        );
      },
    },
    clock: () => new Date(NOW),
  });
  return { fits, projected };
}

const gateA = policyOf(INVESTOR_A, [
  {
    label: "Seed or pre-seed",
    config: { type: "STAGE", allowedStageCodes: ["pre_seed", "seed"] },
  },
  {
    label: "East Africa only",
    config: { type: "GEOGRAPHY", allowedCountries: ["KE", "UG"] },
  },
  {
    label: "$500k to $3M raise",
    config: {
      type: "RAISE_SIZE",
      currency: "USD",
      minAmount: "500000",
      maxAmount: "3000000",
    },
  },
]);

describe("investor gates for a founder's own company (Q.05)", () => {
  it("says met, not met and not known yet per published criterion, by label only", async () => {
    const { fits } = world([gateA]);
    const [fit] = await fits.forOwnCompany({
      tenantId: OWN_TENANT,
      companyId: COMPANY,
      investorOrganisationIds: [INVESTOR_A],
    });
    expect(fit?.criteria.map((c) => [c.label, c.standing])).toEqual([
      ["Seed or pre-seed", "MET"],
      ["East Africa only", "NOT_MET"],
      ["$500k to $3M raise", "UNKNOWN"],
    ]);
    // The configured thresholds never leave: only the investor's labels.
    expect(JSON.stringify(fit)).not.toContain("3000000");
    expect(JSON.stringify(fit)).not.toContain("UG");
  });

  it("ignores drafts and investors without a gate", async () => {
    const draft = policyOf(
      INVESTOR_B,
      [
        {
          label: "Fintech",
          config: { type: "STAGE", allowedStageCodes: ["seed"] },
        },
      ],
      "DRAFT",
    );
    const { fits } = world([draft]);
    expect(
      await fits.forOwnCompany({
        tenantId: OWN_TENANT,
        companyId: COMPANY,
        investorOrganisationIds: [INVESTOR_A, INVESTOR_B],
      }),
    ).toEqual([]);
  });

  it("another tenant's company projects to nothing, so nothing comes back (cross-tenant)", async () => {
    const { fits, projected } = world([gateA]);
    expect(
      await fits.forOwnCompany({
        tenantId: OWN_TENANT,
        companyId: OTHER_COMPANY,
        investorOrganisationIds: [INVESTOR_A],
      }),
    ).toEqual([]);
    expect(
      await fits.forOwnCompany({
        tenantId: TENANT,
        companyId: COMPANY,
        investorOrganisationIds: [INVESTOR_A],
      }),
    ).toEqual([]);
    expect(projected).toHaveLength(2);
  });
});
