import { describe, expect, it } from "vitest";

import type { QSubjectRef, UtcTimestamp } from "@capital-q/contracts";
import type { AuthorisedFact } from "@capital-q/q-core";
import type { CompanyIntelligenceFinding } from "@capital-q/q-core";

import {
  assembleCompanyContext,
  assertsAbsence,
  assertsForbiddenClaim,
  asksAboutChange,
  asksAboutGaps,
  boundedTruthClass,
  coverageByDimension,
  dimensionForKnowledgeKey,
  focusFromQuestion,
  informationConfidence,
  institutionalNotes,
  labelAt,
  validateModelFindings,
  type LabelledFact,
} from "../src/index.js";

/**
 * The deterministic half of CQ-Q-020 (§96): what a model wrote, what
 * Capital Q will accept from it, and what Capital Q says without asking.
 *
 * Every case here is a statement Q must never make about a company —
 * that an absence is a weakness, that a claim is verified, that a number
 * it invented is evidence, that it can rank the company against peers,
 * that a citation exists because a model wrote one. None of them needs a
 * model to judge or a database to store, so none of them is left to an
 * eval.
 */

const t = (value: string): UtcTimestamp => value;
const RUN = "11111111-1111-4111-8111-111111111111";
const COMPANY: QSubjectRef = {
  kind: "COMPANY",
  companyId: "22222222-2222-4222-8222-222222222222",
};

let seq = 0;
const findingId = () =>
  `33333333-3333-4333-8333-${String(++seq).padStart(12, "0")}` as never;

function fact(overrides: Partial<AuthorisedFact> = {}): AuthorisedFact {
  return {
    scope: "KNOWLEDGE_OBJECTS",
    statement: "ARR was 2.4m USD in August 2026.",
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    ...overrides,
  };
}

function labelled(
  index: number,
  overrides: Partial<LabelledFact> = {},
): LabelledFact {
  const label = labelAt(index);
  return {
    fact: { ...fact(), ref: label },
    label,
    dimension: "FINANCIAL",
    evidenceRefs: [
      { kind: "SOURCE", sourceId: "44444444-4444-4444-8444-444444444444" },
    ],
    stale: false,
    disputed: false,
    validAt: null,
    ...overrides,
  };
}

function context(facts: readonly LabelledFact[]) {
  return {
    facts,
    subjectDescription: "a synthetic test company",
    byLabel: new Map(facts.map((f) => [f.label, f] as const)),
  };
}

function validate(
  findings: readonly CompanyIntelligenceFinding[],
  facts: readonly LabelledFact[] = [labelled(0)],
) {
  return validateModelFindings({
    findings,
    context: context(facts),
    runId: RUN,
    subjects: [COMPANY],
    sensitivity: "INTERNAL",
    visibilityScope: "organisation_private",
    validAt: t("2026-09-07T00:00:00.000Z"),
    findingId,
  });
}

function modelFinding(
  overrides: Partial<CompanyIntelligenceFinding> = {},
): CompanyIntelligenceFinding {
  return {
    dimension: "FINANCIAL",
    type: "OBSERVATION",
    statement: "ARR was 2.4m USD in August 2026.",
    truthClass: "USER_CLAIM",
    confidence: "MODERATE",
    citations: ["F1"],
    assumptions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// QCIU-001..004 · a model cannot cite what it was not shown
// ---------------------------------------------------------------------------

describe("QCIU-001 · citations resolve or are dropped", () => {
  it("keeps a citation the render actually showed", () => {
    const result = validate([modelFinding({ citations: ["F1"] })]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.evidenceRefs).toHaveLength(1);
    expect(result.rejectedCitations).toBe(0);
  });

  it("drops a label that was never shown, and keeps no reference for it", () => {
    const result = validate([modelFinding({ citations: ["F1", "F99"] })]);
    expect(result.rejectedCitations).toBe(1);
    expect(result.accepted[0]?.evidenceRefs).toHaveLength(1);
  });

  it("a finding citing only invented labels carries no evidence at all", () => {
    const result = validate([
      modelFinding({
        statement: "The company has a defensible position in its market.",
        citations: ["F42"],
      }),
    ]);
    expect(result.accepted[0]?.evidenceRefs).toEqual([]);
    expect(result.accepted[0]?.evidenceStatus).toBe("NO_EVIDENCE");
  });
});

describe("QCIU-002 · general model knowledge is not entity evidence", () => {
  it("drops an unsupported specific number", () => {
    const result = validate([
      modelFinding({
        dimension: "TEAM",
        type: "FACT",
        statement: "Northstar has 80 employees.",
        citations: [],
      }),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedFindings).toBe(1);
  });

  it("keeps an unsupported qualitative observation, at no evidence", () => {
    const result = validate([
      modelFinding({
        dimension: "PRODUCT",
        type: "INFERENCE",
        statement:
          "The product appears to serve enterprise buyers rather than individuals.",
        citations: [],
      }),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.truthClass).toBe("Q_INFERENCE");
    expect(result.accepted[0]?.confidence).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("QCIU-003 · truth class is bounded by what supports it", () => {
  it("a claim resting on a USER_CLAIM cannot become VERIFIED", () => {
    expect(boundedTruthClass("VERIFIED", [labelled(0)], "FACT")).toBe(
      "USER_CLAIM",
    );
  });

  it("an inference stays an inference however well supported", () => {
    expect(
      boundedTruthClass(
        "VERIFIED",
        [
          labelled(0, {
            fact: { ...fact({ truthClass: "VERIFIED" }), ref: "F1" },
          }),
        ],
        "INFERENCE",
      ),
    ).toBe("Q_INFERENCE");
  });

  it("VERIFIED survives only by restating something already verified", () => {
    expect(
      boundedTruthClass(
        "VERIFIED",
        [
          labelled(0, {
            fact: { ...fact({ truthClass: "VERIFIED" }), ref: "F1" },
          }),
        ],
        "FACT",
      ),
    ).toBe("VERIFIED");
  });
});

describe("QCIU-004 · no score, no fit, no probability, no benchmark", () => {
  it.each([
    "Overall company score: 72 out of 100.",
    "Funding likelihood appears high for this stage.",
    "Investor fit is strong for growth-stage funds.",
    "Revenue growth is above-average for seed companies.",
    "This places the company in the top 10% of its peer group.",
    "Traction sits in the top decile.",
    "The company is investable on current evidence.",
  ])("drops %s", (statement) => {
    expect(assertsForbiddenClaim(statement)).toBe(true);
    expect(validate([modelFinding({ statement })]).accepted).toHaveLength(0);
  });

  it("keeps a specific, evidence-linked strength", () => {
    const result = validate([
      modelFinding({
        type: "STRENGTH",
        dimension: "TRACTION",
        statement:
          "Customer count rose from 4 to 11 between the January and August readings.",
      }),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.type).toBe("STRENGTH");
  });
});

// ---------------------------------------------------------------------------
// QCIU-005..007 · missing is not bad
// ---------------------------------------------------------------------------

describe("QCIU-005 · absence becomes a gap, never a risk", () => {
  it.each([
    "No evidence of customer retention is available.",
    "Gross margin was not disclosed in any source.",
    "Runway is unknown.",
    "Nothing establishes the size of the team.",
  ])("reclassifies %s", (statement) => {
    expect(assertsAbsence(statement)).toBe(true);
    const result = validate([modelFinding({ type: "RISK", statement })]);
    expect(result.accepted[0]?.type).toBe("GAP");
  });

  it("a real, supported risk stays a risk", () => {
    const result = validate([
      modelFinding({
        type: "RISK",
        dimension: "CUSTOMERS",
        statement:
          "One customer accounts for 64% of recorded revenue, so the loss of that contract would remove most of it.",
      }),
    ]);
    expect(result.accepted[0]?.type).toBe("RISK");
  });

  it("an absence claim is never rejected for lacking support", () => {
    // A gap is ABOUT there being no support; requiring support for it
    // would delete the only honest answer.
    const result = validate([
      modelFinding({
        type: "GAP",
        statement: "No evidence of 12-month retention is available.",
        citations: [],
      }),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.type).toBe("GAP");
  });
});

// ---------------------------------------------------------------------------
// QCIU-006..008 · confidence, staleness, disagreement
// ---------------------------------------------------------------------------

describe("QCIU-006 · confidence follows the evidence, not the model", () => {
  it("a disputed supporting fact forces CONFLICTING_EVIDENCE", () => {
    const result = validate(
      [modelFinding({ confidence: "HIGH" })],
      [labelled(0, { disputed: true })],
    );
    expect(result.accepted[0]?.confidence).toBe("CONFLICTING_EVIDENCE");
  });

  it("a stale supporting fact cannot carry a HIGH confidence claim", () => {
    const result = validate(
      [modelFinding({ confidence: "HIGH" })],
      [labelled(0, { stale: true })],
    );
    expect(result.accepted[0]?.confidence).toBe("MODERATE");
  });
});

describe("QCIU-007 · information confidence describes the evidence", () => {
  it("no facts is insufficient evidence, not a low opinion of the company", () => {
    expect(informationConfidence([], [])).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("only self-reported facts is LOW confidence in the understanding", () => {
    expect(
      informationConfidence(
        [
          labelled(0, {
            fact: { ...fact({ evidenceStatus: "SELF_REPORTED" }), ref: "F1" },
          }),
        ],
        [],
      ),
    ).toBe("LOW");
  });

  it("an open disagreement makes the understanding conflicting", () => {
    expect(
      informationConfidence(
        [labelled(0)],
        [
          {
            set: { knowledgeKey: "financial.arr" },
            members: [],
          } as never,
        ],
      ),
    ).toBe("CONFLICTING_EVIDENCE");
  });
});

describe("QCIU-008 · the trusted frame names the disagreement, never the figures", () => {
  it("says a conflict exists and about what, and carries no value", () => {
    const notes = institutionalNotes({
      disputes: [
        {
          set: { id: "s1", knowledgeKey: "financial.arr" },
          members: [
            { object: { statement: "ARR is 2.4m USD" } },
            { object: { statement: "ARR is 1.9m USD" } },
          ],
        } as never,
      ],
      staleKeys: ["financial.cash_balance"],
      changes: [],
      asOf: null,
    });
    expect(notes).toContain("OPEN DISAGREEMENT on financial.arr");
    expect(notes).toContain("do not choose, average or prefer one");
    expect(notes).not.toContain("2.4m");
    expect(notes).not.toContain("1.9m");
    expect(notes).toContain("PAST ITS USEFUL LIFE: financial.cash_balance");
  });

  it("a historical question is told nothing later is available", () => {
    const notes = institutionalNotes({
      disputes: [],
      staleKeys: [],
      changes: [],
      asOf: new Date("2026-01-31T00:00:00.000Z"),
    });
    expect(notes).toContain("historical question");
    expect(notes).toContain("Nothing about a later period is available");
  });

  it("says so plainly when nothing was established", () => {
    expect(
      institutionalNotes({
        disputes: [],
        staleKeys: [],
        changes: [],
        asOf: null,
      }),
    ).toBe("Nothing was established in advance for this request.");
  });
});

// ---------------------------------------------------------------------------
// QCIU-009..011 · dimensions, coverage, assembly order
// ---------------------------------------------------------------------------

describe("QCIU-009 · knowledge keys map to dimensions", () => {
  it.each([
    ["financial.arr", "FINANCIAL"],
    ["team.size", "TEAM"],
    ["market.segment", "MARKET"],
    ["customer.retention", "CUSTOMERS"],
    ["capital.objective", "CAPITAL_OBJECTIVE"],
    ["commercial.customer_concentration", "CUSTOMERS"],
    ["commercial.pricing_model", "BUSINESS_MODEL"],
  ])("%s → %s", (key, dimension) => {
    expect(dimensionForKnowledgeKey(key)).toBe(dimension);
  });

  it("an unmapped key is null, and its facts still travel", () => {
    expect(dimensionForKnowledgeKey("something.nobody.mapped")).toBeNull();
  });

  it("reads a focus from the question without narrowing what may be read", () => {
    expect(focusFromQuestion("what are the main risks to runway?")).toContain(
      "FINANCIAL",
    );
    expect(focusFromQuestion("who are its customers?")).toContain("CUSTOMERS");
    expect(focusFromQuestion("hello")).toEqual([]);
    expect(asksAboutChange("what changed since January?")).toBe(true);
    expect(asksAboutGaps("what don't we know?")).toBe(true);
  });
});

describe("QCIU-010 · coverage is a vocabulary, never a percentage", () => {
  it("reports the best evidence status among a dimension's facts", () => {
    const coverage = coverageByDimension(
      [
        labelled(0, {
          fact: { ...fact({ evidenceStatus: "SELF_REPORTED" }), ref: "F1" },
        }),
        labelled(1, {
          fact: {
            ...fact({ evidenceStatus: "DOCUMENT_SUPPORTED" }),
            ref: "F2",
          },
          evidenceRefs: [
            {
              kind: "SOURCE",
              sourceId: "55555555-5555-4555-8555-555555555555",
            },
          ],
        }),
      ],
      [],
    );
    const financial = coverage.find((c) => c.dimension === "FINANCIAL");
    // Two facts, two distinct sources: multi-source support is a property
    // of the dimension, not of either source alone.
    expect(financial?.coverage).toBe("MULTI_SOURCE_SUPPORTED");
    expect(financial?.supportingFactCount).toBe(2);
  });

  it("counts a finding's own support, so a document-evidenced dimension is not INSUFFICIENT", () => {
    // A retrieved passage carries no dimension of its own. Reading
    // coverage from facts alone would report INSUFFICIENT beside a finding
    // that plainly rests on a document.
    const accepted = validate([
      modelFinding({ dimension: "MARKET", citations: ["F1"] }),
    ]).accepted;
    const coverage = coverageByDimension([], accepted);
    expect(coverage.find((c) => c.dimension === "MARKET")?.coverage).toBe(
      "DOCUMENT_SUPPORTED",
    );
  });

  it("a dimension with only a gap on it stays INSUFFICIENT", () => {
    const accepted = validate([
      modelFinding({
        dimension: "MARKET",
        type: "GAP",
        statement: "No evidence of market size is available.",
        citations: [],
      }),
    ]).accepted;
    const coverage = coverageByDimension([], accepted);
    expect(coverage.find((c) => c.dimension === "MARKET")?.coverage).toBe(
      "INSUFFICIENT",
    );
  });
});

describe("QCIU-011 · canonical state is assembled before documents", () => {
  it("labels facts in hierarchy order, canonical first", () => {
    const assembled = assembleCompanyContext({
      plan: { subjects: [], maxSensitivity: "INTERNAL" } as never,
      canonicalFacts: [
        fact({ scope: "CAPITAL_OBJECTIVE", statement: "Raising 2m USD." }),
      ],
      knowledge: [],
      passages: [],
      subjectDescription: "a synthetic test company",
    });
    expect(assembled.facts[0]?.label).toBe("F1");
    expect(assembled.facts[0]?.fact.scope).toBe("CAPITAL_OBJECTIVE");
    expect(assembled.byLabel.get("F1")).toBeDefined();
  });
});
