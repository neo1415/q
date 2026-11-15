import { describe, expect, it } from "vitest";

import {
  GATEQ_STATEMENT_VIEW_VERSION,
  type GateqDimensionStatements,
  type GateqDossierV2,
  type GateqStatementViewV1,
  type GateqStatementWords,
} from "@capital-q/contracts";
import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import {
  coverageFromView,
  withSettledGaps,
} from "../src/application/statement-words.js";

/**
 * Live 15 Nov 2026: founder review and the dossier listed Customers as
 * Missing beside "from 1 clinic to 4" on traction, which the interview's
 * settled predicate (question-needs) and the investor's one-page summary
 * already read as the customers answer. Every surface now reads that one
 * predicate: what it settles is never Missing, and a stated unknown is
 * reported as not known.
 */

let ids = 0;
const id = () =>
  `00000000-0000-4000-8000-${(++ids).toString(16).padStart(12, "0")}`;

function said(
  summary: string,
  overrides: Partial<GateqStatementWords> = {},
): GateqStatementWords {
  return {
    statementId: id(),
    sourceKind: "APPLICATION_STATEMENT",
    backfilled: false,
    valueKind: "TEXT",
    declined: false,
    summary,
    words: summary,
    quantity: null,
    asOf: null,
    provenance: "APPLICANT_PROVIDED",
    sourceTurnSeq: 3,
    statedAt: "2026-11-15T09:00:00.000Z",
    ...overrides,
  };
}

function dimension(
  name: string,
  status: GateqDimensionStatements["status"],
  statements: readonly GateqStatementWords[],
): GateqDimensionStatements {
  return {
    dimension: name,
    label: name,
    group: null,
    status,
    statements: [...statements],
    superseded: [],
    disagreements: [],
  };
}

const FOUR_CLINICS = said("4 clinics", {
  valueKind: "COUNT",
  quantity: "customers",
  words: "we went from 1 clinic to 4",
});

const VIEW: GateqStatementViewV1 = {
  version: GATEQ_STATEMENT_VIEW_VERSION,
  dimensions: [
    dimension("claims.traction", "SETTLED", [FOUR_CLINICS]),
    dimension("company.market", "UNKNOWN", [
      said("Not known", { valueKind: "UNKNOWN" }),
    ]),
  ],
};

const policy = { criteria: [] } as unknown as GatewayPolicy;
const qualification = {
  access: "GRANTED",
  criteria: [],
  unknowns: [],
} as unknown as QualificationResult;

describe("founder review reads the settled predicate", () => {
  const coverage = coverageFromView({
    policy,
    qualification,
    facts: [],
    view: VIEW,
    includeSources: true,
  });
  const missing = coverage.missing.map((gap) => gap.dimension);

  it("lists Customers as answered by a customer count said elsewhere", () => {
    expect(missing).not.toContain("company.customers");
    const customers = coverage.answered.find(
      (item) => item.dimension === "company.customers",
    );
    expect(customers?.summary).toBe("4 clinics");
    expect(customers?.sourceFactId).toBe(FOUR_CLINICS.statementId);
  });

  it("reports a stated unknown as not known, never Missing", () => {
    expect(missing).not.toContain("company.market");
    expect(coverage.unknown.map((gap) => gap.dimension)).toContain(
      "company.market",
    );
  });

  it("still lists what nothing answers", () => {
    expect(missing).toContain("company.team");
    expect(missing).not.toContain("raise.currency");
  });
});

describe("a frozen dossier's gaps are read through the same predicate", () => {
  const gap = (dimension: string, label: string) => ({
    dimension,
    label,
    group: "MARKET" as const,
  });
  // Frozen before the fix: Customers and Market both listed Missing.
  const frozen = {
    schemaVersion: "gateq-dossier.v2",
    statements: VIEW,
    unknowns: [],
    declined: [],
    missing: [
      { ...gap("company.customers", "Customers"), reason: "UNDERSTANDING" },
      { ...gap("company.market", "Market"), reason: "UNDERSTANDING" },
      { ...gap("company.team", "Team"), reason: "UNDERSTANDING" },
    ],
    diligenceQuestions: [
      {
        dimension: "company.customers",
        basis: "MISSING",
        question: "Who are your customers?",
      },
      {
        dimension: "company.market",
        basis: "MISSING",
        question: "How large is the market?",
      },
      { dimension: "company.team", basis: "MISSING", question: "Who's on it?" },
    ],
    diligenceQuestionsTotal: 3,
  } as unknown as GateqDossierV2;

  const read = withSettledGaps(frozen);

  it("drops a gap the view answers and moves a stated unknown", () => {
    expect(read.missing.map((g) => g.dimension)).toEqual(["company.team"]);
    expect(read.unknowns.map((g) => g.dimension)).toEqual(["company.market"]);
  });

  it("keeps the diligence questions in step", () => {
    expect(read.diligenceQuestions.map((q) => [q.dimension, q.basis])).toEqual([
      ["company.market", "UNKNOWN"],
      ["company.team", "MISSING"],
    ]);
    expect(read.diligenceQuestionsTotal).toBe(2);
  });

  it("never rewrites the frozen row", () => {
    expect(frozen.missing).toHaveLength(3);
  });
});
