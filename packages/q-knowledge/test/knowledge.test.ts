import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import {
  classifyConfidence,
  derivedKnowledgeSensitivity,
  derivedKnowledgeVisibility,
  evidenceStatusForSupport,
  KnowledgeCandidateSchema,
  KNOWLEDGE_STATUSES,
  knowledgeConstraintsFor,
  knowledgeValuesAgree,
  sourceEnvironmentFor,
  truthClassForKnowledge,
} from "../src/index.js";

/**
 * The deterministic half of CQ-KNW-002: everything a candidate is not
 * allowed to decide. No model, no database, no clock.
 */

const COMPANY = "44444444-4444-4444-8444-444444444444";

describe("what a candidate cannot say", () => {
  const base = {
    subject: { subjectType: "COMPANY" as const, subjectId: COMPANY },
    knowledgeType: "fact" as const,
    knowledgeKey: "financial.arr",
    statement: "Annual recurring revenue is approximately USD 2.4m.",
    structuredValue: { kind: "MONEY", amount: 2_400_000, currency: "USD" },
    truthClassProposal: "USER_CLAIM" as const,
    supportingClaimIds: [],
    supportingEvidenceItemIds: ["55555555-5555-4555-8555-555555555555"],
    supportingSourceIds: [],
    validFrom: null,
    validTo: null,
    lineage: [],
    reason: "EXTRACTED_FROM_DOCUMENT",
  };

  it("accepts a well-formed candidate", () => {
    expect(KnowledgeCandidateSchema.safeParse(base).success).toBe(true);
  });

  it("cannot express VERIFIED", () => {
    // Not rejected by a rule — absent from the enum. A candidate asking to
    // be verified is asking for a value this type cannot hold.
    const result = KnowledgeCandidateSchema.safeParse({
      ...base,
      truthClassProposal: "VERIFIED",
    });
    expect(result.success).toBe(false);
  });

  it("has no field for status, confidence, visibility or sensitivity", () => {
    for (const extra of [
      { status: "ACTIVE" },
      { confidenceClass: "HIGH" },
      { confidence: 0.92 },
      { visibilityScope: "network_visible" },
      { sensitivityClass: "INTERNAL" },
      { tenantId: "11111111-1111-4111-8111-111111111111" },
      { evidenceStatus: "PLATFORM_VERIFIED" },
    ]) {
      // `.strict()` refuses the key outright; there is nowhere to put it.
      expect(
        KnowledgeCandidateSchema.safeParse({ ...base, ...extra }).success,
      ).toBe(false);
    }
  });

  it("refuses an inference dressed as a source assertion", () => {
    expect(
      KnowledgeCandidateSchema.safeParse({
        ...base,
        knowledgeType: "inference",
        truthClassProposal: "USER_CLAIM",
      }).success,
    ).toBe(false);
    expect(
      KnowledgeCandidateSchema.safeParse({
        ...base,
        knowledgeType: "inference",
        truthClassProposal: "Q_INFERENCE",
      }).success,
    ).toBe(true);
  });

  it("refuses a reversed validity window", () => {
    expect(
      KnowledgeCandidateSchema.safeParse({
        ...base,
        validFrom: "2026-07-01T00:00:00.000Z",
        validTo: "2026-06-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("truth class", () => {
  it("never returns VERIFIED", () => {
    for (const proposal of [
      "USER_CLAIM",
      "ESTIMATE",
      "Q_INFERENCE",
      "UNKNOWN",
    ] as const) {
      for (const count of [0, 1, 5]) {
        expect(truthClassForKnowledge(proposal, count)).not.toBe("VERIFIED");
      }
    }
  });

  it("falls to UNKNOWN with no evidence, and UNKNOWN is not negative", () => {
    // The model may know what ARR means; it may not know this company's ARR.
    expect(truthClassForKnowledge("USER_CLAIM", 0)).toBe("UNKNOWN");
    // Unknown is not zero, not false and not a poor mark about the subject.
    expect(truthClassForKnowledge("USER_CLAIM", 1)).toBe("USER_CLAIM");
  });

  it("keeps an inference an inference", () => {
    expect(truthClassForKnowledge("Q_INFERENCE", 3)).toBe("Q_INFERENCE");
  });
});

describe("evidence status", () => {
  it("does not call one source agreeing with itself multi-source support", () => {
    expect(
      evidenceStatusForSupport({
        supportingEvidenceCount: 3,
        distinctSourceCount: 1,
        strongestInputStatus: "DOCUMENT_SUPPORTED",
      }),
    ).toBe("DOCUMENT_SUPPORTED");
    expect(
      evidenceStatusForSupport({
        supportingEvidenceCount: 2,
        distinctSourceCount: 2,
        strongestInputStatus: "DOCUMENT_SUPPORTED",
      }),
    ).toBe("MULTI_SOURCE_SUPPORTED");
  });

  it("never produces a verified status", () => {
    for (const distinct of [0, 1, 2, 9]) {
      const status = evidenceStatusForSupport({
        supportingEvidenceCount: 4,
        distinctSourceCount: distinct,
        strongestInputStatus: "PLATFORM_VERIFIED",
      });
      expect(["EXTERNALLY_VERIFIED", "PLATFORM_VERIFIED"]).not.toContain(
        status,
      );
    }
  });

  it("reports no evidence as no evidence", () => {
    expect(
      evidenceStatusForSupport({
        supportingEvidenceCount: 0,
        distinctSourceCount: 0,
        strongestInputStatus: null,
      }),
    ).toBe("NO_EVIDENCE");
  });
});

describe("confidence", () => {
  const at = (
    overrides: Partial<Parameters<typeof classifyConfidence>[0]> = {},
  ) =>
    classifyConfidence({
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      distinctSourceCount: 1,
      hasContradictingEvidence: false,
      supportWithdrawn: false,
      ...overrides,
    });

  it("is categorical and carries a named reason, never a number", () => {
    const decision = at();
    expect(decision.confidenceClass).toBe("MODERATE");
    expect(decision.reason).toBe("SINGLE_DOCUMENT_SOURCE");
    expect(JSON.stringify(decision)).not.toMatch(/0\.\d|%|\b\d{2}\b/);
  });

  it("reaches HIGH only from verified evidence", () => {
    for (const status of [
      "SELF_REPORTED",
      "DOCUMENT_SUPPORTED",
      "MULTI_SOURCE_SUPPORTED",
    ] as const) {
      expect(
        at({ evidenceStatus: status, distinctSourceCount: 9 }).confidenceClass,
      ).not.toBe("HIGH");
    }
    // A pitch deck agreeing with itself nine times is still a pitch deck.
    expect(at({ evidenceStatus: "PLATFORM_VERIFIED" }).confidenceClass).toBe(
      "HIGH",
    );
  });

  it("puts conflict and withdrawal ahead of every gradation", () => {
    expect(
      at({
        evidenceStatus: "PLATFORM_VERIFIED",
        hasContradictingEvidence: true,
      }),
    ).toEqual({
      confidenceClass: "CONFLICTING_EVIDENCE",
      reason: "CONFLICTING_SUPPORT",
    });
    expect(
      at({ evidenceStatus: "PLATFORM_VERIFIED", supportWithdrawn: true }),
    ).toEqual({
      confidenceClass: "INSUFFICIENT_EVIDENCE",
      reason: "SUPPORT_WITHDRAWN",
    });
  });

  it("keeps an inference below what a source asserted", () => {
    expect(
      at({ truthClass: "Q_INFERENCE", distinctSourceCount: 5 }).confidenceClass,
    ).toBe("LOW");
    expect(at({ truthClass: "ESTIMATE" }).confidenceClass).toBe("LOW");
  });

  it("says insufficient when Q could not establish it", () => {
    // Not a low mark about the subject: Q looked and could not find enough.
    expect(at({ evidenceStatus: "NO_EVIDENCE" })).toEqual({
      confidenceClass: "INSUFFICIENT_EVIDENCE",
      reason: "NO_SUPPORTING_EVIDENCE",
    });
    expect(at({ truthClass: "UNKNOWN" }).confidenceClass).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
  });

  it("is a pure function of its inputs, so it can be audited", () => {
    const inputs = {
      truthClass: "USER_CLAIM" as const,
      evidenceStatus: "MULTI_SOURCE_SUPPORTED" as const,
      distinctSourceCount: 3,
      hasContradictingEvidence: false,
      supportWithdrawn: false,
    };
    expect(classifyConfidence(inputs)).toEqual(classifyConfidence(inputs));
  });
});

describe("inheritance", () => {
  it("takes the NARROWEST input visibility, never the widest", () => {
    // An understanding drawn partly from founder-private material could not
    // have been reached without it, so it carries its scope.
    expect(
      derivedKnowledgeVisibility(["network_visible", "founder_private"]),
    ).toBe("founder_private");
    expect(
      derivedKnowledgeVisibility(["organisation_private", "investor_private"]),
    ).toBe("investor_private");
    expect(
      derivedKnowledgeVisibility(["personal_private", "founder_private"]),
    ).toBe("personal_private");
  });

  it("narrows a shared or public input rather than widening", () => {
    expect(derivedKnowledgeVisibility(["network_visible"])).toBe(
      "organisation_private",
    );
    expect(derivedKnowledgeVisibility(["public_external"])).toBe(
      "organisation_private",
    );
    expect(derivedKnowledgeVisibility(["relationship_shared"])).toBe(
      "organisation_private",
    );
    expect(derivedKnowledgeVisibility([])).toBe("organisation_private");
  });

  it("takes the STRONGEST input sensitivity and never descends", () => {
    expect(derivedKnowledgeSensitivity(["INTERNAL", "RESTRICTED"])).toBe(
      "RESTRICTED",
    );
    expect(
      derivedKnowledgeSensitivity(["PUBLIC", "NETWORK_VISIBLE"], "INTERNAL"),
    ).toBe("INTERNAL");
    // Combination risk: the floor is why cash + burn + payroll can imply
    // something more sensitive than any of them alone.
    expect(derivedKnowledgeSensitivity([])).toBe("CONFIDENTIAL");
  });
});

describe("value comparison and provenance", () => {
  it("does not treat different currencies as the same understanding", () => {
    expect(
      knowledgeValuesAgree(
        { kind: "MONEY", amount: 2_400_000, currency: "USD" },
        { kind: "MONEY", amount: 2_400_000, currency: "GBP" },
      ),
    ).toBe(false);
  });

  it("ignores key order but not content", () => {
    expect(
      knowledgeValuesAgree(
        { amount: 1, kind: "MONEY" },
        { kind: "MONEY", amount: 1 },
      ),
    ).toBe(true);
    expect(knowledgeValuesAgree({ amount: 1 }, { amount: 2 })).toBe(false);
    expect(knowledgeValuesAgree({ amount: 1 }, null)).toBe(false);
  });

  it("records where an understanding came from", () => {
    expect(sourceEnvironmentFor(["DOCUMENT", "USER_STATEMENT"])).toBe(
      "DOCUMENT",
    );
    expect(sourceEnvironmentFor(["USER_STATEMENT"])).toBe("CONVERSATION");
    expect(sourceEnvironmentFor([])).toBe("PLATFORM");
  });
});

describe("read authorisation is projected from the plan", () => {
  const plan = (scopes: unknown[]): PermittedContextPlan =>
    ({
      contractVersion: 1,
      policyVersion: "context-firewall-v1",
      planId: "77777777-7777-4777-8777-777777777777",
      fingerprint: "a".repeat(64),
      runId: "66666666-6666-4666-8666-666666666666",
      tenantId: "11111111-1111-4111-8111-111111111111",
      actor: { userId: "22222222-2222-4222-8222-222222222222" },
      purpose: { capability: "INVESTIGATE", taskClass: "OWN_COMPANY_QUESTION" },
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
      scopes,
      denied: [],
      maxSensitivity: "HIGHLY_CONFIDENTIAL",
      allowedLayers: ["EVIDENCE_DOCUMENTS", "STRUCTURED_STATE"],
      combinationConstraints: [],
      evaluatedAt: "2026-09-07T10:00:00.000Z",
      revalidateAfter: "2026-09-07T10:05:00.000Z",
      revalidateOnResume: true,
    }) as unknown as PermittedContextPlan;

  const scope = (overrides: Record<string, unknown>) => ({
    kind: "EVIDENCE_DOCUMENTS",
    subject: { kind: "COMPANY", companyId: COMPANY },
    contextLabel: "founder_private",
    sensitivity: "HIGHLY_CONFIDENTIAL",
    layer: "EVIDENCE_DOCUMENTS",
    factCategories: [],
    projection: "FULL",
    rights: {
      canUseForReasoning: true,
      canDiscloseExistence: true,
      canQuote: true,
      canProvideLink: false,
    },
    filter: {
      tenantId: "11111111-1111-4111-8111-111111111111",
      companyId: COMPANY,
      contextLabels: ["founder_private", "organisation_private"],
    },
    isEvidence: true,
    ...overrides,
  });

  it("keeps each scope's labels paired with its own subject", () => {
    const constraints = knowledgeConstraintsFor(plan([scope({})]));
    expect(constraints).toHaveLength(1);
    expect(constraints[0]?.subjectIds).toEqual([COMPANY]);
    expect(constraints[0]?.visibilityScopes).toEqual([
      "founder_private",
      "organisation_private",
    ]);
    expect(constraints[0]?.layer).toBe("KNOWLEDGE_OBJECTS");
  });

  it("never lets a scope exceed the run's ceiling", () => {
    const narrowed = plan([scope({})]);
    const constraints = knowledgeConstraintsFor({
      ...narrowed,
      maxSensitivity: "INTERNAL",
    });
    expect(constraints[0]?.sensitivityCeiling).toBe("INTERNAL");
  });

  it("drops a scope policy reduced to an aggregate projection", () => {
    expect(
      knowledgeConstraintsFor(plan([scope({ projection: "AGGREGATE" })])),
    ).toEqual([]);
  });

  it("authorises nothing when the plan grants no knowledge-backed scope", () => {
    expect(
      knowledgeConstraintsFor(plan([scope({ kind: "OWN_Q_CONVERSATION" })])),
    ).toEqual([]);
  });
});

describe("lifecycle vocabulary", () => {
  it("has no ninth state for a held candidate", () => {
    // A candidate waiting on a person is a CANDIDATE with a reason. Adding
    // HELD would be a competing lifecycle.
    expect(KNOWLEDGE_STATUSES).toEqual([
      "CANDIDATE",
      "ACTIVE",
      "REJECTED",
      "SUPERSEDED",
      "DISPUTED",
      "STALE",
      "REVOKED",
      "ARCHIVED",
    ]);
  });
});
