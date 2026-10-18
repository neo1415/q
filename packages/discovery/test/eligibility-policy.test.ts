import { describe, expect, it } from "vitest";

import {
  ELIGIBILITY_CRITERIA,
  ELIGIBILITY_POLICY_VERSION,
  ELIGIBILITY_REASON_CODES,
  EligibilityResultSchema,
} from "../src/eligibility/contracts.js";
import {
  DECLARED_TAXONOMY_SOURCES,
  declaredHardExclusions,
  evaluateHardEligibility,
  excludingRules,
  RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY,
  unverifiableHardExclusions,
  unverifiedExclusions,
  type EligibilityEvaluationInput,
} from "../src/eligibility/policy.js";
import type {
  ActiveMandateLookup,
  CompanyEligibilityFacts,
  MandateHardConstraint,
  MandateSnapshotForEligibility,
  MandateTaxonomyRule,
} from "../src/eligibility/ports.js";

/**
 * Golden REC-001 scenarios (packet §31) over the pure policy. Every input
 * is a canonical snapshot or declared policy; there is no field for a
 * memory, a document, a conversation or a public page, which is the point.
 */

const INVESTOR = "aaaaaaaa-0000-4000-8000-00000000aa01";
const OTHER_INVESTOR = "aaaaaaaa-0000-4000-8000-00000000aa02";
const COMPANY = "bbbbbbbb-0000-4000-8000-00000000bb01";
const COMPANY_ORG = "cccccccc-0000-4000-8000-00000000cc01";
const MANDATE = "dddddddd-0000-4000-8000-00000000dd01";
const GAMBLING = "eeeeeeee-0000-4000-8000-00000000ee01";
const PAYMENTS = "eeeeeeee-0000-4000-8000-00000000ee02";
const HARDWARE = "eeeeeeee-0000-4000-8000-00000000ee03";
const AT = "2026-09-18T10:00:00.000Z";

function company(
  overrides: Partial<CompanyEligibilityFacts> = {},
): CompanyEligibilityFacts {
  return {
    companyId: COMPANY,
    tenantId: "ffffffff-0000-4000-8000-00000000ff01",
    organisationId: COMPANY_ORG,
    companyStatus: "active",
    marketplaceVisibility: "network_visible",
    marketplaceParticipation: "ELIGIBLE",
    currentStageCode: "seed",
    headquartersCountry: "NG",
    ...overrides,
  };
}

function constraint(
  overrides: Partial<MandateHardConstraint> &
    Pick<MandateHardConstraint, "dimension">,
): MandateHardConstraint {
  return {
    operator: "IN",
    value: { kind: "codes", values: ["seed"] },
    importance: "HARD_EXCLUSION",
    isHardExclusion: true,
    automatedUse: "ELIGIBLE",
    ...overrides,
  };
}

function taxonomyRule(
  overrides: Partial<MandateTaxonomyRule> = {},
): MandateTaxonomyRule {
  return {
    nodeId: GAMBLING,
    vocabularyCode: "industry",
    preferenceStrength: "HARD_EXCLUSION",
    isExclusion: true,
    source: "user_selected",
    ...overrides,
  };
}

function mandate(
  overrides: Partial<MandateSnapshotForEligibility> = {},
): ActiveMandateLookup {
  return {
    kind: "FOUND",
    mandate: {
      mandateId: MANDATE,
      investorOrganisationId: INVESTOR,
      version: 3,
      status: "ACTIVE",
      constraints: [],
      taxonomyPreferences: [],
      ...overrides,
    },
  };
}

function input(
  overrides: Partial<EligibilityEvaluationInput> = {},
): EligibilityEvaluationInput {
  return {
    mode: "INVESTOR_DISCOVER",
    investorOrganisationId: INVESTOR,
    mandate: mandate(),
    company: company(),
    classifications: [
      { nodeId: PAYMENTS, vocabularyCode: "industry", source: "user_selected" },
    ],
    permittedToView: true,
    relationship: { kind: "NONE" },
    taxonomyVersion: { industry: 1 },
    evaluatedAt: AT,
    ...overrides,
  };
}

const outcomeOf = (
  r: ReturnType<typeof evaluateHardEligibility>,
  criterion: (typeof ELIGIBILITY_CRITERIA)[number],
) => r.criteria.find((c) => c.criterion === criterion);

describe("eligibility policy v1 — golden scenarios", () => {
  it("A. marketplace-ready, visible, matching hard mandate → ELIGIBLE", () => {
    const r = evaluateHardEligibility(input());
    expect(r.decision).toBe("ELIGIBLE");
    expect(r.reasonCodes).toEqual([]);
    expect(r.eligibilityPolicyVersion).toBe(ELIGIBILITY_POLICY_VERSION);
    expect(r.mandateId).toBe(MANDATE);
    expect(r.mandateVersion).toBe(3);
    expect(EligibilityResultSchema.parse(r)).toEqual(r);
  });

  it("B. not marketplace-ready → INELIGIBLE, even though network-visible", () => {
    const r = evaluateHardEligibility(
      input({ company: company({ marketplaceParticipation: "NOT_ELIGIBLE" }) }),
    );
    expect(r.decision).toBe("INELIGIBLE");
    expect(r.reasonCodes).toEqual(["COMPANY_NOT_MARKETPLACE_ELIGIBLE"]);
    expect(outcomeOf(r, "INVESTOR_DISCOVERABILITY")?.outcome).toBe("PASS");
  });

  it("C. not permitted for investor discovery → INELIGIBLE (classification or disclosure)", () => {
    const privateCompany = evaluateHardEligibility(
      input({
        company: company({ marketplaceVisibility: "organisation_private" }),
      }),
    );
    expect(privateCompany.decision).toBe("INELIGIBLE");
    expect(privateCompany.reasonCodes).toEqual([
      "COMPANY_NOT_DISCOVERABLE_BY_INVESTOR",
    ]);

    const disclosureDenied = evaluateHardEligibility(
      input({ permittedToView: false }),
    );
    expect(disclosureDenied.decision).toBe("INELIGIBLE");
    expect(disclosureDenied.reasonCodes).toEqual([
      "COMPANY_NOT_DISCOVERABLE_BY_INVESTOR",
    ]);
  });

  it("closed company → INELIGIBLE", () => {
    const r = evaluateHardEligibility(
      input({ company: company({ companyStatus: "closed" }) }),
    );
    expect(r.decision).toBe("INELIGIBLE");
    expect(r.reasonCodes).toContain("COMPANY_NOT_ACTIVE");
  });

  it("the investor's own company is not a counterpart", () => {
    const r = evaluateHardEligibility(
      input({ company: company({ organisationId: INVESTOR }) }),
    );
    expect(r.decision).toBe("INELIGIBLE");
    expect(r.reasonCodes).toEqual(["COMPANY_IS_INVESTORS_OWN"]);
  });

  it("D. explicit DECLARED taxonomy hard exclusion matches → INELIGIBLE", () => {
    const r = evaluateHardEligibility(
      input({
        mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
        classifications: [
          {
            nodeId: GAMBLING,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
      }),
    );
    expect(r.decision).toBe("INELIGIBLE");
    expect(r.reasonCodes).toEqual(["EXPLICIT_HARD_EXCLUSION"]);
  });

  describe("eligibility.v2: only a declared company classification answers a taxonomy hard exclusion", () => {
    const UNDECLARED = [
      "q_inferred",
      "document_extracted",
      "integration",
    ] as const;

    it("pins the policy version this behaviour belongs to", () => {
      expect(ELIGIBILITY_POLICY_VERSION).toBe("eligibility.v4");
    });

    it("an undeclared classification on the excluded node, alone in the vocabulary → UNKNOWN, kept (v3), never FAIL", () => {
      for (const source of UNDECLARED) {
        const r = evaluateHardEligibility(
          input({
            mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
            classifications: [
              { nodeId: GAMBLING, vocabularyCode: "industry", source },
            ],
          }),
        );
        expect(r.decision, source).toBe("ELIGIBLE");
        expect(outcomeOf(r, "HARD_EXCLUSION_TAXONOMY"), source).toEqual({
          criterion: "HARD_EXCLUSION_TAXONOMY",
          outcome: "UNKNOWN",
          reasonCode: "COMPANY_TAXONOMY_UNKNOWN",
          detail: null,
        });
        expect(r.reasonCodes, source).not.toContain("EXPLICIT_HARD_EXCLUSION");
      }
    });

    it("the same node, user_selected or admin_curated → FAIL, INELIGIBLE", () => {
      for (const source of DECLARED_TAXONOMY_SOURCES) {
        const r = evaluateHardEligibility(
          input({
            mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
            classifications: [
              { nodeId: GAMBLING, vocabularyCode: "industry", source },
            ],
          }),
        );
        expect(r.decision, source).toBe("INELIGIBLE");
        expect(outcomeOf(r, "HARD_EXCLUSION_TAXONOMY")?.outcome, source).toBe(
          "FAIL",
        );
        expect(r.reasonCodes, source).toEqual(["EXPLICIT_HARD_EXCLUSION"]);
      }
    });

    it("an undeclared classification elsewhere in the vocabulary does not answer it either → UNKNOWN, never PASS", () => {
      const r = evaluateHardEligibility(
        input({
          mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
          classifications: [
            {
              nodeId: PAYMENTS,
              vocabularyCode: "industry",
              source: "q_inferred",
            },
          ],
        }),
      );
      expect(r.decision).toBe("ELIGIBLE");
      expect(outcomeOf(r, "HARD_EXCLUSION_TAXONOMY")?.outcome).toBe("UNKNOWN");
      expect(unverifiedExclusions(r)).toEqual(["taxonomy"]);
    });

    it("a declared classification elsewhere answers the vocabulary; a Q inference on the excluded node does not override it → PASS", () => {
      const r = evaluateHardEligibility(
        input({
          mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
          classifications: [
            {
              nodeId: PAYMENTS,
              vocabularyCode: "industry",
              source: "user_selected",
            },
            {
              nodeId: GAMBLING,
              vocabularyCode: "industry",
              source: "q_inferred",
            },
          ],
        }),
      );
      expect(r.decision).toBe("ELIGIBLE");
      expect(outcomeOf(r, "HARD_EXCLUSION_TAXONOMY")?.outcome).toBe("PASS");
    });

    it("confirming the inference (it becomes user_selected) is what makes it exclude", () => {
      const inferred = evaluateHardEligibility(
        input({
          mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
          classifications: [
            {
              nodeId: GAMBLING,
              vocabularyCode: "industry",
              source: "q_inferred",
            },
          ],
        }),
      );
      const confirmed = evaluateHardEligibility(
        input({
          mandate: mandate({ taxonomyPreferences: [taxonomyRule()] }),
          classifications: [
            {
              nodeId: GAMBLING,
              vocabularyCode: "industry",
              source: "user_selected",
            },
          ],
        }),
      );
      expect([inferred.decision, confirmed.decision]).toEqual([
        "ELIGIBLE",
        "INELIGIBLE",
      ]);
      expect(excludingRules(confirmed)).toEqual(["taxonomy"]);
    });
  });

  it("E. AVOID match only → NOT ineligible (taxonomy and constraint)", () => {
    const r = evaluateHardEligibility(
      input({
        mandate: mandate({
          taxonomyPreferences: [
            taxonomyRule({
              nodeId: HARDWARE,
              preferenceStrength: "AVOID",
              isExclusion: false,
            }),
          ],
          constraints: [
            constraint({
              dimension: "business.attribute",
              value: { kind: "codes", values: ["hardware"] },
              importance: "AVOID",
              isHardExclusion: false,
            }),
            constraint({
              dimension: "stage",
              value: { kind: "codes", values: ["series_a"] },
              importance: "MUST",
              isHardExclusion: false,
            }),
          ],
        }),
        classifications: [
          {
            nodeId: HARDWARE,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
        company: company({ currentStageCode: "seed" }),
      }),
    );
    expect(r.decision).toBe("ELIGIBLE");
    expect(outcomeOf(r, "HARD_EXCLUSION_TAXONOMY")?.outcome).toBe(
      "NOT_APPLICABLE",
    );
    expect(outcomeOf(r, "HARD_EXCLUSION_STAGE")?.outcome).toBe(
      "NOT_APPLICABLE",
    );
    expect(outcomeOf(r, "HARD_EXCLUSION_OTHER")?.outcome).toBe(
      "NOT_APPLICABLE",
    );
  });

  it("F. hard stage mismatch → INELIGIBLE ('seed only' as NOT_IN, 'never series B' as IN)", () => {
    const seedOnly = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "stage",
              operator: "NOT_IN",
              value: { kind: "codes", values: ["seed"] },
            }),
          ],
        }),
        company: company({ currentStageCode: "series_a" }),
      }),
    );
    expect(seedOnly.decision).toBe("INELIGIBLE");
    expect(seedOnly.reasonCodes).toEqual(["STAGE_OUTSIDE_HARD_MANDATE"]);

    const neverSeriesB = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "stage",
              operator: "IN",
              value: { kind: "codes", values: ["series_b"] },
            }),
          ],
        }),
        company: company({ currentStageCode: "series_b" }),
      }),
    );
    expect(neverSeriesB.decision).toBe("INELIGIBLE");

    const seedIsFine = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "stage",
              operator: "NOT_IN",
              value: { kind: "codes", values: ["seed"] },
            }),
          ],
        }),
        company: company({ currentStageCode: "seed" }),
      }),
    );
    expect(seedIsFine.decision).toBe("ELIGIBLE");
  });

  it("G. required stage, company stage unknown → kept with the rule reported unverified (v3), not mismatch", () => {
    const r = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "stage",
              operator: "NOT_IN",
              value: { kind: "codes", values: ["seed"] },
            }),
          ],
        }),
        company: company({ currentStageCode: null }),
      }),
    );
    expect(r.decision).toBe("ELIGIBLE");
    expect(r.reasonCodes).toEqual(["COMPANY_STAGE_UNKNOWN"]);
    expect(outcomeOf(r, "HARD_EXCLUSION_STAGE")?.outcome).toBe("UNKNOWN");
    expect(unverifiedExclusions(r)).toEqual(["stage"]);
  });

  it("unknown geography under a hard geography rule → kept, unverified; known and outside → INELIGIBLE", () => {
    const rule = mandate({
      constraints: [
        constraint({
          dimension: "geography.country",
          operator: "NOT_IN",
          value: { kind: "codes", values: ["NG", "GH"] },
        }),
      ],
    });
    expect(
      evaluateHardEligibility(
        input({
          mandate: rule,
          company: company({ headquartersCountry: null }),
        }),
      ).decision,
    ).toBe("ELIGIBLE");
    const outside = evaluateHardEligibility(
      input({ mandate: rule, company: company({ headquartersCountry: "DE" }) }),
    );
    expect(outside.decision).toBe("INELIGIBLE");
    expect(outside.reasonCodes).toEqual(["GEOGRAPHY_OUTSIDE_HARD_MANDATE"]);
    expect(excludingRules(outside)).toEqual(["geography.country"]);
    expect(
      evaluateHardEligibility(
        input({
          mandate: rule,
          company: company({ headquartersCountry: "GH" }),
        }),
      ).decision,
    ).toBe("ELIGIBLE");
  });

  it("unknown taxonomy under a taxonomy exclusion → kept, unverified; classified elsewhere in that vocabulary → PASS", () => {
    const rule = mandate({ taxonomyPreferences: [taxonomyRule()] });
    const unclassified = evaluateHardEligibility(
      input({ mandate: rule, classifications: [] }),
    );
    expect(unclassified.decision).toBe("ELIGIBLE");
    expect(unverifiedExclusions(unclassified)).toEqual(["taxonomy"]);
    expect(unclassified.reasonCodes).toEqual(["COMPANY_TAXONOMY_UNKNOWN"]);

    const otherVocabularyOnly = evaluateHardEligibility(
      input({
        mandate: rule,
        classifications: [
          {
            nodeId: PAYMENTS,
            vocabularyCode: "product_category",
            source: "user_selected",
          },
        ],
      }),
    );
    expect(otherVocabularyOnly.decision).toBe("ELIGIBLE");
    expect(
      outcomeOf(otherVocabularyOnly, "HARD_EXCLUSION_TAXONOMY")?.outcome,
    ).toBe("UNKNOWN");

    const answered = evaluateHardEligibility(
      input({
        mandate: rule,
        classifications: [
          {
            nodeId: PAYMENTS,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
      }),
    );
    expect(answered.decision).toBe("ELIGIBLE");
  });

  it("a hard exclusion on a dimension canonical state cannot answer → kept (ADR 0020), naming only the dimension", () => {
    const r = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "red_flag",
              value: { kind: "codes", values: ["secret_red_flag_code"] },
            }),
          ],
        }),
      }),
    );
    // The live defect: an unmapped red_flag exclusion made every company
    // UNDETERMINED and the feed empty. Unknown never excludes.
    expect(r.decision).toBe("ELIGIBLE");
    expect(r.reasonCodes).toEqual(["HARD_CRITERION_NOT_EVALUABLE"]);
    // Slate-level, not per company: it is the same for every company.
    expect(unverifiedExclusions(r)).toEqual([]);
    expect(excludingRules(r)).toEqual([]);
    const other = outcomeOf(r, "HARD_EXCLUSION_OTHER");
    expect(other?.detail).toBe("red_flag");
    expect(JSON.stringify(r)).not.toContain("secret_red_flag_code");
  });

  it("a MANUAL_ONLY constraint is never a rule, whatever its importance", () => {
    const r = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "custom.text",
              operator: "EQ",
              value: {
                kind: "text",
                text: "never show me anything from Lagos",
              },
              automatedUse: "MANUAL_ONLY",
            }),
          ],
        }),
      }),
    );
    expect(r.decision).toBe("ELIGIBLE");
    expect(JSON.stringify(r)).not.toContain("Lagos");
  });

  it("H. DRAFT mandate with an exclusion has no effect; ACTIVE without it decides", () => {
    // The port returns the ACTIVE one; a DRAFT never reaches the policy as
    // FOUND. If one ever did, its status alone stops its rules being read.
    const draftPinned = evaluateHardEligibility(
      input({
        mandate: mandate({
          status: "DRAFT",
          taxonomyPreferences: [taxonomyRule()],
        }),
        classifications: [
          {
            nodeId: GAMBLING,
            vocabularyCode: "industry",
            source: "user_selected",
          },
        ],
      }),
    );
    expect(draftPinned.decision).toBe("UNDETERMINED");
    expect(draftPinned.reasonCodes).toEqual(["MANDATE_NOT_ACTIVE"]);
    expect(outcomeOf(draftPinned, "HARD_EXCLUSION_TAXONOMY")?.outcome).toBe(
      "NOT_APPLICABLE",
    );
    expect(draftPinned.mandateId).toBeNull();

    const closed = evaluateHardEligibility(
      input({ mandate: mandate({ status: "CLOSED" }) }),
    );
    expect(closed.reasonCodes).toEqual(["MANDATE_NOT_ACTIVE"]);
  });

  it("no ACTIVE mandate → UNDETERMINED; two ACTIVE and none pinned → UNDETERMINED", () => {
    expect(
      evaluateHardEligibility(input({ mandate: { kind: "NONE" } })).reasonCodes,
    ).toEqual(["NO_ACTIVE_MANDATE"]);
    expect(
      evaluateHardEligibility(input({ mandate: { kind: "AMBIGUOUS" } }))
        .reasonCodes,
    ).toEqual(["ACTIVE_MANDATE_AMBIGUOUS"]);
  });

  it("I. a Q-proposed exclusion cannot hard-exclude, even if a row carried isExclusion", () => {
    for (const source of ["q_inferred", "document_extracted", "integration"]) {
      const r = evaluateHardEligibility(
        input({
          mandate: mandate({ taxonomyPreferences: [taxonomyRule({ source })] }),
          classifications: [
            {
              nodeId: GAMBLING,
              vocabularyCode: "industry",
              source: "user_selected",
            },
          ],
        }),
      );
      expect(r.decision, source).toBe("ELIGIBLE");
    }
    expect([...DECLARED_TAXONOMY_SOURCES]).toEqual([
      "user_selected",
      "admin_curated",
    ]);
  });

  it("J. investor max cheque below the company's total round → not automatically ineligible", () => {
    // The policy has no cheque input at all: a $250k–$1m investor and a $3m
    // round can be a perfectly good partial ticket. The criterion records
    // that no hard rule applies rather than inventing one.
    const r = evaluateHardEligibility(
      input({
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "cheque.typical",
              operator: "EQ",
              value: { kind: "amount", amount: "500000", currency: "USD" },
              importance: "NEUTRAL",
              isHardExclusion: false,
            }),
          ],
        }),
      }),
    );
    expect(r.decision).toBe("ELIGIBLE");
    expect(outcomeOf(r, "CHEQUE_COMPATIBILITY")?.outcome).toBe(
      "NOT_APPLICABLE",
    );
  });

  it("K. relationship standing (v4): engaging keeps a company in Discover; an unknown state is UNDETERMINED; PASSED and DECLINED close", () => {
    expect(RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY).toEqual([
      "PASSED",
      "DECLINED",
    ]);
    // Founder 2026-10-05: Q expressing interest under a standing
    // instruction emptied Discover; engaging is not leaving.
    for (const currentState of [
      "DISCOVERED",
      "INTEREST_EXPRESSED",
      "CONNECTED",
      "MEETING_HELD",
      "IN_DILIGENCE",
      "PAUSED",
      "INVESTED",
    ]) {
      expect(
        evaluateHardEligibility(
          input({ relationship: { kind: "STATE", currentState } }),
        ).decision,
        currentState,
      ).toBe("ELIGIBLE");
    }
    const declined = evaluateHardEligibility(
      input({ relationship: { kind: "STATE", currentState: "DECLINED" } }),
    );
    expect(declined.decision).toBe("INELIGIBLE");
    expect(declined.reasonCodes).toEqual(["RELATIONSHIP_CLOSED"]);
    const unknown = evaluateHardEligibility(
      input({ relationship: { kind: "STATE", currentState: "SOMETHING_NEW" } }),
    );
    expect(unknown.decision).toBe("UNDETERMINED");
    expect(unknown.reasonCodes).toEqual(["RELATIONSHIP_STATE_UNKNOWN"]);
  });

  it("L. a post-meeting pass closes the pair until a material change (doc 19 §67)", () => {
    const passedAt = "2026-10-02T10:00:00.000Z";
    const passed = (
      latest: {
        readonly pitch?: string;
        readonly objective?: string;
        readonly version?: number;
      } = {},
    ) =>
      evaluateHardEligibility(
        input({
          relationship: {
            kind: "STATE",
            currentState: "PASSED",
            pass: {
              standing: {
                passedAt,
                mandateId: MANDATE,
                mandateVersion: latest.version ?? 3,
              },
              latestPitchReadyAt: latest.pitch ?? null,
              latestCapitalObjectiveAt: latest.objective ?? null,
            },
          },
        }),
      );
    // Closed: no evidence, older evidence, or no pass record read at all.
    for (const r of [
      passed(),
      passed({ pitch: "2026-09-01T00:00:00.000Z" }),
      evaluateHardEligibility(
        input({ relationship: { kind: "STATE", currentState: "PASSED" } }),
      ),
    ]) {
      expect(r.decision).toBe("INELIGIBLE");
      expect(r.reasonCodes).toEqual(["RELATIONSHIP_CLOSED"]);
    }
    // Reopened by a new pitch, a new raise, or a mandate that changed.
    expect(passed({ pitch: "2026-10-05T00:00:00.000Z" }).decision).toBe(
      "ELIGIBLE",
    );
    expect(passed({ objective: "2026-11-01T00:00:00.000Z" }).decision).toBe(
      "ELIGIBLE",
    );
    expect(passed({ version: 2 }).decision).toBe("ELIGIBLE");
  });

  it("a FAIL outranks an UNKNOWN: an ineligible company stays ineligible when its stage is unknown", () => {
    const r = evaluateHardEligibility(
      input({
        company: company({
          marketplaceParticipation: "NOT_ELIGIBLE",
          currentStageCode: null,
        }),
        mandate: mandate({
          constraints: [
            constraint({
              dimension: "stage",
              operator: "NOT_IN",
              value: { kind: "codes", values: ["seed"] },
            }),
          ],
        }),
      }),
    );
    expect(r.decision).toBe("INELIGIBLE");
    expect(r.reasonCodes).toEqual([
      "COMPANY_NOT_MARKETPLACE_ELIGIBLE",
      "COMPANY_STAGE_UNKNOWN",
    ]);
  });

  it("O. a company in another tenant is evaluated only on canonical facts, and a private one is ineligible", () => {
    const r = evaluateHardEligibility(
      input({
        company: company({
          tenantId: "99999999-0000-4000-8000-000000000099",
          marketplaceVisibility: "organisation_private",
        }),
        permittedToView: false,
      }),
    );
    expect(r.decision).toBe("INELIGIBLE");
    // Nothing but identifiers and codes leaves the policy.
    expect(Object.keys(r).sort()).toEqual(
      [
        "companyId",
        "criteria",
        "decision",
        "eligibilityPolicyVersion",
        "evaluatedAt",
        "investorOrganisationId",
        "mandateId",
        "mandateVersion",
        "mode",
        "reasonCodes",
        "taxonomyVersion",
      ].sort(),
    );
  });

  it("P. repeat evaluation is identical; criteria are complete and ordered; reasons sorted", () => {
    const base = input({
      mandate: mandate({
        constraints: [
          constraint({
            dimension: "geography.country",
            operator: "NOT_IN",
            value: { kind: "codes", values: ["NG"] },
          }),
          constraint({
            dimension: "red_flag",
            value: { kind: "codes", values: ["x"] },
          }),
        ],
        taxonomyPreferences: [taxonomyRule()],
      }),
      company: company({ headquartersCountry: null }),
      classifications: [],
    });
    const first = evaluateHardEligibility(base);
    for (let i = 0; i < 25; i += 1) {
      expect(evaluateHardEligibility(base)).toEqual(first);
    }
    expect(first.criteria.map((c) => c.criterion)).toEqual([
      ...ELIGIBILITY_CRITERIA,
    ]);
    expect(first.reasonCodes).toEqual([...first.reasonCodes].sort());
    expect(first.decision).toBe("ELIGIBLE");
    // Different evaluation time, same decision and reasons.
    const later = evaluateHardEligibility({
      ...base,
      evaluatedAt: "2026-09-19T10:00:00.000Z",
    });
    expect({ ...later, evaluatedAt: AT }).toEqual(first);
  });

  it("another investor's organisation id changes nothing but the subject; results are per pair", () => {
    const r = evaluateHardEligibility(
      input({
        investorOrganisationId: OTHER_INVESTOR,
        mandate: mandate({ investorOrganisationId: OTHER_INVESTOR }),
      }),
    );
    expect(r.investorOrganisationId).toBe(OTHER_INVESTOR);
    expect(r.decision).toBe("ELIGIBLE");
  });

  it("reason codes are stable machine values that never name a source", () => {
    for (const code of ELIGIBILITY_REASON_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(code).not.toMatch(
        /PRIVATE|DECK|DOCUMENT|MEMORY|NOTE|RESEARCH|WEB|TAVILY|CONVERSATION|TRANSCRIPT|INFERRED|MODEL/,
      );
    }
  });
});

describe("ADR 0020: a hard exclusion excludes only on positive evidence", () => {
  const redFlag = constraint({
    dimension: "red_flag",
    value: { kind: "codes", values: ["litigation"] },
  });
  const seedOnly = constraint({
    dimension: "stage",
    operator: "NOT_IN",
    value: { kind: "codes", values: ["seed"] },
  });

  it("an unevaluable exclusion keeps every company and is reported once per mandate", () => {
    const m = mandate({ constraints: [redFlag, seedOnly] });
    const kept = evaluateHardEligibility(
      input({ mandate: m, company: company({ currentStageCode: "seed" }) }),
    );
    expect(kept.decision).toBe("ELIGIBLE");
    expect(outcomeOf(kept, "HARD_EXCLUSION_OTHER")).toMatchObject({
      outcome: "UNKNOWN",
      reasonCode: "HARD_CRITERION_NOT_EVALUABLE",
      detail: "red_flag",
    });
    if (m.kind !== "FOUND") throw new Error("fixture");
    expect(unverifiableHardExclusions(m.mandate)).toEqual(["red_flag"]);
    expect(declaredHardExclusions(m.mandate)).toEqual(["red_flag", "stage"]);
  });

  it("a positive match on a checkable exclusion still excludes, whatever else is unknown", () => {
    const m = mandate({ constraints: [redFlag, seedOnly] });
    const excluded = evaluateHardEligibility(
      input({ mandate: m, company: company({ currentStageCode: "series_b" }) }),
    );
    expect(excluded.decision).toBe("INELIGIBLE");
    expect(excluded.reasonCodes).toEqual([
      "HARD_CRITERION_NOT_EVALUABLE",
      "STAGE_OUTSIDE_HARD_MANDATE",
    ]);
    expect(excludingRules(excluded)).toEqual(["stage"]);
  });

  it("UNKNOWN on a gate that is not an exclusion still withholds: no ACTIVE mandate is UNDETERMINED", () => {
    const r = evaluateHardEligibility(input({ mandate: { kind: "NONE" } }));
    expect(r.decision).toBe("UNDETERMINED");
  });
});
