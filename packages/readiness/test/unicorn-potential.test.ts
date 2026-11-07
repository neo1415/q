import { describe, expect, it } from "vitest";
import { UnicornPotentialDtoSchema } from "@capital-q/contracts";
import type { InvestabilityInputs } from "../src/investability/inputs.js";
import { assessUnicornPotential } from "../src/unicorn-potential/assess.js";
import {
  UNICORN_PILLARS,
  UNICORN_POTENTIAL_METHOD_VERSION,
  UNICORN_WEIGHTS_V1_0,
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
  [
    "Revenue growth last quarter 2026 through 2026-09-30",
    "Revenue is non-recurring through 2026-09-30",
  ],
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
  it("never freshens a metric from its claim assertion timestamp", () => {
    for (const statement of [
      "Revenue grew by 100% last quarter 2026",
      "Revenue grew by 100% last quarter 2024",
      "Recurring revenue 2026",
    ]) {
      const v = assessUnicornPotential(inputs([statement]), NOW).view;
      expect(v.pillars[3]?.grade).toBeNull();
    }
  });
  it("accepts a real dated metric window and excludes a historical one", () => {
    const good = assessUnicornPotential(
      inputs(["Revenue grew by 100% last quarter 2026 through 2026-09-30"]),
      NOW,
    ).view;
    expect(good.pillars[3]?.criteria[0]?.grade).toBe(3);
    const old = assessUnicornPotential(
      inputs(["Revenue grew by 100% last quarter 2024 through 2024-09-30"]),
      NOW,
    ).view;
    expect(old.pillars[3]?.criteria[0]?.state).toBe("STALE");
  });
  it("does not score denied allegations, hypothetical or competitor descriptions", () => {
    for (const text of [
      "No founder has falsified credentials",
      "Hypothetical founder has falsified credentials",
      "Competitor founder has falsified credentials",
    ]) {
      expect(assessUnicornPotential(inputs([text]), NOW).view.coverage).toBe(0);
    }
  });
  it("grades explicit concrete weakness1 without treating it as material failure0", () => {
    const v = assessUnicornPotential(
      inputs(["Current runway 4 months"]),
      NOW,
    ).view;
    expect(v.pillars[7]?.criteria[0]?.grade).toBe(1);
  });
  it("produces a valid full trust-boundary DTO without inventing history", () => {
    const { view } = assessUnicornPotential(inputs(), NOW);
    expect(
      UnicornPotentialDtoSchema.safeParse({
        ...view,
        assessedAt: NOW,
        momentum: null,
      }).success,
    ).toBe(true);
  });
  it("requires60percentweightedcoverageanddoesnotimputemissingcriteria", () => {
    const x = inputs(statements.filter((_, i) => i % 2 === 0));
    const v = assessUnicornPotential(x, NOW).view;
    // v1.1.0 weights: half of every pillar is 47% of the stage weight
    // (P8's runway criterion only ever counts distress).
    expect(v.coverage).toBeLessThan(0.6);
    expect(v.overallScore).toBeNull();
    expect(v.pillars.every((p) => p.coverage === 0.5 || p.coverage === 0)).toBe(
      true,
    );
  });
  it("affirmative adverse evidence grades zero while mere absence remains unknown", () => {
    const v = assessUnicornPotential(
      inputs(["Founder has falsified credentials"]),
      NOW,
    ).view;
    expect(v.pillars[0]?.criteria[0]?.grade).toBe(0);
    expect(v.pillars[0]?.criteria[1]?.grade).toBeNull();
  });

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
  it("reproduces the v1.1.0 arithmetic with one final round", () => {
    const { view } = assessUnicornPotential(inputs(), NOW);
    expect(view.pillars.map((p) => p.grade)).toEqual([
      3, 3, 3, 2, 2, 3, 2, 2, 3, 3, 2, 2,
    ]);
    // Pre-seed v1.1.0 weights [18,15,14,8,4,9,4,6,10,4,6,2] (sum 100):
    // Σ w·g = 270, × 25 / 100 = 67.5, rounded once = 68.
    expect(view.overallScore).toBe(68);
    expect(view.coverage).toBeCloseTo(0.97, 2);
    // All self-reported, and P8's runway criterion no longer counts: Low.
    expect(view.confidence).toBe("LOW");
    expect(
      view.pillars.reduce((s, p) => s + (p.contribution ?? 0), 0),
    ).toBeCloseTo(67.5);
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
        v.pillars.every((p) =>
          p.criteria.every((c) => c.state === "STALE" || c.state === "UNKNOWN"),
        ),
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

describe("Unicorn Potential v1.1.0 (metrics methods)", () => {
  it("is the current method; v1.0.0's weights stay on record", () => {
    expect(UNICORN_POTENTIAL_METHOD_VERSION).toBe("unicorn-potential.v1.1.0");
    expect(UNICORN_WEIGHTS_V1_0.P1).toEqual([15, 12, 8]);
    expect(UNICORN_PILLARS[0]?.weights).toEqual([18, 14, 9]);
  });

  it("runway never raises potential; only distress lowers it", () => {
    const long = assessUnicornPotential(
      inputs(["Current runway 30 months"]),
      NOW,
    ).view;
    expect(long.pillars[7]?.criteria[0]?.grade).toBeNull();
    const distress = assessUnicornPotential(
      inputs(["The company is insolvent"]),
      NOW,
    ).view;
    expect(distress.pillars[7]?.criteria[0]?.grade).toBe(0);
  });

  it("needs 8 of 12 pillars graded", () => {
    // Founder, market, problem, traction and three more: 7 pillars.
    const seven = statements.filter((_, i) => i < 14);
    expect(
      assessUnicornPotential(inputs(seven), NOW).view.overallScore,
    ).toBeNull();
  });

  it("needs traction from seed on", () => {
    const noTraction = statements.filter((_, i) => i !== 6 && i !== 7);
    const seed = assessUnicornPotential(
      { ...inputs(noTraction), stageCode: "SEED" },
      NOW,
    ).view;
    expect(seed.pillars[3]?.grade).toBeNull();
    expect(seed.overallScore).toBeNull();
  });

  it("calls a self-reported grade 3 stated, not demonstrated (P1-13)", () => {
    const v = assessUnicornPotential(inputs(), NOW).view;
    const anchors = v.pillars.flatMap((p) =>
      p.criteria.filter((c) => c.grade === 3).map((c) => c.anchor),
    );
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor).toBe(
        "Stage-appropriate execution, as the company states it",
      );
    }
  });
});
