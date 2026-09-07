import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CAPABILITIES,
  Q_KNOWLEDGE_SCOPE_KINDS,
  Q_SENSITIVITY_RANK,
  Q_TASK_CLASSES,
  QAuthorisedKnowledgeScopeSchema,
  sensitivityWithin,
  strongerSensitivity,
  type QAuthorisedKnowledgeScope,
  type QSubjectKind,
} from "@capital-q/contracts";

import {
  actorWideScopeKinds,
  applyCombinationRules,
  candidateScopeKinds,
  COMBINATION_RISK_RULES,
  CONTEXT_FIREWALL_POLICY_VERSION,
  deriveTaskClass,
  SCOPE_CATALOGUE,
  sensitivityCeiling,
  type SubjectRelation,
} from "../src/index.js";

/**
 * The pure policies, exhaustively. No database, no ports: these are the
 * tables and rules the firewall composes, and a change to any of them is a
 * policy-version change.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

function scope(
  kind: QAuthorisedKnowledgeScope["kind"],
  overrides: Partial<QAuthorisedKnowledgeScope> = {},
): QAuthorisedKnowledgeScope {
  const spec = SCOPE_CATALOGUE[kind];
  return {
    kind,
    subject: { kind: "COMPANY", companyId: COMPANY },
    contextLabel: spec.defaultLabel,
    sensitivity: spec.sharedSensitivity,
    layer: spec.layer,
    factCategories: [...spec.factCategories],
    projection: "FULL",
    rights: {
      canUseForReasoning: true,
      canDiscloseExistence: true,
      canQuote: false,
      canProvideLink: false,
    },
    filter: { tenantId: TENANT, companyId: COMPANY },
    isEvidence: spec.isEvidence,
    ...overrides,
  };
}

describe("policy version", () => {
  it("is explicit and stable", () => {
    expect(CONTEXT_FIREWALL_POLICY_VERSION).toBe("context-firewall-v1");
    expect(CONTEXT_FIREWALL_POLICY_VERSION).not.toMatch(/latest/i);
  });
});

describe("scope catalogue", () => {
  it("covers every knowledge scope kind exactly once and has no wildcard", () => {
    expect(Object.keys(SCOPE_CATALOGUE).sort()).toEqual(
      [...Q_KNOWLEDGE_SCOPE_KINDS].sort(),
    );
    expect(Q_KNOWLEDGE_SCOPE_KINDS).not.toContain("ALL_DATA");
    expect(JSON.stringify(SCOPE_CATALOGUE)).not.toMatch(/ALL|WILDCARD|\*/);
  });

  it("keeps founder-private, investor-private and document scopes owner-only or explicitly shared", () => {
    expect(SCOPE_CATALOGUE.COMPANY_PRIVATE_FINANCIALS.sharedVia).toBeNull();
    expect(SCOPE_CATALOGUE.INVESTOR_MANDATE.sharedVia).toBeNull();
    expect(SCOPE_CATALOGUE.EVIDENCE_DOCUMENTS.sharedVia).toBeNull();
    expect(SCOPE_CATALOGUE.COMPANY_CAPITAL_OBJECTIVE.sharedVia).toBe(
      "capital_objective",
    );
    expect(SCOPE_CATALOGUE.COMPANY_PRIVATE_FINANCIALS.ownerCapability).toBe(
      "company.financials.view",
    );
  });

  it("never treats the model's general knowledge as evidence", () => {
    expect(SCOPE_CATALOGUE.GENERAL_MODEL_KNOWLEDGE.isEvidence).toBe(false);
    expect(SCOPE_CATALOGUE.GENERAL_MODEL_KNOWLEDGE.layer).toBe("GENERAL_MODEL");
    expect(SCOPE_CATALOGUE.COMPANY_PROFILE.isEvidence).toBe(true);
  });

  it("keeps context label and sensitivity as two axes", () => {
    // founder_private + HIGHLY_CONFIDENTIAL is a valid combination, and the
    // same label appears with other sensitivities.
    expect(SCOPE_CATALOGUE.COMPANY_PRIVATE_FINANCIALS.defaultLabel).toBe(
      "founder_private",
    );
    expect(SCOPE_CATALOGUE.COMPANY_PRIVATE_FINANCIALS.ownerSensitivity).toBe(
      "HIGHLY_CONFIDENTIAL",
    );
    expect(SCOPE_CATALOGUE.COMPANY_CAPITAL_OBJECTIVE.defaultLabel).toBe(
      "founder_private",
    );
    expect(SCOPE_CATALOGUE.COMPANY_CAPITAL_OBJECTIVE.ownerSensitivity).toBe(
      "CONFIDENTIAL",
    );
  });
});

describe("purpose policy", () => {
  it("derives a task class for every capability and subject mix, never accepting one", () => {
    for (const capability of Q_CAPABILITIES) {
      for (const kind of [
        "COMPANY",
        "INVESTOR_ORGANISATION",
        "RELATIONSHIP",
        "CAPITAL_OBJECTIVE",
        "DOCUMENT",
        "USER",
        "ORGANISATION",
      ] as const satisfies readonly QSubjectKind[]) {
        for (const relation of [
          "OWNER",
          "COUNTERPARTY",
          "NETWORK",
          "SELF",
        ] as const) {
          const taskClass = deriveTaskClass(capability, [{ kind, relation }]);
          expect(Q_TASK_CLASSES).toContain(taskClass);
        }
      }
      expect(Q_TASK_CLASSES).toContain(deriveTaskClass(capability, []));
    }
    expect(
      deriveTaskClass("ANSWER", [{ kind: "COMPANY", relation: "OWNER" }]),
    ).toBe("OWN_COMPANY_QUESTION");
    expect(
      deriveTaskClass("ANSWER", [{ kind: "COMPANY", relation: "NETWORK" }]),
    ).toBe("COUNTERPARTY_COMPANY_QUESTION");
    expect(deriveTaskClass("ANSWER", [])).toBe("GENERAL_QUESTION");
    expect(deriveTaskClass("PREPARE_ACTION", [])).toBe("ACTION_PREPARATION");
    // There is no support, admin or investigation task class to escalate to.
    expect(Q_TASK_CLASSES.join(" ")).not.toMatch(
      /ADMIN|SUPPORT|INTERNAL|PLATFORM/,
    );
  });

  it("gives a plain answer the minimum: profile and capital objective, no financials or documents", () => {
    expect(candidateScopeKinds("ANSWER", "COMPANY")).toEqual([
      "COMPANY_PROFILE",
      "COMPANY_CAPITAL_OBJECTIVE",
    ]);
    expect(candidateScopeKinds("INVESTIGATE", "COMPANY")).toContain(
      "COMPANY_PRIVATE_FINANCIALS",
    );
    expect(candidateScopeKinds("CLASSIFY", "COMPANY")).toEqual([
      "COMPANY_PROFILE",
    ]);
    expect(candidateScopeKinds("PREPARE_ACTION", "COMPANY")).toEqual([
      "COMPANY_PROFILE",
    ]);
    expect(candidateScopeKinds("ANSWER", "ORGANISATION")).toEqual([]);
  });

  it("only ever proposes catalogue kinds", () => {
    for (const capability of Q_CAPABILITIES) {
      for (const kind of [
        "COMPANY",
        "INVESTOR_ORGANISATION",
        "RELATIONSHIP",
        "CAPITAL_OBJECTIVE",
        "DOCUMENT",
        "USER",
        "ORGANISATION",
      ] as const satisfies readonly QSubjectKind[]) {
        for (const scopeKind of candidateScopeKinds(capability, kind)) {
          expect(Q_KNOWLEDGE_SCOPE_KINDS).toContain(scopeKind);
        }
      }
      for (const scopeKind of actorWideScopeKinds(capability)) {
        expect(Q_KNOWLEDGE_SCOPE_KINDS).toContain(scopeKind);
      }
    }
  });

  it("caps sensitivity by task and never admits RESTRICTED", () => {
    for (const taskClass of Q_TASK_CLASSES) {
      expect(sensitivityCeiling(taskClass)).not.toBe("RESTRICTED");
    }
    expect(sensitivityCeiling("ACTION_PREPARATION")).toBe("CONFIDENTIAL");
    expect(sensitivityCeiling("OWN_COMPANY_QUESTION")).toBe(
      "HIGHLY_CONFIDENTIAL",
    );
  });
});

describe("sensitivity helpers", () => {
  it("orders explicitly and inherits the strongest", () => {
    expect(Q_SENSITIVITY_RANK.RESTRICTED).toBeGreaterThan(
      Q_SENSITIVITY_RANK.HIGHLY_CONFIDENTIAL,
    );
    expect(strongerSensitivity("PUBLIC", "CONFIDENTIAL")).toBe("CONFIDENTIAL");
    expect(strongerSensitivity("HIGHLY_CONFIDENTIAL", "INTERNAL")).toBe(
      "HIGHLY_CONFIDENTIAL",
    );
    expect(sensitivityWithin("CONFIDENTIAL", "CONFIDENTIAL")).toBe(true);
    expect(sensitivityWithin("HIGHLY_CONFIDENTIAL", "CONFIDENTIAL")).toBe(
      false,
    );
  });
});

describe("combination-risk rules", () => {
  const relationOf =
    (relation: SubjectRelation) => (_scope: QAuthorisedKnowledgeScope) =>
      relation;

  it("withdraws the financial primitives from a non-owner when the liquidity set co-occurs", () => {
    // Individually "permitted" by construction of this test: each scope
    // passed on its own. Together, for a counterparty, they are the runway.
    const permitted = [
      scope("COMPANY_PRIVATE_FINANCIALS"),
      scope("COMPANY_CAPITAL_OBJECTIVE"),
      scope("COMPANY_PROFILE"),
    ];
    const outcome = applyCombinationRules(
      permitted,
      relationOf("COUNTERPARTY"),
    );
    expect(outcome.scopes.map((s) => s.kind)).not.toContain(
      "COMPANY_PRIVATE_FINANCIALS",
    );
    expect(outcome.denied).toEqual([
      expect.objectContaining({
        kind: "COMPANY_PRIVATE_FINANCIALS",
        reason: "COMBINATION_RISK",
      }),
    ]);
    expect(outcome.constraints.map((c) => c.ruleId)).toContain(
      "LIQUIDITY_POSITION",
    );
  });

  it("reduces a shared capital objective to an aggregate when relationship history is also present", () => {
    const permitted = [
      scope("COMPANY_CAPITAL_OBJECTIVE"),
      scope("RELATIONSHIP_CONTEXT", {
        subject: { kind: "RELATIONSHIP", relationshipId: COMPANY },
      }),
    ];
    const outcome = applyCombinationRules(
      permitted,
      relationOf("COUNTERPARTY"),
    );
    const objective = outcome.scopes.find(
      (s) => s.kind === "COMPANY_CAPITAL_OBJECTIVE",
    );
    expect(objective?.projection).toBe("AGGREGATE");
    expect(objective?.factCategories).not.toContain("FUNDING_DEADLINE");
    expect(objective?.factCategories).toContain("RAISE_TARGET");
    expect(outcome.constraints.map((c) => c.ruleId)).toContain(
      "NEGOTIATION_LEVERAGE",
    );
  });

  it("never constrains the owning side, and never adds a scope", () => {
    const permitted = [
      scope("COMPANY_PRIVATE_FINANCIALS"),
      scope("COMPANY_CAPITAL_OBJECTIVE"),
      scope("RELATIONSHIP_CONTEXT"),
    ];
    const owner = applyCombinationRules(permitted, relationOf("OWNER"));
    expect(owner.scopes).toEqual(permitted);
    expect(owner.constraints).toEqual([]);

    const counterparty = applyCombinationRules(
      permitted,
      relationOf("NETWORK"),
    );
    expect(counterparty.scopes.length).toBeLessThanOrEqual(permitted.length);
    for (const scope of counterparty.scopes) {
      expect(permitted.map((p) => p.kind)).toContain(scope.kind);
    }
  });

  it("applies every rule to non-owners only, with a threshold above one", () => {
    for (const rule of COMBINATION_RISK_RULES) {
      expect(rule.appliesTo).not.toContain("OWNER");
      expect(rule.threshold).toBeGreaterThanOrEqual(2);
    }
    // A single category never fires a rule.
    const single = applyCombinationRules(
      [scope("COMPANY_CAPITAL_OBJECTIVE")],
      relationOf("COUNTERPARTY"),
    );
    expect(single.constraints).toEqual([]);
  });
});

describe("plan and scope contracts", () => {
  const base = {
    contractVersion: 1,
    policyVersion: CONTEXT_FIREWALL_POLICY_VERSION,
    planId: "33333333-3333-4333-8333-333333333333",
    fingerprint: "a".repeat(64),
    runId: "44444444-4444-4444-8444-444444444444",
    tenantId: TENANT,
    actor: { userId: "55555555-5555-4555-8555-555555555555" },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [scope("GENERAL_MODEL_KNOWLEDGE", { subject: undefined })],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: ["GENERAL_MODEL"],
    combinationConstraints: [],
    evaluatedAt: "2026-09-06T10:00:00.000Z",
    revalidateAfter: "2026-09-06T10:15:00.000Z",
    revalidateOnResume: true,
  };

  it("parses a minimal plan and is strict about every level", () => {
    expect(PermittedContextPlanSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { allData: true },
      { grantedBy: "model" },
      { content: "cash is 3m" },
      { policyVersion: "latest" },
      { revalidateOnResume: false },
      { scopes: [{ kind: "ALL_DATA" }] },
      {
        scopes: [
          scope("COMPANY_PROFILE", {
            filter: { tenantId: TENANT, table: "core.companies" } as never,
          }),
        ],
      },
      {
        scopes: [
          scope("COMPANY_PROFILE", {
            rights: { canUseForReasoning: false } as never,
          }),
        ],
      },
    ]) {
      expect(
        PermittedContextPlanSchema.safeParse({ ...base, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it("rejects a scope carrying content or an unknown kind", () => {
    expect(
      QAuthorisedKnowledgeScopeSchema.safeParse({
        ...scope("COMPANY_PROFILE"),
        excerpt: "FOUNDER-PRIVATE-SECRET-DO-NOT-LEAK",
      }).success,
    ).toBe(false);
    expect(
      QAuthorisedKnowledgeScopeSchema.safeParse({
        ...scope("COMPANY_PROFILE"),
        kind: "EVERYTHING",
      }).success,
    ).toBe(false);
  });
});
