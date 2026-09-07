import { describe, expect, it } from "vitest";

import type { UtcTimestamp } from "@capital-q/contracts";

import {
  assessFreshness,
  classifyMateriality,
  compareKnowledge,
  effectiveFrom,
  freshnessRuleFor,
  isCorrectionOf,
  KNOWLEDGE_FRESHNESS_POLICY_VERSION,
  KnowledgeCandidateSchema,
  periodsOverlap,
  samePeriod,
  selectAsOf,
  selectCurrent,
  type ComparableKnowledge,
} from "../src/index.js";

/**
 * The deterministic half of CQ-KNW-003 (§45-§47): time, difference and age.
 *
 * Every case here is a statement Capital Q must never make about a company's
 * own numbers — that growth is a discrepancy, that a forecast is a lie, that
 * a corrected typo is a decline, that an old figure is a false one. None of
 * them needs a model to judge, a database to store or a clock to tick, so
 * none of them is left to an eval.
 */

const t = (value: string): UtcTimestamp => value;

const money = (amount: number, currency = "USD") => ({
  kind: "MONEY",
  amount,
  currency,
});

const knowledge = (
  overrides: Partial<ComparableKnowledge> = {},
): ComparableKnowledge => ({
  knowledgeKey: "financial.arr",
  definitionQualifier: null,
  measurementBasis: "ACTUAL",
  structuredValue: money(2_400_000),
  validFrom: null,
  validTo: null,
  recordedAt: t("2026-09-01T00:00:00.000Z"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// KNWC-001..003 · valid time is not record time
// ---------------------------------------------------------------------------

describe("KNWC-001 · two clocks", () => {
  it("an undated assertion is about the moment it was made", () => {
    expect(
      effectiveFrom({
        validFrom: null,
        validTo: null,
        recordedAt: t("2026-06-01T00:00:00.000Z"),
      }),
    ).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
  });

  it("a dated assertion is about its period, not about when we heard it", () => {
    expect(
      effectiveFrom({
        validFrom: t("2026-01-01T00:00:00.000Z"),
        validTo: null,
        recordedAt: t("2026-09-01T00:00:00.000Z"),
      }),
    ).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});

describe("KNWC-002 · periods", () => {
  const january = {
    validFrom: t("2026-01-01T00:00:00.000Z"),
    validTo: t("2026-02-01T00:00:00.000Z"),
    recordedAt: t("2026-02-02T00:00:00.000Z"),
  };
  const august = {
    validFrom: t("2026-08-01T00:00:00.000Z"),
    validTo: t("2026-09-01T00:00:00.000Z"),
    recordedAt: t("2026-09-02T00:00:00.000Z"),
  };

  it("distinct months are neither the same period nor overlapping", () => {
    expect(samePeriod(january, august)).toBe(false);
    expect(periodsOverlap(january, august)).toBe(false);
  });

  it("an open-ended period spanning another's start overlaps it", () => {
    expect(periodsOverlap({ ...january, validTo: null }, august)).toBe(true);
  });

  it("two undated assertions are about the same thing", () => {
    const undated = {
      validFrom: null,
      validTo: null,
      recordedAt: t("2026-09-01T00:00:00.000Z"),
    };
    expect(samePeriod(undated, { ...undated })).toBe(true);
  });
});

describe("KNWC-003 · as of", () => {
  const series = [
    {
      id: "january",
      validFrom: t("2026-01-01T00:00:00.000Z"),
      validTo: null,
      recordedAt: t("2026-01-02T00:00:00.000Z"),
    },
    {
      id: "august",
      validFrom: t("2026-08-01T00:00:00.000Z"),
      validTo: null,
      recordedAt: t("2026-08-02T00:00:00.000Z"),
    },
  ];

  it("answers from valid time, not from what was learned most recently", () => {
    expect(selectAsOf(series, new Date("2026-06-15T00:00:00.000Z"))?.id).toBe(
      "january",
    );
  });

  it("never returns a reading from the future of the question", () => {
    expect(selectAsOf(series, new Date("2025-12-01T00:00:00.000Z"))).toBeNull();
  });

  it("the current reading is the latest effective one", () => {
    expect(
      selectCurrent(series, new Date("2026-09-01T00:00:00.000Z"))?.id,
    ).toBe("august");
  });

  it("a later record of the same period wins, which is what a correction is", () => {
    const june = {
      id: "june",
      validFrom: t("2026-06-01T00:00:00.000Z"),
      validTo: null,
      recordedAt: t("2026-06-02T00:00:00.000Z"),
    };
    const corrected = {
      ...june,
      id: "corrected",
      recordedAt: t("2026-07-01T00:00:00.000Z"),
    };
    expect(
      selectAsOf([june, corrected], new Date("2026-06-15T00:00:00.000Z"))?.id,
    ).toBe("corrected");
  });
});

// ---------------------------------------------------------------------------
// KNWC-004..008 · difference is not contradiction
// ---------------------------------------------------------------------------

describe("KNWC-004 · growth is not a discrepancy", () => {
  it("January ARR and August ARR are a series", () => {
    const result = compareKnowledge(
      knowledge({
        structuredValue: money(1_800_000),
        validFrom: t("2026-01-01T00:00:00.000Z"),
        validTo: t("2026-02-01T00:00:00.000Z"),
      }),
      knowledge({
        structuredValue: money(2_400_000),
        validFrom: t("2026-08-01T00:00:00.000Z"),
        validTo: t("2026-09-01T00:00:00.000Z"),
      }),
    );
    expect(result.verdict).toBe("DIFFERENT_PERIOD");
    expect(result.conflictKind).toBeNull();
  });
});

describe("KNWC-005 · a definition is not a disagreement", () => {
  it("gross ARR and ARR net of churn both stand", () => {
    const result = compareKnowledge(
      knowledge({
        definitionQualifier: "gross",
        structuredValue: money(2_400_000),
      }),
      knowledge({
        definitionQualifier: "net_of_churn",
        structuredValue: money(2_100_000),
      }),
    );
    expect(result.verdict).toBe("ACCEPTED_DIFFERENCE");
    expect(result.reason).toBe("DIFFERENT_DEFINITION");
  });
});

describe("KNWC-006 · a forecast is not a competing measurement", () => {
  it("a 4m projection beside a 2m actual is not a conflict", () => {
    const result = compareKnowledge(
      knowledge({
        measurementBasis: "FORECAST",
        structuredValue: money(4_000_000),
      }),
      knowledge({
        measurementBasis: "ACTUAL",
        structuredValue: money(2_000_000),
      }),
    );
    expect(result.verdict).toBe("DIFFERENT_BASIS");
    expect(result.conflictKind).toBeNull();
  });
});

describe("KNWC-007 · different questions", () => {
  it("FY revenue and current ARR are not commensurable", () => {
    const result = compareKnowledge(
      knowledge({ knowledgeKey: "financial.revenue_fy" }),
      knowledge({ knowledgeKey: "financial.arr" }),
    );
    expect(result.verdict).toBe("DIFFERENT_SUBJECT_MATTER");
  });
});

describe("KNWC-008 · currency is not settled by inventing a rate", () => {
  it("naira against dollars is incomparable, never a contradiction", () => {
    const result = compareKnowledge(
      knowledge({ structuredValue: money(100_000_000, "NGN") }),
      knowledge({ structuredValue: money(65_000, "USD") }),
    );
    expect(result.verdict).toBe("INCOMPARABLE");
    expect(result.reason).toBe("DIFFERENT_CURRENCY");
    expect(result.conflictKind).toBe("CURRENCY_MISMATCH");
  });

  it("a count against an amount of money is incomparable", () => {
    const result = compareKnowledge(
      knowledge({ structuredValue: { kind: "COUNT", value: 12 } }),
      knowledge({ structuredValue: money(12) }),
    );
    expect(result.verdict).toBe("INCOMPARABLE");
    expect(result.conflictKind).toBe("UNIT_MISMATCH");
  });
});

describe("KNWC-009 · what a real conflict looks like", () => {
  it("same metric, period, definition, basis and currency, different amount", () => {
    const result = compareKnowledge(
      knowledge({ structuredValue: money(2_400_000) }),
      knowledge({ structuredValue: money(1_800_000) }),
    );
    expect(result.verdict).toBe("CONTRADICTION");
    expect(result.conflictKind).toBe("VALUE_MISMATCH");
  });

  it("identical values agree", () => {
    expect(compareKnowledge(knowledge(), knowledge()).verdict).toBe("SAME");
  });

  it("prose against prose cannot be shown to disagree", () => {
    const result = compareKnowledge(
      knowledge({ structuredValue: null }),
      knowledge(),
    );
    expect(result.verdict).toBe("INCOMPARABLE");
    expect(result.reason).toBe("VALUE_ABSENT");
  });
});

describe("KNWC-010 · materiality is not invented", () => {
  it("a genuine conflict is UNDETERMINED, not sized by a made-up threshold", () => {
    const conflict = compareKnowledge(
      knowledge({ structuredValue: money(2_400_000) }),
      knowledge({ structuredValue: money(2_399_999) }),
    );
    expect(classifyMateriality(conflict)).toBe("UNDETERMINED");
  });

  it("agreement is immaterial", () => {
    expect(
      classifyMateriality(compareKnowledge(knowledge(), knowledge())),
    ).toBe("IMMATERIAL");
  });
});

// ---------------------------------------------------------------------------
// KNWC-011 · corrections
// ---------------------------------------------------------------------------

describe("KNWC-011 · a correction restates a period", () => {
  const june = {
    validFrom: t("2026-06-01T00:00:00.000Z"),
    validTo: t("2026-07-01T00:00:00.000Z"),
    recordedAt: t("2026-06-02T00:00:00.000Z"),
  };

  it("the same period, recorded later, is a correction", () => {
    expect(
      isCorrectionOf(
        { ...june, recordedAt: t("2026-07-15T00:00:00.000Z") },
        june,
      ),
    ).toBe(true);
  });

  it("a later period is growth, not a correction", () => {
    expect(
      isCorrectionOf(
        {
          validFrom: t("2026-08-01T00:00:00.000Z"),
          validTo: t("2026-09-01T00:00:00.000Z"),
          recordedAt: t("2026-09-02T00:00:00.000Z"),
        },
        june,
      ),
    ).toBe(false);
  });

  it("a candidate cannot correct a period by asserting that it does", () => {
    // The flag is a request. The gate reads it only after the periods match,
    // so `correctsEarlier` can never supersede an inconvenient figure.
    const parsed = KnowledgeCandidateSchema.safeParse({
      subject: {
        subjectType: "COMPANY",
        subjectId: "44444444-4444-4444-8444-444444444444",
      },
      knowledgeType: "fact",
      knowledgeKey: "financial.arr",
      statement: "ARR was 1.75m in June.",
      structuredValue: { kind: "MONEY", amount: 1_750_000, currency: "USD" },
      truthClassProposal: "USER_CLAIM",
      supportingClaimIds: [],
      supportingEvidenceItemIds: ["55555555-5555-4555-8555-555555555555"],
      supportingSourceIds: [],
      validFrom: null,
      validTo: null,
      lineage: [],
      reason: "CORRECTION",
      correctsEarlier: true,
    });
    expect(parsed.success).toBe(true);
    // Conservative by default: a caller that never heard of corrections
    // never sends one.
    expect(
      KnowledgeCandidateSchema.parse({
        subject: {
          subjectType: "COMPANY",
          subjectId: "44444444-4444-4444-8444-444444444444",
        },
        knowledgeType: "fact",
        knowledgeKey: "financial.arr",
        statement: "ARR is 2.4m.",
        structuredValue: null,
        truthClassProposal: "USER_CLAIM",
        supportingClaimIds: [],
        supportingEvidenceItemIds: ["55555555-5555-4555-8555-555555555555"],
        supportingSourceIds: [],
        validFrom: null,
        validTo: null,
        lineage: [],
        reason: "EXTRACTED_FROM_DOCUMENT",
      }).correctsEarlier,
    ).toBe(false);
    expect(
      KnowledgeCandidateSchema.parse({
        subject: {
          subjectType: "COMPANY",
          subjectId: "44444444-4444-4444-8444-444444444444",
        },
        knowledgeType: "fact",
        knowledgeKey: "financial.arr",
        statement: "ARR is 2.4m.",
        structuredValue: null,
        truthClassProposal: "USER_CLAIM",
        supportingClaimIds: [],
        supportingEvidenceItemIds: ["55555555-5555-4555-8555-555555555555"],
        supportingSourceIds: [],
        validFrom: null,
        validTo: null,
        lineage: [],
        reason: "EXTRACTED_FROM_DOCUMENT",
      }).measurementBasis,
    ).toBe("ACTUAL");
  });
});

// ---------------------------------------------------------------------------
// KNWC-012 · stale is not false
// ---------------------------------------------------------------------------

describe("KNWC-012 · freshness", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");

  it("a cash balance from May is stale in September", () => {
    const result = assessFreshness(
      {
        knowledgeKey: "financial.cash_balance",
        validFrom: t("2026-05-01T00:00:00.000Z"),
        recordedAt: t("2026-05-02T00:00:00.000Z"),
        lastVerifiedAt: null,
      },
      now,
    );
    expect(result.stale).toBe(true);
    expect(result.reason).toBe("EXCEEDED_USEFUL_LIFE");
    expect(result.policyVersion).toBe(KNOWLEDGE_FRESHNESS_POLICY_VERSION);
  });

  it("re-verifying makes it current again", () => {
    expect(
      assessFreshness(
        {
          knowledgeKey: "financial.cash_balance",
          validFrom: t("2026-05-01T00:00:00.000Z"),
          recordedAt: t("2026-05-02T00:00:00.000Z"),
          lastVerifiedAt: t("2026-08-25T00:00:00.000Z"),
        },
        now,
      ).stale,
    ).toBe(false);
  });

  it("a key with no declared policy never ages by time alone", () => {
    const result = assessFreshness(
      {
        knowledgeKey: "company.headquarters",
        validFrom: t("2019-01-01T00:00:00.000Z"),
        recordedAt: t("2019-01-01T00:00:00.000Z"),
        lastVerifiedAt: null,
      },
      now,
    );
    expect(result.stale).toBe(false);
    expect(result.reason).toBe("NO_POLICY_FOR_KEY");
    expect(freshnessRuleFor("company.headquarters")).toBeNull();
  });

  it("every declared rule carries the reasoning for its number", () => {
    const rule = freshnessRuleFor("financial.burn_rate");
    expect(rule?.usefulForDays).toBe(90);
    expect(rule?.rationale.length).toBeGreaterThan(20);
  });
});
