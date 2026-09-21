import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CRITERION_TYPES,
  CriterionConfigSchema,
  GatewayPolicySchema,
  PublicGatewaySchema,
  UNSUPPORTED_CRITERION_DIMENSIONS,
  type CompanyQualificationProjection,
  type CriterionConfig,
  type CriterionRequiredness,
  type GatewayCriterion,
  type GatewayInboundMode,
  type GatewayPolicy,
} from "../src/contracts/index.js";
import { generateGatewayPublicId } from "../src/domain/public-id.js";
import { publicProjectionOf } from "../src/domain/public-projection.js";
import {
  GateQPolicyNotPublishedError,
  QUALIFICATION_POLICY_VERSION,
  qualify,
} from "../src/domain/qualification.js";

/**
 * GateQ qualification goldens (CQ-GATE-001 §26 A–T).
 *
 * The engine is one pure function over one published policy and one bounded
 * projection, so these are the real thing rather than a model of it. The
 * cases that matter most are the ones where the honest answer is "nobody
 * has said": a gateway that turned silence into a refusal would reject
 * every company Capital Q has not finished learning about.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-00000000000b";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const USER = "b0000000-0000-4000-8000-00000000000a";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const NOW = "2026-09-21T12:00:00.000Z";

const node = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FINTECH = node(1);
const PAYMENTS = node(2);
const TOBACCO = node(9);

type CriterionSpec = {
  readonly requiredness?: CriterionRequiredness;
  readonly label?: string;
  readonly config: CriterionConfig;
};

type PolicyOverrides = {
  readonly status?: "DRAFT" | "PUBLISHED";
  readonly gatewayStatus?: "ACTIVE" | "DISABLED";
  readonly versionNumber?: number;
};

function policyOf(
  inboundMode: GatewayInboundMode,
  specs: readonly CriterionSpec[],
  overrides: PolicyOverrides = {},
): GatewayPolicy {
  const gatewayId = randomUUID();
  const versionId = randomUUID();
  const published = (overrides.status ?? "PUBLISHED") === "PUBLISHED";
  const criteria: GatewayCriterion[] = specs.map((spec, index) => ({
    id: randomUUID() as GatewayCriterion["id"],
    versionId: versionId as GatewayCriterion["versionId"],
    position: index + 1,
    requiredness: spec.requiredness ?? "REQUIRED",
    label: spec.label ?? `criterion ${index + 1}`,
    config: CriterionConfigSchema.parse(spec.config),
  }));
  return GatewayPolicySchema.parse({
    gateway: {
      id: gatewayId,
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      organisationId: ORG,
      publicId: generateGatewayPublicId(),
      name: "Seed programme",
      status: overrides.gatewayStatus ?? "ACTIVE",
      createdByUserId: USER,
      createdAt: NOW,
      updatedAt: NOW,
    },
    version: {
      id: versionId,
      gatewayId,
      tenantId: TENANT,
      versionNumber: overrides.versionNumber ?? 1,
      status: overrides.status ?? "PUBLISHED",
      inboundMode,
      publicTitle: "Seed-stage African fintech",
      publicDescription: "We read every application.",
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

function company(
  overrides: Partial<CompanyQualificationProjection> = {},
): CompanyQualificationProjection {
  return {
    companyId: COMPANY,
    tenantId: "22222222-0000-4000-8000-000000000001",
    classifications: [
      {
        vocabularyCode: "industry",
        nodeId: PAYMENTS,
        ancestorNodeIds: [FINTECH],
      },
    ],
    headquartersCountry: "NG",
    currentStageCode: "seed",
    raise: { amount: "500000", currency: "USD" },
    ...overrides,
  };
}

const SECTOR: CriterionConfig = {
  type: "TAXONOMY",
  vocabularyCode: "industry",
  allowedNodeIds: [FINTECH],
};
const GEO: CriterionConfig = {
  type: "GEOGRAPHY",
  allowedCountries: ["NG", "KE"],
};
const STAGE: CriterionConfig = {
  type: "STAGE",
  allowedStageCodes: ["pre_seed", "seed"],
};

const run = (policy: GatewayPolicy, projection = company()) =>
  qualify({ policy, projection, evaluatedAt: NOW });

describe("the door and the fit are two questions", () => {
  it("A: a CLOSED gateway admits nobody, however good the fit", () => {
    // The fit is still computed and still reported. A closed door is a
    // statement about the organisation's capacity, not a judgement about
    // whoever knocked.
    const result = run(
      policyOf("CLOSED", [{ config: SECTOR }, { config: GEO }]),
    );
    expect(result.access).toBe("MAY_NOT_APPLY");
    expect(result.accessReasonCode).toBe("GATEWAY_CLOSED");
    expect(result.outcome).toBe("QUALIFIED");
  });

  it("B: an OPEN gateway admits a poor fit, and still says it is a poor fit", () => {
    const result = run(
      policyOf("OPEN", [{ config: GEO }]),
      company({ headquartersCountry: "FR" }),
    );
    expect(result.access).toBe("MAY_APPLY");
    expect(result.accessReasonCode).toBe("GATEWAY_OPEN");
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.criteria[0]?.reasonCode).toBe(
      "GEOGRAPHY_COUNTRY_NOT_ALLOWED",
    );
  });

  it("a disabled gateway admits nobody, whatever its published mode says", () => {
    const result = run(
      policyOf("OPEN", [{ config: SECTOR }], { gatewayStatus: "DISABLED" }),
    );
    expect(result.access).toBe("MAY_NOT_APPLY");
    expect(result.accessReasonCode).toBe("GATEWAY_DISABLED");
  });

  it("refuses to decide anything from a draft", () => {
    // A draft is somebody's unsaved thought. Deciding a founder's access on
    // one would make it policy without anyone publishing it.
    expect(() =>
      run(policyOf("QUALIFIED", [{ config: SECTOR }], { status: "DRAFT" })),
    ).toThrow(GateQPolicyNotPublishedError);
  });
});

describe("a QUALIFIED gateway", () => {
  it("C: every required criterion matched", () => {
    const result = run(
      policyOf("QUALIFIED", [
        { config: SECTOR },
        { config: GEO },
        { config: STAGE },
      ]),
    );
    expect(result.outcome).toBe("QUALIFIED");
    expect(result.access).toBe("MAY_APPLY");
    expect(result.accessReasonCode).toBe("REQUIRED_CRITERIA_SATISFIED");
    expect(result.criteria.map((c) => c.status)).toEqual([
      "MATCH",
      "MATCH",
      "MATCH",
    ]);
  });

  it("D: one required mismatch refuses, and names which", () => {
    const policy = policyOf("QUALIFIED", [{ config: SECTOR }, { config: GEO }]);
    const result = run(policy, company({ headquartersCountry: "FR" }));
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.access).toBe("MAY_NOT_APPLY");
    expect(result.principalMismatches).toEqual([policy.criteria[1]?.id]);
    expect(result.unknowns).toEqual([]);
  });

  it("E: no mismatch but one required unknown asks rather than refuses", () => {
    // The difference between "you are not what we are looking for" and "we
    // do not know yet". Only the second has a next step, and GATE-002's
    // interview is where it gets asked.
    const policy = policyOf("QUALIFIED", [
      { config: SECTOR },
      { config: STAGE },
    ]);
    const result = run(policy, company({ currentStageCode: null }));
    expect(result.outcome).toBe("INSUFFICIENT_INFORMATION");
    expect(result.access).toBe("NEEDS_INFORMATION");
    expect(result.accessReasonCode).toBe("REQUIRED_INFORMATION_MISSING");
    expect(result.unknowns).toEqual([policy.criteria[1]?.id]);
  });

  it("E: a hard mismatch outranks a missing answer", () => {
    // Both are present; the refusal is the one that is already decided.
    const result = run(
      policyOf("QUALIFIED", [{ config: GEO }, { config: STAGE }]),
      company({ headquartersCountry: "FR", currentStageCode: null }),
    );
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.principalMismatches).toHaveLength(1);
    expect(result.unknowns).toHaveLength(1);
  });

  it("F: a preferred mismatch is reported and does not gate", () => {
    const result = run(
      policyOf("QUALIFIED", [
        { config: SECTOR },
        { config: GEO, requiredness: "PREFERRED" },
      ]),
      company({ headquartersCountry: "FR" }),
    );
    expect(result.outcome).toBe("QUALIFIED");
    expect(result.access).toBe("MAY_APPLY");
    expect(result.criteria[1]?.status).toBe("NO_MATCH");
    expect(result.principalMismatches).toEqual([]);
  });
});

describe("unknown is never a mismatch", () => {
  it("G: nothing missing is ever read as zero", () => {
    // Every dimension at once, all absent. Not one of them becomes a
    // refusal, because absence is not evidence.
    const result = run(
      policyOf("QUALIFIED", [
        { config: SECTOR },
        { config: GEO },
        { config: STAGE },
        {
          config: {
            type: "RAISE_SIZE",
            currency: "USD",
            minAmount: "100000",
            maxAmount: "2000000",
          },
        },
      ]),
      company({
        classifications: [],
        headquartersCountry: null,
        currentStageCode: null,
        raise: null,
      }),
    );
    expect(result.outcome).toBe("INSUFFICIENT_INFORMATION");
    expect(result.criteria.map((c) => c.status)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(result.principalMismatches).toEqual([]);
    expect(result.criteria.map((c) => c.reasonCode)).toEqual([
      "TAXONOMY_NOT_CLASSIFIED",
      "GEOGRAPHY_NOT_DECLARED",
      "STAGE_NOT_DECLARED",
      "RAISE_NOT_DECLARED",
    ]);
  });

  it("G: revenue, traction and readiness are absent rather than always unknown", () => {
    // A gateway cannot publish a policy Capital Q could never answer, so
    // these are not configurable at all. Each carries the reason it is not
    // safely computable, in code rather than only in a document.
    const dimensions = UNSUPPORTED_CRITERION_DIMENSIONS.map((d) => d.dimension);
    expect(dimensions).toEqual(["REVENUE", "TRACTION", "READINESS"]);
    for (const dimension of dimensions) {
      expect(CRITERION_TYPES as readonly string[]).not.toContain(dimension);
    }
    for (const entry of UNSUPPORTED_CRITERION_DIMENSIONS) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

describe("the canonical dimensions", () => {
  it("H: an allowed parent node admits its descendants", () => {
    // The investor said "fintech"; the company is classified "payments".
    // The hierarchy is the taxonomy context's answer, not a string match.
    const byAncestor = run(policyOf("QUALIFIED", [{ config: SECTOR }]));
    expect(byAncestor.criteria[0]?.reasonCode).toBe(
      "TAXONOMY_ANCESTOR_MATCHED",
    );

    const byNode = run(
      policyOf("QUALIFIED", [
        {
          config: {
            type: "TAXONOMY",
            vocabularyCode: "industry",
            allowedNodeIds: [PAYMENTS],
          },
        },
      ]),
    );
    expect(byNode.criteria[0]?.reasonCode).toBe("TAXONOMY_NODE_MATCHED");
  });

  it("H: a classification in another vocabulary is not an answer to this one", () => {
    const result = run(
      policyOf("QUALIFIED", [
        {
          config: {
            type: "TAXONOMY",
            vocabularyCode: "business_model",
            allowedNodeIds: [node(20)],
          },
        },
      ]),
    );
    expect(result.criteria[0]?.status).toBe("UNKNOWN");
    expect(result.criteria[0]?.reasonCode).toBe("TAXONOMY_NOT_CLASSIFIED");
  });

  it("I: a geography mismatch says so, with the country it saw", () => {
    const result = run(
      policyOf("QUALIFIED", [{ config: GEO }]),
      company({ headquartersCountry: "FR" }),
    );
    expect(result.criteria[0]?.reasonCode).toBe(
      "GEOGRAPHY_COUNTRY_NOT_ALLOWED",
    );
    expect(result.criteria[0]?.observed).toBe("FR");
  });

  it("J: a stage mismatch says so, with the stage it saw", () => {
    const result = run(
      policyOf("QUALIFIED", [{ config: STAGE }]),
      company({ currentStageCode: "series_b" }),
    );
    expect(result.criteria[0]?.reasonCode).toBe("STAGE_NOT_ALLOWED");
    expect(result.criteria[0]?.observed).toBe("series_b");
  });

  it("a raise band compares exact decimals, not floats", () => {
    const band: CriterionConfig = {
      type: "RAISE_SIZE",
      currency: "USD",
      minAmount: "250000",
      maxAmount: "1000000",
    };
    const at = (amount: string) =>
      run(
        policyOf("QUALIFIED", [{ config: band }]),
        company({ raise: { amount, currency: "USD" } }),
      ).criteria[0];
    expect(at("500000")?.reasonCode).toBe("RAISE_WITHIN_BAND");
    expect(at("100000")?.reasonCode).toBe("RAISE_BELOW_BAND");
    expect(at("9000000")?.reasonCode).toBe("RAISE_ABOVE_BAND");
    // Boundaries are inclusive, and 1000000 against 999999.99 is exactly
    // where a float comparison would start being interesting.
    expect(at("1000000")?.status).toBe("MATCH");
    expect(at("999999.99")?.status).toBe("MATCH");
    expect(at("1000000.01")?.status).toBe("NO_MATCH");
  });
});

describe("cheque compatibility", () => {
  const cheque: CriterionConfig = {
    type: "CHEQUE_COMPATIBILITY",
    currency: "USD",
    minCheque: "250000",
    maxCheque: "1000000",
  };

  it("K: the minimum cheque fitting inside the round is compatible", () => {
    // The rule the recommendation context wrote down and could not use: an
    // investor participates in a round, so the question is whether their
    // smallest cheque fits -- never whether their largest covers the whole
    // raise, which would reject every syndicated round.
    const result = run(policyOf("QUALIFIED", [{ config: cheque }]));
    expect(result.criteria[0]?.status).toBe("MATCH");
    expect(result.criteria[0]?.reasonCode).toBe("CHEQUE_FITS_RAISE");
  });

  it("K: a minimum cheque larger than the whole round is not", () => {
    const result = run(
      policyOf("QUALIFIED", [{ config: cheque }]),
      company({ raise: { amount: "100000", currency: "USD" } }),
    );
    expect(result.criteria[0]?.status).toBe("NO_MATCH");
    expect(result.criteria[0]?.reasonCode).toBe("CHEQUE_EXCEEDS_RAISE");
  });

  it("L: no declared raise is unknown, not a refusal", () => {
    const result = run(
      policyOf("QUALIFIED", [{ config: cheque }]),
      company({ raise: null }),
    );
    expect(result.criteria[0]?.status).toBe("UNKNOWN");
    expect(result.criteria[0]?.reasonCode).toBe("RAISE_NOT_DECLARED");
  });

  it("L: a different currency is unknown, because nothing here may invent a rate", () => {
    // An exchange rate is a number nobody in this system is authorised to
    // choose, and a converted amount would be indistinguishable from a
    // declared one.
    const result = run(
      policyOf("QUALIFIED", [{ config: cheque }]),
      company({ raise: { amount: "500000", currency: "NGN" } }),
    );
    expect(result.criteria[0]?.status).toBe("UNKNOWN");
    expect(result.criteria[0]?.reasonCode).toBe("CHEQUE_CURRENCY_DIFFERS");
  });
});

describe("hard exclusions", () => {
  const exclusion: CriterionConfig = {
    type: "EXCLUDED_TAXONOMY",
    vocabularyCode: "industry",
    excludedNodeIds: [TOBACCO],
  };

  it("M: a proven exclusion refuses", () => {
    const result = run(
      policyOf("QUALIFIED", [{ config: exclusion }]),
      company({
        classifications: [
          { vocabularyCode: "industry", nodeId: TOBACCO, ancestorNodeIds: [] },
        ],
      }),
    );
    expect(result.outcome).toBe("NOT_QUALIFIED");
    expect(result.criteria[0]?.reasonCode).toBe("EXCLUSION_MATCHED");
  });

  it("N: an unassessable one excludes nobody", () => {
    // An inferred exclusion is indistinguishable from a rejection nobody
    // decided. Unknown never excludes.
    const result = run(
      policyOf("QUALIFIED", [{ config: exclusion }]),
      company({ classifications: [] }),
    );
    expect(result.outcome).toBe("INSUFFICIENT_INFORMATION");
    expect(result.criteria[0]?.status).toBe("UNKNOWN");
    expect(result.criteria[0]?.reasonCode).toBe("EXCLUSION_NOT_ASSESSABLE");
  });

  it("a company classified elsewhere in the vocabulary is not excluded", () => {
    const result = run(policyOf("QUALIFIED", [{ config: exclusion }]));
    expect(result.criteria[0]?.status).toBe("MATCH");
    expect(result.criteria[0]?.reasonCode).toBe("EXCLUSION_NOT_MATCHED");
  });
});

describe("versions", () => {
  it("P: a result names the exact version it was decided under", () => {
    const policy = policyOf("QUALIFIED", [{ config: SECTOR }], {
      versionNumber: 3,
    });
    const result = run(policy);
    expect(result.gatewayVersionNumber).toBe(3);
    expect(result.gatewayVersionId).toBe(policy.version.id);
    expect(result.qualificationPolicyVersion).toBe(
      QUALIFICATION_POLICY_VERSION,
    );
    // Never "current": a stored result has to stay readable after the
    // organisation publishes something else.
    expect(JSON.stringify(result)).not.toContain("current");
  });

  it("is deterministic: the same policy and projection always agree", () => {
    const policy = policyOf("QUALIFIED", [{ config: SECTOR }, { config: GEO }]);
    const projection = company();
    const first = qualify({ policy, projection, evaluatedAt: NOW });
    for (let i = 0; i < 4; i += 1) {
      expect(qualify({ policy, projection, evaluatedAt: NOW })).toEqual(first);
    }
  });
});

describe("what qualification is not", () => {
  it("R and S: it produces no score and no relationship", () => {
    // The whole result, inspected. There is no number in it to become a
    // ranking input and no field through which a relationship could be
    // created: a qualification is an answer, not an act.
    const result = run(policyOf("QUALIFIED", [{ config: SECTOR }]));
    const text = JSON.stringify(result).toLowerCase();
    for (const forbidden of [
      "score",
      "rank",
      "weight",
      "relationship",
      "quality",
      "investiq",
      "readiness",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(Object.keys(result).sort()).toEqual(
      [
        "access",
        "accessReasonCode",
        "companyId",
        "criteria",
        "evaluatedAt",
        "gatewayId",
        "gatewayVersionId",
        "gatewayVersionNumber",
        "inboundMode",
        "outcome",
        "principalMismatches",
        "qualificationPolicyVersion",
        "unknowns",
      ].sort(),
    );
  });

  it("T: no private marker can reach the result, because none can reach the input", () => {
    // The projection type has nowhere to put a document, a conversation or
    // a Q conclusion, so a founder-private marker cannot be carried in and
    // therefore cannot be carried out.
    const projection = company();
    expect(Object.keys(projection).sort()).toEqual([
      "classifications",
      "companyId",
      "currentStageCode",
      "headquartersCountry",
      "raise",
      "tenantId",
    ]);
    const smuggled = {
      ...projection,
      founderPrivateNote: "FOUNDER_PRIVATE_MARKER",
    } as CompanyQualificationProjection;
    const result = run(policyOf("QUALIFIED", [{ config: SECTOR }]), smuggled);
    expect(JSON.stringify(result)).not.toContain("FOUNDER_PRIVATE_MARKER");
  });
});

describe("the public projection", () => {
  it("shows what is asked about, never the configured answers", () => {
    const policy = policyOf("QUALIFIED", [
      { config: SECTOR, label: "Sector" },
      { config: GEO, label: "Where you are", requiredness: "PREFERRED" },
    ]);
    const projection = publicProjectionOf({
      policy,
      organisationDisplayName: "Acme Ventures",
    });
    expect(projection).not.toBeNull();
    if (projection === null) return;
    expect(() => PublicGatewaySchema.parse(projection)).not.toThrow();
    expect(projection.criteria).toEqual([
      { label: "Sector", requiredness: "REQUIRED", dimension: "TAXONOMY" },
      {
        label: "Where you are",
        requiredness: "PREFERRED",
        dimension: "GEOGRAPHY",
      },
    ]);
    const text = JSON.stringify(projection);
    // The node ids and the country list are the organisation's commercial
    // position, not public information.
    for (const forbidden of [FINTECH, '"NG"', '"KE"', USER, INVESTOR, TENANT]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("O: a draft has no public existence at all", () => {
    const draft = policyOf("QUALIFIED", [{ config: SECTOR }], {
      status: "DRAFT",
    });
    expect(
      publicProjectionOf({ policy: draft, organisationDisplayName: "Acme" }),
    ).toBeNull();
  });

  it("a disabled gateway has none either", () => {
    const disabled = policyOf("OPEN", [{ config: SECTOR }], {
      gatewayStatus: "DISABLED",
    });
    expect(
      publicProjectionOf({ policy: disabled, organisationDisplayName: "Acme" }),
    ).toBeNull();
  });

  it("a closed gateway is visible and says it is closed", () => {
    // Not a 404. Hiding it would turn "we are not taking unsolicited
    // applications" into "this link is wrong", which is worse for the
    // founder and no safer for the investor.
    const closed = policyOf("CLOSED", [{ config: SECTOR }]);
    const projection = publicProjectionOf({
      policy: closed,
      organisationDisplayName: "Acme",
    });
    expect(projection?.inboundMode).toBe("CLOSED");
    expect(projection?.acceptingApplications).toBe(false);
  });
});

describe("the public identifier", () => {
  it("is opaque, unguessable and carries nothing", () => {
    const ids = new Set(
      Array.from({ length: 500 }, () => generateGatewayPublicId()),
    );
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^gq_[0-9a-hjkmnp-tv-z]{26}$/);
      // No organisation, tenant or sequence is recoverable from it.
      expect(id).not.toContain(ORG.slice(0, 8));
    }
  });
});
