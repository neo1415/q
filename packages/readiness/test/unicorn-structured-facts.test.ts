import { describe, it, expect } from "vitest";
import type { DeckSection } from "@capital-q/contracts";
import {
  confirmedNarrativeSignals,
  metricDate,
  deckStructuredFact,
} from "../src/unicorn-potential/structured-facts.js";
import { assessUnicornPotential } from "../src/unicorn-potential/assess.js";
import type { InvestabilityInputs } from "../src/investability/inputs.js";
const NOW = "2026-10-17T12:00:00.000Z";
function company(
  key: string,
  value: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, unknown>> = {},
): InvestabilityInputs {
  return {
    companyId: "test-company",
    stageCode: "SEED",
    sectorCodes: [],
    businessModelCodes: [],
    profile: { listed: true, description: true, website: true, updatedAt: NOW },
    verification: { organisation: false, domain: false, decidedAt: null },
    founders: [],
    deck: null,
    claims: [
      {
        id: "claim",
        claimType: key.split(".")[0] ?? "metric",
        claimKey: key,
        statement: "Canonical company metric",
        structuredValue: value,
        assertedAt: NOW,
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        lifecycleStatus: "CURRENT",
        visibilityScope: "network_visible",
        ...changes,
      },
    ],
  };
}
const criterion = (x: InvestabilityInputs, p: number, c = 0) =>
  assessUnicornPotential(x, NOW).view.pillars[p]?.criteria[c];
describe("canonical structured evidence mapping", () => {
  it("omits expired and future sources from persisted observations so recompute can authorize remaining evidence", () => {
    for (const changes of [
      { validTo: NOW },
      { validTo: "2026-10-16T12:00:00.000Z" },
      { validFrom: "2026-10-18T12:00:00.000Z" },
      { validFrom: "invalid" },
    ]) {
      const input = company(
        "financial.arr",
        {
          kind: "MONEY",
          amount: "1000000",
          currency: "USD",
          asOf: "2026-09-30",
        },
        changes,
      );
      expect(assessUnicornPotential(input, NOW).observations).toEqual([]);
    }
  });
  it("dates confirmed founder experience as evidence capture, never a measurement window", () => {
    const facts = confirmedNarrativeSignals(
      "FOUNDERS",
      "Professional background",
      "Previously worked for 12 years in industry",
      NOW,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      pillar: "P1",
      criterion: "A",
      grade: 2,
      at: NOW,
    });
    expect(facts[0]?.rule).toContain("not a metric measurement date");
  });
  it("does not infer founder quality or team complementarity from names and titles", () => {
    expect(
      confirmedNarrativeSignals(
        "FOUNDERS",
        "Founders",
        "Person A CEO; Person B CTO",
        NOW,
      ),
    ).toEqual([]);
    expect(
      confirmedNarrativeSignals("TEAM", "Team", "CEO CTO COO", NOW),
    ).toEqual([]);
  });
  it("does not use capture time for growth, unit economics, cash or timed delivery", () => {
    for (const section of [
      "TRACTION",
      "FINANCIALS",
      "BUSINESS_MODEL",
      "THE_ASK",
      "TEAM",
    ]) {
      expect(
        confirmedNarrativeSignals(
          section,
          "Growth and cash metrics",
          "Revenue grew 50%, current runway 18 months, 70% margin and milestones delivered on time",
          NOW,
        ),
      ).toEqual([]);
    }
  });
  it("normalizes actual month names and currency symbols but not an undated year", () => {
    expect(metricDate("September 2026")).toBe("2026-09-01T00:00:00.000Z");
    expect(metricDate("2026")).toBeNull();
    expect(
      deckStructuredFact({
        label: "Current ARR",
        value: "£2.7m",
        kind: "FIGURE",
        asOf: "September 2026",
      }),
    ).toMatchObject({
      claimKey: "financial.arr",
      structuredValue: { currency: "GBP", amount: "2700000" },
    });
  });
  it("allows only bounded section-related narrative observations", () => {
    expect(
      confirmedNarrativeSignals(
        "PROBLEM",
        "Problem",
        "SMEs face unreliable manual workflows",
        NOW,
      ),
    ).toMatchObject([{ pillar: "P3", criterion: "A", grade: 2 }]);
    expect(
      confirmedNarrativeSignals(
        "TEAM",
        "Problem",
        "SMEs face unreliable manual workflows",
        NOW,
      ),
    ).toEqual([]);
    expect(
      confirmedNarrativeSignals(
        "COMPETITION",
        "Moat",
        "Proprietary licensed data",
        NOW,
      ),
    ).toMatchObject([{ pillar: "P6", criterion: "A", grade: 2 }]);
  });

  it("supports canonical PERCENTAGE as well as source PERCENT vocabulary", () => {
    for (const kind of ["PERCENTAGE", "PERCENT"]) {
      expect(
        criterion(
          company("financial.nrr", { kind, value: "118", asOf: "2026-09-30" }),
          2,
          1,
        )?.grade,
      ).toBe(3);
    }
  });
  it("does not promote a financial estimate to actual revenue", () => {
    expect(
      criterion(
        company(
          "financial.arr",
          {
            kind: "MONEY",
            amount: "6400000",
            currency: "USD",
            asOf: "2026-09-30",
          },
          { truthClass: "ESTIMATE" },
        ),
        2,
      )?.grade,
    ).toBeNull();
  });
  it("normalizes confirmed deck figures but never an unconfirmed Q read", () => {
    const x = company("unknown", {});
    const section: DeckSection = {
      section: "TRACTION",
      status: "PRESENT",
      summary: null,
      pages: [2],
      confidence: "HIGH",
      facts: [
        {
          label: "ARR",
          value: "USD 6.4m",
          kind: "FIGURE",
          asOf: "2026-09-30",
          pages: [2],
          unknownReason: null,
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
          confidence: "HIGH",
        },
      ],
    };
    const base = {
      ...x,
      claims: [],
      deck: { extractionId: "deck", readAt: NOW, sections: [section] },
    };
    expect(criterion(base, 3, 1)?.grade).toBe(3);
    expect(
      criterion(
        {
          ...base,
          deck: { ...base.deck, sections: [], unconfirmed: [section] },
        },
        3,
        1,
      )?.grade,
    ).toBeNull();
  });
  it("rejects private, inferred, disputed, forecast and expired actual metrics", () => {
    for (const changes of [
      { visibilityScope: "founder_private" },
      { truthClass: "Q_INFERENCE" },
      { lifecycleStatus: "CONTRADICTORY" },
      { statement: "Projected annual recurring revenue" },
      { validTo: "2026-09-01T00:00:00.000Z" },
      { validFrom: "2027-01-01T00:00:00.000Z" },
    ]) {
      const x = company(
        "financial.arr",
        {
          kind: "MONEY",
          amount: "6400000",
          currency: "USD",
          asOf: "2026-09-30",
        },
        changes,
      );
      expect(criterion(x, 2)?.grade).toBeNull();
    }
  });
  it("typed key and value dominate unrelated English phrases", () => {
    const x = company(
      "unknown.field",
      { kind: "COUNT", value: 200, asOf: "2026-09-30" },
      { statement: "Founder previously built a solution" },
    );
    expect(assessUnicornPotential(x, NOW).view.coverage).toBe(0);
  });
  it("retention below100 is mixed, not a fabricated sector failure threshold", () => {
    expect(
      criterion(
        company("financial.nrr", {
          kind: "PERCENT",
          value: "88",
          asOf: "2026-09-30",
        }),
        2,
        1,
      )?.grade,
    ).toBe(2);
  });
  it("requires comparable explicit growth start/end and metric definitions", () => {
    const x = company("traction.growth", {
      kind: "PERCENT",
      value: "25",
      metric: "REVENUE",
      periodStart: "2026-06-30",
      periodEnd: "2026-09-30",
    });
    expect(criterion(x, 3)?.grade).toBe(3);
    const y = company("traction.growth", {
      kind: "PERCENT",
      value: "25",
      metric: "REVENUE",
      asOf: "2026-09-30",
    });
    expect(criterion(y, 3)?.grade).toBeNull();
  });
  it("hashes a correction even when value changes retain the same rubric grade", () => {
    const a = company("financial.arr", {
      kind: "MONEY",
      amount: "6400000",
      currency: "USD",
      asOf: "2026-09-30",
    });
    const b = company("financial.arr", {
      kind: "MONEY",
      amount: "6500000",
      currency: "USD",
      asOf: "2026-09-30",
    });
    expect(assessUnicornPotential(a, NOW).basisHash).not.toBe(
      assessUnicornPotential(b, NOW).basisHash,
    );
  });
  it("reads founder biography creation time rather than profile touch time", () => {
    const x = company("unknown", {});
    const founder = {
      id: "founder",
      title: "Founder previously worked in payments",
      detail: null,
      documentSupported: false,
      visibilityScope: "network_visible",
      recordedAt: "2026-09-30T00:00:00.000Z",
    };
    expect(criterion({ ...x, claims: [], founders: [founder] }, 0)?.grade).toBe(
      3,
    );
    expect(
      criterion(
        { ...x, claims: [], founders: [{ ...founder, recordedAt: null }] },
        0,
      )?.grade,
    ).toBeNull();
  });

  it("reads actual ARR as willingness to pay and recurring quality, never growth velocity", () => {
    const x = company("financial.arr", {
      kind: "MONEY",
      amount: "6400000",
      currency: "USD",
      asOf: "2026-09-30",
    });
    expect(criterion(x, 2)?.grade).toBe(3);
    expect(criterion(x, 3, 1)?.grade).toBe(3);
    expect(criterion(x, 3)?.state).toBe("UNKNOWN");
  });
  it("recognizes paying accounts without pretending they are retained customers", () => {
    const x = company("customers.paying_accounts", {
      kind: "COUNT",
      value: 212,
      asOf: "2026-09-30",
    });
    expect(criterion(x, 2)?.grade).toBe(3);
    expect(criterion(x, 2, 1)?.grade).toBe(2);
  });
  it("keeps malformed currency, negative counts and unknown keys unknown", () => {
    for (const x of [
      company("financial.arr", {
        kind: "MONEY",
        amount: "42",
        currency: "ZZZ",
        asOf: "2026-09-30",
      }),
      company("customers.paying_accounts", {
        kind: "COUNT",
        value: -2,
        asOf: "2026-09-30",
      }),
      company("unknown.arr", {
        kind: "MONEY",
        amount: "42",
        currency: "USD",
        asOf: "2026-09-30",
      }),
    ])
      expect(assessUnicornPotential(x, NOW).view.coverage).toBe(0);
  });
  it("requires the metric period and preserves age instead of using assertion time", () => {
    for (const value of [
      { kind: "MONEY", amount: "6400000", currency: "USD" },
      { kind: "MONEY", amount: "6400000", currency: "USD", asOf: "2025-12-31" },
    ])
      expect(
        criterion(company("financial.arr", value), 3, 1)?.grade,
      ).toBeNull();
  });
  it("retention requires typed period evidence, not NRR vocabulary alone", () => {
    expect(
      criterion(
        company("financial.nrr", {
          kind: "PERCENT",
          value: "118",
          asOf: "2026-09-30",
        }),
        2,
        1,
      )?.grade,
    ).toBe(3);
    expect(
      criterion(
        company("financial.nrr", { kind: "PERCENT", value: "118" }),
        2,
        1,
      )?.grade,
    ).toBeNull();
  });
  it("source revision and input changes affect immutable assessment basis", () => {
    const x = company(
      "financial.arr",
      { kind: "MONEY", amount: "6400000", currency: "USD", asOf: "2026-09-30" },
      { revisionId: "revision-1", revisionNumber: 1 },
    );
    const y = company(
      "financial.arr",
      { kind: "MONEY", amount: "6500000", currency: "USD", asOf: "2026-09-30" },
      { revisionId: "revision-2", revisionNumber: 2 },
    );
    expect(assessUnicornPotential(x, NOW).basisHash).not.toBe(
      assessUnicornPotential(y, NOW).basisHash,
    );
    expect(criterion(y, 2)?.sources[0]?.revision).toBe("revision-2");
  });
});
