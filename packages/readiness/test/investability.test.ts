import { describe, expect, it } from "vitest";

import type {
  DeckFact,
  DeckSection,
  DeckSectionCode,
} from "@capital-q/contracts";
import { DECK_SECTIONS } from "@capital-q/contracts";

import {
  assessInvestability,
  INVESTABILITY_METHOD_VERSION,
  type InvestabilityInputs,
} from "../src/index.js";

const AS_OF = "2026-10-16T12:00:00.000Z";
const READ_AT = "2026-10-10T09:00:00.000Z";

function fact(
  label: string,
  value: string,
  options: Partial<DeckFact> = {},
): DeckFact {
  return {
    label,
    value,
    unknownReason: null,
    kind: "TEXT",
    asOf: null,
    pages: [],
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MEDIUM",
    ...options,
  };
}

function section(
  code: DeckSectionCode,
  facts: readonly DeckFact[] = [],
  options: Partial<DeckSection> = {},
): DeckSection {
  return {
    section: code,
    status: "PRESENT",
    summary: `${code.toLowerCase()} summary`,
    pages: [],
    facts: [...facts],
    confidence: "MEDIUM",
    ...options,
  };
}

const figure = (
  label: string,
  value: string,
  asOf: string | null = "Sep 2026",
) => fact(label, value, { kind: "FIGURE", asOf });

function fullDeck(
  overrides: Partial<Record<DeckSectionCode, DeckSection | null>> = {},
): DeckSection[] {
  const base: Record<DeckSectionCode, DeckSection> = {
    PROBLEM: section("PROBLEM"),
    SOLUTION: section("SOLUTION"),
    VALUE_PROPOSITION: section("VALUE_PROPOSITION"),
    MARKET: section("MARKET", [figure("TAM", "$4B", null)]),
    GO_TO_MARKET: section("GO_TO_MARKET"),
    BUSINESS_MODEL: section("BUSINESS_MODEL", [
      fact("Pricing", "$20 per seat per month subscription"),
    ]),
    TRACTION: section("TRACTION", [
      figure("Monthly revenue", "$40k MRR"),
      figure("Paying customers", "120 customers"),
    ]),
    COMPETITION: section("COMPETITION", [
      fact("Alternatives", "Spreadsheets"),
      fact("Edge", "Local rails"),
    ]),
    FINANCIALS: section("FINANCIALS", [
      figure("2025 revenue", "$300k"),
      fact("Forecast", "2027 projected $2M"),
      fact("Runway", "14 months of cash"),
    ]),
    THE_ASK: section("THE_ASK", [
      fact("Raise amount", "$2M"),
      fact("Instrument", "Post-money SAFE"),
      fact("Use of funds", "Hire engineers and sales"),
    ]),
    FOUNDERS: section("FOUNDERS", [fact("CEO", "Ada")]),
    TEAM: section("TEAM", [
      fact("CTO", "Bo"),
      fact("COO", "Cy"),
      fact("Head of sales", "Di"),
    ]),
  };
  return DECK_SECTIONS.map((code) => {
    const o = overrides[code];
    if (o === null)
      return section(code, [], { status: "NOT_IN_DECK", summary: null });
    return o ?? base[code];
  });
}

function inputs(
  overrides: Partial<InvestabilityInputs> = {},
  deck: DeckSection[] | null = fullDeck(),
): InvestabilityInputs {
  return {
    companyId: "00000000-0000-4000-8000-000000000001",
    stageCode: "seed",
    sectorCodes: ["fintech"],
    businessModelCodes: ["b2b_saas"],
    profile: {
      listed: true,
      description: true,
      website: true,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    verification: { organisation: false, domain: false, decidedAt: null },
    founders: [],
    claims: [],
    deck:
      deck === null
        ? null
        : { extractionId: "ext-1", readAt: READ_AT, sections: deck },
    ...overrides,
  };
}

describe("investability (InvestIQ v1, investor-facing)", () => {
  it("is deterministic and reproducible from its inputs", () => {
    const a = assessInvestability(inputs(), AS_OF);
    const b = assessInvestability(inputs(), AS_OF);
    expect(a.view).toEqual(b.view);
    expect(a.basisHash).toBe(b.basisHash);
    expect(a.view.methodVersion).toBe(INVESTABILITY_METHOD_VERSION);
    // The clock is never part of the basis: a later recompute of the same
    // evidence records nothing new.
    expect(
      assessInvestability(inputs(), "2026-11-01T00:00:00.000Z").basisHash,
    ).toBe(a.basisHash);
    // Order of claims does not matter.
    const claims = [
      claim("c1", "traction", "network_visible"),
      claim("c2", "market", "network_visible"),
    ];
    expect(assessInvestability(inputs({ claims }), AS_OF).basisHash).toBe(
      assessInvestability(inputs({ claims: [...claims].reverse() }), AS_OF)
        .basisHash,
    );
  });

  it("scores a seed company with a confirmed deck, with coverage and confidence", () => {
    const { view } = assessInvestability(inputs(), AS_OF);
    expect(view.status).toBe("SCORED");
    expect(view.score).not.toBeNull();
    expect(Number.isInteger(view.score)).toBe(true);
    expect(view.coverage.areasTotal).toBe(8);
    expect(view.coverage.areasScored).toBeGreaterThanOrEqual(5);
    expect(view.coverage.criteriaScored).toBeLessThan(
      view.coverage.criteriaApplicable,
    );
    // Self-reported deck evidence: low confidence, band held at Developing.
    expect(view.confidence).toBe("LOW");
    expect(["DEVELOPING", "EARLY"]).toContain(view.band);
    expect(view.up.map((f) => f.label)).toContain("Traction");
    expect(view.missing.length).toBeGreaterThan(0);
  });

  it("is stage-aware: pre-revenue is never a weakness at pre-seed, but is at Series A", () => {
    const preRevenue = fullDeck({
      TRACTION: section("TRACTION", [fact("Revenue", "Pre-revenue, 3 pilots")]),
    });
    const preSeed = assessInvestability(
      inputs({ stageCode: "pre_seed" }, preRevenue),
      AS_OF,
    );
    const seriesA = assessInvestability(
      inputs({ stageCode: "series_a" }, preRevenue),
      AS_OF,
    );
    const tractionOf = (r: typeof preSeed) =>
      r.assessment.dimensions
        .flatMap((d) => d.criteria)
        .find((c) => c.criterion === "cp.traction");
    expect(tractionOf(preSeed)?.score).toBe(2);
    expect(tractionOf(seriesA)?.score).toBeLessThan(2);
    expect(seriesA.view.down.map((f) => f.label)).toContain("Traction");
    expect(preSeed.view.down.map((f) => f.label)).not.toContain("Traction");
    // Retention and profitability are not expected at pre-seed.
    const retention = preSeed.assessment.dimensions
      .flatMap((d) => d.criteria)
      .find((c) => c.criterion === "cp.retention");
    expect(retention?.state).toBe("NOT_APPLICABLE");
  });

  it("unknown lowers coverage and confidence, never the score", () => {
    const full = assessInvestability(inputs(), AS_OF).view;
    const less = assessInvestability(
      inputs({}, fullDeck({ COMPETITION: null })),
      AS_OF,
    ).view;
    expect(less.coverage.criteriaScored).toBeLessThan(
      full.coverage.criteriaScored,
    );
    // A missing criterion leaves the mean; it is never scored as zero.
    expect(less.score ?? 0).toBeGreaterThanOrEqual(full.score ?? 0);
    expect(less.confidence).toBe(full.confidence);
    // Too little shared: no number at all, and what is missing is named.
    const thin = assessInvestability(inputs({}, null), AS_OF).view;
    expect(thin.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(thin.score).toBeNull();
    expect(thin.band).toBeNull();
    expect(thin.missing.length).toBeGreaterThan(0);
    // Unknown stage: never defaulted to seed.
    const noStage = assessInvestability(
      inputs({ stageCode: null }),
      AS_OF,
    ).view;
    expect(noStage.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(noStage.missing[0]).toMatch(/Stage/u);
  });

  it("weighs founder claims below document-supported evidence", () => {
    const docTraction = fullDeck({
      TRACTION: section("TRACTION", [
        figure("Monthly revenue", "$40k MRR"),
        fact("Paying customers", "120 customers", {
          kind: "FIGURE",
          asOf: "Sep 2026",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ]),
    });
    const self = assessInvestability(inputs(), AS_OF);
    const doc = assessInvestability(inputs({}, docTraction), AS_OF);
    const of = (r: typeof self, key: string) =>
      r.assessment.dimensions
        .flatMap((d) => d.criteria)
        .find((c) => c.criterion === key)?.score ?? 0;
    expect(of(doc, "cp.traction")).toBeGreaterThan(of(self, "cp.traction"));
    expect(doc.view.score ?? 0).toBeGreaterThanOrEqual(self.view.score ?? 0);
  });

  it("more recorded information never dilutes a strength", () => {
    const strong = assessInvestability(
      inputs({
        founders: [
          founder("f1", "Co-founded Paystack-like startup, exited 2021"),
        ],
      }),
      AS_OF,
    );
    const more = assessInvestability(
      inputs({
        founders: [
          founder("f1", "Co-founded Paystack-like startup, exited 2021"),
          founder("f2", "Product manager at a bank"),
        ],
      }),
      AS_OF,
    );
    const of = (r: typeof strong) =>
      r.assessment.dimensions
        .flatMap((d) => d.criteria)
        .find((c) => c.criterion === "fl.founder_quality")?.score;
    expect(of(more)).toBe(of(strong));
    expect(of(strong)).toBeGreaterThan(2);
  });

  it("withholds a contradicted criterion instead of picking a number", () => {
    const contradictory = fullDeck({
      TRACTION: section("TRACTION", [
        figure("Monthly revenue", "$40k MRR"),
        fact("Customers", "120 or 80", { unknownReason: "CONTRADICTORY" }),
      ]),
    });
    const r = assessInvestability(inputs({}, contradictory), AS_OF);
    const traction = r.assessment.dimensions
      .flatMap((d) => d.criteria)
      .find((c) => c.criterion === "cp.traction");
    expect(traction?.state).toBe("CONFLICTED");
    expect(traction?.score).toBeNull();
    expect(r.view.down.some((f) => /withheld/u.test(f.detail))).toBe(true);
  });

  describe("Context Firewall (release-blocking)", () => {
    it("founder-private and relationship-only material never changes the investor-facing score", () => {
      const eligible = inputs({
        claims: [claim("c1", "traction", "network_visible")],
        founders: [founder("f1", "Engineer at a payments company")],
      });
      const withPrivate = inputs({
        claims: [
          claim("c1", "traction", "network_visible"),
          // Each of these would move the score if it were read.
          claim("p1", "financial.revenue", "founder_private", "VERIFIED"),
          claim("p2", "customers", "organisation_private", "VERIFIED"),
          claim("p3", "team", "relationship_shared", "VERIFIED"),
          claim("p4", "market", "specifically_shared", "VERIFIED"),
          claim("p5", "capital", "investor_private", "VERIFIED"),
          claim("p6", "traction", "personal_private", "VERIFIED"),
        ],
        founders: [
          founder("f1", "Engineer at a payments company"),
          founder("f9", "Founded and sold two companies", "founder_private"),
        ],
      });
      const a = assessInvestability(eligible, AS_OF);
      const b = assessInvestability(withPrivate, AS_OF);
      expect(b.basisHash).toBe(a.basisHash);
      expect(b.view).toEqual(a.view);
      expect(JSON.stringify(b.observations)).not.toMatch(
        /statement p[1-6]|sold two/u,
      );
    });

    it("an unlisted company is not assessed for investors at all", () => {
      const r = assessInvestability(
        inputs({
          profile: {
            listed: false,
            description: true,
            website: true,
            updatedAt: null,
          },
        }),
        AS_OF,
      );
      expect(r.observations).toHaveLength(0);
      expect(r.view.status).toBe("INSUFFICIENT_EVIDENCE");
    });
  });
});

function claim(
  id: string,
  claimType: string,
  visibilityScope: string,
  evidence: "SELF_REPORTED" | "VERIFIED" = "SELF_REPORTED",
): InvestabilityInputs["claims"][number] {
  return {
    id,
    claimType,
    claimKey: `${claimType}.k`,
    statement: `${claimType} statement ${id}`,
    truthClass: evidence === "VERIFIED" ? "VERIFIED" : "USER_CLAIM",
    evidenceStatus:
      evidence === "VERIFIED" ? "EXTERNALLY_VERIFIED" : "SELF_REPORTED",
    lifecycleStatus: "CURRENT",
    visibilityScope,
    assertedAt: "2026-10-01T00:00:00.000Z",
  };
}

function founder(
  id: string,
  title: string,
  visibilityScope = "network_visible",
): InvestabilityInputs["founders"][number] {
  return { id, title, detail: null, documentSupported: false, visibilityScope };
}
