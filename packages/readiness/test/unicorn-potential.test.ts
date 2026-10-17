import { describe, expect, it } from "vitest";
import type { InvestabilityInputs } from "../src/investability/inputs.js";
import { assessUnicornPotential } from "../src/unicorn-potential/assess.js";
import {
  UNICORN_PILLARS,
  unicornStageOf,
} from "../src/unicorn-potential/method-v1.js";
const NOW = "2026-10-17T12:00:00.000Z";
const statements = [
  [
    "Founder previously built a customer solution",
    "Founder delivered a milestone",
  ],
  ["Accessible market has validated demand", "Expansion has paying customers"],
  ["Paid pilots validate the product", "Customers renewed"],
  ["Revenue growth last quarter 2026", "Revenue is non-recurring"],
  ["Modelled contribution margin", "Acquisition payback forecast"],
  [
    "Proprietary technology deployed",
    "Independent competitive benchmark shows advantage",
  ],
  ["Acquisition channel pilot", "Referrals initial"],
  ["Current runway 8 months", "Investor support proposed"],
  ["Technical commercial operations covered", "Milestones delivered on time"],
  ["Structural demand documented", "Market window deployed"],
  ["Operating leverage modelled", "Repeat deployment pilot"],
  ["Ecosystem partnership proposed", "Strategic option hypothesis"],
].flat();
function inputs(texts: readonly string[] = statements): InvestabilityInputs {
  return {
    companyId: "company-1",
    stageCode: "PRE_SEED",
    sectorCodes: ["SAAS"],
    businessModelCodes: [],
    profile: { listed: true, description: true, website: true, updatedAt: NOW },
    verification: { organisation: false, domain: false, decidedAt: null },
    founders: [],
    deck: null,
    claims: texts.map((statement, i) => ({
      id: `claim-${String(i)}`,
      claimKey: `key-${String(i)}`,
      claimType: "research",
      statement,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      visibilityScope: "network_visible",
      assertedAt: NOW,
    })),
  };
}
describe("provisional Unicorn Potential pure engine", () => {
  it("keeps twelve weights and 24 explicit criterion rubrics", () => {
    expect(UNICORN_PILLARS).toHaveLength(12);
    for (const index of [0, 1, 2])
      expect(
        UNICORN_PILLARS.reduce((n, p) => n + (p.weights[index] ?? 0), 0),
      ).toBe(100);
    for (const p of UNICORN_PILLARS)
      for (const c of p.criteria) {
        expect(c.adverse).toBeInstanceOf(RegExp);
        expect(c.limited).toBeInstanceOf(RegExp);
        expect(c.positive).toBeInstanceOf(RegExp);
      }
  });
  it("reproduces the owner's266/100 arithmetic with one final round", () => {
    const { view } = assessUnicornPotential(inputs(), NOW);
    expect(view.pillars.map((p) => p.grade)).toEqual([
      3, 3, 3, 2, 2, 3, 2, 2, 3, 3, 2, 2,
    ]);
    expect(view.overallScore).toBe(67);
    expect(view.coverage).toBe(1);
    expect(view.confidence).toBe("MODERATE");
    expect(
      view.pillars.reduce((s, p) => s + (p.contribution ?? 0), 0),
    ).toBeCloseTo(66.5);
  });
  it("does not equate missing evidence with zero", () => {
    const { view } = assessUnicornPotential(inputs([]), NOW);
    expect(view.overallScore).toBeNull();
    expect(view.coverage).toBe(0);
    expect(view.pillars.every((p) => p.grade === null)).toBe(true);
    expect(view.missing.length).toBeGreaterThan(0);
  });
  it("withholds unknown stage without guessing a benchmark", () => {
    expect(
      assessUnicornPotential({ ...inputs(), stageCode: null }, NOW).view
        .overallScore,
    ).toBeNull();
    expect(unicornStageOf("Series A")).toBe("SERIES_A_GROWTH");
    expect(unicornStageOf("GROWTH")).toBe("SERIES_A_GROWTH");
    expect(unicornStageOf("venture")).toBeNull();
  });
  it("ignores private and Q-only material even when it matches anchors", () => {
    const x = inputs();
    for (const changes of [
      { visibilityScope: "founder_private" },
      { truthClass: "Q_INFERENCE" as const },
      { evidenceStatus: "NO_EVIDENCE" as const },
    ]) {
      const result = assessUnicornPotential(
        { ...x, claims: x.claims.map((c) => ({ ...c, ...changes })) },
        NOW,
      );
      expect(result.view.coverage).toBe(0);
    }
  });
  it("preserves conflicts and repeated corrections to source states", () => {
    const x = inputs([...statements, "Founder has falsified credentials"]);
    const p = assessUnicornPotential(x, NOW).view.pillars[0];
    expect(p?.criteria[0]?.state).toBe("CONFLICTED");
    expect(p?.criteria[0]?.grade).toBeNull();
    expect(p?.criteria[0]?.sources.length).toBe(2);
  });
  it("requires mandatory pillars even with many other observed pillars", () => {
    const x = inputs(statements.slice(2));
    expect(assessUnicornPotential(x, NOW).view.overallScore).toBeNull();
  });
  it("keeps self-report below four and never HIGH confidence", () => {
    const x = inputs(
      statements.map((t) => `${t}; sustained for 12 months 2026`),
    );
    const v = assessUnicornPotential(x, NOW).view;
    expect(
      v.pillars.every((p) => p.criteria.every((c) => (c.grade ?? 0) <= 3)),
    ).toBe(true);
    expect(v.confidence).not.toBe("HIGH");
  });
  it("gives four only to documented sustained execution", () => {
    const x = inputs([
      "Founder previously built a solution sustained for 12 months 2026",
    ]);
    const first = x.claims[0];
    if (first === undefined) throw new Error("missing fixture");
    const v = assessUnicornPotential(
      {
        ...x,
        claims: [{ ...first, evidenceStatus: "MULTI_SOURCE_SUPPORTED" }],
      },
      NOW,
    ).view;
    expect(v.pillars[0]?.criteria[0]?.grade).toBe(4);
  });
  it("excludes stale and undated evidence from current scoring", () => {
    const x = inputs();
    for (const assertedAt of ["2020-01-01T00:00:00.000Z", "invalid"]) {
      const v = assessUnicornPotential(
        { ...x, claims: x.claims.map((c) => ({ ...c, assertedAt })) },
        NOW,
      ).view;
      expect(v.overallScore).toBeNull();
      expect(
        v.pillars.every((p) => p.criteria.every((c) => c.state === "STALE")),
      ).toBe(true);
    }
  });
  it("old metric periods cannot masquerade as fresh growth", () => {
    const x = inputs(["Revenue grew by 50% last quarter 2020"]);
    expect(
      assessUnicornPotential(x, NOW).view.pillars[3]?.criteria[0]?.state,
    ).toBe("STALE");
  });
  it("hash is stable under input ordering, changes for revisions and aging", () => {
    const x = inputs();
    const a = assessUnicornPotential(x, NOW);
    expect(
      assessUnicornPotential({ ...x, claims: [...x.claims].reverse() }, NOW)
        .basisHash,
    ).toBe(a.basisHash);
    expect(
      assessUnicornPotential(
        {
          ...x,
          claims: x.claims.map((c) => ({
            ...c,
            assertedAt: "2026-10-16T12:00:00.000Z",
          })),
        },
        NOW,
      ).basisHash,
    ).not.toBe(a.basisHash);
    expect(
      assessUnicornPotential(x, "2028-10-17T12:00:00.000Z").basisHash,
    ).not.toBe(a.basisHash);
  });
  it("withholds growth forecasts and negated positive claims", () => {
    const v = assessUnicornPotential(
      inputs([
        "Revenue grew by 50% next year 2027 projected",
        "No customers renewed",
      ]),
      NOW,
    ).view;
    expect(v.coverage).toBe(0);
  });
});
